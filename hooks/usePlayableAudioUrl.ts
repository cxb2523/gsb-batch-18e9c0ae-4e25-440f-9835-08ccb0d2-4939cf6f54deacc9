import { useEffect, useRef, useState } from 'react';
import {
  getResourceStatus,
  subscribe,
  waitForCompletion,
  type ResourceStatus,
} from '../src/services/resourceRegistry';

export interface PlayableAudio {
  /**
   * The URL the singleton audio element should load. Equals the requested URL
   * once the asset is cached, while streaming online, or after an online
   * fallback. Null while an offline-only stop is genuinely unavailable.
   */
  audioUrl: string | null;
  /** True while a download must finish before playback can start. */
  isWaitingForDownload: boolean;
  /** True when the asset failed/cancelled and the device is offline. */
  isUnavailable: boolean;
  /** Live registry status for the requested URL. */
  status: ResourceStatus;
}

const IDLE: ResourceStatus = { state: 'idle' };

function resolve(url: string, status: ResourceStatus, online: boolean): PlayableAudio {
  const waiting = status.state === 'downloading';
  const unavailable = !waiting && !online && status.state !== 'cached';
  return {
    // While waiting we keep the previous element untouched (audioUrl null would
    // clear it); the effect only swaps the URL once the download settles.
    audioUrl: waiting || unavailable ? null : url,
    isWaitingForDownload: waiting,
    isUnavailable: unavailable,
    status,
  };
}

/**
 * Resolve which audio URL the player should use for a stop, coordinating with
 * the shared ResourceRegistry instead of blindly loading the address:
 *
 * - cached / idle → the URL is returned immediately; the service worker serves
 *   the cached copy offline and the media element streams it online.
 * - failed (online) → the URL is still returned so the media element retries
 *   over the network; failed while offline → visible "unavailable" state.
 * - downloading → the stop stays selected but the player waits (no error, no
 *   silent skip) until the shared download completes, then swaps the URL in.
 * - cancelled while waiting → fall back to the online URL; if the device is
 *   offline and nothing was cached, `isUnavailable` flips true so the UI shows
 *   a visible message instead of a silent, dead player.
 */
export function usePlayableAudioUrl(
  requestedUrl: string | null | undefined,
  online: boolean
): PlayableAudio {
  const [state, setState] = useState<PlayableAudio>(() => ({
    audioUrl: requestedUrl ?? null,
    isWaitingForDownload: false,
    isUnavailable: false,
    status: requestedUrl ? getResourceStatus(requestedUrl) : IDLE,
  }));
  const requestSeq = useRef(0);
  const onlineRef = useRef(online);
  onlineRef.current = online;

  useEffect(() => {
    const seq = ++requestSeq.current;

    if (!requestedUrl) {
      setState({ audioUrl: null, isWaitingForDownload: false, isUnavailable: false, status: IDLE });
      return;
    }

    const apply = (status: ResourceStatus) => {
      if (seq !== requestSeq.current) return;
      setState(resolve(requestedUrl, status, onlineRef.current));
    };

    const initial = getResourceStatus(requestedUrl);
    apply(initial);

    // If a download is already running, await it. waitForCompletion resolves on
    // cached/failed and rejects on cancel; either way we then re-read state.
    let waiting: Promise<void> | null = null;
    if (initial.state === 'downloading') {
      waiting = waitForCompletion(requestedUrl)
        .then(() => apply(getResourceStatus(requestedUrl)))
        .catch(() => apply(getResourceStatus(requestedUrl)));
    }

    // Follow every later transition (download started after selection, cancel,
    // retry, failure) without re-running the whole effect.
    const unsubscribe = subscribe((changedUrl, status) => {
      if (changedUrl !== requestedUrl) return;
      apply(status);
    });

    return () => {
      unsubscribe();
      void waiting;
    };
  }, [requestedUrl]);

  // React to connectivity changes independently of registry transitions.
  useEffect(() => {
    if (!requestedUrl) return;
    setState(resolve(requestedUrl, getResourceStatus(requestedUrl), online));
  }, [requestedUrl, online]);

  return state;
}
