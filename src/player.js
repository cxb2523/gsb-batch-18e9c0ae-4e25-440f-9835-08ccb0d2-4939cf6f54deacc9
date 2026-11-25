'use strict';

// Minimal playback state machine for the tape deck.
//
// It owns the one piece of truth the background cycle needs: the current
// track id and the playback position inside that track. Everything visual
// (reels, background) is derived from this state per frame, so there is no
// second clock anywhere that could drift from the music.
//
// Time advances only while a track is playing. Pausing freezes the position;
// stopping returns to position 0; selecting a track starts it at 0; scrubbing
// jumps the position immediately.

export class Player {
  constructor() {
    this.status = 'stopped'; // 'playing' | 'paused' | 'stopped'
    this.trackId = null;
    this.positionSeconds = 0;
    this.durationSeconds = 0;
    this.track = null; // { title, artist, album, ... } metadata for label fields
  }

  /** Load and start a track at position 0. Each new track restarts the cycle. */
  play(track, durationSeconds = 0) {
    this.track = track ?? null;
    this.trackId = this.track?.id ?? null;
    this.durationSeconds = Math.max(0, durationSeconds);
    this.positionSeconds = 0;
    this.status = 'playing';
  }

  /** Start the current/loaded track again from the top. */
  restart() {
    this.positionSeconds = 0;
    this.status = 'playing';
  }

  pause() {
    if (this.status === 'playing') this.status = 'paused';
  }

  /** Resume: the position is untouched, so the cycle continues exactly where
   * the music continues rather than jumping back or catching up. */
  resume() {
    if (this.trackId !== null) this.status = 'playing';
  }

  togglePause() {
    if (this.status === 'playing') this.pause();
    else this.resume();
  }

  /** Stop and go back to the list: position returns to 0. */
  stop() {
    this.status = 'stopped';
    this.positionSeconds = 0;
  }

  /**
   * Jump to an arbitrary position (scrub bar / held L-R seek).
   * The change is visible to the background on the very next frame — there is
   * no queued correction waiting for a natural timer tick.
   */
  seek(positionSeconds) {
    const p = Math.max(0, Number(positionSeconds) || 0);
    this.positionSeconds =
      this.durationSeconds > 0 ? Math.min(p, this.durationSeconds) : p;
  }

  /** Called by the render loop with elapsed wall time; only counts while playing. */
  tick(elapsedSeconds) {
    if (this.status !== 'playing') return;
    const dt = Math.max(0, Number(elapsedSeconds) || 0);
    this.positionSeconds += dt;
    if (this.durationSeconds > 0 && this.positionSeconds >= this.durationSeconds) {
      this.positionSeconds = this.durationSeconds;
      this.status = 'paused'; // end-of-track: holds the final frame
    }
  }

  /** The immutable per-frame snapshot handed to every visualization. */
  snapshot() {
    return {
      status: this.status,
      trackId: this.trackId,
      positionSeconds: this.positionSeconds,
      durationSeconds: this.durationSeconds,
      track: this.track,
    };
  }
}
