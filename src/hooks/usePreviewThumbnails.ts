import { useEffect, useRef, useState } from 'react';
import {
  parseThumbnailsVtt,
  PreviewThumbnail,
} from '../utils/parseThumbnailsVtt';

interface Loaded {
  source: string;
  thumbnails: PreviewThumbnail[];
}

/**
 * Returns the thumbnails as is when given a parsed array, otherwise loads and
 * parses them from a VTT URL.
 *
 * Request lifecycle: every source change or unmount aborts the in-flight
 * request and invalidates its resolution, so a slow response from a previous
 * source can never overwrite the state of the current one. Sources that have
 * already loaded are cached for the component instance, which makes switching
 * back to them synchronous and avoids duplicate requests.
 */
export function usePreviewThumbnails(
  source: string | PreviewThumbnail[] | undefined
): PreviewThumbnail[] | undefined {
  const [loaded, setLoaded] = useState<Loaded>();
  const cacheRef = useRef<Map<string, PreviewThumbnail[]> | null>(null);

  if (cacheRef.current === null) {
    cacheRef.current = new Map();
  }

  const cache = cacheRef.current;

  useEffect(() => {
    // Parsed arrays and undefined are returned directly without a request.
    // A cached source needs neither fetch nor cancellation.
    if (typeof source !== 'string' || cache.has(source)) {
      return;
    }

    let active = true;
    const controller = new AbortController();
    const vttUrl = new URL(source, document.baseURI).href;

    fetch(vttUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return response.text();
      })
      .then((text) => {
        // Source changed or component unmounted while the response was coming
        // in: neither cache nor state may be touched by this resolution.
        if (!active) {
          return;
        }

        const thumbnails = parseThumbnailsVtt(text, vttUrl);
        cache.set(source, thumbnails);
        setLoaded({ source, thumbnails });
      })
      .catch((error: Error) => {
        if (error.name !== 'AbortError') {
          console.warn(
            `react-video-seek-slider: failed to load preview thumbnails from ${source}`,
            error
          );
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [source, cache]);

  if (typeof source !== 'string') {
    return source;
  }

  if (loaded?.source === source) {
    return loaded.thumbnails;
  }

  // Hit when switching back to a source loaded earlier in this instance.
  return cache.get(source);
}
