/**
 * Game Boy Player
 * 
 * Main entry point for the v2 synthesis engine.
 * Orchestrates MIDI parsing, track analysis, channel mapping,
 * arpeggiator, and APU scheduling.
 */

import { Midi } from '@tonejs/midi';
import { GameBoyAPU } from '../audio/apu/APU';
import { ChannelMapper } from '../audio/midi/ChannelMapper';
import { Arpeggiator } from '../audio/midi/Arpeggiator';
import { GameBoyArranger, type ArrangerConfig } from '../audio/arranger/GameBoyArranger';
import type { MIDITrack } from '../audio/midi/TrackAnalyzer';
import type { 
  ChannelNote, 
  ChannelAssignment, 
  PlaybackInfo,
  ArpNote,
  V2Config
} from '../types';

export interface GameBoyPlayerConfig extends Partial<V2Config> {
  /** Whether to auto-resume audio context on play */
  autoResume: boolean;
  
  /** Default BPM if not detected from MIDI */
  defaultBPM: number;
  
  /** Enable the arranger for fuller sound */
  enableArranger: boolean;
  
  /** Arranger configuration */
  arrangerConfig: Partial<ArrangerConfig>;
}

const DEFAULT_PLAYER_CONFIG: GameBoyPlayerConfig = {
  autoResume: true,
  defaultBPM: 120,
  masterVolume: 0.7,
  enableArranger: false, // OFF by default - too many overlapping notes causes clipping
  arrangerConfig: {},
};

export class GameBoyPlayer {
  private apu: GameBoyAPU;
  private mapper: ChannelMapper;
  private arpeggiator: Arpeggiator;
  private arranger: GameBoyArranger;
  private config: GameBoyPlayerConfig;
  
  private isPlaying: boolean = false;
  private isPaused: boolean = false;
  private currentPlaybackInfo: PlaybackInfo | null = null;
  private playbackStartTime: number = 0;
  // Song position (seconds) at the moment playback was paused. While playing
  // the position is derived from the audio clock; this holds it while paused.
  private pausedAt: number = 0;

  // Progressive scheduling state
  private pendingNotes: ChannelNote[] = [];
  private scheduleIndex: number = 0;
  // Cache of the last arranged song so pause/resume/seek can restart from an
  // offset without re-parsing and (importantly) re-randomising the arrangement.
  private loadedNotes: ChannelNote[] = [];
  private loadedDuration: number = 0;
  private loadedAssignments: ChannelAssignment[] = [];
  private schedulerInterval: ReturnType<typeof setInterval> | null = null;
  // Timer that flips the player to "stopped" at the natural end of a run.
  // Tracked so stop()/seek() can cancel it — an uncancelled timer from an old
  // run must never touch the state of a new run.
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  // Identifies the playback run the end timer belongs to; a stale timer whose
  // run was superseded becomes a no-op even if clearTimeout is unavailable.
  private playbackRunId: number = 0;
  private readonly SCHEDULE_AHEAD_TIME = 2.0; // Schedule 2 seconds ahead
  private readonly SCHEDULER_INTERVAL_MS = 250; // Check every 250ms
  
  constructor(config: Partial<GameBoyPlayerConfig> = {}, audioContext?: AudioContext) {
    this.config = { ...DEFAULT_PLAYER_CONFIG, ...config };
    this.apu = new GameBoyAPU(audioContext, this.config);
    this.mapper = new ChannelMapper();
    this.arpeggiator = new Arpeggiator({ bpm: this.config.defaultBPM });
    this.arranger = new GameBoyArranger(this.config.arrangerConfig);
  }
  
  /**
   * Get the APU instance for direct channel control.
   */
  getAPU(): GameBoyAPU {
    return this.apu;
  }
  
  /**
   * Parse and play a MIDI file.
   *
   * @param midiData - MIDI file as ArrayBuffer
   * @returns Playback information
   */
  async playMIDI(midiData: ArrayBuffer, startOffset: number = 0): Promise<PlaybackInfo> {
    // Resume audio context if needed
    if (this.config.autoResume) {
      await this.apu.resume();
    }

    // Tear down any current playback (scheduler, nodes, timers) first.
    this.stop();

    const info = this.prepare(midiData);
    this.startFromOffset(startOffset);
    return info;
  }

  /**
   * Parse, map and arrange a MIDI into GB channel notes and cache the result,
   * WITHOUT starting playback. Lets the WAV export render without a sound.
   */
  prepareMIDI(midiData: ArrayBuffer): PlaybackInfo {
    // A new song invalidates any playback state from the previous one.
    this.stop();
    return this.prepare(midiData);
  }

  private prepare(midiData: ArrayBuffer): PlaybackInfo {
    // Slice the bytes: @tonejs/midi detaches the ArrayBuffer it receives,
    // and callers (e.g. the export path) may need to prepare the same MIDI
    // more than once.
    const midi = new Midi(midiData.slice(0));
    const bpm = midi.header.tempos[0]?.bpm || this.config.defaultBPM;
    this.arpeggiator.setBPM(bpm);
    this.arranger.setBPM(bpm);

    const tracks = this.convertMIDITracks(midi);
    const assignments = this.mapper.mapTracks(tracks);
    let gbNotes = this.convertToGBNotes(tracks, assignments);

    if (this.config.enableArranger) {
      const result = this.arranger.arrange(gbNotes, assignments, midi.duration);
      gbNotes = result.notes;
    }

    // Cache the arranged song so pause/resume/seek/export reuse the same notes.
    this.loadedNotes = gbNotes;
    this.loadedDuration = midi.duration;
    this.loadedAssignments = assignments;

    // Make the live APU's channel timbres match this arrangement's channel
    // assignment immediately, so even the very first startFromOffset() runs
    // with the correct duty cycles / wave presets / noise modes.
    this.apu.applyAssignmentSettings(assignments);

    const info = {
      duration: midi.duration,
      assignments,
      noteCount: gbNotes.length,
    };
    this.currentPlaybackInfo = info;
    return info;
  }

  /**
   * (Re)start playback of the currently loaded song from a time offset in
   * seconds. This is the primitive that pause/resume and seeking are built on.
   */
  playFrom(offsetSec: number): void {
    if (this.loadedNotes.length === 0) return;
    this.startFromOffset(Math.max(0, Math.min(this.loadedDuration, offsetSec)));
  }

  /**
   * Pause playback and remember the exact song position. Already-scheduled
   * audio nodes and the scheduler are torn down; resume() restarts from the
   * same position using the same cached channel notes.
   */
  pause(): void {
    if (!this.isPlaying || this.isPaused) return;
    this.pausedAt = this.getElapsedTime();
    this.haltPlaybackRun();
    this.isPaused = true;
  }

  /**
   * Resume from the position stored by pause(). A no-op when not paused.
   */
  resumePlayback(): void {
    if (!this.isPaused) return;
    const offset = this.pausedAt;
    this.isPaused = false;
    this.pausedAt = 0;
    this.startFromOffset(offset);
  }

  /**
   * Move the remembered position while paused, without starting any sound.
   * The next resumePlayback() starts from this new position.
   */
  seekPaused(offsetSec: number): void {
    if (!this.isPaused) return;
    this.pausedAt = Math.max(0, Math.min(this.loadedDuration, offsetSec));
  }

  /**
   * Render the currently loaded song to an AudioBuffer offline (faster than
   * real time). Used to export a WAV. Returns null if nothing is loaded.
   *
   * The render goes through the exact same cached channel notes and the same
   * per-channel assignment settings as live playback, so the exported clip
   * matches what is heard when playing the song from the start.
   */
  async renderToBuffer(sampleRate: number = 22050, maxSeconds: number = 30): Promise<AudioBuffer | null> {
    if (this.loadedNotes.length === 0) return null;

    // The authentic APU (per-note LFSR noise buffers etc.) is heavy to render
    // offline, so bound the work to a short clip from the start of the song and
    // a chiptune-appropriate sample rate. Otherwise a 5-minute song can take
    // tens of seconds in-browser.
    const clipSeconds = Math.min(this.loadedDuration, maxSeconds);
    const totalDuration = clipSeconds + 0.5; // small release tail
    let notes = this.loadedNotes.filter(n => n.startTime < clipSeconds);

    const MAX_NOTES = 1500;
    if (notes.length > MAX_NOTES) {
      const step = notes.length / MAX_NOTES;
      notes = Array.from({ length: MAX_NOTES }, (_, i) => notes[Math.round(i * step)]);
    }

    const offline = new OfflineAudioContext(2, Math.ceil(totalDuration * sampleRate), sampleRate);
    const offlineApu = new GameBoyAPU(offline as unknown as AudioContext, this.config);

    // Re-apply the exact per-channel settings this arrangement used — same
    // call the live player makes on every (re)start.
    offlineApu.applyAssignmentSettings(this.loadedAssignments);

    // Schedule the same notes (same channels, same song-relative times) that
    // the live scheduler would emit for this clip.
    for (const note of notes) {
      offlineApu.scheduleNote(note);
    }

    return offline.startRendering();
  }

  /**
   * Cancel the scheduler interval and the natural-end timer for the current
   * playback run, and stop all scheduled audio nodes. Leaves the loaded song
   * and pause bookkeeping untouched.
   */
  private haltPlaybackRun(): void {
    this.stopScheduler();
    this.clearEndTimer();
    this.apu.stopAll();
  }

  private clearEndTimer(): void {
    if (this.endTimer !== null) {
      clearTimeout(this.endTimer);
      this.endTimer = null;
    }
  }

  private startFromOffset(offsetSec: number): void {
    // Full teardown of any previous run (stop, seek, or restart) so no node
    // or timer from an old run can overlap the new one.
    this.haltPlaybackRun();
    const runId = ++this.playbackRunId;

    // Every (re)start re-applies this arrangement's channel timbres. After a
    // seek the channels therefore sound exactly as they would at the same
    // position when playing from the start.
    this.apu.applyAssignmentSettings(this.loadedAssignments);

    this.pendingNotes = this.loadedNotes;
    // Skip notes that start before the offset (pendingNotes is sorted by time).
    let idx = 0;
    while (idx < this.pendingNotes.length && this.pendingNotes[idx].startTime < offsetSec) {
      idx++;
    }
    this.scheduleIndex = idx;

    // Shift the timeline origin back by the offset so getElapsedTime() reports
    // the song position and notes schedule at the right absolute times.
    const startTime = this.apu.getCurrentTime() + 0.1 - offsetSec;
    this.playbackStartTime = startTime;
    this.isPlaying = true;

    this.scheduleNextBatch();
    this.startScheduler();

    // Auto-stop after the remaining duration. The run id guard makes a timer
    // left over from a superseded run a guaranteed no-op.
    const stopDelay = (this.loadedDuration - offsetSec + 1) * 1000;
    this.endTimer = setTimeout(() => {
      if (this.playbackRunId !== runId) return;
      this.endTimer = null;
      this.playbackRunId++;
      this.stopScheduler();
      this.apu.stopAll();
      this.pendingNotes = [];
      this.scheduleIndex = 0;
      this.isPlaying = false;
      this.isPaused = false;
      this.pausedAt = 0;
    }, Math.max(0, stopDelay));
  }
  
  /**
   * Convert tonejs/midi tracks to our format.
   */
  private convertMIDITracks(midi: InstanceType<typeof Midi>): MIDITrack[] {
    return midi.tracks.map((track) => ({
      channel: track.channel,
      name: track.name,
      notes: track.notes.map(note => ({
        midi: note.midi,
        time: note.time,
        duration: note.duration,
        velocity: Math.round(note.velocity * 127),
      })),
    }));
  }
  
  /**
   * Convert MIDI notes to GB channel notes using assignments.
   */
  private convertToGBNotes(
    tracks: MIDITrack[],
    assignments: ChannelAssignment[]
  ): ChannelNote[] {
    const gbNotes: ChannelNote[] = [];
    
    for (const assignment of assignments) {
      const track = tracks[assignment.trackIndex];
      if (!track || track.notes.length === 0) continue;
      
      // Apply channel-specific settings
      this.applyChannelSettings(assignment);
      
      // Get notes from track
      let notes: ArpNote[] = track.notes.map(n => ({
        midiNote: n.midi,
        time: n.time,
        duration: n.duration,
        velocity: n.velocity,
      }));
      
      // Apply arpeggiator if needed
      if (assignment.shouldArpeggiate) {
        notes = this.arpeggiator.arpeggiate(notes);
      }
      
      // Convert to ChannelNote format
      for (const note of notes) {
        gbNotes.push({
          channel: assignment.channelId,
          midiNote: note.midiNote,
          startTime: note.time,
          duration: note.duration,
          velocity: note.velocity,
        });
      }
    }
    
    // Sort by start time for efficient scheduling
    return gbNotes.sort((a, b) => a.startTime - b.startTime);
  }
  
  /**
   * Apply channel-specific settings from assignment.
   */
  private applyChannelSettings(assignment: ChannelAssignment): void {
    // Delegate to the APU's single settings entry point so preparation and
    // restart apply timbres identically.
    this.apu.applyAssignmentSettings([assignment]);
  }
  
  /**
   * Schedule notes progressively - only schedule notes within the lookahead window.
   */
  private scheduleNextBatch(): void {
    if (!this.isPlaying && this.scheduleIndex > 0) return;
    
    const currentTime = this.apu.getCurrentTime();
    const elapsedTime = currentTime - this.playbackStartTime;
    const scheduleUntil = elapsedTime + this.SCHEDULE_AHEAD_TIME;
    
    let scheduledCount = 0;
    
    while (this.scheduleIndex < this.pendingNotes.length) {
      const note = this.pendingNotes[this.scheduleIndex];
      
      // If note is beyond our scheduling window, stop
      if (note.startTime > scheduleUntil) {
        break;
      }
      
      // Schedule the note
      this.apu.scheduleNote({
        ...note,
        startTime: this.playbackStartTime + note.startTime,
      });
      
      this.scheduleIndex++;
      scheduledCount++;
    }
    
    if (scheduledCount > 0) {
      console.log(`Scheduled ${scheduledCount} notes (${this.scheduleIndex}/${this.pendingNotes.length})`);
    }
  }
  
  /**
   * Start the progressive scheduler.
   */
  private startScheduler(): void {
    this.stopScheduler();
    
    this.schedulerInterval = setInterval(() => {
      if (!this.isPlaying) {
        this.stopScheduler();
        return;
      }
      
      this.scheduleNextBatch();
      
      // Check if all notes have been scheduled
      if (this.scheduleIndex >= this.pendingNotes.length) {
        this.stopScheduler();
      }
    }, this.SCHEDULER_INTERVAL_MS);
  }
  
  /**
   * Stop the progressive scheduler.
   */
  private stopScheduler(): void {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }
  }
  
  /**
   * Stop playback and release everything scheduled for this run: the
   * scheduler interval, the natural-end timer, and every audio node (plus
   * its envelope). After this returns nothing is sounding and no timer is
   * left running. The loaded song is kept so play() can restart it.
   */
  stop(): void {
    this.playbackRunId++; // invalidate any in-flight end timer
    this.haltPlaybackRun();
    this.isPlaying = false;
    this.isPaused = false;
    this.pausedAt = 0;
    this.pendingNotes = [];
    this.scheduleIndex = 0;
    console.log('Playback stopped');
  }

  /**
   * Check if currently playing (false while paused or stopped).
   */
  getIsPlaying(): boolean {
    return this.isPlaying && !this.isPaused;
  }

  /**
   * Check if playback is paused mid-song.
   */
  getIsPaused(): boolean {
    return this.isPaused;
  }

  /**
   * Get the current song position in seconds, including while paused.
   */
  getPosition(): number {
    if (this.isPaused) return Math.max(0, Math.min(this.loadedDuration, this.pausedAt));
    if (!this.isPlaying) return 0;
    return Math.max(0, Math.min(this.loadedDuration, this.apu.getCurrentTime() - this.playbackStartTime));
  }
  
  /**
   * Get current playback info.
   */
  getPlaybackInfo(): PlaybackInfo | null {
    return this.currentPlaybackInfo;
  }
  
  /**
   * Get elapsed playback time in seconds (the current song position).
   */
  getElapsedTime(): number {
    return this.getPosition();
  }
  
  /**
   * Set master volume.
   */
  setVolume(volume: number): void {
    this.apu.setMasterVolume(volume);
  }
  
  /**
   * Get master volume.
   */
  getVolume(): number {
    return this.apu.getMasterVolume();
  }
  
  /**
   * Resume audio context (required after user interaction in most browsers).
   */
  async resume(): Promise<void> {
    await this.apu.resume();
  }
  
  /**
   * Enable or disable the arranger.
   */
  setArrangerEnabled(enabled: boolean): void {
    this.config.enableArranger = enabled;
    console.log(`Arranger ${enabled ? 'enabled' : 'disabled'}`);
  }
  
  /**
   * Check if arranger is enabled.
   */
  isArrangerEnabled(): boolean {
    return this.config.enableArranger ?? true;
  }
  
  /**
   * Get the arranger instance for configuration.
   */
  getArranger(): GameBoyArranger {
    return this.arranger;
  }
  
  /**
   * Parse MIDI without playing (for analysis/preview).
   */
  analyzeMIDI(midiData: ArrayBuffer): {
    duration: number;
    trackCount: number;
    noteCount: number;
    bpm: number;
    assignments: ChannelAssignment[];
  } {
    const midi = new Midi(midiData);
    const tracks = this.convertMIDITracks(midi);
    const assignments = this.mapper.mapTracks(tracks);
    
    return {
      duration: midi.duration,
      trackCount: midi.tracks.length,
      noteCount: midi.tracks.reduce((sum, t) => sum + t.notes.length, 0),
      bpm: midi.header.tempos[0]?.bpm || this.config.defaultBPM,
      assignments,
    };
  }
  
  /**
   * Get detailed track analysis.
   */
  getTrackAnalysis(midiData: ArrayBuffer) {
    const midi = new Midi(midiData.slice(0));
    const tracks = this.convertMIDITracks(midi);
    return this.mapper.analyzeTracks(tracks);
  }

  /**
   * The cached, fully arranged channel notes of the currently loaded song.
   * Playback, seeking and offline rendering all schedule from this exact
   * list, which is what keeps the three paths audibly identical.
   */
  getLoadedNotes(): readonly ChannelNote[] {
    return this.loadedNotes;
  }

  /**
   * The channel assignments (duty cycles, wave presets, noise modes) for the
   * currently loaded song.
   */
  getLoadedAssignments(): readonly ChannelAssignment[] {
    return this.loadedAssignments;
  }
}
