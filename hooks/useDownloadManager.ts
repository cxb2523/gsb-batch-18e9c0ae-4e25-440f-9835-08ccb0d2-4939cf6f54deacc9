import { useState, useEffect, useCallback, useRef } from 'react';
import { TourData } from '../types';
import { storageService } from '../src/services/storageService';
import { extractTourAssetUrls } from '../src/services/tourAssets';
import {
  ensureDownload,
  cancelDownload as cancelResourceDownload,
  getResourceStatus,
  hydrateResourceRegistry,
  subscribe,
  type ResourceStatus,
} from '../src/services/resourceRegistry';

interface DownloadProgress {
  downloaded: number;
  total: number;
  percentage: number;
}

interface UseDownloadManagerReturn {
  isDownloading: boolean;
  isDownloaded: boolean;
  downloadProgress: DownloadProgress;
  startDownload: () => Promise<void>;
  /** Abort every in-flight asset of this tour and release partial data. */
  cancelDownload: () => Promise<void>;
  /** Re-attempt only the URLs that previously failed. */
  retryFailed: () => Promise<void>;
  error: string | null;
  failedUrls: string[];
  /** Imperative per-URL state query: 'idle' | 'downloading' | 'cached' | 'failed'. */
  getResourceStatus: (url: string) => ResourceStatus;
}

interface UseDownloadManagerOptions {
  onDownloadComplete?: () => void;
}

const CONCURRENT_DOWNLOADS = 4;

/**
 * Hook to manage offline tour downloads.
 *
 * All per-URL state lives in the shared ResourceRegistry, so the download
 * manager, the audio preloader and the mini player observe the exact same
 * lifecycle for any audio address: one cache entry per URL, visible
 * progress/failure/cancellation, and no duplicate fetches.
 */
export const useDownloadManager = (
  tour: TourData | null,
  options?: UseDownloadManagerOptions
): UseDownloadManagerReturn => {
  const { onDownloadComplete } = options || {};
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>({
    downloaded: 0,
    total: 0,
    percentage: 0,
  });
  const [error, setError] = useState<string | null>(null);

  const cancelledRef = useRef(false);
  const runningRef = useRef(false);
  const onDownloadCompleteRef = useRef(onDownloadComplete);
  useEffect(() => {
    onDownloadCompleteRef.current = onDownloadComplete;
  }, [onDownloadComplete]);

  /** Every file the tour needs offline (see src/services/tourAssets.ts). */
  const extractAssetUrls = useCallback(
    (tourData: TourData): string[] => extractTourAssetUrls(tourData),
    []
  );

  /**
   * Recompute the aggregate view (progress, failed URLs, completion) from the
   * registry's per-URL states. The registry is the source of truth, so this
   * works for downloads started in a previous component instance too.
   */
  const recompute = useCallback((tourData: TourData) => {
    const assetUrls = extractAssetUrls(tourData);
    if (assetUrls.length === 0) {
      setDownloadProgress({ downloaded: 0, total: 0, percentage: 0 });
      setIsDownloaded(false);
      setFailedUrls([]);
      return;
    }

    let cachedCount = 0;
    let inFlightFraction = 0;
    const failed: string[] = [];
    let anyDownloading = false;

    for (const url of assetUrls) {
      const status = getResourceStatus(url);
      if (status.state === 'cached') {
        cachedCount++;
      } else if (status.state === 'failed') {
        failed.push(url);
      } else if (status.state === 'downloading') {
        anyDownloading = true;
        inFlightFraction += (status.progress ?? 0) / 100;
      }
    }

    const doneEquivalent = cachedCount + inFlightFraction;
    setDownloadProgress({
      downloaded: cachedCount,
      total: assetUrls.length,
      percentage: Math.round((doneEquivalent / assetUrls.length) * 100),
    });
    setFailedUrls(failed);
    setIsDownloading(anyDownloading);
    setIsDownloaded(cachedCount === assetUrls.length);
  }, [extractAssetUrls]);

  // Hydrate the registry from Cache Storage, then reconcile this tour's view
  // and keep it updated on every registry change.
  useEffect(() => {
    if (!tour) return;
    let disposed = false;

    hydrateResourceRegistry().then(() => {
      if (!disposed) recompute(tour);
    });

    const unsubscribe = subscribe(() => {
      if (!disposed) recompute(tour);
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [tour, recompute]);

  const runDownload = useCallback(async (urls: string[]) => {
    if (!tour || runningRef.current) return;

    if (!('caches' in window)) {
      const errorMsg = 'Cache API not available. Offline downloads require HTTPS or localhost.';
      console.error('❌', errorMsg);
      setError(errorMsg);
      return;
    }

    runningRef.current = true;
    cancelledRef.current = false;
    setIsDownloading(true);
    setError(null);
    recompute(tour);

    try {
      // Skip URLs already cached — that is the "same address keeps one copy"
      // guarantee; retrying after a partial failure only re-fetches the rest.
      const pending = urls.filter((url) => getResourceStatus(url).state !== 'cached');

      for (let i = 0; i < pending.length; i += CONCURRENT_DOWNLOADS) {
        if (cancelledRef.current) break;
        const batch = pending.slice(i, i + CONCURRENT_DOWNLOADS);

        await Promise.all(
          batch.map(async (url) => {
            try {
              await ensureDownload(url);
            } catch (err) {
              // Cancellation and genuine failure both land in the registry's
              // state (idle / failed); recompute() reads it. Nothing to do here
              // except let the batch settle.
              if (!cancelledRef.current) {
                console.warn('❌ Asset download failed:', url, err);
              }
            }
          })
        );
      }

      if (cancelledRef.current) {
        // User cancelled: registry has already removed every partial entry.
        return;
      }

      // Persist the set that really made it to the cache, plus its size, so
      // storage cleanup (removeTourDownload) knows what to delete later.
      const assetUrls = extractAssetUrls(tour);
      const cachedUrls = assetUrls.filter((url) => getResourceStatus(url).state === 'cached');
      const cache = await caches.open('tour-assets');
      const sizes = await Promise.all(
        cachedUrls.map(async (url) => {
          const cached = await cache.match(url);
          return cached ? (await cached.blob()).size : 0;
        })
      );
      const totalSize = sizes.reduce((a, b) => a + b, 0);
      await storageService.markTourDownloaded(tour.id, cachedUrls, totalSize, tour.language);

      const failed = assetUrls.filter((url) => getResourceStatus(url).state === 'failed');
      if (failed.length > 0) {
        setError(`Download failed for ${failed.length} of ${assetUrls.length} files. Retry to try again.`);
      } else if (onDownloadCompleteRef.current) {
        onDownloadCompleteRef.current();
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(`Download failed: ${errorMessage}`);
      console.error('Download error:', err);
    } finally {
      runningRef.current = false;
      recompute(tour);
    }
  }, [tour, recompute, extractAssetUrls]);

  const startDownload = useCallback(async () => {
    if (!tour) return;
    // Already fully cached, or a run is in flight (possibly from a remounted
    // hook instance) — never start a second competing download.
    const assetUrls = extractAssetUrls(tour);
    if (runningRef.current || assetUrls.every((url) => getResourceStatus(url).state === 'cached')) {
      return;
    }
    await runDownload(assetUrls);
  }, [tour, extractAssetUrls, runDownload]);

  const cancelDownload = useCallback(async () => {
    if (!tour) return;
    cancelledRef.current = true;

    // Abort every asset of this tour that is still in flight. The registry
    // deletes the partial cache entries as each abort settles.
    const assetUrls = extractAssetUrls(tour);
    await Promise.all(assetUrls.map((url) => cancelResourceDownload(url)));

    setError(null);
    recompute(tour);
  }, [tour, extractAssetUrls, recompute]);

  const retryFailed = useCallback(async () => {
    if (!tour || runningRef.current) return;
    // Retry everything that is not safely cached: explicit `failed` URLs plus
    // any `idle` URLs a previous interrupted run never reached. `runDownload`
    // itself filters out cached URLs, so this converges on a full download.
    const pending = extractAssetUrls(tour).filter(
      (url) => getResourceStatus(url).state !== 'cached'
    );
    if (pending.length === 0) return;
    setError(null);
    await runDownload(pending);
  }, [tour, extractAssetUrls, runDownload]);

  return {
    isDownloading,
    isDownloaded,
    downloadProgress,
    startDownload,
    cancelDownload,
    retryFailed,
    error,
    failedUrls,
    getResourceStatus,
  };
};
