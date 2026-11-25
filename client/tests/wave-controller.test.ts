/**
 * Race-focused tests for the "Моя волна" queue controller (client/src/wave.ts).
 *
 * Run with:  npm run test:wave -w client   (tsx, no browser needed)
 *
 * A controllable fake /api/wave (manually-resolved deferreds) drives the exact
 * interleavings that used to corrupt the queue: slow extension responses,
 * queue replacements mid-flight, pause/resume, and cross-batch feedback.
 *
 * Covers the acceptance criteria:
 *   1. normal extension appends once, anchored at the real tail, no duplicates
 *   2. a stale in-flight response is discarded after the queue is replaced
 *   3. pausing never extends; resuming re-checks the runway
 *   4. feedback is attributed to the batch the track actually arrived in
 */
import { WaveController } from '../src/wave';
import type { WavePlaybackState, WavePlayer } from '../src/wave';
import type { Track, WaveFeedbackRequest, WaveResponse } from '@shared';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function tr(id: string): Track {
  return { id, title: `title-${id}`, artist: `artist-${id}`, album: null, durationMs: 60_000, bitrateKbps: 128 };
}

function ids(tracks: Track[]): string[] {
  return tracks.map((t) => t.id);
}

/** Minimal WavePlayer: no audio, state changes are driven directly. */
class FakePlayer implements WavePlayer {
  tracks: Track[] = [];
  currentIndex = -1;
  state: WavePlaybackState = 'stopped';
  playedSeconds = 0;
  private readonly stateFns: Array<(s: WavePlaybackState) => void> = [];

  get frontierId(): string | null {
    return this.tracks[this.tracks.length - 1]?.id ?? null;
  }
  get currentTimeSeconds(): number {
    return this.playedSeconds;
  }
  setPlaylist(tracks: Track[]): void {
    this.tracks = [...tracks];
    this.currentIndex = tracks.length > 0 ? 0 : -1;
  }
  appendTracks(tracks: Track[]): void {
    this.tracks = this.tracks.concat(tracks);
  }
  playIndex(index: number): void {
    const n = this.tracks.length;
    this.currentIndex = ((index % n) + n) % n;
    this.setState('playing'); // like the real <audio> 'playing' event
  }
  on(_event: 'statechange', fn: (s: WavePlaybackState) => void): void {
    this.stateFns.push(fn);
  }
  setState(state: WavePlaybackState): void {
    this.state = state;
    for (const fn of this.stateFns) fn(state);
  }
}

/** Fake /api/wave: every call parks until respond() resolves it. */
class FakeWaveBackend {
  /** The `after` anchor of every call, in order. */
  readonly calls: Array<string | undefined> = [];
  private readonly waiters: Array<(res: WaveResponse) => void> = [];

  readonly fetch = (after?: string): Promise<WaveResponse> => {
    this.calls.push(after);
    return new Promise<WaveResponse>((resolve) => this.waiters.push(resolve));
  };

  get pendingCount(): number {
    return this.waiters.length;
  }

  /** Resolve the oldest pending request. */
  respond(body: WaveResponse): void {
    const waiter = this.waiters.shift();
    if (!waiter) throw new Error('no pending /api/wave request to resolve');
    waiter(body);
  }
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// ---------------------------------------------------------------------------
// Tiny test runner
// ---------------------------------------------------------------------------

let failures = 0;
function check(cond: boolean, msg: string): void {
  if (cond) console.log(`    ✓ ${msg}`);
  else {
    failures++;
    console.error(`    ✗ ${msg}`);
  }
}

function setup(opts: { runway?: number; yandex?: boolean } = {}): {
  player: FakePlayer;
  backend: FakeWaveBackend;
  wave: WaveController;
  feedbackLog: WaveFeedbackRequest[];
  statuses: string[];
} {
  const player = new FakePlayer();
  const backend = new FakeWaveBackend();
  const feedbackLog: WaveFeedbackRequest[] = [];
  const statuses: string[] = [];
  const wave = new WaveController({
    player,
    runway: opts.runway ?? 2,
    fetchWave: backend.fetch,
    sendFeedback: (body) => {
      feedbackLog.push(body);
    },
    isYandexMode: () => opts.yandex ?? false,
    onActiveChange: () => {},
    onQueueChanged: () => {},
    onStatus: (text) => {
      statuses.push(text);
    },
  });
  return { player, backend, wave, feedbackLog, statuses };
}

// ---------------------------------------------------------------------------
// 1. Normal extension: anchored at the real tail, single in-flight, no dupes
// ---------------------------------------------------------------------------
async function testNormalExtension(): Promise<void> {
  console.log('  normal extension (anchor, single-flight, no duplicates)');
  const { player, backend, wave } = setup({ runway: 2 });

  const started = wave.start(true);
  backend.respond({ tracks: [tr('a'), tr('b'), tr('c')], sessionId: 'batch-1' });
  check((await started) === 'started', 'wave starts with batch-1 [a,b,c]');
  check(player.state === 'playing' && player.currentIndex === 0, 'autoplay starts track 0');
  check(backend.calls.length === 1 && backend.calls[0] === undefined, 'start fetches without anchor');

  // Near the tail: two concurrent triggers must share ONE in-flight request.
  player.currentIndex = 1; // ahead = 1 < runway 2
  const p1 = wave.maybeExtend();
  const p2 = wave.maybeExtend();
  check(backend.calls.length === 2, 'concurrent triggers collapse to one in-flight request');
  check(backend.calls[1] === 'c', 'extension anchored at the real queue tail (c)');

  backend.respond({ tracks: [tr('d'), tr('e')], sessionId: 'batch-2' });
  await Promise.all([p1, p2]);
  check(ids(player.tracks).join(',') === 'a,b,c,d,e', 'batch-2 appended exactly once');
  check(wave.batchId === 'batch-2', 'batch id advanced to batch-2');

  // Enough runway again → no further request.
  await wave.maybeExtend();
  check(backend.calls.length === 2, 'no extension while the runway is full');
}

// ---------------------------------------------------------------------------
// 2. Stale in-flight response is discarded when the queue is replaced
// ---------------------------------------------------------------------------
async function testStaleResponseDiscarded(): Promise<void> {
  console.log('  stale in-flight response discarded after queue replacement');
  const { player, backend, wave } = setup({ runway: 2 });

  const started = wave.start(true);
  backend.respond({ tracks: [tr('a'), tr('b'), tr('c')], sessionId: 'batch-1' });
  await started;

  player.currentIndex = 1;
  const extending = wave.maybeExtend(); // parks: slow /api/wave
  check(backend.pendingCount === 1, 'extension in flight');

  // User runs a search mid-flight: wave mode left, queue replaced.
  wave.deactivate();
  player.setPlaylist([tr('x'), tr('y')]);

  backend.respond({ tracks: [tr('d'), tr('e')], sessionId: 'batch-2' });
  await extending;
  check(ids(player.tracks).join(',') === 'x,y', 'stale response NOT appended to the new queue');
  check(wave.batchId === null, 'stale response did not overwrite the batch id');
  check(!wave.isActive, 'wave stays inactive after the search');

  // Same protection for a superseded wave start (double retune).
  const first = wave.start(true);
  const second = wave.start(true); // user hammered the wave button
  backend.respond({ tracks: [tr('a')], sessionId: 'old' }); // resolves the FIRST request
  check((await first) === 'superseded', 'first start reports superseded');
  backend.respond({ tracks: [tr('b'), tr('c')], sessionId: 'new' });
  check((await second) === 'started', 'second start wins');
  check(ids(player.tracks).join(',') === 'b,c', 'only the newest start applied');
  check(wave.batchId === 'new', 'batch id comes from the newest start');
}

// ---------------------------------------------------------------------------
// 3. Pause never extends; resume re-checks the runway
// ---------------------------------------------------------------------------
async function testPauseResume(): Promise<void> {
  console.log('  pause does not extend; resume extends only if still near the tail');
  const { player, backend, wave } = setup({ runway: 2 });

  const started = wave.start(true);
  backend.respond({ tracks: [tr('a'), tr('b'), tr('c')], sessionId: 'batch-1' });
  await started;
  check(backend.calls.length === 1, 'no extension while the runway is full');

  // Pause near the tail: neither the state change nor an explicit check fires.
  player.currentIndex = 2; // at the very tail
  player.setState('paused');
  await wave.maybeExtend();
  await tick();
  check(backend.calls.length === 1, 'paused near the tail → no extension request');

  // Resume: still near the tail → the runway is topped up now.
  player.setState('playing');
  await tick();
  check(backend.calls.length === 2 && backend.calls[1] === 'c', 'resume near the tail extends from the tail');
  backend.respond({ tracks: [tr('d'), tr('e')], sessionId: 'batch-2' });
  await tick();
  check(ids(player.tracks).join(',') === 'a,b,c,d,e', 'extension applied after resume');

  // Pause again, then seek back to the start before resuming: runway is full
  // now, so the resume must NOT extend.
  player.setState('paused');
  player.currentIndex = 0;
  player.setState('playing');
  await tick();
  check(backend.calls.length === 2, 'resume with a full runway does not extend');
}

// ---------------------------------------------------------------------------
// 4. Feedback is attributed to the batch the track arrived in
// ---------------------------------------------------------------------------
async function testFeedbackAttribution(): Promise<void> {
  console.log('  feedback batch attribution (late events stay on their batch)');
  const { player, backend, wave, feedbackLog } = setup({ runway: 2 });

  const started = wave.start(true);
  backend.respond({ tracks: [tr('a'), tr('b'), tr('c')], sessionId: 'batch-1' });
  await started;

  player.currentIndex = 1;
  const extending = wave.maybeExtend();
  backend.respond({ tracks: [tr('d'), tr('e')], sessionId: 'batch-2' });
  await extending;
  check(wave.batchId === 'batch-2', 'batch-2 applied');

  // A LATE event for an old-batch track must carry batch-1, not batch-2.
  player.currentIndex = 0;
  player.playedSeconds = 42;
  wave.feedback('trackFinished');
  // The current track belongs to batch-2.
  player.currentIndex = 3;
  player.playedSeconds = 7;
  wave.feedback('skip');

  check(feedbackLog.length === 2, 'two feedback events sent');
  const [late, current] = feedbackLog;
  check(
    late?.sessionId === 'batch-1' && late?.trackId === 'a' && late?.totalPlayedSeconds === 42,
    'late event for an old-batch track keeps batch-1',
  );
  check(
    current?.sessionId === 'batch-2' && current?.trackId === 'd' && current?.totalPlayedSeconds === 7,
    'current-batch event carries batch-2',
  );

  // Demo mode repeats track ids across batches — attribution is per queue
  // position, so duplicates still map to their own batch.
  const demo = setup({ runway: 2 });
  const dStarted = demo.wave.start(true);
  demo.backend.respond({ tracks: [tr('a'), tr('b')], sessionId: 'demo-1' });
  await dStarted;
  demo.player.currentIndex = 1;
  const dExtending = demo.wave.maybeExtend();
  demo.backend.respond({ tracks: [tr('a'), tr('c')], sessionId: 'demo-2' }); // 'a' repeats
  await dExtending;
  demo.player.currentIndex = 0; // the FIRST 'a' (batch demo-1)
  demo.wave.feedback('skip');
  demo.player.currentIndex = 2; // the SECOND 'a' (batch demo-2)
  demo.wave.feedback('skip');
  const [first, second] = demo.feedbackLog;
  check(
    first?.sessionId === 'demo-1' && second?.sessionId === 'demo-2',
    'duplicate track ids attribute per queue position (demo mode)',
  );

  // No wave → no feedback at all.
  wave.deactivate();
  wave.feedback('skip');
  check(feedbackLog.length === 2, 'feedback is suppressed once the wave is off');
}

// ---------------------------------------------------------------------------
// 5. End-of-queue continuation: extend at the tail, then keep playing
// ---------------------------------------------------------------------------
async function testContinuationAtTail(): Promise<void> {
  console.log('  natural end at the tail extends, then advances');
  const { player, backend, wave, feedbackLog } = setup({ runway: 1 });

  const started = wave.start(true);
  backend.respond({ tracks: [tr('a'), tr('b')], sessionId: 'batch-1' });
  await started;

  // Last track ends naturally (player is stopped, sitting on 'b').
  player.currentIndex = 1;
  player.setState('stopped');
  const continuing = wave.continueAfterEnd();
  check(backend.calls.length === 2 && backend.calls[1] === 'b', 'continuation extends from the real tail');
  backend.respond({ tracks: [tr('c')], sessionId: 'batch-2' });
  await continuing;
  await tick(); // playIndex → 'playing' → runway check (ahead 0 < 1) extends again
  check(player.currentIndex === 2 && player.state === 'playing', 'playback advanced to the fresh track');
  check(
    feedbackLog[0]?.event === 'trackFinished' && feedbackLog[0]?.trackId === 'b' && feedbackLog[0]?.sessionId === 'batch-1',
    'the finished track was reported on its own batch',
  );
  backend.respond({ tracks: [tr('d')], sessionId: 'batch-3' }); // settle the runway top-up
  await tick();

  // If the user replaces the queue while the continuation fetch is in flight,
  // playback must NOT auto-advance afterwards.
  player.setState('stopped');
  player.currentIndex = player.tracks.length - 1; // at the tail again
  const stalled = wave.continueAfterEnd();
  wave.deactivate();
  player.setPlaylist([tr('z')]);
  backend.respond({ tracks: [tr('q')], sessionId: 'batch-4' });
  await stalled;
  check(ids(player.tracks).join(',') === 'z' && player.state === 'stopped', 'no auto-advance after a mid-flight queue replacement');
}

// ---------------------------------------------------------------------------
// 6. yandex mode: appended batches are deduped against the queued tracks
// ---------------------------------------------------------------------------
async function testYandexDedupe(): Promise<void> {
  console.log('  yandex mode dedupes appended tracks');
  const { player, backend, wave } = setup({ runway: 1, yandex: true });

  const started = wave.start(true);
  backend.respond({ tracks: [tr('a'), tr('b')], sessionId: 'batch-1' });
  await started;

  player.currentIndex = 1; // ahead = 0 < runway 1
  const extending = wave.maybeExtend();
  backend.respond({ tracks: [tr('b'), tr('c')], sessionId: 'batch-2' }); // 'b' already queued
  await extending;
  check(ids(player.tracks).join(',') === 'a,b,c', 'already-queued tracks are not re-appended');
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await testNormalExtension();
  await testStaleResponseDiscarded();
  await testPauseResume();
  await testFeedbackAttribution();
  await testContinuationAtTail();
  await testYandexDedupe();
  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\nall wave-controller checks passed');
}

await main();
