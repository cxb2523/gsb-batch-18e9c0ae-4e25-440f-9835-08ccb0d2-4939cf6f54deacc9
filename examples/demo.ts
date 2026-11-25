/**
 * Executable acceptance sample for the fixed-timestep bunny-hop core.
 *
 * Run:
 *   node examples/demo.ts
 * or:
 *   npm test
 *
 * The canonical input segment is 256 ticks (2 seconds at 128Hz). For each
 * display rate we group those same tick intentions into render frames. A frame
 * that drives k ticks receives k raw mouse counts; the loop divides those k
 * counts evenly, restoring the same six-count mouse input on every tick.
 */

import assert from 'node:assert/strict';

import {
  AIR_WISH_SPEED_CAP,
  DEFAULT_PHYSICS_CONFIG,
  TICK_DT,
  TICK_RATE,
  clonePhysicsState,
} from '../src/physics.ts';
import type { PhysicsState } from '../src/physics.ts';
import { FixedTickLoop, planTickBudget, splitEvenly } from '../src/loop.ts';
import { positionIsBetweenSnapshots } from '../src/view.ts';

const DURATION_SECONDS = 2;
const TOTAL_TICKS = Math.round(DURATION_SECONDS * TICK_RATE); // 256
const MOUSE_PER_TICK = 6;

interface RateRun {
  hz: number;
  loop: FixedTickLoop;
  frameCount: number;
  interpolationSample: {
    frame: number;
    alpha: number;
    from: { x: number; y: number; z: number };
    to: { x: number; y: number; z: number };
    rendered: { x: number; y: number; z: number };
  } | null;
  maxMouseSplitError: number;
}

function frameInputForNextFrame(loop: FixedTickLoop, hz: number) {
  const deltaSeconds = 1 / hz;
  const budget = planTickBudget(loop.accumulator, deltaSeconds, loop.stepSeconds);
  const tickCount = budget.tickCount;

  return {
    deltaSeconds,
    right: true,
    jump: true,
    // Rate-specific packet for the same canonical six-count-per-tick sweep.
    mouseDeltaX: tickCount * MOUSE_PER_TICK,
    mouseDeltaY: 0,
  };
}

function runAtRate(hz: number): RateRun {
  const loop = new FixedTickLoop();
  const frameCount = Math.round(DURATION_SECONDS * hz);
  let interpolationSample: RateRun['interpolationSample'] = null;
  let maxMouseSplitError = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const input = frameInputForNextFrame(loop, hz);
    const result = loop.frame(input);
    const stateAfterPhysics = clonePhysicsState(loop.state);

    // A4: every driven frame's mouse shares sum to its total delta.
    if (result.tickCount > 0) {
      const mouseSum = result.tickInputs.reduce(
        (sum, tick) => sum + (tick.mouseDeltaX ?? 0),
        0,
      );
      maxMouseSplitError = Math.max(
        maxMouseSplitError,
        Math.abs(mouseSum - input.mouseDeltaX),
      );
      assert.equal(mouseSum, input.mouseDeltaX, 'integer mouse split must sum exactly');

      const timeSum = result.tickInputs.reduce(
        (sum, tick) => sum + tick.realElapsedShare,
        0,
      );
      assert.ok(
        Math.abs(timeSum - input.deltaSeconds) < 1e-12,
        'real frame time shares must sum to the frame elapsed time',
      );

      for (const tick of result.tickInputs) {
        assert.ok(
          Math.abs((tick.mouseDeltaX ?? 0) - MOUSE_PER_TICK) < 1e-12,
          'each canonical tick must receive the same mouse input',
        );
      }
    }

    // A2/A5: every rendered pose lies in its snapshot pair, and rendering does
    // not mutate physics state.
    const render = loop.render();
    assert.ok(
      positionIsBetweenSnapshots(
        render.position,
        loop.previousSnapshot,
        loop.currentSnapshot,
      ),
      'interpolated position must stay between adjacent snapshots',
    );
    assert.deepEqual(
      loop.state,
      stateAfterPhysics,
      'interpolation must not write back to physics state',
    );

    if (
      interpolationSample === null &&
      result.tickCount > 0 &&
      result.alpha > 1e-6 &&
      result.alpha < 1 - 1e-6
    ) {
      interpolationSample = {
        frame,
        alpha: result.alpha,
        from: { ...loop.previousSnapshot.position },
        to: { ...loop.currentSnapshot.position },
        rendered: { ...render.position },
      };
    }
  }

  assert.equal(loop.committedTickCount, TOTAL_TICKS, `${hz}Hz must commit 256 ticks`);
  assert.ok(interpolationSample, 'expected at least one interior interpolation sample');

  return { hz, loop, frameCount, interpolationSample, maxMouseSplitError };
}

function distance(a: PhysicsState['position'], b: PhysicsState['position']): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function runJumpLandingCheck(): { jumpTick: number | null; landingTick: number | null } {
  const loop = new FixedTickLoop();

  const jumpFrame = loop.frame({ deltaSeconds: TICK_DT, jumpPressed: true });
  assert.equal(jumpFrame.tickCount, 1);
  assert.equal(loop.state.tick, 1);
  assert.equal(loop.state.grounded, false);
  assert.equal(loop.state.lastJumpTick, 1);
  assert.ok(loop.state.position.y > 0, 'jump must leave the ground');

  for (let i = 0; i < 120 && !loop.state.grounded; i += 1) {
    loop.frame({ deltaSeconds: TICK_DT });
  }

  assert.equal(loop.state.grounded, true, 'bunny must land');
  assert.equal(loop.state.position.y, 0);
  assert.ok(loop.state.lastLandingTick !== null);

  return {
    jumpTick: loop.state.lastJumpTick,
    landingTick: loop.state.lastLandingTick,
  };
}

function runFocusRecoveryCheck() {
  const FRAME_HZ = 60;
  const WARMUP_FRAMES = 30; // 0.5s = exactly 64 ticks at 128Hz.

  const normal = new FixedTickLoop();
  const recovered = new FixedTickLoop();

  for (let i = 0; i < WARMUP_FRAMES; i += 1) {
    normal.frame(frameInputForNextFrame(normal, FRAME_HZ));
    recovered.frame(frameInputForNextFrame(recovered, FRAME_HZ));
  }

  assert.deepEqual(recovered.state, normal.state, 'warm-up runs must agree');

  const normalInput = frameInputForNextFrame(normal, FRAME_HZ);
  const normalBefore = clonePhysicsState(normal.state);
  const normalResult = normal.frame(normalInput);
  const normalTravel = distance(normal.state.position, normalBefore.position);

  // Stale mouse motion accumulated while the window was unfocused.
  recovered.queueMouseDelta(987_654, -432_109);
  recovered.blur();

  // A long background frame must be ignored rather than accumulating 5s.
  const backgroundResult = recovered.frame({
    deltaSeconds: 5,
    forward: true,
    jump: true,
    mouseDeltaX: 987_654,
  });
  assert.equal(backgroundResult.ran, false);
  assert.equal(recovered.accumulator, 0);
  assert.equal(recovered.pendingMouseDelta.x, 0);

  recovered.focus();

  const recoveryBefore = clonePhysicsState(recovered.state);
  const recoveryResult = recovered.frame({ ...normalInput });
  const recoveryTravel = distance(recovered.state.position, recoveryBefore.position);

  const naiveBacklogTicks = Math.floor(5 / TICK_DT);

  assert.ok(
    recoveryResult.tickCount <= normalResult.tickCount,
    'recovery frame must not run more ticks than a normal frame',
  );
  assert.ok(
    recoveryTravel <= normalTravel + 1e-10,
    `recovery travel ${recoveryTravel} exceeded normal frame travel ${normalTravel}`,
  );
  assert.deepEqual(
    recovered.state.position,
    normal.state.position,
    'recovery frame should match the equivalent normal frame exactly',
  );
  assert.deepEqual(
    recovered.state.velocity,
    normal.state.velocity,
    'recovery velocity should match the equivalent normal frame exactly',
  );

  // Pause uses the same backlog-discard contract.
  const paused = new FixedTickLoop();
  paused.pause();
  const pausedResult = paused.frame({ deltaSeconds: 5, mouseDeltaX: 10_000 });
  assert.equal(pausedResult.ran, false);
  assert.equal(paused.accumulator, 0);

  return {
    normalTickCount: normalResult.tickCount,
    recoveryTickCount: recoveryResult.tickCount,
    normalTravel,
    recoveryTravel,
    naiveBacklogTicks,
  };
}

function runTimestampRecoveryCheck() {
  const loop = new FixedTickLoop();
  loop.frameAt(0, { forward: true, mouseDeltaX: 2 });
  loop.blur();
  loop.frameAt(5, { forward: true, mouseDeltaX: 999_999 });
  loop.focus();

  // First rAF timestamp after focus re-bases the clock, so its huge timestamp
  // gap is not converted into elapsed frame time.
  const firstAfterFocus = loop.frameAt(5 + 1 / 60, { forward: true, mouseDeltaX: 2 });
  assert.equal(firstAfterFocus.tickCount, 0);

  const next = loop.frameAt(5 + 2 / 60, { forward: true, mouseDeltaX: 2 });
  assert.ok(next.tickCount <= 3, 'a normal 60Hz-ish frame drives at most three ticks');
}

function main(): void {
  assert.equal(TICK_RATE, 128);
  assert.ok(Math.abs(TICK_DT - 1 / 128) < Number.EPSILON);
  assert.equal(AIR_WISH_SPEED_CAP, 30);
  assert.equal(DEFAULT_PHYSICS_CONFIG.airWishSpeedCap, AIR_WISH_SPEED_CAP);

  const oddShares = splitEvenly(123, 7);
  assert.equal(
    oddShares.reduce((sum, value) => sum + value, 0),
    123,
    'even split helper must preserve arbitrary totals',
  );

  const jumpLanding = runJumpLandingCheck();
  const run60 = runAtRate(60);
  const run240 = runAtRate(240);

  // A1: exact same 256 tick trajectory => exact same committed state.
  assert.deepEqual(
    run60.loop.state.position,
    run240.loop.state.position,
    '60Hz and 240Hz final positions must be exactly equal',
  );
  assert.deepEqual(
    run60.loop.state.velocity,
    run240.loop.state.velocity,
    '60Hz and 240Hz final velocities must be exactly equal',
  );
  assert.deepEqual(
    run60.loop.state,
    run240.loop.state,
    'complete physics states must be exactly equal',
  );

  const focus = runFocusRecoveryCheck();
  runTimestampRecoveryCheck();

  const p60 = run60.loop.state.position;
  const v60 = run60.loop.state.velocity;
  const sample = run60.interpolationSample!;

  console.log('🐇 Fixed-step bunny-hop simulation demo');
  console.log('-------------------------------------');
  console.log(`tick rate:              ${TICK_RATE} Hz (dt=${TICK_DT.toFixed(8)}s)`);
  console.log(`air wish-speed cap:     ${AIR_WISH_SPEED_CAP} u/s`);
  console.log('jump/landing ticks:     ', jumpLanding);
  console.log(
    `60Hz:                   ${run60.frameCount} frames -> ${run60.loop.committedTickCount} ticks`,
  );
  console.log(
    `240Hz:                  ${run240.frameCount} frames -> ${run240.loop.committedTickCount} ticks`,
  );
  console.log('final position:         ', p60);
  console.log('final velocity:         ', v60);
  console.log('60/240 state equality:  ✅ exact deepStrictEqual');
  console.log('mouse split max error:  ', Math.max(run60.maxMouseSplitError, run240.maxMouseSplitError));
  console.log('interpolation sample:   ', sample);
  console.log('focus recovery:         ', focus);
  console.log('focus travel <= normal: ✅', focus.recoveryTravel, '<=', focus.normalTravel);
  console.log(`discarded backlog:      ${focus.naiveBacklogTicks} stale ticks avoided`);
  console.log('\nAll acceptance assertions passed.');
}

main();
