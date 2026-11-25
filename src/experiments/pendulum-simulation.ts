"use client";

// ============================================
// FRAMEWORK-AGNOSTIC PENDULUM SIMULATION CORE
// ============================================
//
// Holds all mutable simulation state (physics, accumulated sim time,
// oscillation measurements and the motion-trail buffer) behind one
// controlled entry point: `restart()`.
//
// Both "the user changed a physics parameter" and "the user pressed
// reset" funnel through the same `restart()` path, so the scene, the
// measured data and the UI panels can never diverge.

export interface PendulumParams {
  length: number;
  gravity: number;
  mass: number;
  damping: number;
  initialAngle: number; // radians
}

export interface PendulumData {
  period: number;
  periodMeasured: number;
  frequency: number;
  angularFrequency: number;
  kineticEnergy: number;
  potentialEnergy: number;
  totalEnergy: number;
  angle: number;
  angleDeg: number;
  angularVelocity: number;
  tangentialVelocity: number;
  elapsedTime: number;
  oscillations: number;
  phaseAngle: number;
  phaseVelocity: number;
}

// ============================================
// PHYSICS HELPERS
// ============================================

/** Large-angle period correction: T = T₀ × (1 + θ₀²/16 + 11θ₀⁴/3072) */
export function correctedPeriod(L: number, g: number, theta0: number): number {
  const T0 = 2 * Math.PI * Math.sqrt(L / g);
  const correction =
    1 + (theta0 * theta0) / 16 + (11 * theta0 * theta0 * theta0 * theta0) / 3072;
  return T0 * correction;
}

export function pendulumPE(m: number, g: number, L: number, theta: number): number {
  return m * g * L * (1 - Math.cos(theta));
}

export function pendulumKE(m: number, L: number, omega: number): number {
  return 0.5 * m * L * L * omega * omega;
}

// ============================================
// RK4 INTEGRATOR
// ============================================

export function rk4Step(
  theta: number,
  omega: number,
  g: number,
  L: number,
  b: number,
  dt: number
): [number, number] {
  const f = (th: number, om: number): [number, number] => {
    const dTheta = om;
    const dOmega = -(g / L) * Math.sin(th) - b * om;
    return [dTheta, dOmega];
  };

  const [k1a, k1b] = f(theta, omega);
  const [k2a, k2b] = f(theta + k1a * dt * 0.5, omega + k1b * dt * 0.5);
  const [k3a, k3b] = f(theta + k2a * dt * 0.5, omega + k2b * dt * 0.5);
  const [k4a, k4b] = f(theta + k3a * dt, omega + k3b * dt);

  const newTheta = theta + (dt / 6) * (k1a + 2 * k2a + 2 * k3a + k4a);
  const newOmega = omega + (dt / 6) * (k1b + 2 * k2b + 2 * k3b + k4b);
  return [newTheta, newOmega];
}

// ============================================
// TRAIL BUFFER
// ============================================

export const MAX_TRAIL = 1500;

export interface TrailBuffer {
  positions: Float32Array;
  colors: Float32Array;
  ages: Float32Array;
  /** Number of points written since the last restart (wraps via modulo). */
  idx: number;
}

function createTrailBuffer(): TrailBuffer {
  return {
    positions: new Float32Array(MAX_TRAIL * 3),
    colors: new Float32Array(MAX_TRAIL * 3),
    ages: new Float32Array(MAX_TRAIL),
    idx: 0,
  };
}

// ============================================
// SIMULATION CONTROLLER
// ============================================

interface PhysicsState {
  theta: number;
  omega: number;
  time: number;
  lastTheta: number;
  oscillations: number;
  lastCrossTime: number;
  measuredPeriod: number;
}

export class PendulumSim {
  params: PendulumParams;
  trail: TrailBuffer;

  private state: PhysicsState;

  constructor(params: PendulumParams) {
    this.params = { ...params };
    this.trail = createTrailBuffer();
    this.state = this.freshState();
  }

  private freshState(): PhysicsState {
    const theta0 = this.params.initialAngle;
    return {
      theta: theta0,
      omega: 0,
      time: 0,
      lastTheta: theta0,
      oscillations: 0,
      lastCrossTime: 0,
      measuredPeriod: 0,
    };
  }

  /**
   * The single controlled restart path.
   *
   * Applies the supplied parameters, then restarts the motion from the
   * new initial angle with zero angular velocity and zero simulated time.
   * All measurements (periods, oscillation count) and the trail buffer
   * are cleared, with the trail rewritten from index 0.
   */
  restart(nextParams: PendulumParams): void {
    this.params = { ...nextParams };
    this.state = this.freshState();

    // Clear the trail buffer and restart writes from index 0.
    this.trail.idx = 0;
    this.trail.positions.fill(0);
    this.trail.colors.fill(0);
    this.trail.ages.fill(0);
  }

  get theta(): number {
    return this.state.theta;
  }

  get omega(): number {
    return this.state.omega;
  }

  /** Simulated time actually accumulated by the scene (freezes on pause). */
  get time(): number {
    return this.state.time;
  }

  get oscillations(): number {
    return this.state.oscillations;
  }

  /** Zero until one full zero-crossing interval has been measured. */
  get measuredPeriod(): number {
    return this.state.measuredPeriod;
  }

  /** Bob position in the pivot-relative frame used by the scene. */
  get bobPosition(): [number, number, number] {
    const { length } = this.params;
    return [
      Math.sin(this.state.theta) * length,
      -Math.cos(this.state.theta) * length,
      0,
    ];
  }

  /**
   * Advance the simulation by one rendered frame.
   *
   * @param rawDt   Real frame delta (clamped by the caller), in seconds.
   * @param speed   Simulation speed multiplier (only affects advances made
   *                from this call onward; previously accumulated time is
   *                untouched).
   * @param playing When false, nothing advances: time, angle and
   *                measurements stay exactly where they were.
   */
  advance(rawDt: number, speed: number, playing: boolean): void {
    const dt = rawDt * speed;
    if (!playing || dt <= 0) return;

    const { gravity, length, damping } = this.params;
    const s = this.state;

    // Capture the angle at the frame boundary. The sub-step loop below
    // overwrites `lastTheta` on every sub-step, so crossing detection has
    // to use this frame-start value — otherwise crossings that happen
    // between sub-steps are silently missed and the oscillation count and
    // measured period come out wrong.
    const frameStartTheta = s.theta;

    // Sub-step for stability at high speed.
    const steps = Math.max(1, Math.ceil(dt / 0.004));
    const subDt = dt / steps;
    for (let i = 0; i < steps; i++) {
      const [newTheta, newOmega] = rk4Step(
        s.theta,
        s.omega,
        gravity,
        length,
        damping,
        subDt
      );
      s.lastTheta = s.theta;
      s.theta = newTheta;
      s.omega = newOmega;
    }
    s.time += dt;

    // Count oscillations via upward zero-crossing detection across the
    // full frame (frame-start angle -> frame-end angle).
    if (frameStartTheta < 0 && s.theta >= 0) {
      s.oscillations++;
      if (s.lastCrossTime > 0) {
        s.measuredPeriod = s.time - s.lastCrossTime;
      }
      s.lastCrossTime = s.time;
    }
  }

  /**
   * Append the current bob position to the motion-trail buffer.
   * Call only while the trail is visible and the sim is playing.
   */
  addTrailPoint(rawDt: number): void {
    const [bx, by] = this.bobPosition;
    const idx = this.trail.idx % MAX_TRAIL;
    this.trail.positions[idx * 3] = bx;
    this.trail.positions[idx * 3 + 1] = by;
    this.trail.positions[idx * 3 + 2] = 0;
    this.trail.ages[idx] = 1.0; // Full opacity at the newest point.

    const t = Math.min(Math.abs(this.state.omega) / 3, 1);

    // Color gradient based on velocity (blue = slow, green = medium, red = fast).
    if (t < 0.5) {
      this.trail.colors[idx * 3] = 0.2 + t * 0.4; // R
      this.trail.colors[idx * 3 + 1] = 0.5 + t * 0.4; // G
      this.trail.colors[idx * 3 + 2] = 1.0 - t * 0.3; // B
    } else {
      this.trail.colors[idx * 3] = 0.4 + (t - 0.5) * 0.6;
      this.trail.colors[idx * 3 + 1] = 0.7 - (t - 0.5) * 0.4;
      this.trail.colors[idx * 3 + 2] = 0.85 - (t - 0.5) * 0.5;
    }
    this.trail.idx++;

    // Age the trail points (fades out over ~1.25 seconds of wall time).
    for (let i = 0; i < MAX_TRAIL; i++) {
      if (this.trail.ages[i] > 0) {
        this.trail.ages[i] -= rawDt * 0.8;
        if (this.trail.ages[i] < 0) this.trail.ages[i] = 0;
      }
    }
  }

  /** Number of trail points the geometry should currently draw. */
  get trailDrawCount(): number {
    return Math.min(this.trail.idx, MAX_TRAIL);
  }

  /**
   * Snapshot of every value shown in the data panel. The theoretical
   * period always reflects the *current* parameters; the measured period
   * stays 0 until a full zero-crossing interval has completed, so the UI
   * can show "not measured" instead of a stale or fabricated value.
   */
  getSnapshot(): PendulumData {
    const { length, gravity, mass, initialAngle } = this.params;
    const { theta, omega, time } = this.state;
    const period = correctedPeriod(length, gravity, Math.abs(initialAngle));
    const ke = pendulumKE(mass, length, omega);
    const pe = pendulumPE(mass, gravity, length, theta);

    return {
      period,
      periodMeasured: this.state.measuredPeriod,
      frequency: 1 / period,
      angularFrequency: Math.sqrt(gravity / length),
      kineticEnergy: ke,
      potentialEnergy: pe,
      totalEnergy: ke + pe,
      angle: theta,
      angleDeg: (theta * 180) / Math.PI,
      angularVelocity: omega,
      tangentialVelocity: omega * length,
      elapsedTime: time,
      oscillations: this.state.oscillations,
      phaseAngle: theta,
      phaseVelocity: omega,
    };
  }
}

export default PendulumSim;
