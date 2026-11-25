import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Equalizer } from 'adapters/equalizer';
import HlsAdapter from 'adapters/hls';
import { AudioX } from 'audio';
import type { MediaTrack } from 'types';

import { FakeHls } from './setup/fakeHls';
import {
  MockAudioContext,
  MockAudioElement,
  installWebAudioMocks,
  resetWebAudioMocks,
} from './setup/webAudioMock';

// Avoid any real CDN/script loading: hand the adapter our in-memory FakeHls.
// The factory is self-contained (reaches FakeHls through globalThis) because
// hoisted vi.mock factories cannot safely reference top-level import bindings.
vi.mock('helpers/common', async (importOriginal) => {
  const actual = await importOriginal<typeof import('helpers/common')>();
  return {
    ...actual,
    loadScript: vi.fn(async () => {
      window.Hls = globalThis.__AUDIOX_FAKE_HLS__ as unknown as typeof window.Hls;
    }),
  };
});

const makeTrack = (id: string, source: string): MediaTrack => ({
  id,
  title: `track-${id}`,
  source,
  artwork: null,
});

const MP3_TRACK_A = makeTrack('a', 'https://example.com/a.mp3');
const MP3_TRACK_B = makeTrack('b', 'https://example.com/b.mp3');
const HLS_TRACK = makeTrack('hls', 'https://example.com/stream.m3u8');

const createPlayer = async (init: Record<string, unknown> = {}) => {
  const player = new AudioX();
  await player.init({
    mode: 'VANILLA',
    useDefaultEventListeners: false,
    customEventListeners: null,
    enableEQ: true,
    ...init,
  });
  return player;
};

// createMediaElementSource wiring is asserted through these private internals.
const getEqStatus = (player: AudioX) => (player as unknown as { eqStatus: string }).eqStatus;
const getEqInstance = (player: AudioX) =>
  (player as unknown as { eqInstance: Equalizer | undefined }).eqInstance;

// jsdom never fires real decoding progress, so mark the element ready to play
// after a source has been loaded.
const markReady = () => {
  const audio = AudioX.getAudioInstance() as unknown as MockAudioElement | undefined;
  if (audio) {
    audio.readyState = MockAudioElement.HAVE_ENOUGH_DATA;
  }
};

const addAndPlay = async (player: AudioX, track: MediaTrack) => {
  await player.addMedia(track);
  markReady();
  await player.play();
};

// The classes are process-wide singletons; destroy whatever a previous test
// left behind so every test starts from a clean IDEAL state.
const resetSingletons = async () => {
  if (AudioX.getAudioInstance()) {
    await new AudioX().destroy();
  }
};

describe('equalizer lifecycle', () => {
  beforeEach(async () => {
    await resetSingletons();
    vi.restoreAllMocks();
    // Singleton guards legitimately warn on repeated `new ...()`; keep output clean.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    resetWebAudioMocks();
    installWebAudioMocks();
    FakeHls.reset();
  });

  it('wires the equalizer graph exactly once across repeated play, track changes and pause/resume', async () => {
    const player = await createPlayer();

    await addAndPlay(player, MP3_TRACK_A);

    // First successful wiring.
    expect(MockAudioContext.createdContexts).toHaveLength(1);
    const firstContext = MockAudioContext.createdContexts[0];
    expect(firstContext.createMediaElementSource).toHaveBeenCalledTimes(1);
    expect(getEqStatus(player)).toBe('ACTIVE');
    expect(getEqInstance(player)).toBeInstanceOf(Equalizer);

    // Repeated play() while already running / paused-resumed cycles.
    await player.play();
    player.pause();
    await player.play();
    player.pause();
    await player.play();

    // Switching to another regular track keeps the same graph.
    await player.addMedia(MP3_TRACK_B);
    await player.play();
    await player.play();

    expect(MockAudioContext.createdContexts).toHaveLength(1);
    expect(firstContext.createMediaElementSource).toHaveBeenCalledTimes(1);
    // Browser-wide: the element entered a graph exactly once for its whole life.
    expect(MockAudioContext.totalMediaElementSourceCalls).toBe(1);
    expect(MockAudioContext.globallyRoutedElements.size).toBe(1);
    // Ten EQ bands, bass boost and compressor are created a single time each.
    expect(firstContext.countNode('biquadFilter')).toBe(11);
    expect(firstContext.countNode('compressor')).toBe(1);
    expect(firstContext.connectedNodes).toContainEqual({
      from: 'mediaElementSource#0',
      to: 'biquadFilter#0',
    });
    expect(firstContext.connectedNodes).toContainEqual({
      from: 'compressor#0',
      to: 'destination#0',
    });
  });

  it('keeps setPreset / setCustomEQ / setBassBoost usable after repeated plays and track changes', async () => {
    const player = await createPlayer();
    await addAndPlay(player, MP3_TRACK_A);
    await player.play();
    await player.addMedia(MP3_TRACK_B);
    player.pause();
    await player.play();

    const context = MockAudioContext.createdContexts[0];
    const eq = getEqInstance(player);
    expect(eq).toBeDefined();

    expect(() => {
      player.setPreset('rock' as never);
      player.setCustomEQ(new Array(10).fill(2));
      player.setBassBoost(true, 8);
      player.setBassBoost(false);
    }).not.toThrow();

    // Every gain parameter was scheduled on the existing, single context.
    const paramWrites = context.createdNodes.biquadFilter.reduce(
      (total, node) =>
        total +
        (node as unknown as { gain: { setTargetAtTime: ReturnType<typeof vi.fn> } }).gain
          .setTargetAtTime.mock.calls.length,
      0,
    );
    expect(paramWrites).toBeGreaterThan(0);
    expect(MockAudioContext.createdContexts).toHaveLength(1);
  });

  it('only logs errors and never throws when EQ controls are used while enableEQ is off', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const player = await createPlayer({ enableEQ: false });
    await player.addMedia(MP3_TRACK_A);
    markReady();
    await player.play();

    expect(getEqInstance(player)).toBeUndefined();
    expect(MockAudioContext.createdContexts).toHaveLength(0);

    expect(() => player.setPreset('rock' as never)).not.toThrow();
    expect(() => player.setCustomEQ(new Array(10).fill(1))).not.toThrow();
    expect(() => player.setBassBoost(true)).not.toThrow();

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('does not throw when EQ controls are enabled but play() (and therefore wiring) has not run', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const player = await createPlayer();
    await player.addMedia(MP3_TRACK_A);

    expect(getEqInstance(player)).toBeUndefined();
    expect(() => player.setPreset('rock' as never)).not.toThrow();
    expect(() => player.setCustomEQ(new Array(10).fill(1))).not.toThrow();
    expect(() => player.setBassBoost(true)).not.toThrow();

    // After play the graph comes up and the controls become effective.
    markReady();
    await player.play();
    expect(getEqStatus(player)).toBe('ACTIVE');
    expect(() => player.setBassBoost(true, 5)).not.toThrow();
    errorSpy.mockRestore();
  });
});

describe('HLS and regular source switching on the shared audio element', () => {
  beforeEach(async () => {
    await resetSingletons();
    vi.restoreAllMocks();
    // Singleton guards legitimately warn on repeated `new ...()`; keep output clean.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    resetWebAudioMocks();
    installWebAudioMocks();
    FakeHls.reset();
  });

  it('attaches hls.js for m3u8, detaches it when returning to a regular source, and keeps the EQ alive', async () => {
    const player = await createPlayer({ enableHls: true });
    await addAndPlay(player, MP3_TRACK_A);

    const contextBeforeSwitch = MockAudioContext.createdContexts[0];
    expect(contextBeforeSwitch.createMediaElementSource).toHaveBeenCalledTimes(1);

    // Regular -> HLS.
    await player.addMedia(HLS_TRACK);
    let hlsAdapter = new HlsAdapter();
    expect(hlsAdapter.isMediaAttached()).toBe(true);
    const hls = FakeHls.instances[0];
    expect(hls.lastUrl).toBe(HLS_TRACK.source);
    expect(hls.count('attachMedia')).toBe(1);

    // HLS -> HLS again: detach first, then re-attach, still a single hls client.
    const secondHlsTrack = makeTrack('hls-2', 'https://example.com/other.m3u8');
    await player.addMedia(secondHlsTrack);
    expect(FakeHls.instances).toHaveLength(1);
    expect(hls.count('detachMedia')).toBe(1);
    expect(hls.count('attachMedia')).toBe(2);
    expect(hls.lastUrl).toBe(secondHlsTrack.source);

    // HLS -> regular: hls.js must be unbound from the element.
    await player.addMedia(MP3_TRACK_B);
    hlsAdapter = new HlsAdapter();
    expect(hlsAdapter.isMediaAttached()).toBe(false);
    expect(hls.count('detachMedia')).toBe(2);
    expect(hls.media).toBeNull();

    const audio = AudioX.getAudioInstance() as unknown as MockAudioElement;
    expect(audio.src).toBe(MP3_TRACK_B.source);

    // The equalizer graph survived every source switch untouched.
    expect(MockAudioContext.createdContexts).toHaveLength(1);
    expect(contextBeforeSwitch.createMediaElementSource).toHaveBeenCalledTimes(1);
    expect(getEqStatus(player)).toBe('ACTIVE');
    expect(() => player.setPreset('pop' as never)).not.toThrow();
  });

  it('warns instead of throwing when an m3u8 source is added without enabling HLS', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const player = await createPlayer({ enableHls: false });
    await player.addMedia(MP3_TRACK_A);
    markReady();
    await player.play();

    await expect(player.addMedia(HLS_TRACK)).resolves.toBeUndefined();
    expect(FakeHls.instances).toHaveLength(0);
    warnSpy.mockRestore();
  });
});

describe('destroy and re-initialization', () => {
  beforeEach(async () => {
    await resetSingletons();
    vi.restoreAllMocks();
    // Singleton guards legitimately warn on repeated `new ...()`; keep output clean.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    resetWebAudioMocks();
    installWebAudioMocks();
    FakeHls.reset();
  });

  it('closes the AudioContext, disconnects nodes and resets singletons/state, then rebuilds on re-init', async () => {
    const player = await createPlayer({ enableHls: true });
    await player.addMedia(HLS_TRACK);
    markReady();
    await player.play();

    const context = MockAudioContext.createdContexts[0];
    const hls = FakeHls.instances[0];
    expect(context.createMediaElementSource).toHaveBeenCalledTimes(1);
    expect(hls).toBeDefined();

    await player.destroy();

    // Web Audio graph fully released (the destination is an output sink and is
    // never disconnected by application code).
    expect(context.closed).toBe(true);
    expect(context.close).toHaveBeenCalledTimes(1);
    for (const [kind, nodes] of Object.entries(context.createdNodes)) {
      if (kind === 'destination') {
        continue;
      }
      for (const node of nodes) {
        expect(node.disconnect).toHaveBeenCalled();
      }
    }
    expect(context.destination.disconnect).not.toBeCalled();

    // HLS client destroyed and detached.
    expect(hls.destroyed).toBe(true);
    expect(hls.media).toBeNull();

    // Singletons and EQ state reset.
    expect(getEqInstance(player)).toBeUndefined();
    expect(getEqStatus(player)).toBe('IDEAL');
    expect(AudioX.getAudioInstance()).toBeUndefined();
    expect(new HlsAdapter().getHlsInstance()).toBeUndefined();

    // Re-init + play builds a brand new graph against a brand new element.
    const rebuilt = await createPlayer({ enableHls: true });
    await rebuilt.addMedia(MP3_TRACK_A);
    markReady();
    await rebuilt.play();

    expect(MockAudioContext.createdContexts).toHaveLength(2);
    const rebuiltContext = MockAudioContext.createdContexts[1];
    expect(rebuiltContext).not.toBe(context);
    expect(rebuiltContext.createMediaElementSource).toHaveBeenCalledTimes(1);
    // Two distinct elements were each routed exactly once (one graph per
    // element lifetime), and the old element was never re-routed.
    expect(MockAudioContext.totalMediaElementSourceCalls).toBe(2);
    expect(MockAudioContext.globallyRoutedElements.size).toBe(2);
    expect(getEqStatus(rebuilt)).toBe('ACTIVE');
    expect(getEqInstance(rebuilt)).toBeInstanceOf(Equalizer);

    await rebuilt.destroy();
    expect(MockAudioContext.createdContexts[1].closed).toBe(true);
  });

  it('is safe to call destroy without ever starting playback', async () => {
    const player = await createPlayer({ enableHls: true });
    await expect(player.destroy()).resolves.toBeUndefined();
    expect(AudioX.getAudioInstance()).toBeUndefined();
    expect(MockAudioContext.createdContexts).toHaveLength(0);
  });
});
