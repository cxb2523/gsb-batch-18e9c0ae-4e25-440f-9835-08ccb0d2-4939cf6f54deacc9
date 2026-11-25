import { createApp, defineComponent, h, onUnmounted, ref } from 'vue'
import { useWaveSurferRecorderStandalone } from '../src/plugins/useWaveSurferRecorder'

/**
 * Minimal interactive example for `useWaveSurferRecorderStandalone`.
 *
 *   yarn dev   → open the printed URL, allow microphone access
 *
 * It shows the state machine the composable guarantees:
 *   idle → recording → paused → recording → stopped
 * The button label comes from `isPauseResume`, the timer from `currentTime`,
 * and the Blob from `stopRecording()`.
 */
const RecorderDemo = defineComponent({
  name: 'RecorderDemo',
  setup() {
    const containerRef = ref<HTMLDivElement | null>(null)
    const lastBlobUrl = ref<string | null>(null)
    const lastBlobSize = ref<number | null>(null)
    const error = ref<string | null>(null)

    const {
      currentTime,
      isRecording,
      isPaused,
      isPauseResume,
      startRecording,
      pauseRecording,
      stopRecording,
      waveSurferRecorder
    } = useWaveSurferRecorderStandalone({
      containerRef,
      options: { height: 64, waveColor: '#c9cddd', progressColor: '#6a24ff' },
      recordPluginOptions: { continuousWaveform: true }
    })

    const stateLabel = ref('idle')

    const onStart = async () => {
      error.value = null
      revokeUrl()
      try {
        await startRecording()
        stateLabel.value = 'recording'
      } catch (e) {
        error.value = (e as Error).message
      }
    }

    const onPauseResume = () => {
      pauseRecording()
      stateLabel.value = isPaused.value ? 'paused' : 'recording'
    }

    const onStop = async () => {
      error.value = null
      try {
        const blob = await stopRecording()
        lastBlobSize.value = blob.size
        lastBlobUrl.value = URL.createObjectURL(blob)
        stateLabel.value = 'stopped'
      } catch (e) {
        error.value = (e as Error).message
      }
    }

    const revokeUrl = () => {
      if (lastBlobUrl.value) {
        URL.revokeObjectURL(lastBlobUrl.value)
        lastBlobUrl.value = null
      }
    }

    onUnmounted(revokeUrl)

    const style = {
      card: {
        background: '#fff',
        border: '1px solid #e6e8f0',
        borderRadius: '12px',
        padding: '20px',
        boxShadow: '0 1px 3px rgba(16, 24, 40, 0.06)'
      },
      row: { display: 'flex', gap: '8px', flexWrap: 'wrap' as const, marginTop: '16px' },
      btn: {
        padding: '8px 16px',
        borderRadius: '8px',
        border: '1px solid #d6d9e4',
        background: '#fff',
        cursor: 'pointer',
        fontSize: '14px'
      },
      primary: {
        padding: '8px 16px',
        borderRadius: '8px',
        border: '1px solid #6a24ff',
        background: '#6a24ff',
        color: '#fff',
        cursor: 'pointer',
        fontSize: '14px'
      },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }
    } as const

    return () =>
      h('div', { style: style.card }, [
        h('h1', { style: { margin: 0, fontSize: '18px' } }, 'Recorder state machine'),
        h(
          'p',
          { style: { color: '#5b6178', fontSize: '14px' } },
          'record-plugin instance: ' + (waveSurferRecorder.value ? 'ready' : 'attaching…')
        ),
        h('div', { ref: containerRef, style: { marginTop: '12px', minHeight: '72px' } }),
        h('div', { style: { ...style.mono, fontSize: '14px', display: 'grid', gap: '6px' } }, [
          h('div', `state: ${stateLabel.value}`),
          h('div', `isRecording: ${isRecording.value}`),
          h('div', `isPaused: ${isPaused.value}`),
          h('div', `isPauseResume (next label): ${isPauseResume.value ? 'pause' : 'resume'}`),
          h('div', `currentTime: ${currentTime.value}`)
        ]),
        h('div', { style: style.row }, [
          h(
            'button',
            { style: style.primary, onClick: onStart, disabled: isRecording.value },
            'Start'
          ),
          h(
            'button',
            {
              style: style.btn,
              onClick: onPauseResume,
              disabled: !isRecording.value && !isPaused.value
            },
            isPauseResume.value ? 'Pause' : 'Resume'
          ),
          h(
            'button',
            {
              style: style.btn,
              onClick: onStop,
              disabled: !isRecording.value && !isPaused.value
            },
            'Stop'
          )
        ]),
        error.value ? h('p', { style: { color: '#c0262d', fontSize: '13px' } }, error.value) : null,
        lastBlobUrl.value
          ? h('div', { style: { marginTop: '16px' } }, [
              h(
                'p',
                { style: { fontSize: '13px', color: '#5b6178' } },
                `Blob size: ${lastBlobSize.value} bytes`
              ),
              h('audio', { controls: true, src: lastBlobUrl.value, style: { width: '100%' } })
            ])
          : null
      ])
  }
})

createApp(RecorderDemo).mount('#app')
