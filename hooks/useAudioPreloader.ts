import { useEffect, useRef, useCallback } from 'react';
import { AudioStop } from '../types';
import {
  getResourceStatus,
  ensureDownload,
} from '../src/services/resourceRegistry';

const DEBUG_PRELOAD = import.meta.env.VITE_DEBUG_AUDIO === 'true' || import.meta.env.DEV;

// Performance tracking to detect infinite loops
let effectRunCount = 0;
let lastEffectRun = 0;

const debugLog = (...args: unknown[]) => {
  if (DEBUG_PRELOAD) {
    console.log('[PRELOAD]', ...args);
  }
};

const checkPerformance = (effectName: string) => {
  const now = Date.now();
  effectRunCount++;

  if (now - lastEffectRun < 100) {
    console.warn(`⚠️ [PERFORMANCE] ${effectName} running very frequently! Count: ${effectRunCount}`);
  }

  if (effectRunCount > 50) {
    console.error(`🔥 [PERFORMANCE] Possible infinite loop detected in ${effectName}! Count: ${effectRunCount}`);
  }

  lastEffectRun = now;

  // Reset counter every 5 seconds
  if (effectRunCount > 10 && now - lastEffectRun > 5000) {
    effectRunCount = 0;
  }
};

/**
 * Shared preload logic used by both the eager (pre-hook) loader and the
 * in-tour hook. The ResourceRegistry is consulted first so a URL that is
 * cached or already downloading is never fetched a second time:
 *
 * - cached       → create the media element against the cached URL (no fetch)
 * - downloading  → wait for the shared download, then create the element
 * - failed       → let the media element retry over the network
 * - idle         → register the preload as the URL's single in-flight fetch via
 *                  `ensureDownload`; a download manager starting for the same
 *                  address joins this promise instead of opening a second
 *                  request, and the bytes land in the shared cache either way.
 *
 * A module-level map additionally de-duplicates two callers racing for the
 * same URL before any registry state exists.
 */
const inflightPreloads = new Map<string, Promise<void>>();

export const preloadAudioUrl = (url: string): Promise<void> => {
  const existing = inflightPreloads.get(url);
  if (existing) {
    debugLog('♻️ Joining in-flight preload:', url);
    return existing;
  }

  const task = (async () => {
    const status = getResourceStatus(url);
    let registrySatisfied = false;

    if (status.state === 'cached') {
      debugLog('♻️ Preload reuses cached asset:', url);
      registrySatisfied = true;
    } else {
      // idle / downloading / failed → go through the registry so the network
      // fetch happens at most once per address and its result fills the shared
      // cache. On failure (e.g. offline), fall through to a media-element load
      // below, which surfaces the failure to the player instead of throwing.
      try {
        await ensureDownload(url);
        debugLog('✅ Preload populated/joined shared cache:', url);
        registrySatisfied = true;
      } catch (err) {
        debugLog('⚠️ Registry download unavailable, media element will retry online:', url, err);
      }
    }

    // When the bytes are already in the shared cache, creating another
    // HTMLAudioElement would just re-request the same address (the old
    // duplicate-fetch bug). The player's singleton loads the cached URL itself
    // when playback starts, so nothing else is needed here.
    if (registrySatisfied) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      debugLog('⏳ Preloading audio element (online fallback):', url);
      const audio = new Audio();
      audio.preload = 'auto';

      const handleCanPlayThrough = () => {
        debugLog('✅ Audio preloaded:', url);
        cleanup();
        // Release the element; the player's singleton loads the same URL from
        // the HTTP/cache layer when playback starts.
        audio.src = '';
        resolve();
      };

      const handleError = (e: Event) => {
        debugLog('❌ Audio preload failed:', url, e);
        cleanup();
        reject(e);
      };

      const cleanup = () => {
        audio.removeEventListener('canplaythrough', handleCanPlayThrough);
        audio.removeEventListener('error', handleError);
      };

      audio.addEventListener('canplaythrough', handleCanPlayThrough, { once: true });
      audio.addEventListener('error', handleError, { once: true });

      audio.src = url;
      audio.load();
    });
  })();

  inflightPreloads.set(url, task);
  task.finally(() => inflightPreloads.delete(url));
  return task;
};

// Standalone preload functions for eager loading (before hook initialization)
// These are stateless and can be called directly from App.tsx
export const eagerPreloadImage = (url: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    debugLog('[EAGER] ⏳ Preloading image:', url);
    const img = new Image();
    img.onload = () => {
      debugLog('[EAGER] ✅ Image preloaded:', url);
      resolve();
    };
    img.onerror = (e) => {
      debugLog('[EAGER] ❌ Image preload failed:', url, e);
      reject(e);
    };
    img.src = url;
  });
};

export const eagerPreloadAudio = (url: string): Promise<void> => preloadAudioUrl(url);

interface UseAudioPreloaderOptions {
  audioPlaylist: AudioStop[];
  currentStopId: string | null;
  isPlaying?: boolean;
  preloadCount?: number;
}

interface PreloadedAudio {
  url: string;
  audio: HTMLAudioElement;
  loaded: boolean;
}

export const useAudioPreloader = ({
  audioPlaylist,
  currentStopId,
  isPlaying = false,
  preloadCount = 1,
}: UseAudioPreloaderOptions) => {
  const preloadedRef = useRef<Map<string, PreloadedAudio>>(new Map());
  const preloadedImagesRef = useRef<Set<string>>(new Set());
  const cleanupTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isPreloadingRef = useRef(false); // Prevent concurrent preload operations
  const abortControllerRef = useRef<AbortController | null>(null);

  const preloadImage = useCallback((url: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (preloadedImagesRef.current.has(url)) {
        debugLog('✅ Image already preloaded:', url);
        resolve();
        return;
      }

      debugLog('⏳ Preloading image:', url);
      const img = new Image();
      img.onload = () => {
        preloadedImagesRef.current.add(url);
        debugLog('✅ Image preloaded:', url);
        resolve();
      };
      img.onerror = (e) => {
        debugLog('❌ Image preload failed:', url, e);
        reject(e);
      };
      img.src = url;
    });
  }, []);

  const preloadAudio = useCallback((url: string): Promise<HTMLAudioElement> => {
    return new Promise((resolve, reject) => {
      const existing = preloadedRef.current.get(url);
      if (existing?.loaded) {
        debugLog('✅ Already preloaded:', url);
        resolve(existing.audio);
        return;
      }

      const startMediaLoad = () => {
        debugLog('⏳ Preloading:', url);
        const audio = new Audio();
        audio.preload = 'auto';

        const entry: PreloadedAudio = { url, audio, loaded: false };
        preloadedRef.current.set(url, entry);

        const handleCanPlayThrough = () => {
          entry.loaded = true;
          debugLog('✅ Preloaded:', url);
          cleanup();
          resolve(audio);
        };

        const handleError = (e: Event) => {
          debugLog('❌ Preload failed:', url, e);
          preloadedRef.current.delete(url);
          cleanup();
          reject(e);
        };

        const cleanup = () => {
          audio.removeEventListener('canplaythrough', handleCanPlayThrough);
          audio.removeEventListener('error', handleError);
        };

        audio.addEventListener('canplaythrough', handleCanPlayThrough, { once: true });
        audio.addEventListener('error', handleError, { once: true });

        audio.src = url;
        audio.load();
      };

      // Registry coordination: never open a second request for an address the
      // download manager already owns.
      const status = getResourceStatus(url);
      if (status.state === 'cached') {
        // The service worker/Cache layer serves this instantly; the media
        // element still needs creating, but no network fetch is made.
        debugLog('♻️ Reusing cached asset for preload:', url);
        startMediaLoad();
      } else if (status.state === 'downloading') {
        debugLog('⏳ Preload joins in-flight download:', url);
        ensureDownload(url)
          .then(() => startMediaLoad())
          .catch((err) => {
            // Cancelled or failed: fall back to a direct online load instead
            // of swallowing the stop.
            debugLog('⚠️ Download unavailable, preloading online:', url, err);
            startMediaLoad();
          });
      } else {
        // idle / failed → normal streaming preload (or online retry).
        startMediaLoad();
      }
    });
  }, []);

  const getPreloadedAudio = useCallback((url: string): HTMLAudioElement | null => {
    const entry = preloadedRef.current.get(url);
    return entry?.loaded ? entry.audio : null;
  }, []);

  const cleanupOldPreloads = useCallback((keepUrls: Set<string>) => {
    for (const [url, entry] of preloadedRef.current.entries()) {
      if (!keepUrls.has(url)) {
        debugLog('🗑️ Cleaning up old preload:', url);
        entry.audio.src = '';
        preloadedRef.current.delete(url);
      }
    }
  }, []);

  // Preload first image + audio, then remaining images sequentially (before user starts tour)
  useEffect(() => {
    checkPerformance('Initial Preload Effect');

    if (audioPlaylist.length === 0) return;
    if (currentStopId !== null) return; // Only run when no track is active yet
    if (isPreloadingRef.current) {
      debugLog('⚠️ Preload already in progress, skipping');
      return;
    }

    debugLog('🚀 Initial preload - first image + audio with priority, then rest');

    const firstStop = audioPlaylist[0];
    if (!firstStop) return;

    // Create abort controller for cleanup
    abortControllerRef.current = new AbortController();
    isPreloadingRef.current = true;

    // PRIORITY 1: Preload first image and wait for completion
    const preloadFirstAssets = async () => {
      try {
        if (firstStop.image) {
          debugLog('🎯 HIGH PRIORITY: Preloading first image');
          try {
            await preloadImage(firstStop.image);
            debugLog('✅ First image ready');
          } catch (e) {
            debugLog('❌ First image failed, continuing anyway');
          }
        }

        // Check if aborted
        if (abortControllerRef.current?.signal.aborted) {
          debugLog('🛑 Preload aborted');
          return;
        }

        // PRIORITY 2: Preload first audio
        if (firstStop.audioFile) {
          debugLog('🎵 Preloading first audio');
          preloadAudio(firstStop.audioFile).catch(() => {});
        }

        // PRIORITY 3: Preload remaining images sequentially (max 5 at once to limit memory)
        const MAX_BACKGROUND_IMAGES = Math.min(5, audioPlaylist.length - 1);
        debugLog(`📸 Starting background preload of next ${MAX_BACKGROUND_IMAGES} images`);

        for (let i = 1; i <= MAX_BACKGROUND_IMAGES; i++) {
          // Check if aborted before each iteration
          if (abortControllerRef.current?.signal.aborted) {
            debugLog('🛑 Background preload aborted');
            break;
          }

          const stop = audioPlaylist[i];
          if (stop?.image) {
            // Small delay between each image to prevent memory pressure
            await new Promise(resolve => setTimeout(resolve, 500));
            debugLog(`📸 Background preloading image ${i + 1}/${audioPlaylist.length}`);
            preloadImage(stop.image).catch(() => {});
          }
        }
      } finally {
        isPreloadingRef.current = false;
        debugLog('✅ Initial preload complete');
      }
    };

    preloadFirstAssets();

    // Cleanup: abort ongoing preload if effect re-runs
    return () => {
      if (abortControllerRef.current) {
        debugLog('🧹 Cleaning up preload operation');
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      isPreloadingRef.current = false;
    };
  }, [audioPlaylist, currentStopId, preloadAudio, preloadImage]);

  // Preload next tracks when playing - with delay to ensure current audio is stable
  useEffect(() => {
    checkPerformance('Next Track Preload Effect');

    // Only preload next tracks when audio is actually playing
    if (!isPlaying || !currentStopId || audioPlaylist.length === 0) return;

    const currentIndex = audioPlaylist.findIndex(s => s.id === currentStopId);
    if (currentIndex === -1) return;

    // Delay preload by 3 seconds to ensure current audio is playing smoothly
    // This prevents premature preloading that can cause stalling
    const preloadDelay = setTimeout(() => {
      debugLog('⏰ Starting delayed preload of next track');

      const urlsToKeep = new Set<string>();
      const preloadPromises: Promise<unknown>[] = [];

      for (let i = 1; i <= preloadCount; i++) {
        const nextIndex = currentIndex + i;
        if (nextIndex < audioPlaylist.length) {
          const nextStop = audioPlaylist[nextIndex];
          if (nextStop.audioFile) {
            urlsToKeep.add(nextStop.audioFile);
            preloadPromises.push(
              preloadAudio(nextStop.audioFile).catch(() => null)
            );
          }
          // Images are already preloaded in initial effect
        }
      }

      const currentStop = audioPlaylist[currentIndex];
      if (currentStop?.audioFile) {
        urlsToKeep.add(currentStop.audioFile);
      }

      if (cleanupTimeoutRef.current) {
        clearTimeout(cleanupTimeoutRef.current);
      }
      cleanupTimeoutRef.current = setTimeout(() => {
        cleanupOldPreloads(urlsToKeep);
      }, 5000);
    }, 3000); // 3 second delay

    return () => {
      clearTimeout(preloadDelay);
      if (cleanupTimeoutRef.current) {
        clearTimeout(cleanupTimeoutRef.current);
      }
    };
  }, [audioPlaylist, currentStopId, isPlaying, preloadCount, preloadAudio, preloadImage, cleanupOldPreloads]);

  useEffect(() => {
    return () => {
      for (const entry of preloadedRef.current.values()) {
        entry.audio.src = '';
      }
      preloadedRef.current.clear();
    };
  }, []);

  return {
    getPreloadedAudio,
    preloadAudio,
    preloadImage,
  };
};
