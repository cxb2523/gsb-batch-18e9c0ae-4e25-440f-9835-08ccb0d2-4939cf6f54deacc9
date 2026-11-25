/**
 * Read-only render interpolation layer.
 *
 * This module deliberately accepts committed snapshot values, never the
 * mutable physics world. Calling a view function cannot advance physics or
 * write a position/velocity back into the simulation.
 */

import type { PhysicsSnapshot, Vec3 } from './physics.ts';

export interface RenderSnapshot {
  tick: number;
  /** Interpolation factor in [0, 1]. */
  alpha: number;
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  pitch: number;
  grounded: boolean;
  /** The two committed snapshots used for this render pose. */
  from: PhysicsSnapshot;
  to: PhysicsSnapshot;
}

export interface SnapshotPair {
  previous: PhysicsSnapshot;
  current: PhysicsSnapshot;
  alpha?: number;
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function lerp(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha;
}

export function lerpVec3(a: Vec3, b: Vec3, alpha: number): Vec3 {
  return {
    x: lerp(a.x, b.x, alpha),
    y: lerp(a.y, b.y, alpha),
    z: lerp(a.z, b.z, alpha),
  };
}

/**
 * Interpolate between two adjacent committed tick snapshots.
 *
 * `alpha=0` returns the older snapshot position and `alpha=1` returns the
 * newer snapshot position. The result is a fresh render-only object.
 */
export function interpolateSnapshots(
  previous: PhysicsSnapshot,
  current: PhysicsSnapshot,
  alpha: number,
): RenderSnapshot {
  const t = clamp01(alpha);
  return {
    tick: lerp(previous.tick, current.tick, t),
    alpha: t,
    position: lerpVec3(previous.position, current.position, t),
    velocity: lerpVec3(previous.velocity, current.velocity, t),
    yaw: lerp(previous.yaw, current.yaw, t),
    pitch: lerp(previous.pitch, current.pitch, t),
    // Discrete state is taken from the newer committed tick.
    grounded: current.grounded,
    from: previous,
    to: current,
  };
}

export function interpolateSnapshotPair(pair: SnapshotPair): RenderSnapshot {
  return interpolateSnapshots(pair.previous, pair.current, pair.alpha ?? 0);
}

/** Returns true when value is inclusively between endpoints on one axis. */
export function isBetween(value: number, a: number, b: number, epsilon = 1e-12): boolean {
  const low = Math.min(a, b) - epsilon;
  const high = Math.max(a, b) + epsilon;
  return value >= low && value <= high;
}

/** Checks every interpolated position axis against its two source snapshots. */
export function positionIsBetweenSnapshots(
  renderPosition: Vec3,
  previous: PhysicsSnapshot,
  current: PhysicsSnapshot,
  epsilon = 1e-10,
): boolean {
  return (
    isBetween(renderPosition.x, previous.position.x, current.position.x, epsilon) &&
    isBetween(renderPosition.y, previous.position.y, current.position.y, epsilon) &&
    isBetween(renderPosition.z, previous.position.z, current.position.z, epsilon)
  );
}

export interface SnapshotReader {
  previousSnapshot: PhysicsSnapshot;
  currentSnapshot: PhysicsSnapshot;
  alpha: number;
}

/**
 * Tiny view object for renderers. It reads a snapshot source and creates a
 * new pose; it has no reference to any mutating physics method.
 */
export class InterpolatedView {
  private readonly reader: SnapshotReader;

  constructor(reader: SnapshotReader) {
    this.reader = reader;
  }

  render(alpha: number = this.reader.alpha): RenderSnapshot {
    return interpolateSnapshots(
      this.reader.previousSnapshot,
      this.reader.currentSnapshot,
      alpha,
    );
  }
}

/** Compatibility aliases. */
export const interpolate = interpolateSnapshots;
export const interpolatePosition = lerpVec3;
export const createRenderView = (reader: SnapshotReader): InterpolatedView =>
  new InterpolatedView(reader);
