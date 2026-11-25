import { test, expect, type Page } from '@playwright/test';
import { openTour, startTour, dismissSplashIfPresent } from './helpers';
import {
  FIXTURE_AUDIO_URLS,
  installLocalAssetMocks,
  getTourAssetCacheEntries,
  cacheHasUrl,
  resetOfflineState,
  simulateOfflineForAudio,
  clearOfflineSimulation,
  type AudioRouteStats,
} from './offline-helpers';

/**
 * Offline-download ↔ audio-preload ↔ mini-player coordination.
 *
 * All media is synthesized locally and served through route mocks
 * (offline-helpers.ts): no real network, no external credentials. The hidden
 * `_fixture` tour points its audio stops at /test-assets/audio/*.wav, the same
 * URLs the mocks answer and the download manager caches.
 *
 * Acceptance coverage:
 *  1. Normal download completes → offline playback hits the cache.
 *  2. Switching stops while the target is still downloading waits, then plays.
 *  3. Cancelling leaves no residual cache entry and the player falls back /
 *     shows a visible unavailable state.
 *  4. Repeated requests for one address produce a single cached copy.
 *  Plus: partial failure and cancel-then-retry state consistency.
 */

const TOUR_ID = '_offline';
const STOP_1 = '/test-assets/audio/stop-1.wav';
const STOP_2 = '/test-assets/audio/stop-2.wav';

async function openFixtureTour(page: Page): Promise<void> {
  await page.goto(`/tour/${TOUR_ID}`, { waitUntil: 'domcontentloaded' });
  await dismissSplashIfPresent(page);
  await page.getByRole('button', { name: /Start tour|Resume tour|Replay tour/ }).waitFor({
    timeout: 15000,
  });
}

/** Registry state for a URL, read straight from the page's module singleton. */
async function registryState(page: Page, url: string): Promise<string> {
  return page.evaluate((target) => {
    const handle = (window as unknown as {
      __resourceRegistry?: { getResourceStatus: (u: string) => { state: string } };
    }).__resourceRegistry;
    if (!handle) throw new Error('resource registry debug handle missing');
    return handle.getResourceStatus(target).state;
  }, url);
}

test.describe('Offline download / preload / player coordination', () => {
  test.beforeEach(async ({ context, page }) => {
    // Land on a real same-origin page first so storage APIs are available.
    await page.goto(`/tour/${TOUR_ID}`, { waitUntil: 'domcontentloaded' });
    await resetOfflineState(page);

    // Start from a clean service worker too — cached responses from other
    // specs would otherwise mask the coordination behavior.
    await page.evaluate(async () => {
      const regs = await navigator.serviceWorker?.getRegistrations();
      await Promise.all((regs ?? []).map((r) => r.unregister()));
    });
    await context.clearCookies();
  });

  test('completed download: one cache entry per URL and offline playback reuses it', async ({
    context,
    page,
  }) => {
    const stats = await installLocalAssetMocks(context);
    await openFixtureTour(page);

    // Start the offline download from the start card.
    await page.getByRole('button', { name: 'Download for offline' }).click();

    // The tour reports completion (all assets cached).
    await expect
      .poll(() => registryState(page, STOP_1), { timeout: 15000 })
      .toBe('cached');
    await expect
      .poll(() => registryState(page, STOP_2), { timeout: 15000 })
      .toBe('cached');

    await expect.poll(() => getTourAssetCacheEntries(page), { timeout: 5000 }).toEqual(
      expect.arrayContaining(FIXTURE_AUDIO_URLS as unknown as string[])
    );

    // The registry owns exactly one download fetch per address; any `media`
    // request is the player's normal streaming path, not a second download.
    const fetchHits = (path: string) => stats.hitsByType.get(path)?.get('fetch') ?? 0;
    expect(fetchHits(STOP_1)).toBe(1);
    expect(fetchHits(STOP_2)).toBe(1);

    // Go offline, then start the tour: the player must serve the first stop
    // from the cache with no new network request for the audio.
    await simulateOfflineForAudio(context);
    await startTour(page, TOUR_ID);

    // The singleton audio element's src resolves to the cached address.
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            Array.from(document.querySelectorAll('audio')).some(
              (a) => a.src.includes('/test-assets/audio/stop-1.wav') && a.readyState >= 1
            )
          ),
        { timeout: 15000 }
      )
      .toBe(true);

    // No extra download fetch for an address that was already cached.
    expect(fetchHits(STOP_1)).toBe(1);
    await clearOfflineSimulation(context);
  });

  test('switching to a stop whose audio is downloading waits, then plays it', async ({
    context,
    page,
  }) => {
    test.setTimeout(60000);
    // Hold every audio response long enough to cover the in-app navigation.
    await installLocalAssetMocks(context, { audioDelayMs: 12000 });
    await openFixtureTour(page);

    // Enter the player first via SPA navigation (a full reload would reset the
    // in-memory registry and defeat the wait scenario).
    await startTour(page, TOUR_ID);

    // A background download for stop 2 starts while the visitor is already in
    // the player — the same path "Download tour" takes, driven directly through
    // the shared registry so the Start CTA's disabled state doesn't block us.
    await page.evaluate((url) => {
      const handle = (window as unknown as {
        __resourceRegistry: { ensureDownload: (u: string) => Promise<void> };
      }).__resourceRegistry;
      void handle.ensureDownload(url);
    }, STOP_2);
    await expect
      .poll(() => registryState(page, STOP_2), { timeout: 8000 })
      .toBe('downloading');

    // Jump to stop 2 (in-app, no reload) while its audio is still downloading.
    await page.locator('[id^="stop-"]').filter({ hasText: 'Second audio stop' }).first().click();

    // The mini player shows the visible waiting banner rather than erroring.
    await expect(page.getByTestId('player-status-banner')).toBeVisible({ timeout: 8000 });

    // Once the download settles, the banner disappears and the audio element
    // loads stop 2 — no error screen, no silent skip.
    await expect(page.getByTestId('player-status-banner')).toBeHidden({ timeout: 20000 });
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            Array.from(document.querySelectorAll('audio')).some((a) =>
              a.src.includes('/test-assets/audio/stop-2.wav')
            )
          ),
        { timeout: 10000 }
      )
      .toBe(true);
    await expect.poll(() => registryState(page, STOP_2), { timeout: 5000 }).toBe('cached');
  });

  test('cancelling a download leaves no partial cache entry and the player falls back', async ({
    context,
    page,
  }) => {
    test.setTimeout(60000);
    // stop-2 is not eagerly preloaded, so its download stays in flight long
    // enough to cancel deterministically.
    await installLocalAssetMocks(context, { audioDelayMs: 12000 });
    await openFixtureTour(page);

    await page.getByRole('button', { name: 'Download for offline' }).click();
    await expect
      .poll(() => registryState(page, STOP_2), { timeout: 10000 })
      .toBe('downloading');

    // Cancel via the start-card action.
    await page.getByRole('button', { name: 'Cancel download' }).click();

    // Registry returns to idle and no half-finished cache entry remains.
    await expect
      .poll(() => registryState(page, STOP_2), { timeout: 10000 })
      .toBe('idle');
    await expect.poll(() => cacheHasUrl(page, STOP_2), { timeout: 5000 }).toBe(false);
    const entries = await getTourAssetCacheEntries(page);
    expect(entries.some((e) => e.endsWith('stop-2.wav'))).toBe(false);

    // Online: starting the tour and opening stop 2 falls back to the streaming
    // address instead of showing an error — the audio element still gets a URL.
    await startTour(page, TOUR_ID);
    await page.locator('[id^="stop-"]').filter({ hasText: 'Second audio stop' }).first().click();
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            Array.from(document.querySelectorAll('audio')).some((a) =>
              a.src.includes('/test-assets/audio/stop-2.wav')
            )
          ),
        { timeout: 15000 }
      )
      .toBe(true);
  });

  test('cancelled download while offline shows a visible unavailable player state', async ({
    context,
    page,
  }) => {
    test.setTimeout(60000);
    await installLocalAssetMocks(context, { audioDelayMs: 12000 });
    await openFixtureTour(page);

    await page.getByRole('button', { name: 'Download for offline' }).click();
    await expect
      .poll(() => registryState(page, STOP_2), { timeout: 10000 })
      .toBe('downloading');
    await page.getByRole('button', { name: 'Cancel download' }).click();
    await expect
      .poll(() => registryState(page, STOP_2), { timeout: 10000 })
      .toBe('idle');
    expect(await cacheHasUrl(page, STOP_2)).toBe(false);

    // Now go offline with stop 2 uncached and open it: the player must say so
    // visibly rather than silently failing.
    await simulateOfflineForAudio(context);
    await startTour(page, TOUR_ID);
    await page.locator('[id^="stop-"]').filter({ hasText: 'Second audio stop' }).first().click();
    await expect(page.getByTestId('player-status-banner')).toBeVisible({ timeout: 10000 });
    expect(await page.getByTestId('player-status-banner').innerText()).toContain('offline');
    await clearOfflineSimulation(context);
  });

  test('duplicate requests for one address never create a second cache entry', async ({
    context,
    page,
  }) => {
    // stop-2 gives a clean slate (no eager preload); a long delay keeps the
    // first request in flight so the second genuinely races it.
    const stats: AudioRouteStats = await installLocalAssetMocks(context, { audioDelayMs: 3000 });
    await openFixtureTour(page);

    // Fire two downloads for the same address concurrently (double tap / a
    // remounted hook) — the second must join the first instead of fetching.
    await page.evaluate((url) => {
      const handle = (window as unknown as {
        __resourceRegistry: { ensureDownload: (u: string) => Promise<void> };
      }).__resourceRegistry;
      void handle.ensureDownload(url);
      void handle.ensureDownload(url);
    }, STOP_2);

    await expect
      .poll(() => registryState(page, STOP_2), { timeout: 15000 })
      .toBe('cached');

    // One download fetch and one cache entry for this address, even though two
    // callers requested it concurrently.
    expect(stats.hitsByType.get(STOP_2)?.get('fetch') ?? 0).toBe(1);
    const entries = (await getTourAssetCacheEntries(page)).filter((e) =>
      e.endsWith('stop-2.wav')
    );
    expect(entries).toHaveLength(1);
  });

  test('partial failure is queryable and retry only re-fetches failed URLs', async ({
    context,
    page,
  }) => {
    test.setTimeout(60000);
    // First phase: make every audio request fail. The eager preload hits this
    // too, so the start card may already show Retry by the time we interact.
    await installLocalAssetMocks(context, { failAudio: true });
    await openFixtureTour(page);

    // Start a full download attempt (Retry if the eager preload failed first).
    const start = page.getByRole('button', { name: /download for offline|retry/i });
    await start.waitFor({ timeout: 10000 });
    await start.click();
    await expect
      .poll(() => registryState(page, STOP_1), { timeout: 15000 })
      .toBe('failed');
    await expect
      .poll(() => registryState(page, STOP_2), { timeout: 15000 })
      .toBe('failed');

    // Nothing was cached and the failure is visible/queryable.
    expect(await cacheHasUrl(page, STOP_1)).toBe(false);
    await expect
      .poll(() => getTourAssetCacheEntries(page), { timeout: 5000 })
      .not.toEqual(expect.arrayContaining(FIXTURE_AUDIO_URLS as unknown as string[]));

    // Restore healthy responses and retry through the start-card action. The
    // single catch-all mock is replaced wholesale by an unroute + reinstall.
    await context.unroute('**/*');
    const stats = await installLocalAssetMocks(context);

    // The start card swaps to a Retry action while any asset is failed.
    const retryButton = page.getByRole('button', { name: /retry/i });
    await retryButton.waitFor({ timeout: 5000 });
    await retryButton.click();
    await expect
      .poll(() => registryState(page, STOP_1), { timeout: 15000 })
      .toBe('cached');
    await expect
      .poll(() => registryState(page, STOP_2), { timeout: 15000 })
      .toBe('cached');
    // The healthy retry re-fetched stop 1 exactly once through the registry.
    expect(stats.hitsByType.get(STOP_1)?.get('fetch') ?? 0).toBe(1);
    expect(await cacheHasUrl(page, STOP_1)).toBe(true);
  });

  test('cancel then retry converges to a fully cached, queryable state', async ({
    context,
    page,
  }) => {
    test.setTimeout(60000);
    // stop-2 keeps an observable in-flight window; stop-1 may already be cached
    // by the eager preload, which is fine — the retry must still converge.
    await installLocalAssetMocks(context, { audioDelayMs: 12000 });
    await openFixtureTour(page);

    await page.getByRole('button', { name: 'Download for offline' }).click();
    await expect
      .poll(() => registryState(page, STOP_2), { timeout: 10000 })
      .toBe('downloading');
    await page.getByRole('button', { name: 'Cancel download' }).click();
    await expect
      .poll(() => registryState(page, STOP_2), { timeout: 10000 })
      .toBe('idle');

    // Restart the download after cancelling. The start card now offers either
    // a fresh "Download for offline" or a "Retry" depending on how many assets
    // had already settled — accept both.
    const restart = page.getByRole('button', { name: /download for offline|retry/i });
    await restart.waitFor({ timeout: 10000 });
    await restart.click();
    await expect
      .poll(() => registryState(page, STOP_2), { timeout: 20000 })
      .toBe('cached');

    const entries = await getTourAssetCacheEntries(page);
    for (const url of FIXTURE_AUDIO_URLS) {
      expect(entries).toContain(url);
      expect(await registryState(page, url)).toBe('cached');
    }
  });
});
