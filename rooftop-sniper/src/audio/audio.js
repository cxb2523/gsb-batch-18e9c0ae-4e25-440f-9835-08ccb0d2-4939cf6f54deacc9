// All sounds are synthesised with WebAudio at runtime: no files to load or go missing.
// Every entry point is guarded so a browser without audio support simply stays silent.

const STORAGE_KEY = 'rooftop-sniper-audio';

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'off') this.enabled = false;
    } catch {
      /* storage unavailable */
    }
    this.windNodes = null;
  }

  // Must be called from a user gesture (browser autoplay policy).
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 0.8 : 0;
      this.master.connect(this.ctx.destination);
      // shared noise buffer
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // city echo: feedback delay used by the rifle shot
      this.echo = this.ctx.createDelay(1.0);
      this.echo.delayTime.value = 0.23;
      const fb = this.ctx.createGain();
      fb.gain.value = 0.32;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      this.echo.connect(lp);
      lp.connect(fb);
      fb.connect(this.echo);
      this.echoOut = this.ctx.createGain();
      this.echoOut.gain.value = 0.5;
      lp.connect(this.echoOut);
      this.echoOut.connect(this.master);
      this.startWind();
    } catch (err) {
      console.warn('Audio disabled:', err);
      this.ctx = null;
    }
  }

  setEnabled(on) {
    this.enabled = on;
    try {
      localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
    } catch {
      /* ignore */
    }
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.05);
  }

  toggle() {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  get ready() {
    return !!this.ctx;
  }

  noiseSource() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    return src;
  }

  env(gainNode, t, attack, peak, decay) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(peak, t + attack);
    g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  startWind() {
    if (!this.ctx || this.windNodes) return;
    const ctx = this.ctx;
    const src = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 380;
    bp.Q.value = 0.6;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    // slow gusts
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.03;
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.21;
    const lfo2Gain = ctx.createGain();
    lfo2Gain.gain.value = 140;
    lfo2.connect(lfo2Gain);
    lfo2Gain.connect(bp.frequency);
    src.connect(bp);
    bp.connect(lp);
    lp.connect(gain);
    gain.connect(this.master);
    src.start();
    lfo.start();
    lfo2.start();
    this.windNodes = { gain, bp };
  }

  // Wind loudness follows the in-game wind speed.
  setWind(speed) {
    if (!this.windNodes) return;
    const g = 0.035 + Math.min(Math.abs(speed), 4) * 0.012;
    if (Math.abs(g - (this.lastWindGain ?? -1)) < 0.002) return; // avoid piling up automation events
    this.lastWindGain = g;
    this.windNodes.gain.gain.setTargetAtTime(g, this.ctx.currentTime, 1.0);
  }

  shot() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    // crack
    const n = this.noiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(5000, t);
    lp.frequency.exponentialRampToValueAtTime(400, t + 0.25);
    const g = ctx.createGain();
    this.env(g, t, 0.003, 0.9, 0.35);
    n.connect(lp);
    lp.connect(g);
    g.connect(this.master);
    g.connect(this.echo);
    n.start(t);
    n.stop(t + 0.5);
    // thump
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.2);
    const og = ctx.createGain();
    this.env(og, t, 0.004, 0.8, 0.28);
    o.connect(og);
    og.connect(this.master);
    o.start(t);
    o.stop(t + 0.4);
  }

  click(t0 = 0, freq = 2600, vol = 0.25, len = 0.03) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + t0;
    const n = this.noiseSource();
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = freq;
    hp.Q.value = 2.5;
    const g = ctx.createGain();
    this.env(g, t, 0.002, vol, len);
    n.connect(hp);
    hp.connect(g);
    g.connect(this.master);
    n.start(t);
    n.stop(t + len + 0.05);
  }

  bolt(delay = 0.35) {
    this.click(delay, 1800, 0.3, 0.05);
    this.click(delay + 0.22, 2400, 0.28, 0.04);
  }

  reload(duration = 2.4) {
    this.click(0.1, 1400, 0.3, 0.06); // mag out
    this.click(duration * 0.55, 1200, 0.35, 0.07); // mag in
    this.click(duration * 0.55 + 0.05, 2200, 0.2, 0.03);
    this.bolt(duration * 0.78);
  }

  dry() {
    this.click(0, 3200, 0.2, 0.02);
  }

  hit(delay = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(1500, t);
    o.frequency.exponentialRampToValueAtTime(1100, t + 0.12);
    const g = ctx.createGain();
    this.env(g, t, 0.003, 0.22, 0.16);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.25);
    this.click(delay + 0.02, 300, 0.4, 0.12); // distant thud
  }

  impact() {
    this.click(0, 900, 0.12, 0.08);
  }

  civilian() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = i % 2 ? 520 : 780;
      const g = ctx.createGain();
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2200;
      g.gain.setValueAtTime(0.0001, t + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.14, t + i * 0.18 + 0.01);
      g.gain.setValueAtTime(0.14, t + i * 0.18 + 0.15);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.17);
      o.connect(lp);
      lp.connect(g);
      g.connect(this.master);
      o.start(t + i * 0.18);
      o.stop(t + i * 0.18 + 0.2);
    }
  }

  ui() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(1300, t);
    o.frequency.exponentialRampToValueAtTime(700, t + 0.05);
    const g = ctx.createGain();
    this.env(g, t, 0.002, 0.12, 0.06);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.1);
  }

  zoom() {
    this.click(0, 5000, 0.06, 0.02);
  }

  result(success) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const notes = success ? [392, 494, 587] : [330, 262];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      this.env(g, t + i * 0.16, 0.02, 0.12, 0.9);
      o.connect(g);
      g.connect(this.master);
      o.start(t + i * 0.16);
      o.stop(t + i * 0.16 + 1.1);
    });
  }
}

export const audio = new AudioEngine();
