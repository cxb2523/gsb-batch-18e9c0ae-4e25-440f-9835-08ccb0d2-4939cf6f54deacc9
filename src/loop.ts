/**
 * Fixed-timestep accumulator loop.
 *
 * Render frames have arbitrary elapsed times. Each frame, this module computes
 * how many deterministic 128Hz ticks fit in the accumulated time, divides the
 * frame's mouse delta across exactly those ticks, and commits one snapshot per
 * tick. Pause/blur/focus boundaries clear stale time and mouse backlog.
 */

import {
  TICK_DT,
  advancePhysics,
  createPhysicsState,
  createSnapshot,
  DEFAULT_PHYSICS_CONFIG,
} from './physics.ts';
import type {
  PhysicsConfig,
  PhysicsSnapshot,
  PhysicsState,
  TickInput,
  Vec3,
} from './physics.ts';
import { InterpolatedView, clamp01, interpolateSnapshots } from './view.ts';
import type { RenderSnapshot } from './view.ts';

export interface FrameInput extends TickInput {
  /** Elapsed render-frame time in seconds. */
  deltaSeconds?: number;
  /** Alias used by some frame loops. */
  elapsedSeconds?: number;
  /** Timestamp in seconds for frameAt(). */
  nowSeconds?: number;
}

export interface DistributedTickInput extends TickInput {
  /** Zero-based index among ticks driven by the originating frame. */
  index: number;
  /** Number of ticks driven by the originating frame. */
  tickCountInFrame: number;
  /** Equal real-frame time share; retained for input sampling/debugging. */
  realElapsedShare: number;
}

export interface TickBudget {
  tickCount: number;
  remainder: number;
  alpha: number;
}

export interface FrameResult {
  ran: boolean;
  frameDeltaSeconds: number;
  tickCount: number;
  tickInputs: DistributedTickInput[];
  accumulator: number;
  alpha: number;
  state: PhysicsState;
  previousSnapshot: PhysicsSnapshot;
  currentSnapshot: PhysicsSnapshot;
}

export interface FixedTickLoopOptions {
  stepSeconds?: number;
  config?: Partial<PhysicsConfig>;
  initialState?: Partial<PhysicsState>;
  /** Optional safety cap. Excess accumulated time remains for later frames. */
  maxTicksPerFrame?: number;
}

/**
 * Split a total as evenly as practical. Mouse deltas are commonly integral, so
 * the final share absorbs floating-point/rounding residue. The returned shares
 * sum to the original total (within one floating-point operation).
 */
export function splitEvenly(total: number, count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [total];

  const base = total / count;
  const shares = new Array<number>(count);
  let used = 0;
  for (let index = 0; index < count - 1; index += 1) {
    shares[index] = base;
    used += base;
  }
  // Put rounding residue in the final share so reduction sums to total.
  shares[count - 1] = total - used;
  return shares;
}

/** Divide mouse and other per-frame analog input across the ticks in a frame. */
export function distributeFrameInput(
  input: FrameInput,
  tickCount: number,
  frameDeltaSeconds = 0,
  accumulatedMouse: Vec3 = { x: 0, y: 0, z: 0 },
): DistributedTickInput[] {
  if (tickCount <= 0) return [];

  const totalX = (input.mouseDeltaX ?? 0) + accumulatedMouse.x;
  const totalY = (input.mouseDeltaY ?? 0) + accumulatedMouse.y;
  const xShares = splitEvenly(totalX, tickCount);
  const yShares = splitEvenly(totalY, tickCount);
  const timeShares = splitEvenly(frameDeltaSeconds, tickCount);
  const {
    deltaSeconds: _deltaSeconds,
    elapsedSeconds: _elapsedSeconds,
    nowSeconds: _nowSeconds,
    ...tickInput
  } = input;

  return Array.from({ length: tickCount }, (_, index) => {
    const tick: DistributedTickInput = {
      ...tickInput,
      mouseDeltaX: xShares[index],
      mouseDeltaY: yShares[index],
      index,
      tickCountInFrame: tickCount,
      realElapsedShare: timeShares[index],
    };
    return tick;
  });
}

/**
 * Cut accumulated time into fixed steps.
 *
 * A small epsilon prevents binary floating-point error from turning an exact
 * 60/240Hz rational schedule into an accidental extra/missing tick.
 */
export function planTickBudget(
  accumulatorSeconds: number,
  frameDeltaSeconds: number,
  stepSeconds: number = TICK_DT,
  maxTicksPerFrame: number = Number.POSITIVE_INFINITY,
): TickBudget {
  const safeDelta = Number.isFinite(frameDeltaSeconds) && frameDeltaSeconds > 0
    ? frameDeltaSeconds
    : 0;
  const safeAccumulator = Number.isFinite(accumulatorSeconds) && accumulatorSeconds > 0
    ? accumulatorSeconds
    : 0;

  const total = safeAccumulator + safeDelta;
  const tickEpsilon = 1e-10;
  let tickCount = Math.floor(total / stepSeconds + tickEpsilon);

  if (Number.isFinite(maxTicksPerFrame)) {
    tickCount = Math.min(tickCount, Math.max(0, Math.floor(maxTicksPerFrame)));
  }

  let remainder = total - tickCount * stepSeconds;
  if (Math.abs(remainder) < 1e-12) remainder = 0;
  if (stepSeconds - remainder < 1e-12) {
    tickCount += 1;
    remainder = 0;
  }

  return {
    tickCount,
    remainder,
    alpha: clamp01(remainder / stepSeconds),
  };
}

/**
 * Stateful accumulator and snapshot owner. This class is DOM-free; browser
 * code only needs to call frameAt() from requestAnimationFrame and forward
 * blur/visibility events to blur()/focus().
 */
export class FixedTickLoop {
  readonly stepSeconds: number;
  readonly config: PhysicsConfig;

  state: PhysicsState;
  previousSnapshot: PhysicsSnapshot;
  currentSnapshot: PhysicsSnapshot;
  snapshots: [PhysicsSnapshot, PhysicsSnapshot];

  accumulator = 0;
  alpha = 0;
  committedTickCount = 0;
  paused = false;
  focused = true;

  pendingMouseDelta: { x: number; y: number } = { x: 0, y: 0 };
  lastFrameResult: FrameResult | null = null;

  private lastNowSeconds: number | null = null;
  private resetClockNextFrame = false;
  private readonly maxTicksPerFrame: number;

  /** Renderer-facing read-only interpolation object. */
  readonly view: InterpolatedView;

  constructor(stepSecondsOrOptions: number | FixedTickLoopOptions = {}, maybeOptions: FixedTickLoopOptions = {}) {
    const options: FixedTickLoopOptions = typeof stepSecondsOrOptions === 'number'
      ? { ...maybeOptions, stepSeconds: stepSecondsOrOptions }
      : stepSecondsOrOptions;

    this.stepSeconds = options.stepSeconds ?? TICK_DT;
    this.config = { ...DEFAULT_PHYSICS_CONFIG, ...options.config };
    this.state = createPhysicsState(options.initialState);
    const initialSnapshot = createSnapshot(this.state);
    this.previousSnapshot = initialSnapshot;
    this.currentSnapshot = initialSnapshot;
    this.snapshots = [initialSnapshot, initialSnapshot];
    this.maxTicksPerFrame = options.maxTicksPerFrame ?? Number.POSITIVE_INFINITY;

    // The loop itself implements SnapshotReader because it exposes
    // previousSnapshot/currentSnapshot/alpha.
    this.view = new InterpolatedView(this);
  }

  /** Clear all time/input backlog. Safe to call from pause/blur handlers. */
  discardBacklog(): void {
    this.accumulator = 0;
    this.alpha = 0;
    this.pendingMouseDelta.x = 0;
    this.pendingMouseDelta.y = 0;
  }

  pause(): void {
    this.paused = true;
    this.discardBacklog();
  }

  resume(): void {
    this.paused = false;
    this.discardBacklog();
    this.resetClockNextFrame = true;
  }

  blur(): void {
    this.focused = false;
    this.discardBacklog();
    this.resetClockNextFrame = true;
  }

  focus(): void {
    this.focused = true;
    this.discardBacklog();
    this.resetClockNextFrame = true;
  }

  handleVisibilityChange(visibilityState: 'visible' | 'hidden'): void {
    if (visibilityState === 'hidden') this.blur();
    else this.focus();
  }

  queueMouseDelta(delta: { x?: number; y?: number } | number, y?: number): void {
    if (typeof delta === 'number') {
      this.pendingMouseDelta.x += delta;
      this.pendingMouseDelta.y += y ?? 0;
    } else {
      this.pendingMouseDelta.x += delta.x ?? 0;
      this.pendingMouseDelta.y += delta.y ?? 0;
    }
  }

  /** Convenience alias supporting both update(input) and update(dt, input). */
  update(deltaSeconds: number, input?: FrameInput): FrameResult;
  update(input?: FrameInput): FrameResult;
  update(
    deltaOrInput: number | FrameInput = {},
    maybeInput: FrameInput = {},
  ): FrameResult {
    if (typeof deltaOrInput === 'number') {
      return this.frame({ ...maybeInput, deltaSeconds: deltaOrInput });
    }
    return this.frame(deltaOrInput);
  }

  /** Drive a frame from an explicit elapsed delta (useful in tests/replays). */
  frame(input: FrameInput = {}): FrameResult {
    const frameDeltaSeconds = input.deltaSeconds ?? input.elapsedSeconds ?? 0;

    if (this.paused || !this.focused) {
      // Never allow a background interval or stale mouse delta to queue up.
      this.discardBacklog();
      const result: FrameResult = {
        ran: false,
        frameDeltaSeconds,
        tickCount: 0,
        tickInputs: [],
        accumulator: 0,
        alpha: 0,
        state: this.state,
        previousSnapshot: this.previousSnapshot,
        currentSnapshot: this.currentSnapshot,
      };
      this.lastFrameResult = result;
      return result;
    }

    const budget = planTickBudget(
      this.accumulator,
      frameDeltaSeconds,
      this.stepSeconds,
      this.maxTicksPerFrame,
    );

    let mouseCarry: Vec3 = { x: this.pendingMouseDelta.x, y: this.pendingMouseDelta.y, z: 0 };

    let tickInputs: DistributedTickInput[];
    if (budget.tickCount === 0) {
      // A high-refresh frame may drive no tick. Preserve its mouse delta for
      // the next driven tick rather than dividing by zero or dropping it.
      this.pendingMouseDelta.x += input.mouseDeltaX ?? 0;
      this.pendingMouseDelta.y += input.mouseDeltaY ?? 0;
      mouseCarry = { x: this.pendingMouseDelta.x, y: this.pendingMouseDelta.y, z: 0 };
      tickInputs = [];
    } else {
      tickInputs = distributeFrameInput(
        input,
        budget.tickCount,
        frameDeltaSeconds,
        mouseCarry,
      );
      this.pendingMouseDelta.x = 0;
      this.pendingMouseDelta.y = 0;

      for (const tickInput of tickInputs) {
        this.state = advancePhysics(this.state, tickInput, this.stepSeconds, this.config);
        this.committedTickCount += 1;
        const snapshot = createSnapshot(this.state);
        this.previousSnapshot = this.snapshots[1];
        this.currentSnapshot = snapshot;
        this.snapshots = [this.previousSnapshot, snapshot];
      }
    }

    this.accumulator = budget.remainder;
    this.alpha = budget.alpha;

    const result: FrameResult = {
      ran: true,
      frameDeltaSeconds,
      tickCount: budget.tickCount,
      tickInputs,
      accumulator: this.accumulator,
      alpha: this.alpha,
      state: this.state,
      previousSnapshot: this.previousSnapshot,
      currentSnapshot: this.currentSnapshot,
    };
    this.lastFrameResult = result;
    return result;
  }

  /**
   * DOM/rAF-friendly entry point. The first frame after construction, resume,
   * blur, or focus has zero elapsed delta so a long background gap is discarded.
   */
  frameAt(nowSeconds: number, input: FrameInput = {}): FrameResult {
    let deltaSeconds = 0;
    if (!this.resetClockNextFrame && this.lastNowSeconds !== null) {
      deltaSeconds = Math.max(0, nowSeconds - this.lastNowSeconds);
    }
    this.lastNowSeconds = nowSeconds;
    this.resetClockNextFrame = false;
    return this.frame({ ...input, deltaSeconds });
  }

  render(alpha: number = this.alpha): RenderSnapshot {
    return interpolateSnapshots(this.previousSnapshot, this.currentSnapshot, alpha);
  }
}

/** Descriptive aliases for modules/tests using "simulation" vocabulary. */
export const SimulationLoop = FixedTickLoop;
export const FixedTimestepLoop = FixedTickLoop;
export const Accumulator = FixedTickLoop;
export const createLoop = (options?: FixedTickLoopOptions): FixedTickLoop =>
  new FixedTickLoop(options);
export const createAccumulator = createLoop;

export const splitFrameTime = splitEvenly;
export const splitMouseDelta = splitEvenly;
