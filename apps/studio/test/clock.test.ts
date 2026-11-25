import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ClockFreezer } from '../src/sandbox/clock';

/** Mirrors what R3F's render loop does each frame. */
const frame = (clock: THREE.Clock) => ({ delta: clock.getDelta(), elapsed: clock.elapsedTime });

describe('ClockFreezer (d9: pause on gizmo hover and drag)', () => {
  it('reports delta 0 and a frozen elapsedTime while any reason is on, and restores the original getDelta after', () => {
    let t = 0;
    const clock = new THREE.Clock(false);
    const real = clock.getDelta;
    // drive THREE.Clock from a fake time source
    const now = () => t;
    const freezer = new ClockFreezer(clock, now);
    clock.start();
    clock.oldTime = 0;
    t = 16;
    // the unfrozen clock advances (Clock reads performance.now internally, so just check the API shape here)
    expect(typeof real).toBe('function');

    freezer.set('hover', true);
    const a = frame(clock);
    t = 500;
    const b = frame(clock);
    expect(a.delta).toBe(0);
    expect(b.delta).toBe(0);
    expect(b.elapsed).toBe(a.elapsed);
    expect(freezer.frozen).toBe(true);
    expect(clock.oldTime).toBe(500);

    freezer.set('drag', true); // hover + drag overlap
    freezer.set('hover', false); // still frozen: drag holds it
    expect(freezer.frozen).toBe(true);
    expect(frame(clock).delta).toBe(0);

    freezer.set('drag', false);
    expect(freezer.frozen).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(clock, 'getDelta')).toBe(false);
    expect(clock.getDelta).toBe(real);
  });

  it('resuming does not catch up: the first delta after a long freeze is small', async () => {
    const clock = new THREE.Clock();
    clock.getDelta();
    const freezer = new ClockFreezer(clock);
    freezer.set('drag', true);
    await new Promise((r) => setTimeout(r, 120));
    expect(frame(clock).delta).toBe(0);
    const elapsedFrozen = clock.elapsedTime;
    freezer.set('drag', false);
    const first = frame(clock);
    expect(first.delta).toBeLessThan(0.05); // not the ~0.12 s that passed
    expect(first.elapsed - elapsedFrozen).toBeLessThan(0.05);
  });

  it('dispose() restores the clock and is safe to repeat; unknown reasons toggle idempotently', () => {
    const clock = new THREE.Clock();
    const freezer = new ClockFreezer(clock);
    freezer.set('hover', true);
    freezer.set('hover', true);
    freezer.set('hover', false);
    expect(freezer.frozen).toBe(false);
    freezer.set('drag', true);
    freezer.dispose();
    freezer.dispose();
    expect(freezer.frozen).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(clock, 'getDelta')).toBe(false);
  });
});

describe('version guard: R3F still drives frames with clock.getDelta()', () => {
  const require = createRequire(import.meta.url);
  const dist = dirname(require.resolve('@react-three/fiber'));
  const loopSources = readdirSync(dist)
    .filter((f) => /^events-.*\.esm\.js$/.test(f))
    .map((f) => readFileSync(join(dist, f), 'utf8'));

  it('finds the installed R3F render loop', () => {
    expect(loopSources.length).toBeGreaterThan(0);
  });

  it('the loop reads its delta from state.clock.getDelta() (the hook d9 freezes)', () => {
    // If this fails, R3F changed how it times frames (for example it moved to THREE.Timer).
    // Revisit src/sandbox/clock.ts and the d9 pause before bumping @react-three/fiber.
    expect(loopSources.some((s) => /let delta = state\.clock\.getDelta\(\)/.test(s))).toBe(true);
  });

  it('setFrameloop still resets clock.elapsedTime (the reason d9 does not use it)', () => {
    expect(loopSources.some((s) => /setFrameloop:[\s\S]{0,300}clock\.elapsedTime = 0/.test(s))).toBe(true);
  });

  it('is pinned to a version this guard was written against', () => {
    const pkg = JSON.parse(readFileSync(join(dist, '..', 'package.json'), 'utf8')) as { version: string };
    expect(pkg.version.startsWith('9.')).toBe(true);
  });
});
