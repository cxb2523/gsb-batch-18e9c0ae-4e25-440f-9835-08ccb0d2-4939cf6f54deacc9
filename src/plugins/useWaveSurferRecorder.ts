import { computed, getCurrentScope, onMounted, onScopeDispose, ref } from 'vue'
import RecordPlugin from 'wavesurfer.js/dist/plugins/record.js'
import type { Ref } from 'vue'
import type WaveSurfer from 'wavesurfer.js'
import type { RecordPluginOptions } from 'wavesurfer.js/dist/plugins/record'
import { useWaveSurferPlugin, useWaveSurferPluginStandalone } from '../core/useWaveSurferPlugin'

export interface UseWaveSurferRecorderOptions {
  waveSurfer: Ref<WaveSurfer | null>
  recordPluginOptions?: RecordPluginOptions
  /**
   * Safety net for `stopRecording()`. If the underlying plugin never emits
   * `record-end`, the returned promise is rejected after this many
   * milliseconds instead of hanging forever.
   * @default 5000
   */
  stopTimeout?: number
}

export interface UseWaveSurferRecorderStandaloneOptions {
  containerRef: Ref<HTMLElement | null>
  options: any
  recordPluginOptions?: RecordPluginOptions
  /** @see UseWaveSurferRecorderOptions.stopTimeout */
  stopTimeout?: number
}

type RecordingState = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping'

type Unsubscribe = () => void

/**
 * The subset of `RecordPlugin` this composable relies on. Declaring it
 * structurally keeps the composable usable with any compatible recorder
 * (including test doubles) and avoids leaking WaveSurfer's private members
 * into the reactive ref type.
 */
export interface RecorderLike {
  startRecording(options?: any): void | Promise<void>
  stopRecording(): void
  pauseRecording(): void
  resumeRecording(): void
  on?(event: string, listener: (...args: any[]) => void): unknown
  un?(event: string, listener: (...args: any[]) => void): void
}

interface PendingStop {
  promise: Promise<Blob>
  resolve: (blob: Blob) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

const DEFAULT_STOP_TIMEOUT = 5000

const NOT_AVAILABLE_MESSAGE =
  '[useWaveSurferRecorder] Cannot stop recording: the record plugin is not available.'
const NOT_RECORDING_MESSAGE =
  '[useWaveSurferRecorder] Cannot stop recording: no recording is currently in progress.'
const TIMEOUT_MESSAGE =
  '[useWaveSurferRecorder] Timed out waiting for the "record-end" event after stopping.'
const DISPOSED_MESSAGE =
  '[useWaveSurferRecorder] The recorder was disposed before the "record-end" event arrived.'

/**
 * Recording state machine shared by both public entry points.
 *
 * Source of truth is the internal `state` variable; the exposed refs are
 * always derived from it, and transitions are additionally confirmed by the
 * plugin's own events (`record-start`, `record-pause`, `record-resume`,
 * `record-end`). This keeps `isRecording` / `isPaused` in sync with what the
 * MediaRecorder is actually doing, even when calls are asynchronous.
 *
 * Plugin listeners are attached lazily on the first `startRecording()` call
 * and reused until the owning scope is disposed, so pausing, resuming and
 * repeated starts never stack duplicate listeners.
 */
const createRecordingLogic = (
  waveSurferRecorder: Ref<RecorderLike | null>,
  stopTimeout = DEFAULT_STOP_TIMEOUT
) => {
  const recordingTime = ref<number>(0)
  const isRecording = ref<boolean>(false)
  const isPaused = ref<boolean>(false)
  const error = ref<Error | null>(null)

  let state: RecordingState = 'idle'
  let pendingStop: PendingStop | null = null
  let attachedPlugin: RecorderLike | null = null
  let unsubscribers: Unsubscribe[] = []
  // Set when a session is abandoned while `startRecording()` is still awaiting
  // the microphone (stop timed out / unmounted). The `record-start` handler
  // must not revive such a session; the start continuation closes it instead.
  let sessionAborted = false

  // `isPauseResume` drives the pause/resume button label:
  // `value ? 'pause' : 'resume'`. It is `true` while the recorder is running
  // and `false` once it is paused, so the label flips as soon as the state does.
  const isPauseResume = computed<boolean>(() => isRecording.value || !isPaused.value)

  const currentTime = computed<string>(() => {
    // time will be in milliseconds, convert it to mm:ss format
    return [
      Math.floor((recordingTime.value % 3600000) / 60000), // minutes
      Math.floor((recordingTime.value % 60000) / 1000) // seconds
    ]
      .map((v) => (v < 10 ? '0' + v : v))
      .join(':')
  })

  const syncRefs = () => {
    isRecording.value = state === 'recording'
    isPaused.value = state === 'paused'
  }

  // Read through a function so TypeScript doesn't narrow `state` across
  // `setState()` calls or `await` boundaries (the value can change inside a
  // plugin event handler while an async control is in flight).
  const getState = (): RecordingState => state

  const setState = (next: RecordingState) => {
    state = next
    // A new or finished session always starts from 00:00. `stopping` keeps the
    // last value so the timer doesn't jump to 00:00 while the blob is closing.
    if (next === 'idle' || next === 'starting') {
      recordingTime.value = 0
    }
    syncRefs()
  }

  const failPendingStop = (reason: unknown) => {
    const pending = pendingStop
    if (!pending) return
    pendingStop = null
    clearTimeout(pending.timer)
    setState('idle')
    pending.reject(reason)
  }

  // --- Plugin event handlers -------------------------------------------------

  const handleRecordStart = () => {
    // A stop was requested (or timed out / the scope was disposed) while the
    // asynchronous start was still pending: don't revive the session. The
    // start continuation stops the recorder once it becomes active.
    if (sessionAborted || state === 'stopping') return
    setState('recording')
  }

  const handleRecordProgress = (time: number) => {
    if (state === 'idle' || state === 'stopping') return
    recordingTime.value = time
  }

  const handleRecordPause = () => {
    if (state === 'idle' || state === 'stopping') return
    setState('paused')
  }

  const handleRecordResume = () => {
    if (state === 'idle' || state === 'stopping') return
    setState('recording')
  }

  const handleRecordEnd = (blob: Blob) => {
    const pending = pendingStop
    pendingStop = null
    setState('idle')
    if (pending) {
      clearTimeout(pending.timer)
      pending.resolve(blob)
    }
  }

  // --- Listener lifecycle ----------------------------------------------------

  const subscribe = (plugin: RecorderLike, event: string, handler: (...args: any[]) => void) => {
    const unsubscribe = plugin.on?.(event, handler)
    if (typeof unsubscribe === 'function') return unsubscribe as Unsubscribe
    // Older / alternative emitters may not return an unsubscribe function.
    return () => plugin.un?.(event, handler)
  }

  const detachListeners = () => {
    while (unsubscribers.length) {
      const unsubscribe = unsubscribers.pop()
      try {
        unsubscribe?.()
      } catch {
        // Never let cleanup throw during unmount.
      }
    }
    attachedPlugin = null
  }

  const attachListeners = (plugin: RecorderLike) => {
    // One set of listeners per plugin instance, forever (until dispose).
    // Pause/resume and repeated starts call this again but must not stack.
    if (attachedPlugin === plugin && unsubscribers.length > 0) return
    detachListeners()
    unsubscribers = [
      subscribe(plugin, 'record-start', handleRecordStart),
      subscribe(plugin, 'record-progress', handleRecordProgress),
      subscribe(plugin, 'record-pause', handleRecordPause),
      subscribe(plugin, 'record-resume', handleRecordResume),
      subscribe(plugin, 'record-end', handleRecordEnd)
    ]
    attachedPlugin = plugin
  }

  // --- Public controls -------------------------------------------------------

  const resumeRecording = () => {
    const plugin = waveSurferRecorder.value
    if (!plugin || state !== 'paused') return
    plugin.resumeRecording()
    // The mock plugin / browsers may emit asynchronously; keep the UI honest
    // immediately. The event handler is idempotent.
    if (getState() === 'paused') setState('recording')
  }

  const startRecording = async (): Promise<void> => {
    const plugin = waveSurferRecorder.value
    if (!plugin) return

    switch (getState()) {
      case 'recording':
      case 'starting':
      case 'stopping':
        // Idempotent: never start a second session (or attach listeners twice).
        return
      case 'paused':
        resumeRecording()
        return
      default:
        break
    }

    attachListeners(plugin)
    setState('starting')
    error.value = null
    sessionAborted = false

    try {
      await plugin.startRecording()
      const settled = getState()
      if (sessionAborted) {
        // The session was abandoned while we waited for the microphone; close
        // the recorder we just opened and reset to idle.
        setState('idle')
        plugin.stopRecording()
      } else if (settled === 'starting') {
        setState('recording')
      } else if (settled === 'stopping' || settled === 'idle') {
        // stopRecording() was called while getUserMedia() was still pending:
        // close the freshly opened recorder so it doesn't record with no owner.
        plugin.stopRecording()
      }
    } catch (cause) {
      sessionAborted = false
      if (getState() === 'starting' || getState() === 'recording') {
        setState('idle')
      }
      failPendingStop(cause)
      // Surface the failure without throwing: existing callers use
      // fire-and-forget `startRecording()` and must not get unhandled
      // rejections when the microphone permission is denied.
      error.value = cause instanceof Error ? cause : new Error(String(cause))
    }
  }

  const pauseRecording = () => {
    const plugin = waveSurferRecorder.value
    if (!plugin) return
    if (state === 'paused') {
      resumeRecording()
      return
    }
    if (getState() !== 'recording') return

    plugin.pauseRecording()
    // Browser MediaRecorder fires `pause` asynchronously; reflect it now so the
    // button label never lags behind, then let the event confirm it.
    if (getState() === 'recording') setState('paused')
  }

  const stopRecording = (): Promise<Blob> => {
    const plugin = waveSurferRecorder.value
    if (!plugin) {
      return Promise.reject(new Error(NOT_AVAILABLE_MESSAGE))
    }
    if (pendingStop) return pendingStop.promise
    if (state === 'idle') {
      // Nothing to stop: settle immediately instead of waiting for a
      // `record-end` event that will never come.
      return Promise.reject(new Error(NOT_RECORDING_MESSAGE))
    }

    setState('stopping')

    let resolveStop!: (blob: Blob) => void
    let rejectStop!: (reason?: unknown) => void
    const promise = new Promise<Blob>((resolve, reject) => {
      resolveStop = resolve
      rejectStop = reject
    })

    const timer = setTimeout(() => {
      if (pendingStop && pendingStop.reject === rejectStop) {
        pendingStop = null
        // If the mic is still being acquired, the start continuation would
        // otherwise reopen a hidden session. Mark it aborted instead.
        if (state === 'stopping') sessionAborted = true
        setState('idle')
        rejectStop(new Error(TIMEOUT_MESSAGE))
      }
    }, stopTimeout)

    pendingStop = { promise, resolve: resolveStop, reject: rejectStop, timer }

    try {
      // If the recorder is still starting, this is a no-op; the start
      // continuation above will stop it once the MicStream is ready.
      plugin.stopRecording()
    } catch (error) {
      failPendingStop(error)
    }

    return promise
  }

  const dispose = () => {
    detachListeners()
    const pending = pendingStop
    pendingStop = null
    // An in-flight `startRecording()` must not revive the session after the
    // owner is gone.
    if (state === 'starting') sessionAborted = true
    if (pending) {
      clearTimeout(pending.timer)
      setState('idle')
      pending.reject(new Error(DISPOSED_MESSAGE))
    }
    if (state !== 'idle') {
      // Best effort: release the microphone when the owner unmounts.
      try {
        waveSurferRecorder.value?.stopRecording()
      } catch {
        // The plugin may already be destroyed.
      }
      setState('idle')
    }
  }

  if (getCurrentScope()) {
    onScopeDispose(dispose)
  }

  return {
    currentTime,
    startRecording,
    stopRecording,
    pauseRecording,
    isRecording,
    isPaused,
    isPauseResume,
    error,
    dispose
  }
}

// Plugin with existing WaveSurfer instance
export const useWaveSurferRecorder = ({
  waveSurfer,
  recordPluginOptions = {},
  stopTimeout = DEFAULT_STOP_TIMEOUT
}: UseWaveSurferRecorderOptions) => {
  const { pluginInstance: waveSurferRecorder, createPlugin } = useWaveSurferPlugin<RecordPlugin>(
    RecordPlugin,
    {
      renderRecordedAudio: false,
      ...recordPluginOptions
    }
  )

  const recordingLogic = createRecordingLogic(waveSurferRecorder, stopTimeout)

  onMounted(() => {
    if (waveSurfer.value) {
      createPlugin(waveSurfer.value)
    }
  })

  return {
    waveSurferRecorder,
    ...recordingLogic
  }
}

// Standalone version that creates its own WaveSurfer instance
export const useWaveSurferRecorderStandalone = ({
  containerRef,
  options,
  recordPluginOptions = {},
  stopTimeout = DEFAULT_STOP_TIMEOUT
}: UseWaveSurferRecorderStandaloneOptions) => {
  const { waveSurfer, pluginInstance: waveSurferRecorder } =
    useWaveSurferPluginStandalone<RecordPlugin>(RecordPlugin, {
      containerRef,
      options,
      pluginOptions: {
        renderRecordedAudio: false,
        ...recordPluginOptions
      }
    })

  const recordingLogic = createRecordingLogic(waveSurferRecorder, stopTimeout)

  return {
    waveSurfer,
    waveSurferRecorder,
    ...recordingLogic
  }
}
