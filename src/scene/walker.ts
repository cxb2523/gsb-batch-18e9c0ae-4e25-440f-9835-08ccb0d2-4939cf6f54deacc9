/**
 * Path following for the moving agents. Kept apart from React so it can be tested on its own.
 */
import * as THREE from 'three';
import type { V3 } from '../layout';

const headingTo = (a: THREE.Vector3, b: THREE.Vector3) => Math.atan2(b.x - a.x, b.z - a.z);

/** Index of the route point closest to `at`. */
export function nearestIndex(pts: THREE.Vector3[], at: THREE.Vector3) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = pts[i].distanceToSquared(at);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export class Walker {
  readonly pos: THREE.Vector3;
  heading = 0;
  private readonly pts: THREE.Vector3[];
  private i = 1;
  private traveled = 0;
  readonly total: number;

  /**
   * `resumeAt`: when a layout rebuild replaces the path, continue from the point closest to the
   * agent's current position instead of jumping back to the start (or to the rack, when docked).
   */
  constructor(points: V3[], resumeAt?: THREE.Vector3) {
    this.pts = points.map((p) => new THREE.Vector3(...p));
    this.pos = this.pts[0].clone();
    this.total = this.pts.reduce((acc, p, k) => (k ? acc + p.distanceTo(this.pts[k - 1]) : 0), 0);
    if (this.pts.length > 1) this.heading = headingTo(this.pts[0], this.pts[1]);
    if (!resumeAt || this.pts.length < 2) return;
    const k = nearestIndex(this.pts, resumeAt);
    this.pos.copy(this.pts[k]);
    this.traveled = this.pts.slice(1, k + 1).reduce((acc, p, j) => acc + p.distanceTo(this.pts[j]), 0);
    this.i = Math.min(k + 1, this.pts.length);
    if (this.i < this.pts.length) this.heading = headingTo(this.pos, this.pts[this.i]);
  }

  /** Advances along the path; returns true once the last point is reached. */
  step(dist: number) {
    while (dist > 1e-6 && this.i < this.pts.length) {
      const target = this.pts[this.i];
      const d = this.pos.distanceTo(target);
      if (d > 1e-6) this.heading = headingTo(this.pos, target);
      if (d <= dist) {
        this.pos.copy(target);
        this.traveled += d;
        dist -= d;
        this.i++;
      } else {
        this.pos.lerp(target, dist / d);
        this.traveled += dist;
        dist = 0;
      }
    }
    return this.done;
  }

  get done() {
    return this.i >= this.pts.length;
  }
  get remaining() {
    return Math.max(0, this.total - this.traveled);
  }
}

export function dampAngle(current: number, target: number, lambda: number, dt: number) {
  const diff = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + diff * (1 - Math.exp(-lambda * dt));
}
