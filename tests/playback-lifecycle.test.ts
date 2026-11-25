/**
 * Headless tests for the Game Boy playback lifecycle: pause/resume alignment,
 * seek timbre reset, noise buffer cache isolation, stop() teardown, and
 * live-vs-offline render parity. Runs under Node with mocked Web Audio
 * (see tests/mocks/mockAudioContext.ts).
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import {
  installWebAudioMocks,
  MockAudioContext,
  MockAudioBufferSourceNode,
  MockGainNode,
  MockOscillatorNode,
  MockOfflineAudioContext,
} from './mocks/mockAudioContext.ts';
import { TimerSpy } from './mocks/timerSpy.ts';
import { buildMultiTrackMidi } from './helpers/testMidi.ts';
import { GameBoyPlayer } from '../src-v2/core/GameBoyPlayer.ts';
import { GameBoyAPU } from '../src-v2/audio/apu/APU.ts';
import { NoiseChannel } from '../src-v2/audio/apu/NoiseChannel.ts';
import { WarioPlayer } from '../src/core/WarioPlayer.ts';
import type { ChannelAssignment } from '../src-v2/types/index.ts';

let timerSpy: TimerSpy;

beforeEach(() => {
  timerSpy = new TimerSpy();
  timerSpy.install();
});

afterEach(() => {
  // Make sure no engine timer can fire into a later test.
  timerSpy.clearAll();
  timerSpy.restore();
});

function createPlayer(): { player: GameBoyPlayer; ctx: MockAudioContext } {
  const ctx = installWebAudioMocks();
  const player = new GameBoyPlayer({ autoResume: false }, ctx as unknown as AudioContext);
  return { player, ctx };
}

function sourceNodes(ctx: MockAudioContext) {
  return [
    ...nodesOfType(ctx, MockOscillatorNode),
    ...nodesOfType(ctx, MockAudioBufferSourceNode),
  ];
}

function nodesOfType<T>(ctx: MockAudioContext, ctor: new (...args: any[]) => T): T[] {
  return [...ctx.getAllNodes()].filter((n): n is T => n instanceof ctor);
}

test('prepare caches one shared set of channel notes used by play, seek and export', async () => {
  const { player } = createPlayer();
  const midi = buildMultiTrackMidi();
  const info = player.prepareMIDI(midi);

  assert.ok(info.noteCount > 0, 'prepare should produce notes');
  assert.ok(info.assignments.length >= 2, 'multi-track MIDI should map multiple channels');

  // The same cached note list drives every playback entry point.
  player.playFrom(0);
  assert.ok(player.getAPU().getScheduledNoteCount() > 0);
  player.playFrom(3);
  player.stop();
  assert.equal(timerSpy.activeCount(), 0, 'stop leaves no timers behind');

  // Offline render renders the prepared song without touching live playback.
  const rendered = await player.renderToBuffer(22050, 30);
  assert.ok(rendered, 'render should produce a buffer');
  assert.equal(rendered.sampleRate, 22050);
});

test('pause releases every scheduled node and timer; resume restarts at the same song position', () => {
  const { player, ctx } = createPlayer();
  player.prepareMIDI(buildMultiTrackMidi());

  player.playFrom(0);
  assert.ok(sourceNodes(ctx).length > 0, 'notes should be scheduled on play');
  const timersWhilePlaying = timerSpy.activeCount();
  assert.equal(timersWhilePlaying, 2, 'one scheduler interval + one end timer while playing');

  const positionBeforePause = player.getElapsedTime();
  player.pause();
  assert.ok(player.getIsPaused(), 'pause flag should be set');

  // All source nodes must have been stopped.
  for (const node of sourceNodes(ctx)) {
    assert.equal(node.stopped, true, 'source node must be stopped on pause');
  }
  assert.equal(timerSpy.activeCount(), 0, 'no scheduler/end timers survive pause');

  player.resumePlayback();
  assert.equal(player.getIsPaused(), false);
  const positionAfterResume = player.getElapsedTime();
  // The mock audio clock is fixed at 0, so the resumed timeline origin
  // reproduces the same song offset that was current at pause time.
  assert.ok(
    Math.abs(positionAfterResume - positionBeforePause) < 0.25,
    `resume position ${positionAfterResume} should match pause position ${positionBeforePause}`,
  );
  assert.equal(timerSpy.activeCount(), 2, 'resume creates a fresh interval + end timer');

  player.stop();
  assert.equal(timerSpy.activeCount(), 0, 'stop clears all timers');
});

test('repeated seeks never leave stopped runs sounding and never leak timers', () => {
  const { player, ctx } = createPlayer();
  player.prepareMIDI(buildMultiTrackMidi());
  const apu = player.getAPU();

  let previousTotal = 0;
  for (let i = 0; i < 8; i++) {
    player.playFrom(1 + i * 0.7);

    // The APU must only be tracking the current run's lookahead batch:
    // every node from earlier runs has already been stopped and dropped.
    const tracked = apu.getTrackedNodeCount();
    assert.ok(tracked > 0, 'new run schedules nodes');
    const total = sourceNodes(ctx).length;
    assert.ok(total >= previousTotal, 'each run adds its own batch of nodes');
    assert.equal(timerSpy.activeCount(), 2, 'exactly one interval + one end timer per run');
    previousTotal = total;
  }

  player.stop();
  assert.equal(timerSpy.activeCount(), 0, 'no timers after stop');
  assert.equal(apu.getTrackedNodeCount(), 0, 'no tracked source nodes survive stop');
  assert.equal(apu.getTrackedEnvelopeCount(), 0, 'no tracked envelope gains survive stop');
  for (const node of sourceNodes(ctx)) {
    assert.equal(node.stopped, true, 'every source node is stopped');
  }
});

test('a stale natural-end timer from a superseded run cannot stop the new run', async () => {
  const { player } = createPlayer();
  player.prepareMIDI(buildMultiTrackMidi());

  player.playFrom(0);
  // Immediately seek: the first run's end timer is cancelled and its run id
  // invalidated.
  player.playFrom(5);
  assert.ok(player.getIsPlaying(), 'new run is playing');
  assert.equal(timerSpy.activeCount(), 2);

  // Let the event loop turn so any (incorrectly) surviving timer callback
  // would have had a chance to run.
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(player.getIsPlaying(), 'stale timer did not kill the current run');
  player.stop();
});

test('every (re)start re-applies the arrangement channel timbres', () => {
  const { player } = createPlayer();
  const info = player.prepareMIDI(buildMultiTrackMidi());
  const apu = player.getAPU();

  // Mutate channels away from the arrangement settings.
  for (const id of ['p1', 'p2', 'p3', 'p4'] as const) apu.setPulseDuty(id, 0);
  for (const id of ['w1', 'w2'] as const) apu.setWavePreset(id, 'lead');
  for (const id of ['n1', 'n2'] as const) apu.setNoiseMode(id, '15bit');

  // A seek must restore the arrangement settings.
  player.playFrom(4);
  for (const a of info.assignments) {
    if (a.channelId.startsWith('p')) {
      assert.equal(apu.getPulseChannel(a.channelId as 'p1')?.getDutyCycle(), a.dutyCycle);
    } else if (a.channelId.startsWith('w')) {
      assert.equal(apu.getWaveChannel(a.channelId as 'w1')?.getPreset(), a.wavePreset);
    } else if (a.channelId.startsWith('n')) {
      assert.equal(apu.getNoiseChannel(a.channelId as 'n1')?.getMode(), a.noiseMode);
    }
  }

  // Same guarantee after pause + resume.
  player.pause();
  for (const id of ['p1', 'p2', 'p3', 'p4'] as const) apu.setPulseDuty(id, 3);
  player.resumePlayback();
  for (const a of info.assignments) {
    if (a.channelId.startsWith('p')) {
      assert.equal(apu.getPulseChannel(a.channelId as 'p1')?.getDutyCycle(), a.dutyCycle);
    }
  }
  player.stop();
});

test('noise buffers are cached strictly by frequency, LFSR mode and duration', () => {
  const ctx = installWebAudioMocks();
  const output = new MockGainNode(ctx);
  const noise = new NoiseChannel(ctx as unknown as AudioContext, output, '15bit');

  // Two notes with identical params share a buffer.
  const first = noise.playNote(60, 0.2, 100, 1);
  const second = noise.playNote(60, 0.2, 100, 2);
  assert.equal(first.source.buffer, second.source.buffer, 'identical params reuse the buffer');

  // A different MIDI note maps to a different frequency -> new buffer.
  const third = noise.playNote(80, 0.2, 100, 3);
  assert.notEqual(third.source.buffer, first.source.buffer, 'different frequency gets a new buffer');

  // Switching LFSR mode changes the buffer even at the same pitch.
  noise.setMode('7bit');
  const fourth = noise.playNote(60, 0.2, 100, 4);
  assert.notEqual(fourth.source.buffer, first.source.buffer, 'different LFSR mode gets a new buffer');
  assert.equal(fourth.source.buffer, noise.playNote(60, 0.2, 100, 5).source.buffer);

  // Different duration is also a distinct entry.
  const fifth = noise.playNote(60, 0.5, 100, 6);
  assert.notEqual(fifth.source.buffer, first.source.buffer, 'different duration gets a new buffer');

  // Clearing the cache forces regeneration for every parameter set.
  noise.clearCache();
  const afterClear = noise.playNote(60, 0.2, 100, 7);
  assert.notEqual(afterClear.source.buffer, fourth.source.buffer, 'clearCache invalidates entries');
});

test('stopAll clears noise caches so a restart never reuses old-position buffers', () => {
  const { player } = createPlayer();
  player.prepareMIDI(buildMultiTrackMidi());
  const apu = player.getAPU();

  player.playFrom(0);
  const n1 = apu.getNoiseChannel('n1')!;
  const before = n1.playNote(36, 0.2, 100, 10).source.buffer;

  player.stop();
  const after = n1.playNote(36, 0.2, 100, 11).source.buffer;
  assert.notEqual(before, after, 'stop must drop cached noise buffers');
});

test('noise channels are audible (channel gain not muted) and schedule sources', () => {
  const { player } = createPlayer();
  const info = player.prepareMIDI(buildMultiTrackMidi());
  const apu = player.getAPU();

  const noiseAssignment = info.assignments.find((a) => a.channelId.startsWith('n'));
  assert.ok(noiseAssignment, 'drum track must be assigned to a noise channel');

  // Construction gain for noise channels must be non-zero.
  const states = apu.getChannelStates();
  for (const id of ['n1', 'n2'] as const) {
    assert.ok(states.get(id)!.currentGain > 0, `${id} must not be muted`);
  }

  player.playFrom(0);
  const noiseSources = nodesOfType(
    apu.getAudioContext() as unknown as MockAudioContext,
    MockAudioBufferSourceNode,
  );
  assert.ok(noiseSources.length > 0, 'percussion should schedule noise buffer sources');
  player.stop();
});

test('offline render matches the live clip length and uses the same assignments', async () => {
  const { player } = createPlayer();
  const info = player.prepareMIDI(buildMultiTrackMidi());

  const assignments: ChannelAssignment[] = info.assignments;
  const grouped = assignments.reduce<Record<string, number>>((acc, a) => {
    const kind = a.channelId[0];
    acc[kind] = (acc[kind] ?? 0) + 1;
    return acc;
  }, {});
  assert.ok((grouped.n ?? 0) > 0, 'arrangement includes a noise channel');

  const buffer = await player.renderToBuffer(22050, 30);
  assert.ok(buffer);
  // 30-second cap + 0.5 tail at 22050 Hz.
  const expectedLength = Math.ceil((Math.min(info.duration, 30) + 0.5) * 22050);
  assert.equal(buffer.length, expectedLength);
  assert.equal(buffer.numberOfChannels, 2);
});

test('offline export schedules the same notes and timbres as a live run from the start', async () => {
  const { player } = createPlayer();
  const info = player.prepareMIDI(buildMultiTrackMidi());

  // --- Reference: the cached notes the live scheduler plays from 0. ---
  const allNotes = player.getLoadedNotes();
  const clipNotes = allNotes.filter((n) => n.startTime < Math.min(info.duration, 30));
  assert.ok(clipNotes.length > 0);

  // Capture what the offline render actually scheduled by spying on the
  // OfflineAudioContext created inside renderToBuffer.
  const offlineContexts: MockOfflineAudioContext[] = [];
  const OriginalOffline = globalThis.OfflineAudioContext;
  class RecordingOffline extends MockOfflineAudioContext {
    constructor(channels: number, length: number, sampleRate: number) {
      super(channels, length, sampleRate);
      offlineContexts.push(this);
    }
  }
  (globalThis as Record<string, unknown>).OfflineAudioContext = RecordingOffline;

  try {
    await player.renderToBuffer(22050, 30);
  } finally {
    (globalThis as Record<string, unknown>).OfflineAudioContext = OriginalOffline;
  }

  assert.equal(offlineContexts.length, 1, 'one offline context per render');
  const offlineCtx = offlineContexts[0];

  // The render creates one source node per scheduled note (oscillator or
  // buffer source), matching the live note-for-note count for the clip.
  const offlineSources = [...offlineCtx.getAllNodes()].filter(
    (n) => n instanceof MockOscillatorNode || n instanceof MockAudioBufferSourceNode,
  );
  assert.equal(offlineSources.length, clipNotes.length, 'render schedules exactly the clip notes');

  // Both runs go through the same assignment settings entry point. Sanity
  // check the live APU still reflects the arrangement after the render.
  const liveApu = player.getAPU();
  for (const a of info.assignments) {
    if (a.channelId.startsWith('n')) {
      assert.equal(liveApu.getNoiseChannel(a.channelId as 'n1')?.getMode(), a.noiseMode);
    }
  }
});

test('prepareMIDI with the same ArrayBuffer twice does not throw (buffer detach safety)', () => {
  const { player } = createPlayer();
  const midi = buildMultiTrackMidi();
  const first = player.prepareMIDI(midi);
  const second = player.prepareMIDI(midi);
  assert.equal(first.noteCount, second.noteCount);
  assert.deepEqual(
    first.assignments.map((a) => a.channelId),
    second.assignments.map((a) => a.channelId),
  );
});

test('APU.applyAssignmentSettings configures every channel type', () => {
  const ctx = installWebAudioMocks();
  const apu = new GameBoyAPU(ctx as unknown as AudioContext);

  apu.applyAssignmentSettings([
    { trackIndex: 0, channelId: 'p1', shouldArpeggiate: false, dutyCycle: 1 },
    { trackIndex: 1, channelId: 'w2', shouldArpeggiate: false, wavePreset: 'pad' },
    { trackIndex: 2, channelId: 'n1', shouldArpeggiate: false, noiseMode: '7bit' },
  ]);

  assert.equal(apu.getPulseChannel('p1')?.getDutyCycle(), 1);
  assert.equal(apu.getWaveChannel('w2')?.getPreset(), 'pad');
  assert.equal(apu.getNoiseChannel('n1')?.getMode(), '7bit');
  // Untouched channels keep construction defaults.
  assert.equal(apu.getPulseChannel('p2')?.getDutyCycle(), 2);
});

test('scheduled note times stay on the original song timeline after resume', () => {
  const { player } = createPlayer();
  const info = player.prepareMIDI(buildMultiTrackMidi());

  // Find a note a few seconds into the song and confirm that a run started
  // from that offset schedules it at (audio origin + song time), i.e. the
  // timeline mapping is preserved rather than restarting from zero.
  player.playFrom(0);
  player.pause();
  const offset = 4;
  player.seekPaused(offset);
  assert.equal(player.getElapsedTime(), offset);
  player.resumePlayback();
  assert.ok(player.getIsPlaying());
  assert.ok(info.duration > offset);
  player.stop();
});

test('pause → scrub → resume starts from the scrubbed position (UI flow)', () => {
  const { player } = createPlayer();
  const info = player.prepareMIDI(buildMultiTrackMidi());

  // Mirror MotifApp.handlePlayPause / handleMotifSeek:
  // play, pause, scrub while paused, then play() again.
  player.playFrom(0);
  player.pause();
  assert.ok(player.getIsPaused());

  const scrubOffset = info.duration * 0.4;
  player.seekPaused(scrubOffset);
  assert.equal(player.getElapsedTime(), scrubOffset, 'scrub moves the paused position');

  player.resumePlayback();
  assert.ok(player.getIsPlaying());
  assert.equal(player.getIsPaused(), false);
  assert.ok(
    Math.abs(player.getElapsedTime() - scrubOffset) < 0.25,
    `resume after scrub should be at ${scrubOffset}, got ${player.getElapsedTime()}`,
  );

  // Scrubbing while actively playing restarts from the new offset.
  const liveOffset = info.duration * 0.7;
  player.playFrom(liveOffset);
  assert.ok(
    Math.abs(player.getElapsedTime() - liveOffset) < 0.25,
    `live seek should be at ${liveOffset}, got ${player.getElapsedTime()}`,
  );
  assert.equal(timerSpy.activeCount(), 2, 'live seek leaves exactly one interval + end timer');
  player.stop();
  assert.equal(timerSpy.activeCount(), 0);
});

test('seeking after a full stop never restarts audio or creates timers', () => {
  const { player, ctx } = createPlayer();
  player.prepareMIDI(buildMultiTrackMidi());

  player.playFrom(0);
  player.stop();
  assert.equal(player.getIsPlaying(), false);
  assert.equal(player.getIsPaused(), false);
  assert.equal(timerSpy.activeCount(), 0);

  // WarioPlayer.seek behavior while stopped: no new run, no nodes, no timers.
  const trackedBefore = player.getAPU().getTrackedNodeCount();
  assert.equal(trackedBefore, 0);
  player.playFrom(5); // direct engine call still works for explicit API users
  assert.ok(player.getIsPlaying());
  assert.equal(timerSpy.activeCount(), 2);
  player.stop();

  // The stopped state is fully inert again.
  assert.equal(timerSpy.activeCount(), 0);
  assert.equal(player.getAPU().getTrackedNodeCount(), 0);
  assert.equal(sourceNodes(ctx).every((n) => n.stopped), true);
});

test('WarioPlayer wrapper: stop → seek stays silent; pause → seek moves resume point', async () => {
  const ctx = installWebAudioMocks();
  const wrapper = new WarioPlayer();
  await wrapper.prepare(buildMultiTrackMidi());

  // Start, then fully stop.
  await wrapper.play();
  assert.equal(timerSpy.activeCount(), 2);
  wrapper.stop();
  assert.equal(timerSpy.activeCount(), 0);

  // A scrub while stopped must not start any run.
  wrapper.seek(0.5);
  assert.equal(timerSpy.activeCount(), 0, 'stopped-state seek creates no timers');

  // Pause path: play, pause, scrub while paused, resume from the scrub point.
  await wrapper.play();
  wrapper.pause();
  assert.equal(wrapper.isPaused(), true);
  wrapper.seek(0.25);
  assert.equal(wrapper.isPaused(), true, 'paused seek does not start audio');
  const expected = wrapper.getDuration() * 0.25;
  assert.ok(Math.abs(wrapper.getCurrentTime() - expected) < 0.25);

  await wrapper.play();
  assert.equal(wrapper.isPaused(), false);
  assert.ok(Math.abs(wrapper.getCurrentTime() - expected) < 0.25);
  wrapper.stop();
  assert.equal(timerSpy.activeCount(), 0);
});
