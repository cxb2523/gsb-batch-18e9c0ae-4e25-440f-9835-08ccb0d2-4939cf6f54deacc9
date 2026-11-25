import { AudioX } from 'audio';
import { bands, presets } from 'constants/equalizer';
import { isValidArray } from 'helpers/common';

import type { EqualizerStatus, Preset } from 'types/equalizer.types';

class Equalizer {
  private static _instance: Equalizer | undefined;
  private audioCtx: AudioContext | undefined;
  private audioCtxStatus: EqualizerStatus = 'IDEAL';
  private eqFilterBands: BiquadFilterNode[] = [];
  private bassBoostFilter: BiquadFilterNode | undefined;
  private compressor: DynamicsCompressorNode | undefined;
  private audioSource: MediaElementAudioSourceNode | undefined;
  private resumeListener: (() => void) | undefined;

  /**
   * Creates an instance of Equalizer or returns the existing instance.
   */
  constructor() {
    if (Equalizer._instance) {
      console.warn(
        'Instantiation failed: cannot create multiple instances of Equalizer. Returning existing instance.',
      );
      // biome-ignore lint/correctness/noConstructorReturn: singleton must return the existing instance
      return Equalizer._instance;
    }

    this.initializeAudioContext();

    Equalizer._instance = this;
  }

  /**
   * Initializes the AudioContext, ensuring compatibility with older browsers.
   * @private
   */
  private initializeAudioContext() {
    const audioContextOptions = { latencyHint: 'playback' };
    if (typeof AudioContext !== 'undefined') {
      this.audioCtx = new AudioContext(audioContextOptions as AudioContextOptions);
    } else if (typeof (window as any).webkitAudioContext !== 'undefined') {
      this.audioCtx = new (window as any).webkitAudioContext(audioContextOptions);
    } else {
      console.error('Web Audio API is not supported in this browser.');
      this.audioCtxStatus = 'FAILED';
      return;
    }

    this.audioCtxStatus = 'ACTIVE';
    this.init();

    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.addResumeListener();
    }
  }

  /**
   * Adds a listener to resume the AudioContext on user interaction.
   * @private
   */
  private addResumeListener() {
    if (!this.audioCtx) {
      return;
    }
    const resume = () => {
      if (!this.audioCtx) {
        return;
      }
      this.audioCtx.resume();
      setTimeout(() => {
        if (this.audioCtx && this.audioCtx.state === 'running' && this.resumeListener) {
          document.body.removeEventListener('click', this.resumeListener, false);
          this.resumeListener = undefined;
        }
      }, 0);
    };
    this.resumeListener = resume;

    document.body.addEventListener('click', resume, false);
  }

  /**
   * Initializes the equalizer by setting up the audio source and filter bands.
   *
   * A media element can only be wired into an AudioContext once, so the graph
   * is built a single time for the lifetime of the instance. Re-entrant calls
   * (for example repeated `play()` calls) are no-ops instead of calling
   * `createMediaElementSource` again, which would throw and leave the EQ dead.
   */
  init() {
    // Idempotent: never re-create the MediaElementSource or re-wire the graph.
    if (!this.audioCtx || this.audioSource) {
      return;
    }

    try {
      const audioInstance = AudioX.getAudioInstance();
      if (!audioInstance) {
        console.error('Equalizer initialization failed: audio element is not available.');
        this.audioCtxStatus = 'FAILED';
        return;
      }
      const ctx = this.audioCtx;
      const audioSource = ctx.createMediaElementSource(audioInstance);

      const equalizerBands = bands.map((band) => {
        const filter = ctx.createBiquadFilter();
        filter.type = band.type;
        filter.frequency.value = band.frequency;
        filter.gain.value = band.gain;
        filter.Q.value = band.q || 1; // Use a default Q of 1 if not specified
        return filter;
      });

      // Create a compressor for overall dynamic control
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -24;
      compressor.knee.value = 30;
      compressor.ratio.value = 12;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;

      // Create the bass boost filter
      const bassBoostFilter = ctx.createBiquadFilter();
      bassBoostFilter.type = 'lowshelf';
      bassBoostFilter.frequency.value = 100;
      bassBoostFilter.gain.value = 0;

      // Connect the nodes
      audioSource.connect(equalizerBands[0]);
      for (let i = 0; i < equalizerBands.length - 1; i++) {
        equalizerBands[i].connect(equalizerBands[i + 1]);
      }
      equalizerBands[equalizerBands.length - 1].connect(bassBoostFilter);
      bassBoostFilter.connect(compressor);
      compressor.connect(ctx.destination);

      this.audioCtxStatus = 'ACTIVE';
      this.audioSource = audioSource;
      this.eqFilterBands = equalizerBands;
      this.bassBoostFilter = bassBoostFilter;
      this.compressor = compressor;
    } catch (error) {
      console.error('Equalizer initialization failed:', error);
      this.audioCtxStatus = 'FAILED';
    }
  }

  /**
   * Sets the equalizer to a predefined preset.
   * @param {keyof Preset} id - The ID of the preset to apply.
   */
  setPreset(id: keyof Preset) {
    if (!this.isReady()) {
      return;
    }
    const ctx = this.audioCtx;
    if (!ctx) {
      return;
    }
    const filterBands = this.eqFilterBands;

    const preset = presets.find((el) => el.id === id);
    if (!preset) {
      console.error('Preset not found:', id);
      return;
    }

    if (!filterBands || filterBands.length !== preset.gains.length) {
      console.error('Invalid data provided.');
      return;
    }

    const currentTime = ctx.currentTime;
    for (let index = 0; index < filterBands.length; index++) {
      const band = filterBands[index];
      const targetGain = preset.gains[index];
      band.gain.setTargetAtTime(targetGain, currentTime, 0.05);
    }
  }

  /**
   * Retrieves the list of available presets.
   * @returns {Preset[]} The list of available presets.
   */
  static getPresets() {
    return presets;
  }

  /**
   * Gets the current status of the AudioContext.
   * @returns {EqualizerStatus} The current status of the AudioContext.
   */
  status() {
    if (!this.audioCtx) {
      return this.audioCtxStatus;
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtxStatus;
  }

  /**
   * Sets a custom equalizer configuration.
   * @param {number[]} gains - The gain values for each band.
   */
  setCustomEQ(gains: number[]) {
    if (!this.isReady()) {
      return;
    }
    const ctx = this.audioCtx;
    if (!ctx) {
      return;
    }
    const filterBands = this.eqFilterBands;

    if (isValidArray(gains) && gains.length === filterBands.length) {
      const currentTime = ctx.currentTime;
      for (let index = 0; index < filterBands.length; index++) {
        const band = filterBands[index];
        band.gain.setTargetAtTime(gains[index], currentTime, 0.05);
      }
    } else {
      console.error('Invalid array of gains provided.');
    }
  }

  /**
   * Enables or disables bass boost.
   * @param {boolean} enable - Whether to enable or disable bass boost.
   * @param {number} gain - The gain value for bass boost.
   */
  setBassBoost(enable: boolean, gain = 6) {
    if (!this.isReady() || !this.bassBoostFilter) {
      return;
    }
    const ctx = this.audioCtx;
    if (!ctx) {
      return;
    }
    const bassBoostFilter = this.bassBoostFilter;
    const currentTime = ctx.currentTime;
    if (enable) {
      bassBoostFilter.gain.setTargetAtTime(gain, currentTime, 0.05);
    } else {
      bassBoostFilter.gain.setTargetAtTime(0, currentTime, 0.05);
    }
  }

  /**
   * Adjusts the compressor settings.
   * @param {Partial<DynamicsCompressorOptions>} options - The compressor options to adjust.
   */
  setCompressorSettings(options: Partial<DynamicsCompressorOptions>) {
    if (this.compressor && this.audioCtx) {
      if (options.threshold !== undefined)
        this.compressor.threshold.setTargetAtTime(
          options.threshold,
          this.audioCtx.currentTime,
          0.01,
        );
      if (options.knee !== undefined)
        this.compressor.knee.setTargetAtTime(options.knee, this.audioCtx.currentTime, 0.01);
      if (options.ratio !== undefined)
        this.compressor.ratio.setTargetAtTime(options.ratio, this.audioCtx.currentTime, 0.01);
      if (options.attack !== undefined)
        this.compressor.attack.setTargetAtTime(options.attack, this.audioCtx.currentTime, 0.01);
      if (options.release !== undefined)
        this.compressor.release.setTargetAtTime(options.release, this.audioCtx.currentTime, 0.01);
    }
  }

  /**
   * Resets the equalizer to flat response.
   */
  reset() {
    if (!this.isReady() || !this.bassBoostFilter) {
      return;
    }
    const ctx = this.audioCtx;
    if (!ctx) {
      return;
    }
    const filterBands = this.eqFilterBands;
    const bassBoostFilter = this.bassBoostFilter;
    const currentTime = ctx.currentTime;
    for (const band of filterBands) {
      band.gain.setTargetAtTime(0, currentTime, 0.05);
    }
    bassBoostFilter.gain.setTargetAtTime(0, currentTime, 0.05);
  }

  /**
   * Tears down the whole equalizer graph: disconnects every node, closes the
   * AudioContext, removes the resume listener and clears the singleton so that a
   * later `init()` can build a fresh graph against a new audio element.
   */
  async destroy() {
    if (this.resumeListener && typeof document !== 'undefined' && document.body) {
      document.body.removeEventListener('click', this.resumeListener, false);
      this.resumeListener = undefined;
    }

    this.audioSource?.disconnect();
    for (const band of this.eqFilterBands) {
      band.disconnect();
    }
    this.bassBoostFilter?.disconnect();
    this.compressor?.disconnect();

    if (this.audioCtx) {
      try {
        await this.audioCtx.close();
      } catch (error) {
        console.error('Failed to close equalizer AudioContext:', error);
      }
    }

    this.audioCtx = undefined;
    this.audioSource = undefined;
    this.eqFilterBands = [];
    this.bassBoostFilter = undefined;
    this.compressor = undefined;
    this.audioCtxStatus = 'IDEAL';
    Equalizer._instance = undefined;
  }

  /**
   * Guards every mutating API: the graph must have been built successfully and
   * the AudioContext must still be open before any parameter is touched.
   * @private
   */
  private isReady() {
    if (!this.audioCtx || this.audioCtx.state === 'closed' || !this.audioSource) {
      console.error('Equalizer is not initialized, please enable enableEQ at init and play once.');
      return false;
    }
    return true;
  }
}

export { Equalizer };
