import { GameBoyPlayer } from '../../src-v2/core/GameBoyPlayer';
import { audioBufferToWavBytes } from '../utils/export';
import { unlockAudio } from '../utils/audioUnlock';

/** Bridges the main player controls to the Game Boy synthesis engine. */
export class WarioPlayer {
  private player: GameBoyPlayer | null = null;
  private volume = 0.7;
  private duration = 0;

  async prepare(buffer: ArrayBuffer): Promise<void> {
    const context = await unlockAudio();
    this.player ??= new GameBoyPlayer({}, context);
    // prepareMIDI fully tears down any previous run (nodes, scheduler, timers)
    // and caches the new song's arranged channel notes for play/seek/export.
    this.player.prepareMIDI(buffer);
    const info = this.player.getPlaybackInfo();
    if (!info || !info.noteCount || info.duration <= 0) {
      throw new Error('No playable notes found in this MIDI.');
    }
    this.duration = info.duration;
    this.player.setVolume(this.volume);
  }

  /**
   * Start from the beginning, or resume from the exact pause position.
   * Never double-schedules: a paused engine resumes its existing run rather
   * than starting a second overlapping one.
   */
  async play(): Promise<void> {
    if (!this.player) return;
    await this.player.resume();
    if (this.player.getIsPaused()) {
      this.player.resumePlayback();
    } else if (!this.player.getIsPlaying()) {
      this.player.playFrom(0);
    }
  }

  /** Pause and remember the song position; all scheduled nodes are released. */
  pause(): void {
    this.player?.pause();
  }

  stop(): void {
    this.player?.stop();
  }

  seek(progress: number): void {
    if (!this.player) return;
    const offset = Math.max(0, Math.min(1, progress)) * this.duration;
    if (this.player.getIsPaused()) {
      // While paused, just move the remembered position — do not start sound.
      this.player.seekPaused(offset);
    } else if (this.player.getIsPlaying()) {
      // A live seek restarts the run from the new offset.
      this.player.playFrom(offset);
    }
    // When stopped, a scrub must not start audio: the UI updates its own
    // progress display and the next play() starts from the beginning.
  }

  setVolume(volume: number): void {
    this.volume = volume;
    this.player?.setVolume(volume);
  }
  getDuration(): number {
    return this.duration;
  }
  getCurrentTime(): number {
    return Math.max(0, Math.min(this.duration, this.player?.getElapsedTime() || 0));
  }
  getProgress(): number {
    return this.duration ? this.getCurrentTime() / this.duration : 0;
  }
  isPaused(): boolean {
    return this.player?.getIsPaused() ?? false;
  }
  hasGeneratedContent(): boolean {
    return this.duration > 0;
  }
  async exportMotifWAVBytes(): Promise<Uint8Array> {
    // Renders the same cached channel notes and assignment settings used by
    // live playback, so the clip matches the first 30 seconds heard live.
    const buffer = await this.player?.renderToBuffer();
    if (!buffer) throw new Error('Nothing to export.');
    return audioBufferToWavBytes(buffer);
  }
}
