/**
 * A controllable stand-in for wavesurfer.js's RecordPlugin.
 *
 * It mirrors the real plugin's observable contract closely enough to exercise
 * the composable's state machine:
 *  - `on()` returns an unsubscribe function and de-duplicates listeners per Set
 *  - `record-start` / `record-pause` / `record-resume` are emitted on the
 *    matching controls
 *  - `record-end` is emitted asynchronously (like MediaRecorder's `onstop`)
 *  - stopping an inactive recorder emits nothing (the real "hang" scenario)
 */
export type MockListener = (...args: any[]) => void

type MockState = 'inactive' | 'recording' | 'paused'

export interface MockRecordPluginOptions {
  /** Emit the lifecycle events automatically (default true). */
  autoEmit?: boolean
  /** Emit `record-end` when `stopRecording()` is called (default true). */
  emitEnd?: boolean
  /** When set, `startRecording()` waits for this promise before settling. */
  startGate?: Promise<void>
  /** When set, `startRecording()` rejects with this error (e.g. mic denied). */
  startError?: Error
}

export class MockRecordPlugin {
  readonly listeners = new Map<string, Set<MockListener>>()
  readonly onCalls: string[] = []

  state: MockState = 'inactive'
  startCalls = 0
  stopCalls = 0
  pauseCalls = 0
  resumeCalls = 0
  endBlob: Blob
  options: any

  private autoEmit: boolean
  private emitEnd: boolean
  private startGate?: Promise<void>
  private startError?: Error

  constructor(options: any = {}, behavior: MockRecordPluginOptions = {}) {
    this.options = options
    this.autoEmit = behavior.autoEmit ?? true
    this.emitEnd = behavior.emitEnd ?? true
    this.startGate = behavior.startGate
    this.startError = behavior.startError
    this.endBlob = new Blob(['mock-audio'], { type: 'audio/webm' })
  }

  // EventEmitter surface -----------------------------------------------------
  on(event: string, listener: MockListener): () => void {
    this.onCalls.push(event)
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener)
    return () => this.un(event, listener)
  }

  un(event: string, listener: MockListener): void {
    this.listeners.get(event)?.delete(listener)
  }

  emit(event: string, ...args: any[]): void {
    this.listeners.get(event)?.forEach((listener) => listener(...args))
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0
  }

  totalRegistrations(event: string): number {
    return this.onCalls.filter((name) => name === event).length
  }

  clearRegistrations(): void {
    this.onCalls.length = 0
  }

  // RecordPlugin surface -----------------------------------------------------
  isRecording(): boolean {
    return this.state === 'recording'
  }

  isPaused(): boolean {
    return this.state === 'paused'
  }

  isActive(): boolean {
    return this.state !== 'inactive'
  }

  async startRecording(): Promise<void> {
    this.startCalls += 1
    if (this.startGate) {
      await this.startGate
    }
    if (this.startError) {
      throw this.startError
    }
    this.state = 'recording'
    if (this.autoEmit) this.emit('record-start')
  }

  pauseRecording(): void {
    if (this.state !== 'recording') return
    this.pauseCalls += 1
    this.state = 'paused'
    if (this.autoEmit) this.emit('record-pause', new Blob([]))
  }

  resumeRecording(): void {
    if (this.state !== 'paused') return
    this.resumeCalls += 1
    this.state = 'recording'
    if (this.autoEmit) this.emit('record-resume')
  }

  stopRecording(): void {
    this.stopCalls += 1
    if (this.state === 'inactive') return
    this.state = 'inactive'
    const blob = this.endBlob
    // MediaRecorder's `stop` event is asynchronous; keep that behaviour so
    // callers must actually wait for `record-end`.
    queueMicrotask(() => {
      if (this.emitEnd) this.emit('record-end', blob)
    })
  }

  /** Test helper: push a progress tick. */
  progress(time: number): void {
    this.emit('record-progress', time)
  }

  /** Test helper: toggle whether `record-end` is emitted (simulate a stuck recorder). */
  setEmitEnd(value: boolean): void {
    this.emitEnd = value
  }

  destroy(): void {
    this.emit('destroy')
    this.listeners.clear()
  }
}

/**
 * Minimal WaveSurfer double used by the standalone entry point. The composable
 * only touches `registerPlugin` and `destroy`.
 */
export class MockWaveSurfer {
  options: any
  plugins: any[] = []
  destroyed = false

  constructor(options: any = {}) {
    this.options = options
  }

  registerPlugin<T>(plugin: T): T {
    this.plugins.push(plugin)
    return plugin
  }

  destroy(): void {
    this.destroyed = true
  }
}

/** Registry of everything created through the mocked plugin factory. */
export const registry = {
  recordPlugins: [] as MockRecordPlugin[],
  waveSurfers: [] as MockWaveSurfer[],
  /** Behaviour applied to the next created plugin. */
  nextBehavior: {} as MockRecordPluginOptions,
  reset() {
    this.recordPlugins.length = 0
    this.waveSurfers.length = 0
    this.nextBehavior = {}
  },
  lastPlugin(): MockRecordPlugin {
    const plugin = this.recordPlugins[this.recordPlugins.length - 1]
    if (!plugin) throw new Error('No MockRecordPlugin has been created')
    return plugin
  }
}
