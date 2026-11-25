/**
 * Minimal, deterministic mock of the Web Audio API surface used by the v2
 * Game Boy engine. Enough of AudioContext / OfflineAudioContext is
 * implemented to drive scheduling, stop/disconnect bookkeeping and noise
 * buffer generation headlessly in Node — no real audio device is touched.
 */

export class MockAudioParam {
  value: number;
  private events: Array<{ time: number; value: number; type: string }> = [];

  constructor(value = 0) {
    this.value = value;
  }

  setValueAtTime(value: number, time: number): this {
    this.events.push({ time, value, type: 'set' });
    this.value = value;
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    this.events.push({ time, value, type: 'linear' });
    this.value = value;
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    this.events.push({ time, value, type: 'expo' });
    this.value = value;
    return this;
  }

  getEvents(): ReadonlyArray<{ time: number; value: number; type: string }> {
    return this.events;
  }
}

export type AnyMockNode = MockNode;

export class MockNode {
  readonly context: MockBaseAudioContext;
  numberOfInputs = 1;
  numberOfOutputs = 1;
  onended: ((event: { type: 'ended' }) => void) | null = null;
  stopped = false;
  stopTimes: number[] = [];
  started = false;
  startTimes: number[] = [];
  disconnected = false;
  private connections = new Set<MockNode>();

  constructor(context: MockBaseAudioContext) {
    this.context = context;
    context.registerNode(this);
  }

  connect(destination: MockNode): MockNode {
    this.connections.add(destination);
    return destination;
  }

  disconnect(): void {
    this.connections.clear();
    this.disconnected = true;
  }

  getConnections(): ReadonlySet<MockNode> {
    return this.connections;
  }

  start(when = 0): void {
    this.started = true;
    this.startTimes.push(when);
  }

  stop(when = 0): void {
    this.stopped = true;
    this.stopTimes.push(when);
  }

  /** Test helper: simulate the node finishing naturally. */
  fireEnded(): void {
    this.onended?.({ type: 'ended' });
  }
}

export class MockOscillatorNode extends MockNode {
  readonly frequency = new MockAudioParam(440);
  type: OscillatorType = 'custom';
  periodicWave: unknown = null;

  setPeriodicWave(wave: unknown): void {
    this.periodicWave = wave;
    this.type = 'custom';
  }
}

export class MockAudioBufferSourceNode extends MockNode {
  buffer: MockAudioBuffer | null = null;
  loop = false;
  playbackRate = new MockAudioParam(1);
}

export class MockGainNode extends MockNode {
  readonly gain: MockAudioParam;

  constructor(context: MockBaseAudioContext, initial = 1) {
    super(context);
    this.gain = new MockAudioParam(initial);
  }
}

export class MockDynamicsCompressorNode extends MockNode {
  readonly threshold = new MockAudioParam(-24);
  readonly knee = new MockAudioParam(30);
  readonly ratio = new MockAudioParam(12);
  readonly attack = new MockAudioParam(0.003);
  readonly release = new MockAudioParam(0.25);
}

export class MockBiquadFilterNode extends MockNode {
  type: BiquadFilterType = 'lowpass';
  readonly frequency = new MockAudioParam(350);
  readonly Q = new MockAudioParam(1);
  readonly detune = new MockAudioParam(0);
  readonly gain = new MockAudioParam(0);
}

export class MockWaveShaperNode extends MockNode {
  curve: Float32Array | null = null;
  oversample: OverSampleType = 'none';
}

export class MockAudioBuffer {
  readonly sampleRate: number;
  readonly length: number;
  readonly numberOfChannels: number;
  private channels: Float32Array[];

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel];
  }
}

export class MockPeriodicWave {
  constructor(public readonly real: Float32Array, public readonly imag: Float32Array) {}
}

export class MockBaseAudioContext {
  sampleRate: number;
  state: 'suspended' | 'running' | 'closed' = 'running';
  currentTime = 0;
  protected allNodes = new Set<MockNode>();
  private timerCount = 0;
  private timers = new Map<number, { callback: () => void; dueAt: number; cleared: boolean }>();
  private now = 0;
  readonly destination: MockGainNode;

  constructor(sampleRate = 44100) {
    this.sampleRate = sampleRate;
    // Destination must be created after the node set exists; it registers
    // itself via registerNode().
    this.destination = new MockGainNode(this as unknown as MockBaseAudioContext, 1);
  }

  registerNode(node: MockNode): void {
    this.allNodes.add(node);
  }

  createOscillator(): MockOscillatorNode {
    return new MockOscillatorNode(this);
  }

  createBufferSource(): MockAudioBufferSourceNode {
    return new MockAudioBufferSourceNode(this);
  }

  createGain(initial = 1): MockGainNode {
    return new MockGainNode(this, initial);
  }

  createDynamicsCompressor(): MockDynamicsCompressorNode {
    return new MockDynamicsCompressorNode(this);
  }

  createBiquadFilter(): MockBiquadFilterNode {
    return new MockBiquadFilterNode(this);
  }

  createWaveShaper(): MockWaveShaperNode {
    return new MockWaveShaperNode(this);
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): MockAudioBuffer {
    return new MockAudioBuffer(numberOfChannels, length, sampleRate);
  }

  createPeriodicWave(real: Float32Array, imag: Float32Array): MockPeriodicWave {
    return new MockPeriodicWave(real, imag);
  }

  /** Advance the mock clock; fires due timers. */
  advance(seconds: number): void {
    this.now += seconds;
    this.currentTime = this.now;
    for (const timer of this.timers.values()) {
      if (!timer.cleared && timer.dueAt <= this.now) {
        timer.cleared = true;
        timer.callback();
      }
    }
  }

  setTimeout(callback: () => void, delayMs: number): number {
    const id = ++this.timerCount;
    this.timers.set(id, { callback, dueAt: this.now + delayMs / 1000, cleared: false });
    return id;
  }

  clearTimeout(id: number): void {
    const timer = this.timers.get(id);
    if (timer) timer.cleared = true;
  }

  setInterval(callback: () => void, intervalMs: number): number {
    const id = ++this.timerCount;
    const tick = () => {
      const timer = this.timers.get(id);
      if (!timer || timer.cleared) return;
      callback();
      timer.dueAt = this.now + intervalMs / 1000;
    };
    this.timers.set(id, { callback: tick, dueAt: this.now + intervalMs / 1000, cleared: false });
    return id;
  }

  clearInterval(id: number): void {
    this.clearTimeout(id);
  }

  getAllNodes(): ReadonlySet<MockNode> {
    return this.allNodes;
  }

  getTimerCount(): number {
    let active = 0;
    for (const t of this.timers.values()) if (!t.cleared) active++;
    return active;
  }
}

export class MockAudioContext extends MockBaseAudioContext {
  async resume(): Promise<void> {
    this.state = 'running';
  }

  async close(): Promise<void> {
    this.state = 'closed';
  }
}

export class MockOfflineAudioContext extends MockBaseAudioContext {
  readonly length: number;

  constructor(_numberOfChannels: number, length: number, sampleRate: number) {
    super(sampleRate);
    this.length = length;
  }

  async startRendering(): Promise<MockAudioBuffer> {
    return new MockAudioBuffer(2, this.length, this.sampleRate);
  }
}

/**
 * Install the mocks onto globalThis so code using bare AudioContext /
 * OfflineAudioContext constructors resolves them.
 */
export function installWebAudioMocks(sampleRate = 44100): MockAudioContext {
  const ctx = new MockAudioContext(sampleRate);
  (globalThis as Record<string, unknown>).AudioContext = MockAudioContext;
  (globalThis as Record<string, unknown>).OfflineAudioContext = MockOfflineAudioContext;
  (globalThis as Record<string, unknown>).PeriodicWave = MockPeriodicWave;
  return ctx;
}
