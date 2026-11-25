declare global {
  interface Window {
    Hls: any;
  }
}

import { AudioX } from 'audio';
import { URLS } from 'constants/common';
import { HLS_EVENTS_CALLBACK_MAP } from 'events/hlsEvents';
import { attachHlsEventsListeners } from 'events/listeners';
import { loadScript } from 'helpers/common';
import type { MediaTrack } from 'types';
import type Hls from 'types/hls.js.js';
import type { HlsConfig } from 'types/hls.js.js';

let hlsInstance: Hls | undefined;

class HlsAdapter {
  private static _instance: HlsAdapter | undefined;
  private HlsClass: typeof Hls | undefined;
  private attachedMedia: HTMLMediaElement | null = null;

  constructor() {
    if (HlsAdapter._instance) {
      console.warn(
        'Instantiation failed: cannot create multiple instance of HLS returning existing instance',
      );
      // biome-ignore lint/correctness/noConstructorReturn: singleton must return the existing instance
      return HlsAdapter._instance;
    }
    HlsAdapter._instance = this;
  }

  async load() {
    await loadScript(
      URLS.HLS,
      () => {
        console.log('HLS Loaded');
      },
      'hls',
    )
      .then(() => {
        this.HlsClass = window.Hls;
        window.Hls = undefined;
      })
      .catch((msg: string) => {
        console.log(msg);
      });

    return this.HlsClass;
  }

  async init(enablePlayLog: boolean, config: HlsConfig | Record<string, unknown> = {}) {
    const Hls = await this.load();
    if (!Hls) {
      console.warn('HLS library could not be loaded, HLS playback will be unavailable.');
      return;
    }
    if (Hls.isSupported()) {
      hlsInstance = new Hls(config);
      attachHlsEventsListeners(HLS_EVENTS_CALLBACK_MAP, enablePlayLog);
    }
  }

  /**
   * Loads an HLS stream and binds hls.js to the shared audio element.
   * Any previous binding is removed first, so hls.js never stays attached to
   * an element that has switched back to a regular `src`.
   */
  addHlsMedia(mediaTrack: MediaTrack) {
    const Hls = this.HlsClass;
    const audioInstance = AudioX.getAudioInstance();
    if (!Hls || !hlsInstance || !audioInstance) {
      console.warn('HLS playback is not ready, unable to add the HLS media.');
      return;
    }

    this.detachFromMedia();
    hlsInstance.loadSource(mediaTrack.source);
    hlsInstance.attachMedia(audioInstance);
    this.attachedMedia = audioInstance;
    hlsInstance.on(Hls.Events.MEDIA_ATTACHED, () => {
      console.log('hls media attached');
    });
  }

  /**
   * Unbinds hls.js from the audio element. Called when switching back to a
   * regular source so the element only keeps the current source's wiring.
   */
  detachFromMedia() {
    if (hlsInstance && this.attachedMedia) {
      hlsInstance.detachMedia();
      this.attachedMedia = null;
    }
  }

  isMediaAttached() {
    return this.attachedMedia !== null;
  }

  getHlsInstance() {
    return hlsInstance;
  }

  /**
   * Stops the hls.js instance and clears every module/singleton reference so
   * that a fresh `init()` creates a new HLS client.
   */
  destroy() {
    this.detachFromMedia();
    hlsInstance?.destroy();
    hlsInstance = undefined;
    this.HlsClass = undefined;
    HlsAdapter._instance = undefined;
  }
}

export default HlsAdapter;
