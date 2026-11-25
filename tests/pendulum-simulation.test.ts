/**
 * Headless tests for the pendulum controlled-restart / pause-resume logic.
 *
 * Runs on Node's built-in test runner with native TypeScript type
 * stripping (Node >= 22.18), no extra dependencies:
 *
 *   node --experimental-strip-types --test tests/pendulum-simulation.test.ts
 *
 * These tests exercise the same PendulumSim class the 3D scene drives
 * frame-by-frame, so they cover restart state, pause/resume semantics,
 * speed changes, trail-buffer clearing and data-panel consistency without
 * needing a browser.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PendulumSim,
  correctedPeriod,
  pendulumPE,
  pendulumKE,
  MAX_TRAIL,
  type PendulumParams,
} from "../src/experiments/pendulum-simulation.ts";

const BASE_PARAMS: PendulumParams = {
  length: 10,
  gravity: 9.81,
  mass: 2,
  damping: 0, // undamped: energy must be conserved exactly
  initialAngle: Math.PI / 4,
};

const FRAME_DT = 1 / 60;

function runFrames(
  sim: PendulumSim,
  frames: number,
  dt = FRAME_DT,
  speed = 1,
  playing = true
): void {
  for (let i = 0; i < frames; i++) {
    sim.advance(dt, speed, playing);
  }
}

test("starts at the initial angle with zero angular velocity and zero time", () => {
  const sim = new PendulumSim(BASE_PARAMS);

  assert.equal(sim.theta, BASE_PARAMS.initialAngle);
  assert.equal(sim.omega, 0);
  assert.equal(sim.time, 0);
  assert.equal(sim.oscillations, 0);
  assert.equal(sim.measuredPeriod, 0);
  assert.equal(sim.trail.idx, 0);
  assert.equal(sim.trailDrawCount, 0);

  const snapshot = sim.getSnapshot();
  assert.equal(snapshot.elapsedTime, 0);
  assert.equal(snapshot.oscillations, 0);
  assert.equal(snapshot.periodMeasured, 0);
  assert.equal(snapshot.kineticEnergy, 0);
  assert.ok(
    Math.abs(snapshot.potentialEnergy - pendulumPE(2, 9.81, 10, Math.PI / 4)) < 1e-10
  );
});

test("theoretical period in the snapshot uses the current parameters", () => {
  const sim = new PendulumSim(BASE_PARAMS);
  const snapshot = sim.getSnapshot();
  const expected = correctedPeriod(10, 9.81, Math.PI / 4);

  assert.ok(Math.abs(snapshot.period - expected) < 1e-12);
  assert.equal(snapshot.frequency, 1 / expected);
  assert.ok(Math.abs(snapshot.angularFrequency - Math.sqrt(9.81 / 10)) < 1e-12);

  // After a parameter-driven restart the theoretical period changes at once.
  sim.restart({ ...BASE_PARAMS, gravity: 1.62, length: 4 });
  const moonSnapshot = sim.getSnapshot();
  assert.ok(
    Math.abs(moonSnapshot.period - correctedPeriod(4, 1.62, Math.PI / 4)) < 1e-12
  );
});

test("measured period is not reported before a full zero-crossing interval", () => {
  const sim = new PendulumSim(BASE_PARAMS);

  // 30 frames at 60 Hz = 0.5 s, far shorter than one ~6.3 s period.
  runFrames(sim, 30);

  assert.equal(sim.measuredPeriod, 0);
  assert.equal(sim.getSnapshot().periodMeasured, 0);
});

test("counts oscillations and measures a period close to the theoretical one", () => {
  const sim = new PendulumSim(BASE_PARAMS);
  const theoretical = correctedPeriod(10, 9.81, Math.PI / 4);

  // Run ~5.5 undamped periods with a small fixed step. The counter
  // increments on upward zero crossings, which start one period after the
  // positive-angle release.
  const totalTime = theoretical * 5.5;
  const frames = Math.ceil(totalTime / FRAME_DT);
  runFrames(sim, frames);

  // At least one full upward zero-crossing interval must have completed.
  assert.ok(sim.oscillations >= 4, `oscillations=${sim.oscillations}`);
  assert.ok(sim.measuredPeriod > 0);
  // RK4 with sub-stepping should be well within 2% of the analytical value.
  assert.ok(
    Math.abs(sim.measuredPeriod - theoretical) / theoretical < 0.02,
    `measured=${sim.measuredPeriod} theoretical=${theoretical}`
  );
});

test("pause freezes every state value and resume continues from the same values", () => {
  const sim = new PendulumSim(BASE_PARAMS);
  runFrames(sim, 120); // 2 s of motion

  const frozen = {
    theta: sim.theta,
    omega: sim.omega,
    time: sim.time,
    oscillations: sim.oscillations,
    measuredPeriod: sim.measuredPeriod,
  };
  assert.ok(frozen.time > 0);

  // Frames keep arriving while paused, but nothing may move.
  runFrames(sim, 300, FRAME_DT, 1, false); // 5 s of paused wall time
  assert.equal(sim.theta, frozen.theta);
  assert.equal(sim.omega, frozen.omega);
  assert.equal(sim.time, frozen.time);
  assert.equal(sim.oscillations, frozen.oscillations);
  assert.equal(sim.measuredPeriod, frozen.measuredPeriod);

  // Resume: time keeps accumulating from the frozen value.
  runFrames(sim, 60, FRAME_DT, 1, true);
  assert.ok(Math.abs(sim.time - (frozen.time + 1)) < 1e-9);
  assert.notEqual(sim.theta, frozen.theta);
});

test("speed multiplier changes only the subsequent advance rate", () => {
  const slow = new PendulumSim(BASE_PARAMS);
  const fast = new PendulumSim(BASE_PARAMS);

  runFrames(slow, 60, FRAME_DT, 0.5, true); // 0.5 s of sim time
  runFrames(fast, 60, FRAME_DT, 2, true); // 2 s of sim time

  assert.ok(Math.abs(slow.time - 0.5) < 1e-9);
  assert.ok(Math.abs(fast.time - 2) < 1e-9);

  // Switching speed mid-run must not rewrite accumulated time.
  const timeBefore = fast.time;
  runFrames(fast, 60, FRAME_DT, 0.5, true);
  assert.ok(Math.abs(fast.time - (timeBefore + 0.5)) < 1e-9);
});

test("restart from new parameters resets angle, omega, time and measurements", () => {
  const sim = new PendulumSim(BASE_PARAMS);
  runFrames(sim, 600); // 10 s: nonzero omega, time, oscillations, period
  assert.ok(sim.oscillations > 0);
  assert.notEqual(sim.omega, 0);
  assert.ok(sim.time > 0);

  const newParams: PendulumParams = {
    ...BASE_PARAMS,
    length: 5,
    gravity: 3.72,
    mass: 7,
    initialAngle: (20 * Math.PI) / 180,
  };
  sim.restart(newParams);

  assert.equal(sim.theta, newParams.initialAngle);
  assert.equal(sim.omega, 0);
  assert.equal(sim.time, 0);
  assert.equal(sim.oscillations, 0);
  assert.equal(sim.measuredPeriod, 0);
  assert.equal(sim.trail.idx, 0);
  assert.equal(sim.trailDrawCount, 0);

  const snapshot = sim.getSnapshot();
  assert.equal(snapshot.elapsedTime, 0);
  assert.equal(snapshot.oscillations, 0);
  assert.equal(snapshot.periodMeasured, 0);
  assert.equal(snapshot.angleDeg, 20);
  assert.equal(snapshot.kineticEnergy, 0);
  assert.ok(
    Math.abs(
      snapshot.potentialEnergy -
        pendulumPE(7, 3.72, 5, (20 * Math.PI) / 180)
    ) < 1e-10
  );
  // The new run must obey the new (lighter) gravity, not the old one.
  assert.ok(
    Math.abs(snapshot.period - correctedPeriod(5, 3.72, (20 * Math.PI) / 180)) <
      1e-12
  );
});

test("reset and a parameter change produce identical controlled-restart state", () => {
  const makeRun = (restartParams: PendulumParams) => {
    const sim = new PendulumSim(BASE_PARAMS);
    runFrames(sim, 600);
    sim.restart(restartParams);
    return {
      theta: sim.theta,
      omega: sim.omega,
      time: sim.time,
      oscillations: sim.oscillations,
      measuredPeriod: sim.measuredPeriod,
      trailIdx: sim.trail.idx,
      trailDraw: sim.trailDrawCount,
      snapshot: sim.getSnapshot(),
    };
  };

  // "Reset button" = restart with the very same parameters.
  const viaReset = makeRun(BASE_PARAMS);
  // "Parameter slider" = restart carrying one changed parameter.
  const viaParam = makeRun({ ...BASE_PARAMS, length: 12 });

  for (const result of [viaReset, viaParam]) {
    assert.equal(result.omega, 0);
    assert.equal(result.time, 0);
    assert.equal(result.oscillations, 0);
    assert.equal(result.measuredPeriod, 0);
    assert.equal(result.trailIdx, 0);
    assert.equal(result.trailDraw, 0);
    assert.equal(result.snapshot.elapsedTime, 0);
    assert.equal(result.snapshot.periodMeasured, 0);
  }
  assert.equal(viaReset.theta, BASE_PARAMS.initialAngle);
  assert.equal(viaParam.theta, BASE_PARAMS.initialAngle);
});

test("restart leaves play state to the caller: advancing while paused stays frozen", () => {
  const sim = new PendulumSim(BASE_PARAMS);
  runFrames(sim, 300);
  sim.restart(BASE_PARAMS); // equivalent to pressing reset mid-session

  // The controller itself never forces playback: a paused frame loop after
  // restart must keep the freshly-restarted state exactly at time zero.
  runFrames(sim, 120, FRAME_DT, 1, false);
  assert.equal(sim.time, 0);
  assert.equal(sim.theta, BASE_PARAMS.initialAngle);
  assert.equal(sim.omega, 0);
  assert.equal(sim.oscillations, 0);
});

test("trail buffer is fully cleared and rewritten from index 0 after restart", () => {
  const sim = new PendulumSim(BASE_PARAMS);

  // Simulate playing frames that write trail points.
  for (let i = 0; i < 90; i++) {
    sim.advance(FRAME_DT, 1, true);
    sim.addTrailPoint(FRAME_DT);
  }
  assert.equal(sim.trail.idx, 90);
  assert.equal(sim.trailDrawCount, 90);
  // Slot 0 holds the initial release point (x = L·sin(θ₀) ≈ 7.07).
  assert.ok(Math.abs(sim.trail.positions[0] - 10 * Math.sin(Math.PI / 4)) < 0.05);

  sim.restart(BASE_PARAMS);

  assert.equal(sim.trail.idx, 0);
  assert.equal(sim.trailDrawCount, 0);
  // Every backing slot must be zeroed, not just the write head.
  for (let i = 0; i < MAX_TRAIL * 3; i++) {
    assert.equal(sim.trail.positions[i], 0);
    assert.equal(sim.trail.colors[i], 0);
  }
  for (let i = 0; i < MAX_TRAIL; i++) {
    assert.equal(sim.trail.ages[i], 0);
  }

  // New writes start at slot 0 again; the newest point is near full
  // opacity (the age loop immediately fades it by one frame's worth).
  sim.advance(FRAME_DT, 1, true);
  sim.addTrailPoint(FRAME_DT);
  assert.equal(sim.trail.idx, 1);
  assert.equal(sim.trailDrawCount, 1);
  assert.ok(sim.trail.ages[0] > 0.98);
  const [bx, by] = sim.bobPosition;
  // Trail slots are Float32, so expect single-precision rounding only.
  assert.ok(Math.abs(sim.trail.positions[0] - bx) < 1e-5);
  assert.ok(Math.abs(sim.trail.positions[1] - by) < 1e-5);
});

test("trail wraps around the ring buffer without exceeding the cap", () => {
  const sim = new PendulumSim(BASE_PARAMS);

  for (let i = 0; i < MAX_TRAIL + 25; i++) {
    sim.advance(FRAME_DT, 1, true);
    sim.addTrailPoint(FRAME_DT);
  }

  assert.equal(sim.trail.idx, MAX_TRAIL + 25);
  assert.equal(sim.trailDrawCount, MAX_TRAIL); // capped, never over-draws
});

test("undamped energy is conserved and the snapshot stays internally consistent", () => {
  const sim = new PendulumSim(BASE_PARAMS);
  const initial = sim.getSnapshot();
  const initialTotal = initial.totalEnergy;

  runFrames(sim, 60 * 10); // 10 s
  const later = sim.getSnapshot();

  assert.ok(Math.abs(later.totalEnergy - initialTotal) / initialTotal < 1e-4);
  assert.ok(Math.abs(later.kineticEnergy + later.potentialEnergy - later.totalEnergy) < 1e-9);
  assert.ok(Math.abs(later.tangentialVelocity - later.angularVelocity * 10) < 1e-9);
  assert.ok(Math.abs(later.angleDeg - (later.angle * 180) / Math.PI) < 1e-9);
  assert.equal(later.elapsedTime, sim.time);
});

test("zero and negative effective dt never advance the simulation", () => {
  const sim = new PendulumSim(BASE_PARAMS);

  sim.advance(0, 1, true);
  assert.equal(sim.time, 0);
  sim.advance(FRAME_DT, 0, true);
  assert.equal(sim.time, 0);
  // A playing flag with a non-positive speed must likewise be a no-op.
  sim.advance(FRAME_DT, -1, true);
  assert.equal(sim.time, 0);
  assert.equal(sim.theta, BASE_PARAMS.initialAngle);
});

test("damping removes mechanical energy over time", () => {
  const damped = new PendulumSim({ ...BASE_PARAMS, damping: 0.05 });
  const initialTotal = damped.getSnapshot().totalEnergy;

  runFrames(damped, 60 * 20); // 20 s
  const laterTotal = damped.getSnapshot().totalEnergy;

  assert.ok(laterTotal < initialTotal * 0.9);
});

test("restart is deterministic: identical parameter sequences match", () => {
  const run = () => {
    const sim = new PendulumSim(BASE_PARAMS);
    runFrames(sim, 240);
    sim.restart({ ...BASE_PARAMS, initialAngle: (60 * Math.PI) / 180 });
    runFrames(sim, 240);
    sim.restart(BASE_PARAMS);
    runFrames(sim, 120);
    return sim.getSnapshot();
  };

  const a = run();
  const b = run();
  assert.deepEqual(a, b);
});
