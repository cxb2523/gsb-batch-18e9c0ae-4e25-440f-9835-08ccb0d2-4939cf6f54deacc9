/**
 * ResourceRegistry — the single source of truth for every remote asset the app
 * fetches into the `tour-assets` Cache Storage.
 *
 * Before this registry existed, the download manager (offline "Download tour"),
 * the audio preloader (`new Audio()`) and the player each fetched the same URL
 * independently, so one audio address could be downloaded twice, a finished
 * download was invisible to the player ("downloaded but silent"), and cancelling
 * a download left a half-written cache entry behind.
 *
 * The registry now owns the per-URL lifecycle:
 *
 *   idle ──ensureDownload──▶ downloading ──success──▶ cached
 *                                  │
 *                                  ├──failure──▶ failed (no cache entry left)
 *                                  └──cancel───▶ idle   (no cache entry left)
 *
 * Rules every consumer relies on:
 * - One in-flight fetch per URL: a second `ensureDownload`/preload for the same
 *   address joins the existing promise instead of opening a second request.
 * - `cached` means the response really is in `tour-assets` (verified on write),
 *   so players and preloads can reuse it without re-fetching.
 * - Failure and cancellation always delete the partial cache entry — a URL is
 *   never reported `cached` while only half of it is on disk.
 * - State changes are observable (`subscribe`/`waitFor`), so the player can wait
 *   for a download in progress instead of erroring or skipping the stop.
 *
 * The service worker still answers Range requests from this same cache, so a
 * cached URL plays offline with no extra plumbing.
 */

export const TOUR_ASSETS_CACHE = 'tour-assets';

export type ResourceState = 'idle' | 'downloading' | 'cached' | 'failed';

export interface ResourceStatus {
  state: ResourceState;
  /** Set while `downloading`: 0–100. Undefined otherwise. */
  progress?: number;
  /** Set when `failed`: the error message surfaced to the UI. */
  error?: string;
}

interface ResourceEntry {
  state: ResourceState;
  progress?: number;
  error?: string;
  /** Shared in-flight promise; the same promise is returned to every requester. */
  promise: Promise<void> | null;
  /** Abort handle for the in-flight fetch (cancellation). */
  controller: AbortController | null;
  /**
   * Immutable snapshot handed to listeners and React's useSyncExternalStore.
   * It keeps the same reference until the next real state change, so React
   * never tears or re-renders on an identical read.
   */
  snapshot: ResourceStatus;
}

type Listener = (url: string, status: ResourceStatus) => void;

const entries = new Map<string, ResourceEntry>();
const listeners = new Set<Listener>();

/**
 * Normalize every URL to an absolute href so a relative path (`/audio/x.wav`)
 * and its resolved form (`https://host/audio/x.wav`) share one registry entry
 * and therefore one cache entry. In non-browser contexts the input is used
 * unchanged.
 */
function normalizeUrl(url: string): string {
  if (typeof window !== 'undefined' && window.location) {
    try {
      return new URL(url, window.location.href).href;
    } catch {
      return url;
    }
  }
  return url;
}

const getEntry = (url: string): ResourceEntry => {
  const key = normalizeUrl(url);
  let entry = entries.get(key);
  if (!entry) {
    entry = {
      state: 'idle',
      promise: null,
      controller: null,
      snapshot: { state: 'idle' },
    };
    entries.set(key, entry);
  }
  return entry;
};

/** Rebuild the immutable snapshot and fan out the change. */
const emit = (url: string) => {
  const key = normalizeUrl(url);
  const entry = entries.get(key);
  if (!entry) return;
  const snapshot: ResourceStatus = {
    state: entry.state,
    ...(entry.progress !== undefined ? { progress: entry.progress } : {}),
    ...(entry.error !== undefined ? { error: entry.error } : {}),
  };
  entry.snapshot = snapshot;
  listeners.forEach((listener) => {
    try {
      listener(key, snapshot);
    } catch (err) {
      console.error('[ResourceRegistry] listener error:', err);
    }
  });
};

const isCacheApiAvailable = (): boolean =>
  typeof globalThis !== 'undefined' && 'caches' in globalThis;

/**
 * Reconcile the in-memory state with what is actually in Cache Storage.
 * Runs once at startup: a previous session may have cached files without
 * recording them here, and a crashed download may have left a partial entry.
 */
let hydratePromise: Promise<void> | null = null;
export function hydrateResourceRegistry(): Promise<void> {
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    if (!isCacheApiAvailable()) return;
    try {
      const cache = await caches.open(TOUR_ASSETS_CACHE);
      const requests = await cache.keys();
      const cachedUrls = new Set(requests.map((request) => normalizeUrl(request.url)));

      // Snapshot which entries existed BEFORE this hydration ran. Only those
      // can legitimately be reconciled against the disk; entries created while
      // the async cache read was in flight belong to a live download and must
      // be left untouched.
      const knownKeysAtStart = new Set(entries.keys());

      // Anything on disk that we don't know about is a finished cached asset.
      for (const url of cachedUrls) {
        const entry = getEntry(url);
        if (entry.state !== 'cached') {
          entry.state = 'cached';
          entry.progress = undefined;
          entry.error = undefined;
          entry.promise = null;
          entry.controller = null;
          emit(url);
        }
      }

      // Only reconcile entries that predate this hydration AND claim to be
      // cached but have vanished from disk. In-flight downloads are never
      // touched: they have no cache entry until they finish.
      for (const url of knownKeysAtStart) {
        const entry = entries.get(url);
        if (entry && entry.state === 'cached' && !cachedUrls.has(url)) {
          entry.state = 'idle';
          entry.promise = null;
          entry.controller = null;
          entry.progress = undefined;
          entry.error = undefined;
          emit(url);
        }
      }
    } catch (err) {
      console.error('[ResourceRegistry] hydrate failed:', err);
    }
  })();

  return hydratePromise;
}

/** Stable snapshot of one URL's state (same reference until it changes). */
export function getResourceStatus(url: string): ResourceStatus {
  return entries.get(normalizeUrl(url))?.snapshot ?? { state: 'idle' };
}

export function isResourceCached(url: string): boolean {
  return entries.get(normalizeUrl(url))?.state === 'cached';
}

export function isResourceDownloading(url: string): boolean {
  return entries.get(normalizeUrl(url))?.state === 'downloading';
}

/** Subscribe to status changes for one URL (or every URL when `url` is omitted). */
export function subscribe(listener: Listener, url?: string): () => void {
  const targetKey = url ? normalizeUrl(url) : undefined;
  const wrapped: Listener = (changedUrl, status) => {
    if (!targetKey || changedUrl === targetKey) listener(changedUrl, status);
  };
  listeners.add(wrapped);
  return () => {
    listeners.delete(wrapped);
  };
}

/**
 * Resolve once the URL reaches `cached` or `failed`. Rejects when the download
 * is cancelled (state returns to `idle`) so callers can fall back to the
 * online address instead of waiting forever.
 */
export function waitForCompletion(url: string): Promise<ResourceStatus> {
  const key = normalizeUrl(url);
  const current = entries.get(key);
  if (current && (current.state === 'cached' || current.state === 'failed')) {
    return Promise.resolve(current.snapshot);
  }

  return new Promise((resolve, reject) => {
    const unsubscribe = subscribe((changedUrl, status) => {
      if (changedUrl !== key) return;
      if (status.state === 'cached' || status.state === 'failed') {
        unsubscribe();
        resolve(status);
      } else if (status.state === 'idle') {
        unsubscribe();
        reject(new Error(`Download cancelled for ${url}`));
      }
    }, key);
  });
}

async function removeCachedResponse(url: string): Promise<void> {
  if (!isCacheApiAvailable()) return;
  try {
    const cache = await caches.open(TOUR_ASSETS_CACHE);
    // Cache Storage matches the absolute request URL; delete both the raw key
    // (absolute) and any resolution of it.
    await cache.delete(normalizeUrl(url));
    await cache.delete(url);
  } catch (err) {
    console.error('[ResourceRegistry] failed to delete cache entry:', url, err);
  }
}

/**
 * Download `url` into the shared cache, joining an in-flight download if one
 * exists. Resolves when the response is verified in the cache; rejects on
 * network failure or cancellation. A failed/cancelled run never leaves a
 * partial cache entry behind.
 */
export function ensureDownload(url: string): Promise<void> {
  const entry = getEntry(url);
  const cacheUrl = normalizeUrl(url);

  // Reuse a finished asset or an in-flight request — never fetch twice.
  if (entry.state === 'cached') return Promise.resolve();
  if (entry.state === 'downloading' && entry.promise) return entry.promise;

  const controller = new AbortController();
  entry.controller = controller;
  entry.state = 'downloading';
  entry.error = undefined;
  entry.progress = 0;
  emit(cacheUrl);

  const run = async (): Promise<void> => {
    if (!isCacheApiAvailable()) {
      throw new Error('Cache API not available. Offline downloads require HTTPS or localhost.');
    }

    try {
      const cache = await caches.open(TOUR_ASSETS_CACHE);

      // Another path (e.g. the service worker's opportunistic caching) may have
      // stored the asset in the meantime — adopt it instead of re-fetching.
      const alreadyCached = await cache.match(cacheUrl);
      if (alreadyCached) {
        entry.state = 'cached';
        entry.progress = 100;
        entry.controller = null;
        emit(cacheUrl);
        return;
      }

      const response = await fetch(cacheUrl, { mode: 'cors', signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
      }

      // Stream the body so an aborted download cannot leave a truncated
      // response in the cache, and so progress reflects real bytes received.
      const reader = response.clone().body?.getReader();
      if (reader) {
        const contentLength = Number(response.headers.get('content-length')) || 0;
        let received = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value?.byteLength ?? 0;
          if (contentLength > 0) {
            entry.progress = Math.min(99, Math.round((received / contentLength) * 100));
            emit(cacheUrl);
          }
        }
      }

      // The fetch may have been aborted while `reader.read()` was pending.
      if (controller.signal.aborted) {
        throw new DOMException('Download aborted', 'AbortError');
      }

      await cache.put(cacheUrl, response.clone());

      // Verify before claiming success — a put that silently fails must not be
      // reported as cached (the old "downloaded but silent" bug).
      const verified = await cache.match(cacheUrl);
      if (!verified) {
        throw new Error(`Cache write could not be verified for ${url}`);
      }

      entry.state = 'cached';
      entry.progress = 100;
      entry.error = undefined;
      entry.controller = null;
      emit(cacheUrl);
    } catch (err) {
      // Always clear anything partial, whether we failed or were cancelled.
      await removeCachedResponse(cacheUrl);

      entry.controller = null;
      entry.promise = null;
      entry.progress = undefined;

      if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        entry.state = 'idle';
        entry.error = undefined;
        emit(cacheUrl);
        throw new DOMException('Download cancelled', 'AbortError');
      }

      entry.state = 'failed';
      entry.error = err instanceof Error ? err.message : String(err);
      emit(cacheUrl);
      throw err instanceof Error ? err : new Error(String(err));
    }
  };

  entry.promise = run();
  return entry.promise;
}

/**
 * Cancel an in-flight download and release its resource. No-op when nothing is
 * downloading. Guarantees no half-finished cache entry remains.
 */
export async function cancelDownload(url: string): Promise<void> {
  const key = normalizeUrl(url);
  const entry = entries.get(key);
  if (!entry || entry.state !== 'downloading') return;

  entry.controller?.abort();
  try {
    await entry.promise;
  } catch {
    // Expected: the aborted run rejects with AbortError.
  }
  // Defensive: make sure nothing partial survived regardless of the run's path.
  await removeCachedResponse(key);

  const current = entries.get(key);
  if (current && current.state === 'downloading') {
    current.state = 'idle';
    current.progress = undefined;
    current.promise = null;
    current.controller = null;
    emit(key);
  }
}

/** True when none of the given URLs is still downloading. */
export function allSettled(urls: string[]): boolean {
  return urls.every((url) => entries.get(normalizeUrl(url))?.state !== 'downloading');
}

/**
 * Forget registry state for specific URLs after their cache entries were
 * deleted outside the registry (e.g. storage cleanup). In-flight downloads of
 * those URLs are aborted first so nothing re-caches them.
 */
export function resetResourceUrls(urls: string[]): void {
  for (const url of urls) {
    const key = normalizeUrl(url);
    const entry = entries.get(key);
    if (!entry) continue;
    entry.controller?.abort();
    entries.delete(key);
  }
}

/** Test/teardown helper: forget all tracked state (does not touch the cache). */
export function resetResourceRegistry(): void {
  for (const entry of entries.values()) {
    entry.controller?.abort();
  }
  entries.clear();
  listeners.clear();
  hydratePromise = null;
}

// Debug/test handle: lets E2E specs query the live registry without a bundler
// path assumption. Never used by production UI code.
if (typeof globalThis !== 'undefined') {
  (globalThis as Record<string, unknown>).__resourceRegistry = {
    getResourceStatus,
    isResourceCached,
    isResourceDownloading,
    ensureDownload,
    cancelDownload,
    waitForCompletion,
    resetResourceRegistry,
  };
}
