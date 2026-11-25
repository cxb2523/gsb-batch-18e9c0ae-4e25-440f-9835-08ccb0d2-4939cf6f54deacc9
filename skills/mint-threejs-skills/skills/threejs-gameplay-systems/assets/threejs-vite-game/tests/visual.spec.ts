import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

type CanvasSample = {
  ok: boolean;
  reason: string;
  variance?: number;
  colorBuckets?: number;
};

async function sampleCanvas(page: import('@playwright/test').Page): Promise<CanvasSample> {
  const canvas = page.locator('#game-canvas');
  const box = await canvas.boundingBox();
  if (!box || box.width < 32 || box.height < 32) {
    return { ok: false, reason: 'canvas-too-small' };
  }

  const buffer = await canvas.screenshot();
  const png = PNG.sync.read(buffer);
  let min = 255;
  let max = 0;
  let alphaPixels = 0;
  const buckets = new Set<string>();
  const stride = Math.max(1, Math.floor((png.width * png.height) / 4096));

  for (let pixel = 0; pixel < png.width * png.height; pixel += stride) {
    const offset = pixel * 4;
    const r = png.data[offset];
    const g = png.data[offset + 1];
    const b = png.data[offset + 2];
    const a = png.data[offset + 3];
    min = Math.min(min, r, g, b);
    max = Math.max(max, r, g, b);
    if (a > 0) alphaPixels += 1;
    buckets.add(`${r >> 4},${g >> 4},${b >> 4},${a >> 6}`);
  }

  const variance = max - min;
  return {
    ok: alphaPixels > 256 && (variance > 8 || buckets.size > 3),
    reason: 'sampled',
    variance,
    colorBuckets: buckets.size,
  };
}

test('renders a nonblank interactive game canvas', async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page.locator('#game-canvas')).toBeVisible();
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);

  const sample = await sampleCanvas(page);
  expect(sample, JSON.stringify(sample)).toMatchObject({ ok: true });

  const before = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.player.position.z ?? 0);

  if (testInfo.project.name.includes('mobile')) {
    const stick = page.locator('#touch-stick');
    await expect(stick).toBeVisible();
    const box = await stick.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.05, { steps: 6 });
      await page.waitForTimeout(450);
      await page.mouse.up();
    }
  } else {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(450);
    await page.keyboard.up('KeyW');
  }

  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.player.position.z ?? 0))
    .toBeLessThan(before - 0.3);

  const screenshot = await page.screenshot({ fullPage: true });
  await testInfo.attach(`${testInfo.project.name}-game`, {
    body: screenshot,
    contentType: 'image/png',
  });

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

// ---------------------------------------------------------------------------
// State consistency: restart, screenshot pause, and diagnostics <-> HUD.
// All driving goes through the existing in-page hooks/diagnostics.
// ---------------------------------------------------------------------------

type Diagnostics = NonNullable<Window['__THREE_GAME_DIAGNOSTICS__']>;
type MoveKey = 'KeyW' | 'KeyA' | 'KeyS' | 'KeyD';

async function getDiagnostics(page: Page): Promise<Diagnostics> {
  return page.evaluate(() => {
    const diagnostics = window.__THREE_GAME_DIAGNOSTICS__;
    if (!diagnostics) throw new Error('__THREE_GAME_DIAGNOSTICS__ is not published');
    return diagnostics;
  });
}

function collectPageErrors(page: Page): { consoleErrors: string[]; pageErrors: string[] } {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  return { consoleErrors, pageErrors };
}

function formatHudTime(elapsed: number): string {
  const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const seconds = Math.floor(elapsed % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

/**
 * Reads diagnostics and HUD text in one synchronous evaluate so a frame boundary
 * cannot land between the two reads.
 */
async function expectHudInSync(page: Page): Promise<void> {
  const state = await page.evaluate(() => {
    const d = window.__THREE_GAME_DIAGNOSTICS__;
    const text = (selector: string) => document.querySelector(selector)?.textContent ?? null;
    return {
      diag: d
        ? {
            elapsed: d.elapsed,
            score: d.score,
            targetScore: d.targetScore,
            complete: d.complete,
          }
        : null,
      hud: {
        score: text('#score-value'),
        target: text('#target-value'),
        timer: text('#timer-value'),
        status: text('#status-line'),
      },
    };
  });

  expect(state.diag, 'diagnostics must be published').not.toBeNull();
  const diag = state.diag as NonNullable<typeof state.diag>;
  expect(state.hud.score, 'HUD score matches diagnostics').toBe(String(diag.score));
  expect(state.hud.target, 'HUD target matches diagnostics').toBe(String(diag.targetScore));
  expect(state.hud.timer, 'HUD timer matches diagnostics.elapsed').toBe(formatHudTime(diag.elapsed));
  expect(state.hud.status, 'HUD status line matches diagnostics.complete').toBe(
    diag.complete ? 'Relay grid online' : 'Collect relays',
  );
}

/** Exact mulberry32 sequence used by src/utils/random.ts. */
function seededRandomValues(seed: number, count: number): number[] {
  let state = seed >>> 0;
  const values: number[] = [];
  for (let i = 0; i < count; i += 1) {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    values.push(((t ^ (t >>> 14)) >>> 0) / 4294967296);
  }
  return values;
}

async function engageForward(page: Page, mobile: boolean): Promise<() => Promise<void>> {
  if (mobile) {
    const stick = page.locator('#touch-stick');
    const box = await stick.boundingBox();
    expect(box, 'touch stick must be visible on mobile project').not.toBeNull();
    if (!box) return async () => {};
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX, centerY - box.height * 0.34, { steps: 4 });
    return async () => {
      await page.mouse.up().catch(() => {});
    };
  }

  await page.keyboard.down('KeyW');
  return async () => {
    await page.keyboard.up('KeyW').catch(() => {});
  };
}

test('restart from complete restores score, timer, player and relay visibility', async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  await page.goto('/');
  await expect(page.locator('#game-canvas')).toBeVisible();
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);

  // Let the timer leave zero so restart proves elapsed is reset.
  await page.waitForTimeout(350);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('complete'));

  const completed = await getDiagnostics(page);
  expect(completed.score).toBe(8);
  expect(completed.targetScore).toBe(8);
  expect(completed.complete).toBe(true);
  expect(completed.pickups).toHaveLength(8);
  expect(completed.pickups.every((p) => p.collected && !p.active && !p.visible)).toBe(true);
  await expectHudInSync(page);
  await expect(page.locator('#score-value')).toHaveText('8');
  await expect(page.locator('#status-line')).toHaveText('Relay grid online');

  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('active-play'));
  const restarted = await getDiagnostics(page);

  expect(restarted.score).toBe(0);
  expect(restarted.targetScore).toBe(8);
  expect(restarted.complete).toBe(false);
  expect(restarted.elapsed).toBeLessThan(0.25);
  expect(Math.abs(restarted.player.position.x)).toBeLessThan(1e-6);
  expect(Math.abs(restarted.player.position.z)).toBeLessThan(1e-6);
  expect(restarted.player.speed).toBeLessThan(1e-6);
  expect(restarted.pickups).toHaveLength(8);
  expect(restarted.pickups.every((p) => p.active && p.visible && !p.collected)).toBe(true);

  await expectHudInSync(page);
  await expect(page.locator('#score-value')).toHaveText('0');
  await expect(page.locator('#timer-value')).toHaveText('00:00');
  await expect(page.locator('#status-line')).toHaveText('Collect relays');

  expect(errors.consoleErrors).toEqual([]);
  expect(errors.pageErrors).toEqual([]);
});

test('restart resets every relay animation phase and re-seeds rotation', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);

  const seed = 987654;
  const expectedRotations = seededRandomValues(seed, 8).map((value) => value * Math.PI * 2);

  // Seed + restart + read in one evaluate: the published rotations are exactly
  // the RNG-assigned spawn angles before another frame can advance them.
  const resetOnce = await page.evaluate((seedValue) => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__;
    hooks?.seed(seedValue);
    hooks?.setState('active-play');
    return window.__THREE_GAME_DIAGNOSTICS__ as Diagnostics;
  }, seed);

  resetOnce.pickups.forEach((pickup, index) => {
    expect(pickup.rotationY).toBeCloseTo(expectedRotations[index], 10);
    expect(pickup.rotation.y).toBeCloseTo(expectedRotations[index], 10);
    // Core spin and float phase must also return to their starting values.
    expect(pickup.coreRotationX).toBe(0);
    expect(pickup.rotation.x).toBe(0);
    expect(pickup.rotation.z).toBe(0);
    expect(pickup.position.y).toBeCloseTo(0.78 + Math.sin(index) * 0.16, 10);
  });

  // Let rotation accumulate, then complete the run so the collected relays
  // freeze while carrying a non-trivial residual phase.
  await page.waitForTimeout(650);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('complete'));
  const residual = await getDiagnostics(page);
  const residualRotations = residual.pickups.map((p) => p.rotationY);

  // Re-seed identically and restart: rotations return to the same deterministic
  // spawn angles instead of sticking at the collected residual phase.
  const resetTwice = await page.evaluate((seedValue) => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__;
    hooks?.seed(seedValue);
    hooks?.setState('active-play');
    return window.__THREE_GAME_DIAGNOSTICS__ as Diagnostics;
  }, seed);
  const freshRotations = resetTwice.pickups.map((p) => p.rotationY);

  const sharedAdvance: number[] = [];
  freshRotations.forEach((angle, index) => {
    expect(angle).toBeCloseTo(expectedRotations[index], 10);
    const advanced = residualRotations[index] - angle;
    expect(advanced, `relay ${index} phase must not remain at its old angle`).toBeGreaterThan(0.12);
    sharedAdvance.push(advanced);
  });
  // Every relay spins at the same fixed rate, so the discarded phase span is shared.
  for (let i = 1; i < sharedAdvance.length; i += 1) {
    expect(Math.abs(sharedAdvance[i] - sharedAdvance[0])).toBeLessThan(1e-6);
  }

  // Reset phases must keep animating afterwards.
  await page.waitForTimeout(350);
  const animating = await getDiagnostics(page);
  animating.pickups.forEach((pickup, index) => {
    expect(pickup.rotationY).toBeGreaterThan(freshRotations[index] + 0.03);
  });
});

test('screenshot pause freezes time, movement, relay animation and scoring, then resumes', async ({
  page,
}, testInfo) => {
  const errors = collectPageErrors(page);
  const mobile = testInfo.project.name.includes('mobile');

  await page.goto('/');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);
  await page.evaluate(() => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__;
    hooks?.seed(7);
    hooks?.setState('active-play');
    hooks?.setPausedForScreenshot(true);
  });

  const frameAtPause = (await getDiagnostics(page)).frame;
  // Frames/diagnostics keep being published while paused.
  await expect
    .poll(async () => (await getDiagnostics(page)).frame, { timeout: 5_000 })
    .toBeGreaterThan(frameAtPause + 4);

  const before = await getDiagnostics(page);
  expect(before.paused).toBe(true);

  const releaseForward = await engageForward(page, mobile);
  try {
    await page.waitForTimeout(450);
    const frozen = await getDiagnostics(page);

    expect(frozen.frame).toBeGreaterThan(before.frame);
    expect(frozen.elapsed).toBe(before.elapsed);
    expect(frozen.score).toBe(before.score);
    expect(frozen.complete).toBe(before.complete);
    expect(frozen.player.position.x).toBe(before.player.position.x);
    expect(frozen.player.position.z).toBe(before.player.position.z);
    expect(frozen.player.speed).toBe(0);
    expect(frozen.pickups.map((p) => p.rotationY)).toEqual(before.pickups.map((p) => p.rotationY));
    expect(frozen.pickups.map((p) => p.position.y)).toEqual(before.pickups.map((p) => p.position.y));

    // Resume while input is still held: simulation continues from the freeze.
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setPausedForScreenshot(false));

    await expect
      .poll(async () => (await getDiagnostics(page)).elapsed, { timeout: 5_000 })
      .toBeGreaterThan(frozen.elapsed + 0.15);
    const resumedTime = await getDiagnostics(page);
    // No pause-induced time jump.
    expect(resumedTime.elapsed - frozen.elapsed).toBeLessThan(1.5);

    await expect
      .poll(async () => (await getDiagnostics(page)).player.position.z, { timeout: 5_000 })
      .toBeLessThan(frozen.player.position.z - 0.3);

    const resumed = await getDiagnostics(page);
    expect(resumed.paused).toBe(false);
  } finally {
    await releaseForward();
  }

  expect(errors.consoleErrors).toEqual([]);
  expect(errors.pageErrors).toEqual([]);
});

test('diagnostics and HUD agree across pause/restart/complete combinations', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);

  // Paused -> active-play.
  await page.evaluate(() => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__;
    hooks?.setPausedForScreenshot(true);
    hooks?.setState('active-play');
  });
  let diagnostics = await getDiagnostics(page);
  expect(diagnostics.paused).toBe(true);
  expect(diagnostics.score).toBe(0);
  expect(diagnostics.complete).toBe(false);
  await expectHudInSync(page);

  // Paused -> complete.
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('complete'));
  diagnostics = await getDiagnostics(page);
  expect(diagnostics.paused).toBe(true);
  expect(diagnostics.score).toBe(8);
  expect(diagnostics.complete).toBe(true);
  await expectHudInSync(page);
  await expect(page.locator('#score-value')).toHaveText('8');
  await expect(page.locator('#status-line')).toHaveText('Relay grid online');

  // Paused -> active-play again.
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('active-play'));
  diagnostics = await getDiagnostics(page);
  expect(diagnostics.score).toBe(0);
  expect(diagnostics.complete).toBe(false);
  await expectHudInSync(page);
  await expect(page.locator('#timer-value')).toHaveText('00:00');

  // Resume, then complete and restart while running.
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setPausedForScreenshot(false));
  await expectHudInSync(page);

  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('complete'));
  await expectHudInSync(page);
  await expect(page.locator('#status-line')).toHaveText('Relay grid online');

  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('active-play'));
  await expectHudInSync(page);
  await expect(page.locator('#score-value')).toHaveText('0');
  await expect(page.locator('#status-line')).toHaveText('Collect relays');

  expect(errors.consoleErrors).toEqual([]);
  expect(errors.pageErrors).toEqual([]);
});

async function driveToAllRelays(
  page: Page,
  timeoutMs = 60_000,
): Promise<{ scoreHistory: number[]; timedOut: boolean; finalScore: number; complete: boolean }> {
  const held = new Set<MoveKey>();
  const scoreHistory: number[] = [];
  let previousScore = -1;
  const startedAt = Date.now();

  const releaseAll = async (): Promise<void> => {
    for (const key of held) await page.keyboard.up(key).catch(() => {});
    held.clear();
  };

  try {
    while (Date.now() - startedAt < timeoutMs) {
      const diagnostics = await getDiagnostics(page);
      if (diagnostics.score !== previousScore) {
        scoreHistory.push(diagnostics.score);
        previousScore = diagnostics.score;
      }
      if (diagnostics.complete || diagnostics.score >= diagnostics.targetScore) {
        return { scoreHistory, timedOut: false, finalScore: diagnostics.score, complete: true };
      }

      const position = diagnostics.player.position;
      const active = diagnostics.pickups.filter((pickup) => pickup.active);
      if (active.length === 0) {
        return { scoreHistory, timedOut: false, finalScore: diagnostics.score, complete: false };
      }

      let target = active[0];
      let bestDistanceSq = Number.POSITIVE_INFINITY;
      for (const pickup of active) {
        const dx = pickup.position.x - position.x;
        const dz = pickup.position.z - position.z;
        const distanceSq = dx * dx + dz * dz;
        if (distanceSq < bestDistanceSq) {
          bestDistanceSq = distanceSq;
          target = pickup;
        }
      }

      const dx = target.position.x - position.x;
      const dz = target.position.z - position.z;
      const desired = new Set<MoveKey>();
      if (dx > 0.25) desired.add('KeyD');
      else if (dx < -0.25) desired.add('KeyA');
      if (dz > 0.25) desired.add('KeyS');
      else if (dz < -0.25) desired.add('KeyW');

      for (const key of [...held]) {
        if (!desired.has(key)) {
          await page.keyboard.up(key);
          held.delete(key);
        }
      }
      for (const key of desired) {
        if (!held.has(key)) {
          await page.keyboard.down(key);
          held.add(key);
        }
      }

      await page.waitForTimeout(90);
    }

    const diagnostics = await getDiagnostics(page);
    return {
      scoreHistory,
      timedOut: true,
      finalScore: diagnostics.score,
      complete: diagnostics.complete,
    };
  } finally {
    await releaseAll();
  }
}

test('after restart, collecting relays scores again and re-triggers completion', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name.includes('mobile'),
    'Keyboard closed-loop collection; touch movement is covered by the interaction test.',
  );
  test.setTimeout(120_000);

  const errors = collectPageErrors(page);
  await page.goto('/');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);

  // Complete, then restart: the exact state transition called out in the task.
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('complete'));
  expect((await getDiagnostics(page)).complete).toBe(true);
  await page.evaluate(() => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__;
    hooks?.seed(4242);
    hooks?.setState('active-play');
  });
  expect((await getDiagnostics(page)).score).toBe(0);

  const result = await driveToAllRelays(page);
  expect(result.timedOut, `closed-loop collection timed out: ${JSON.stringify(result)}`).toBe(false);
  expect(result.scoreHistory).toContain(1);
  expect(result.finalScore).toBe(8);
  expect(result.complete).toBe(true);

  const diagnostics = await getDiagnostics(page);
  expect(diagnostics.score).toBe(8);
  expect(diagnostics.complete).toBe(true);
  expect(diagnostics.pickups.every((pickup) => !pickup.active && !pickup.visible)).toBe(true);

  await expectHudInSync(page);
  await expect(page.locator('#score-value')).toHaveText('8');
  await expect(page.locator('#status-line')).toHaveText('Relay grid online');

  expect(errors.consoleErrors).toEqual([]);
  expect(errors.pageErrors).toEqual([]);
});
