/**
 * Instrumented, in-memory stand-in for hls.js. It records every
 * loadSource/attachMedia/detachMedia/destroy call so tests can prove that the
 * shared audio element only keeps the currently active source's wiring.
 */

export interface HlsCall {
  type: 'loadSource' | 'attachMedia' | 'detachMedia' | 'destroy';
  url?: string;
  media?: HTMLMediaElement | null;
}

export class FakeHls {
  static readonly Events = {
    MEDIA_ATTACHED: 'hlsMediaAttached',
    MEDIA_DETACHED: 'hlsMediaDetached',
  };

  static instances: FakeHls[] = [];

  readonly calls: HlsCall[] = [];
  media: HTMLMediaElement | null = null;
  lastUrl: string | undefined;
  destroyed = false;
  private listeners: Record<string, Array<() => void>> = {};

  constructor(_config?: unknown) {
    FakeHls.instances.push(this);
  }

  static isSupported() {
    return true;
  }

  loadSource(url: string) {
    this.lastUrl = url;
    this.calls.push({ type: 'loadSource', url });
  }

  attachMedia(media: HTMLMediaElement) {
    this.media = media;
    this.calls.push({ type: 'attachMedia', media });
    // Emulate hls.js taking ownership of the element while attached.
    (media as unknown as { src: string }).src = '';
    this.emit(FakeHls.Events.MEDIA_ATTACHED);
  }

  detachMedia() {
    this.calls.push({ type: 'detachMedia', media: this.media });
    this.media = null;
    this.emit(FakeHls.Events.MEDIA_DETACHED);
  }

  destroy() {
    this.destroyed = true;
    this.calls.push({ type: 'destroy' });
    this.media = null;
    this.listeners = {};
  }

  on(event: string, listener: () => void) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(listener);
  }

  private emit(event: string) {
    for (const listener of this.listeners[event] ?? []) {
      listener();
    }
  }

  count(type: HlsCall['type']): number {
    return this.calls.filter((call) => call.type === type).length;
  }

  static reset() {
    FakeHls.instances = [];
  }
}

// Exposed on globalThis so the hoisted vi.mock('helpers/common') factory can
// reach it without an (hoisting-unsafe) static import binding.
declare global {
  // eslint-disable-next-line no-var
  var __AUDIOX_FAKE_HLS__: typeof FakeHls | undefined;
}
globalThis.__AUDIOX_FAKE_HLS__ = FakeHls;
