import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, h, ref, type Ref } from 'vue'
import { mount } from '@vue/test-utils'

import { registry, MockRecordPlugin } from './helpers/mockRecordPlugin'
import {
  useWaveSurferRecorder,
  useWaveSurferRecorderStandalone
} from '../src/plugins/useWaveSurferRecorder'

// The plugin factory is mocked so no microphone / MediaRecorder is needed.
vi.mock('wavesurfer.js/dist/plugins/record.js', () => ({
  default: {
    create: (options: any) => {
      const plugin = new MockRecordPlugin(options, registry.nextBehavior)
      registry.recordPlugins.push(plugin)
      return plugin
    }
  }
}))

// Standalone creates its own WaveSurfer through the default export.
vi.mock('wavesurfer.js', async () => {
  const { MockWaveSurfer } = await import('./helpers/mockRecordPlugin')
  return {
    default: {
      create: (options: any) => {
        const ws = new MockWaveSurfer(options)
        registry.waveSurfers.push(ws)
        return ws
      }
    }
  }
})

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

interface RecordedApi {
  isRecording: Ref<boolean>
  isPaused: Ref<boolean>
  isPauseResume: { value: boolean }
  currentTime: { value: string }
  error: Ref<Error | null>
  startRecording: () => Promise<void>
  pauseRecording: () => void
  stopRecording: () => Promise<Blob>
  waveSurferRecorder: Ref<any>
}

/**
 * Mount a component that owns the composable so `onMounted` / `onScopeDispose`
 * behave exactly like in a real app. Returns the reactive API plus an unmount.
 */
const mountRecorder = (
  factory: 'instance' | 'standalone',
  extraOptions: Record<string, any> = {}
) => {
  let api!: RecordedApi
  const containerRef = ref<HTMLElement | null>(null)

  const wrapper = mount(
    defineComponent({
      setup() {
        if (factory === 'instance') {
          const waveSurfer = ref<any>(
            new (class {
              registerPlugin(plugin: any) {
                return plugin
              }
            })()
          )
          api = useWaveSurferRecorder({
            waveSurfer,
            ...extraOptions
          }) as unknown as RecordedApi
        } else {
          api = useWaveSurferRecorderStandalone({
            containerRef,
            options: {},
            ...extraOptions
          }) as unknown as RecordedApi
        }
        return () => h('div', { ref: containerRef })
      }
    })
  )

  return { api, wrapper, containerRef }
}

describe.each([
  ['useWaveSurferRecorder', 'instance'],
  ['useWaveSurferRecorderStandalone', 'standalone']
] as const)('%s', (_name, factory) => {
  beforeEach(() => {
    registry.reset()
  })

  it('follows start → pause → resume → stop and keeps refs in sync', async () => {
    const { api } = mountRecorder(factory)
    await flush()
    const plugin = registry.lastPlugin()

    expect(api.isRecording.value).toBe(false)
    expect(api.isPaused.value).toBe(false)

    // start
    await api.startRecording()
    expect(plugin.startCalls).toBe(1)
    expect(api.isRecording.value).toBe(true)
    expect(api.isPaused.value).toBe(false)
    expect(api.isPauseResume.value).toBe(true)

    // pause
    api.pauseRecording()
    expect(plugin.pauseCalls).toBe(1)
    expect(api.isRecording.value).toBe(false)
    expect(api.isPaused.value).toBe(true)
    expect(api.isPauseResume.value).toBe(false)

    // resume
    api.pauseRecording() // same button toggles resume
    expect(plugin.resumeCalls).toBe(1)
    expect(api.isRecording.value).toBe(true)
    expect(api.isPaused.value).toBe(false)
    expect(api.isPauseResume.value).toBe(true)

    // stop
    const stopPromise = api.stopRecording()
    await expect(stopPromise).resolves.toBeInstanceOf(Blob)
    expect(api.isRecording.value).toBe(false)
    expect(api.isPaused.value).toBe(false)
    expect(api.isPauseResume.value).toBe(true)
  })

  it('returns the recorded Blob from stopRecording', async () => {
    const { api } = mountRecorder(factory)
    await flush()
    const plugin = registry.lastPlugin()

    await api.startRecording()
    plugin.progress(2500)

    const blob = await api.stopRecording()
    expect(blob).toBeInstanceOf(Blob)
    expect(blob).toBe(plugin.endBlob)
  })

  it('rejects immediately when stopping without an active recording', async () => {
    const { api } = mountRecorder(factory)
    await flush()
    const plugin = registry.lastPlugin()

    // Must settle rather than hang forever waiting for `record-end`.
    await expect(api.stopRecording()).rejects.toThrow(/no recording/i)
    expect(plugin.stopCalls).toBe(0)
    expect(api.isRecording.value).toBe(false)
    expect(api.isPaused.value).toBe(false)
  })

  it('resets the timer to 00:00 after stopping', async () => {
    const { api } = mountRecorder(factory)
    await flush()
    const plugin = registry.lastPlugin()

    await api.startRecording()
    plugin.progress(65_000)
    expect(api.currentTime.value).toBe('01:05')

    await api.stopRecording()
    expect(api.currentTime.value).toBe('00:00')
  })

  it('registers record-progress / record-end listeners only once across repeated starts', async () => {
    const { api } = mountRecorder(factory)
    await flush()
    const plugin = registry.lastPlugin()

    await api.startRecording()
    await api.stopRecording()
    await api.startRecording()
    api.pauseRecording()
    api.pauseRecording() // resume
    await api.stopRecording()
    await api.startRecording()
    api.pauseRecording() // pause
    await api.stopRecording()

    expect(plugin.startCalls).toBe(3)
    expect(plugin.listenerCount('record-progress')).toBe(1)
    expect(plugin.listenerCount('record-end')).toBe(1)
    expect(plugin.listenerCount('record-start')).toBe(1)
    expect(plugin.totalRegistrations('record-progress')).toBe(1)
    expect(plugin.totalRegistrations('record-end')).toBe(1)
  })

  it('unbinds every listener when the component unmounts', async () => {
    const { api, wrapper } = mountRecorder(factory)
    await flush()
    const plugin = registry.lastPlugin()

    await api.startRecording()
    expect(plugin.listenerCount('record-progress')).toBe(1)

    wrapper.unmount()

    expect(plugin.listenerCount('record-progress')).toBe(0)
    expect(plugin.listenerCount('record-end')).toBe(0)
    expect(plugin.listenerCount('record-start')).toBe(0)
    expect(plugin.listenerCount('record-pause')).toBe(0)
    expect(plugin.listenerCount('record-resume')).toBe(0)
  })

  it('settles a pending stop when unmounting mid-stop', async () => {
    const { api, wrapper } = mountRecorder(factory, { stopTimeout: 10_000 })
    await flush()
    const plugin = registry.lastPlugin()

    await api.startRecording()
    plugin.setEmitEnd(false)

    const pending = api.stopRecording()
    wrapper.unmount()

    await expect(pending).rejects.toThrow(/disposed/i)
  })
})

describe('stopRecording timeout', () => {
  beforeEach(() => registry.reset())

  it('rejects instead of hanging when record-end never arrives', async () => {
    registry.nextBehavior = { emitEnd: false }
    const { api } = mountRecorder('instance', { stopTimeout: 30 })
    await flush()
    const plugin = registry.lastPlugin()

    await api.startRecording()
    await expect(api.stopRecording()).rejects.toThrow(/timed out/i)
    expect(plugin.stopCalls).toBe(1)
    expect(api.isRecording.value).toBe(false)
    expect(api.isPaused.value).toBe(false)
  })
})

describe('stop requested while start is still pending', () => {
  beforeEach(() => registry.reset())

  it('waits for the async start and still resolves with a Blob', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    registry.nextBehavior = { startGate: gate }

    const { api } = mountRecorder('instance')
    await flush()

    const startPromise = api.startRecording()
    expect(api.isRecording.value).toBe(false)
    expect(api.isPaused.value).toBe(false)

    const stopPromise = api.stopRecording()
    expect(api.isRecording.value).toBe(false)

    release()
    await startPromise

    await expect(stopPromise).resolves.toBeInstanceOf(Blob)
    expect(api.isRecording.value).toBe(false)
    expect(api.isPaused.value).toBe(false)
  })
  it('closes the recorder if the stop times out before start settles', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    registry.nextBehavior = { startGate: gate }

    const { api } = mountRecorder('instance', { stopTimeout: 20 })
    await flush()
    const plugin = registry.lastPlugin()

    const startPromise = api.startRecording()
    await expect(api.stopRecording()).rejects.toThrow(/timed out/i)

    release()
    await startPromise

    // The recorder started after the stop gave up; it must be closed, not left
    // recording invisibly.
    expect(plugin.isRecording()).toBe(false)
    expect(plugin.stopCalls).toBeGreaterThanOrEqual(1)
    expect(api.isRecording.value).toBe(false)
    expect(api.isPaused.value).toBe(false)
  })
})

describe('repeated start keeps a single session', () => {
  beforeEach(() => registry.reset())

  it('does not start a second recording or duplicate listeners', async () => {
    const { api } = mountRecorder('instance')
    await flush()
    const plugin = registry.lastPlugin()

    await api.startRecording()
    await api.startRecording()
    await api.startRecording()

    expect(plugin.startCalls).toBe(1)
    expect(plugin.listenerCount('record-progress')).toBe(1)
    expect(plugin.listenerCount('record-end')).toBe(1)
    expect(api.isRecording.value).toBe(true)
  })

  it('startRecording while paused resumes instead of starting over', async () => {
    const { api } = mountRecorder('instance')
    await flush()
    const plugin = registry.lastPlugin()

    await api.startRecording()
    api.pauseRecording()
    await api.startRecording()

    expect(plugin.startCalls).toBe(1)
    expect(plugin.resumeCalls).toBe(1)
    expect(api.isRecording.value).toBe(true)
    expect(api.isPaused.value).toBe(false)
  })
})

describe('failure handling', () => {
  beforeEach(() => registry.reset())

  it('surfaces a microphone failure via the error ref and resets to idle', async () => {
    registry.nextBehavior = { startError: new Error('permission denied') }
    const { api } = mountRecorder('instance')
    await flush()

    // Must not throw (callers commonly fire-and-forget), but must report it.
    await api.startRecording()

    expect(api.error.value?.message).toBe('permission denied')
    expect(api.isRecording.value).toBe(false)
    expect(api.isPaused.value).toBe(false)
  })

  it('does not emit an unhandled rejection when start fails fire-and-forget', async () => {
    registry.nextBehavior = { startError: new Error('no device') }
    const { api } = mountRecorder('instance')
    await flush()

    const onUnhandled = vi.fn()
    process.once('unhandledRejection', onUnhandled)
    api.startRecording()
    await flush()
    await flush()
    process.removeListener('unhandledRejection', onUnhandled)

    expect(onUnhandled).not.toHaveBeenCalled()
    expect(api.error.value?.message).toBe('no device')
  })
})
