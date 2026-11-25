/**
 * "Моя волна" (My Wave) queue controller — owns the whole AI-radio business
 * chain around the playlist:
 *
 *  - Extension is always anchored at the REAL queue tail (`frontierId` read
 *    at request time), and at most one extension request is ever in flight.
 *  - Every queue replacement (search, playlist pick, wave retune, account
 *    connect) bumps an epoch. An in-flight extension response whose epoch is
 *    stale — or whose anchor is no longer the tail — is discarded: it must
 *    never append to the new queue nor overwrite the new batch id.
 *  - Feedback carries the batch id of the batch the track actually arrived
 *    in (tracked per queue index, so demo-mode repeats of the same track id
 *    still attribute correctly). Late events for an old batch therefore never
 *    leak into the new batch.
 *  - Pausing never triggers an extension; the runway is only re-checked when
 *    playback is actually flowing ('playing' state), so a resume extends the
 *    queue only if it is still near the tail.
 *
 * The /api/wave and /api/wave/feedback contract is unchanged — this module
 * only decides WHEN to call them and with WHICH anchors / batch ids. It is
 * transport-agnostic (the wave fetch + feedback sink are injected), which is
 * what lets the race tests drive it with a controllable fake backend.
 */
import type { Track, WaveFeedbackRequest, WaveResponse } from '@shared';

export type WavePlaybackState = 'stopped' | 'playing' | 'paused';

/** The slice of the audio engine the controller needs (Player satisfies it). */
export interface WavePlayer {
  tracks: Track[];
  currentIndex: number;
  readonly state: WavePlaybackState;
  /** id of the last queued track — the frontier the wave advances from. */
  readonly frontierId: string | null;
  /** Seconds into the current track (for finished/skip feedback). */
  readonly currentTimeSeconds: number;
  setPlaylist(tracks: Track[]): void;
  appendTracks(tracks: Track[]): void;
  playIndex(index: number): void;
  on(event: 'statechange', fn: (state: WavePlaybackState) => void): void;
}

export interface WaveControllerDeps {
  player: WavePlayer;
  fetchWave: (after?: string) => Promise<WaveResponse>;
  sendFeedback: (body: WaveFeedbackRequest) => void | Promise<unknown>;
  /** yandex mode dedupes appended tracks; the tiny demo catalog may repeat. */
  isYandexMode: () => boolean;
  onActiveChange: (active: boolean) => void;
  /** The wave queue changed (started/extended) — re-render the playlist. */
  onQueueChanged: () => void;
  onStatus: (text: string, kind: 'info' | 'error') => void;
  /** Extend once fewer than this many tracks remain ahead. Default 20. */
  runway?: number;
}

export type WaveStartResult =
  /** First batch applied to the queue. */
  | 'started'
  /** The wave returned no tracks. */
  | 'empty'
  /** The queue was replaced while the first batch was loading — nothing applied. */
  | 'superseded';

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class WaveController {
  private readonly player: WavePlayer;
  private readonly deps: WaveControllerDeps;
  private readonly runway: number;

  private active = false;
  /** Bumped by every queue replacement; stale in-flight responses check it. */
  private epoch = 0;
  /** The single in-flight extension, if any (also awaited by continuation). */
  private inFlight: Promise<void> | null = null;
  /** Batch id (sessionId) of the most recently APPLIED batch. */
  private currentBatchId: string | null = null;
  /** Parallel to player.tracks: the batch each queued track arrived in. */
  private batchByIndex: (string | null)[] = [];

  constructor(deps: WaveControllerDeps) {
    this.deps = deps;
    this.player = deps.player;
    this.runway = deps.runway ?? 20;
    this.player.on('statechange', (state) => {
      // The ONLY automatic extension trigger: audio actually flowing. A pause
      // never extends the wave; a resume re-checks the runway and extends
      // only if the queue is still near its tail.
      if (state === 'playing') void this.maybeExtend();
    });
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Batch id of the newest applied batch (null when the wave is off). */
  get batchId(): string | null {
    return this.currentBatchId;
  }

  /**
   * (Re)start the wave from scratch. Throws on transport failure (the caller
   * reports it); a 'superseded' result means a newer queue action won the
   * race and this response was discarded.
   */
  async start(autoplay: boolean): Promise<WaveStartResult> {
    const epoch = ++this.epoch; // invalidates any in-flight extension
    const res = await this.deps.fetchWave();
    if (epoch !== this.epoch) return 'superseded';
    if (res.tracks.length === 0) return 'empty';
    this.active = true;
    this.currentBatchId = res.sessionId;
    this.player.setPlaylist(res.tracks);
    this.batchByIndex = new Array<string | null>(res.tracks.length).fill(res.sessionId);
    this.deps.onActiveChange(true);
    this.deps.onQueueChanged();
    if (autoplay) this.player.playIndex(0);
    return 'started';
  }

  /**
   * Leave wave mode: the playlist is no longer the wave queue. Every queue
   * replacement (search, playlist pick, mode switch) must go through here so
   * in-flight extension responses are invalidated.
   */
  deactivate(): void {
    this.epoch++;
    this.active = false;
    this.currentBatchId = null;
    this.batchByIndex = [];
    this.deps.onActiveChange(false);
  }

  /**
   * Report a playback event for the CURRENT track, tagged with the batch the
   * track arrived in — not the newest batch — so late events from an old
   * batch never leak into the new one. No-op when the wave is off.
   */
  feedback(event: WaveFeedbackRequest['event']): void {
    if (!this.active) return;
    const index = this.player.currentIndex;
    const track = this.player.tracks[index];
    if (!track) return;
    void this.deps.sendFeedback({
      sessionId: this.batchByIndex[index] ?? this.currentBatchId,
      trackId: track.id,
      event,
      totalPlayedSeconds: Math.floor(this.player.currentTimeSeconds),
    });
  }

  /** Extend when the queue runs low. Gated on actual playback — see the ctor. */
  async maybeExtend(): Promise<void> {
    if (!this.active || this.player.state !== 'playing') return;
    const ahead = this.player.tracks.length - this.player.currentIndex - 1;
    if (ahead >= this.runway) return;
    await this.extend();
  }

  /**
   * Natural track end with the wave on: report the finish, then keep flowing
   * — advance to the next queued track, extending first if we hit the tail.
   */
  async continueAfterEnd(): Promise<void> {
    if (!this.active) return;
    this.feedback('trackFinished');
    if (this.player.currentIndex < this.player.tracks.length - 1) {
      this.player.playIndex(this.player.currentIndex + 1);
      return;
    }
    // At the tail: genuine end-of-queue continuation — this extends even
    // though the player is stopped (a natural end is not the paused case).
    const epoch = this.epoch;
    const endedId = this.player.tracks[this.player.currentIndex]?.id ?? null;
    await this.extend();
    // The user replaced the queue, or took control of the transport, while
    // the extension was in flight — don't yank playback away from them.
    if (epoch !== this.epoch || !this.active) return;
    const nowId = this.player.tracks[this.player.currentIndex]?.id ?? null;
    if (nowId !== endedId || this.player.state !== 'stopped') return;
    if (this.player.currentIndex < this.player.tracks.length - 1) {
      this.player.playIndex(this.player.currentIndex + 1);
    } else {
      this.deps.onStatus('wave stalled — press Моя волна to retune', 'error');
    }
  }

  /** Single-flight extension; concurrent callers share the in-flight request. */
  private extend(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const run = this.doExtend();
    this.inFlight = run;
    const clear = (): void => {
      if (this.inFlight === run) this.inFlight = null;
    };
    run.then(clear, clear);
    return run;
  }

  private async doExtend(): Promise<void> {
    const epoch = this.epoch;
    const anchor = this.player.frontierId; // anchor at the REAL queue tail
    try {
      const res = await this.deps.fetchWave(anchor ?? undefined);
      // The queue was replaced (search / playlist pick / wave retune / mode
      // switch) while this request was in flight → the response must not
      // append to the new queue nor overwrite the new batch id.
      if (epoch !== this.epoch || !this.active) return;
      // The tail we anchored on must still be the tail.
      if (this.player.frontierId !== anchor) return;
      if (res.sessionId) this.currentBatchId = res.sessionId;
      const batchId = res.sessionId ?? this.currentBatchId;
      // yandex: drop tracks already queued; demo: the tiny catalog may repeat.
      const existing = new Set(this.player.tracks.map((t) => t.id));
      const fresh = this.deps.isYandexMode()
        ? res.tracks.filter((t) => !existing.has(t.id))
        : res.tracks;
      if (fresh.length === 0) return;
      this.player.appendTracks(fresh);
      for (let i = 0; i < fresh.length; i++) this.batchByIndex.push(batchId);
      this.deps.onQueueChanged();
    } catch (err) {
      // Non-fatal: the current queue keeps playing. Surface it only if this
      // request is still relevant to the current queue.
      if (epoch === this.epoch && this.active) {
        this.deps.onStatus(`could not extend the wave: ${errMsg(err)}`, 'error');
      }
    }
  }
}
