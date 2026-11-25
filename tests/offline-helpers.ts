import { Page, BrowserContext } from '@playwright/test';

/**
 * Helpers for the offline-download / audio-preload coordination suite.
 *
 * Everything is local and deterministic: tiny WAV files are synthesized in
 * memory and served through Playwright route interception, so the tests never
 * touch the real network or need credentials. The same fixture audio URLs are
 * used by the hidden `_fixture` tour (`/test-assets/audio/*.wav`).
 */

export const FIXTURE_AUDIO_URLS = [
  '/test-assets/audio/stop-1.wav',
  '/test-assets/audio/stop-2.wav',
] as const;

/** A small valid mono 16-bit PCM WAV (default ~0.4s of silence). */
export function makeWavBytes(seconds = 0.4, sampleRate = 8000): Buffer {
  const numSamples = Math.floor(seconds * sampleRate);
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  // Samples stay zero (silence) — enough for metadata/canplaythrough in tests.
  return buffer;
}

export interface MockRouteOptions {
  /** Delay each audio response by this many ms to keep a download "in flight". */
  audioDelayMs?: number;
  /** When true, the fixture audio URLs respond 500 instead of audio bytes. */
  failAudio?: boolean;
}

export interface AudioRouteStats {
  /** Number of times the network layer was actually hit per audio path. */
  hits: Map<string, number>;
  /**
   * Per-resource-type hit counts per audio path, so tests can distinguish the
   * registry's download `fetch` from the player's normal `media` streaming.
   */
  hitsByType: Map<string, Map<string, number>>;
}

/**
 * Install local route mocks on a context:
 * - fixture WAV URLs are answered from memory (optionally delayed/failing)
 * - every other external request is aborted locally so no real network is used
 *
 * Returns live stats the spec can assert on.
 */
export async function installLocalAssetMocks(
  context: BrowserContext,
  options: MockRouteOptions = {}
): Promise<AudioRouteStats> {
  const stats: AudioRouteStats = { hits: new Map(), hitsByType: new Map() };
  const wav = makeWavBytes();

  // One catch-all handler: fixture audio is synthesized in memory, same-origin
  // dev-server traffic continues, and everything external is stubbed or
  // aborted. A single handler avoids overlapping-glob ordering surprises.
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname.startsWith('/test-assets/audio/')) {
      stats.hits.set(url.pathname, (stats.hits.get(url.pathname) ?? 0) + 1);
      const byType =
        stats.hitsByType.get(url.pathname) ?? new Map<string, number>();
      const resourceType = request.resourceType();
      byType.set(resourceType, (byType.get(resourceType) ?? 0) + 1);
      stats.hitsByType.set(url.pathname, byType);

      if (options.audioDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.audioDelayMs));
      }

      if (options.failAudio) {
        return route.fulfill({
          status: 500,
          contentType: 'text/plain',
          body: 'Mocked audio failure',
        });
      }

      return route.fulfill({
        status: 200,
        contentType: 'audio/wav',
        headers: {
          'Content-Length': String(wav.length),
          'Accept-Ranges': 'bytes',
        },
        body: wav,
      });
    }

    const frameUrl = request.frame()?.url() ?? '';
    const sameOrigin =
      url.hostname === 'localhost' && frameUrl.startsWith(`http://localhost:${url.port}`);

    if (sameOrigin) {
      return route.continue();
    }

    if (request.resourceType() === 'image') {
      return route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          'base64'
        ),
      });
    }
    return route.abort();
  });

  return stats;
}

/** Read the `tour-assets` Cache Storage entries visible to the page. */
export async function getTourAssetCacheEntries(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    if (!('caches' in window)) return [];
    const cache = await caches.open('tour-assets');
    const requests = await cache.keys();
    return requests.map((r) => new URL(r.url).pathname);
  });
}

/** Whether a specific URL currently exists in the `tour-assets` cache. */
export async function cacheHasUrl(page: Page, url: string): Promise<boolean> {
  return page.evaluate(async (target) => {
    const cache = await caches.open('tour-assets');
    const keys = (await cache.keys()).map((r) => r.url);
    return keys.some((u) => new URL(u).pathname === target || u === target);
  }, url);
}

/**
 * Simulate "offline" at the network layer without disconnecting localhost
 * (Playwright's setOffline would also block the dev server). After this call,
 * any request for an audio fixture URL that is NOT already in the shared cache
 * fails, while cached audio and the app shell keep working — exactly the
 * offline condition the player must survive. `navigator.onLine` is flipped to
 * false on every frame as well, and an `offline` event is dispatched.
 */
export async function simulateOfflineForAudio(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => false,
    });
    window.addEventListener('DOMContentLoaded', () => window.dispatchEvent(new Event('offline')));
  });

  await context.route('**/test-assets/audio/*.wav', async (route) => {
    const page = context.pages()[0];
    const url = new URL(route.request().url());
    const hit = page
      ? await page.evaluate(async (pathname) => {
          const cache = await caches.open('tour-assets');
          const keys = (await cache.keys()).map((r) => new URL(r.url).pathname);
          return keys.includes(pathname);
        }, url.pathname)
      : false;

    if (hit) {
      // Hand back the cached bytes through the same mocked shape the online
      // tests use, so playback can proceed without a network.
      return route.fulfill({
        status: 200,
        contentType: 'audio/wav',
        headers: { 'Accept-Ranges': 'bytes' },
        body: makeWavBytes(),
      });
    }
    return route.abort('failed');
  });
}

/** Remove the offline simulation installed by simulateOfflineForAudio. */
export async function clearOfflineSimulation(context: BrowserContext): Promise<void> {
  await context.unroute('**/test-assets/audio/*.wav');
}

/** Reset Cache Storage, the app's IndexedDB and localStorage. */
export async function resetOfflineState(page: Page): Promise<void> {
  await page.evaluate(async () => {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    // Delete the app's known DB directly — indexedDB.databases() is not allowed
    // in every browser context.
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('audiotour-db');
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
    localStorage.clear();
  });
}
