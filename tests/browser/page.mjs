// Browser-side end-to-end check for the recording graph.
//
// Runs the real component code against the real Tone.js build and the real
// MediaRecorder. Audio comes from generated buffers, so no microphone or
// external service is involved.
//
// Assertions observe the real Tone nodes and timers captured by
// tests/browser/tone-shim.mjs (window.__tracking) plus the component's public
// state. Each scenario is isolated in its own component instance, so a failure
// in one does not prevent the others from running.

import * as Tone from 'tone'
import noiseModule from '../../src/components/noise.js'

const track = window.__tracking
const log = window.__log
const results = window.__results

function assert (condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function check (name, fn) {
  const timeout = new Promise((resolve, reject) => {
    setTimeout(() => reject(new Error('timed out after 20s')), 20000)
  })

  try {
    await Promise.race([fn(), timeout])
    results.push({ name, ok: true })
  } catch (error) {
    log.push(`[${name}] ` + (error && error.stack ? error.stack : String(error)))
    results.push({ name, ok: false, detail: String(error && error.message ? error.message : error) })
  }
}

// Generate a short buffer for the sample players (no microphone needed).
function makeBuffer () {
  const rawContext = window.Tone.getContext().rawContext
  const buffer = rawContext.createBuffer(1, rawContext.sampleRate * 0.5, rawContext.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.sin((i / rawContext.sampleRate) * 2 * Math.PI * 220) * 0.1
  }
  return buffer
}

function profile (id, name, overrides = {}) {
  return Object.assign({
    id,
    name,
    isTimerEnabled: false,
    duration: 30,
    volume: -20,
    noiseColor: 'pink',
    isFilterEnabled: true,
    filterType: 'lowpass',
    filterCutoff: 800,
    isLFOFilterCutoffEnabled: true,
    lfoFilterCutoffFrequency: 0.5,
    lfoFilterCutoffLow: 100,
    lfoFilterCutoffHigh: 5000,
    isTremoloEnabled: true,
    tremoloFrequency: 0.5,
    tremoloDepth: 0.5,
    samples: []
  }, overrides)
}

function sample (id, overrides = {}) {
  return Object.assign({
    id,
    name: 'sample-' + id,
    user: 'user',
    volume: -12,
    fadeIn: 0,
    loopPointsEnabled: false,
    loopStart: 0,
    loopEnd: 0,
    reverbEnabled: true,
    reverbPreDelay: 0.01,
    reverbDecay: 1.2,
    reverbWet: 0.5,
    playbackMode: 'continuous',
    sporadicMin: 1,
    sporadicMax: 2
  }, overrides)
}

const SAMPLES = [
  sample(101, { reverbEnabled: true, playbackMode: 'continuous' }),
  sample(102, { reverbEnabled: true, playbackMode: 'sporadic', sporadicMin: 1, sporadicMax: 2 })
]
const PROFILES = [
  profile(1, 'Normal', { samples: SAMPLES }),
  profile(2, 'Recorded', { samples: SAMPLES })
]

// Build a fresh component with a stubbed HTTP layer, then run the component's
// own `created()` hook so it starts from exactly the state it expects.
function createComponent () {
  const instance = Object.assign({}, noiseModule.data())
  Object.assign(instance, noiseModule.methods)

  Object.defineProperty(instance, 'changeableSettings', {
    get () { return [instance.volume] }
  })

  const requests = []
  instance.$http = {
    get (url) {
      requests.push(['GET', url])
      if (url === '/profiles') {
        return Promise.resolve({ status: 200, data: { profiles: PROFILES.map(p => ({ id: p.id, text: p.name })) } })
      }
      const match = url.match(/^\/profiles\/(\d+)$/)
      if (match) {
        const found = PROFILES.find(p => String(p.id) === match[1])
        return Promise.resolve({ status: 200, data: { profile: JSON.parse(JSON.stringify(found)) } })
      }
      if (url === '/samples') {
        return Promise.resolve({ status: 200, data: { samples: [] } })
      }
      if (url === '/users/current') {
        return Promise.resolve({
          status: 200,
          data: { user: { canUpload: true, darkMode: false, preferences: { accentColor: { hex: '#ffffff' } } } }
        })
      }
      return Promise.resolve({ status: 200, data: {} })
    },
    put (url) { requests.push(['PUT', url]); return Promise.resolve({ status: 200 }) },
    post (url) { requests.push(['POST', url]); return Promise.resolve({ status: 200, data: {} }) },
    delete (url) { requests.push(['DELETE', url]); return Promise.resolve({ status: 200 }) }
  }
  instance.$watch = () => () => {}
  instance.$nextTick = (cb) => Promise.resolve().then(cb)
  instance.$forceUpdate = () => {}
  instance.$vuetify = { theme: { dark: false, themes: { dark: { primary: '' }, light: { primary: '' } } } }
  instance.requests = requests

  noiseModule.created.call(instance)

  for (const id of new Set(SAMPLES.map(s => s.id))) {
    instance.players.add(id, makeBuffer())
  }

  instance.selectedProfile = { id: 1, text: 'Normal' }
  instance.activeProfile = PROFILES[0]
  instance.recordedProfile = { id: 2, text: 'Recorded' }
  instance.recordingFileName = 'e2e-test'
  instance.loadedSamples = JSON.parse(JSON.stringify(SAMPLES))

  return instance
}

const liveNodes = () => track.nodes.filter(node => !node.__disposed)
const createdSince = index => track.nodes.slice(index)
const liveCreatedSince = index => createdSince(index).filter(node => !node.__disposed)
const liveKind = kind => liveNodes().filter(node => node.__kind === kind)

function pathExists (from, to, visited = new Set()) {
  if (from === to) {
    return true
  }
  if (visited.has(from)) {
    return false
  }
  visited.add(from)
  return (from.__connections || []).some(next => pathExists(next, to, visited))
}

function feedsRecorder (nodes, recorders) {
  return nodes.some(node => recorders.some(recorder => pathExists(node, recorder)))
}

async function stopEverything (component) {
  try {
    if (component.isRecording || component.recordingStarting) {
      await component.cancelRecording()
    } else if (typeof component.stop === 'function') {
      component.stop()
    }
  } catch (e) {
    // Ignore cleanup errors in the harness.
  }

  // Give the recorder/timer teardown a moment to settle before the next
  // scenario builds its own graph.
  await sleep(300)
}

async function run () {
  await Tone.start()

  await check('recording captures audio and stays audible', async () => {
    const component = createComponent()
    const recordingStart = track.nodes.length

    await component.startRecording()
    await sleep(800)

    const recordingNodes = createdSince(recordingStart)
    const liveRecorders = liveKind('Recorder')
    assert(liveRecorders.length === 1, 'expected exactly one live recorder during recording, got ' + liveRecorders.length)

    const recorder = liveRecorders[0]
    const recordingNoise = recordingNodes.find(node => node.__kind === 'Noise' && !node.__disposed)
    assert(recordingNoise, 'no noise source is running during recording')
    assert(pathExists(recordingNoise, recorder), 'the noise source does not reach the recorder')
    assert(pathExists(recordingNoise, window.Tone.Destination), 'recording is not audible through the speakers')

    await stopEverything(component)
  })

  await check('Stop and Save downloads once and releases the recording graph', async () => {
    const component = createComponent()
    const intervalsAtRest = track.intervals.size
    const downloadsBefore = track.downloads.length
    const recordingStart = track.nodes.length

    await component.startRecording()
    await sleep(800)

    const recorder = liveKind('Recorder')[0]
    assert(recorder, 'no live recorder during recording')

    await component.stopRecording()
    await sleep(600)

    assert(track.downloads.length === downloadsBefore + 1,
      'Stop and Save should download exactly once, got ' + (track.downloads.length - downloadsBefore))
    assert(track.downloads[track.downloads.length - 1] === 'e2e-test.webm',
      'unexpected download name ' + track.downloads[track.downloads.length - 1])

    const leaked = liveCreatedSince(recordingStart)
    assert(leaked.length === 0, 'recording nodes were not released: ' + leaked.map(node => node.__kind).join(', '))
    assert(liveKind('Recorder').length === 0, 'a recorder is still alive after stopping')
    assert(!feedsRecorder(liveNodes(), [recorder]), 'audio is still routed into the stopped recorder')
    assert(track.intervals.size <= intervalsAtRest,
      'recording left ' + (track.intervals.size - intervalsAtRest) + ' timers behind')

    await stopEverything(component)
  })

  await check('playback after saving is clean and never reaches a recorder', async () => {
    const component = createComponent()

    await component.startRecording()
    await sleep(700)
    await component.stopRecording()
    await sleep(500)

    const playbackStart = track.nodes.length
    await component.play()
    await sleep(700)

    const playbackNodes = createdSince(playbackStart)
    const playbackNoise = playbackNodes.find(node => node.__kind === 'Noise' && !node.__disposed)
    assert(playbackNoise, 'playback did not start a noise source')
    assert(pathExists(playbackNoise, window.Tone.Destination), 'playback is not audible')

    // A recorder that is still alive would mean playback audio can still be
    // captured by it.
    assert(liveKind('Recorder').length === 0, 'playback keeps a recorder alive')

    const playbackReverbs = playbackNodes.filter(node => node.__kind === 'Reverb' && !node.__disposed)
    assert(playbackReverbs.length === 2, 'playback should build exactly two reverbs, got ' + playbackReverbs.length)

    await stopEverything(component)
  })

  await check('stopping playback releases its graph', async () => {
    const component = createComponent()
    const playbackStart = track.nodes.length

    await component.play()
    await sleep(500)
    component.stop()
    await sleep(500)

    const leaked = liveCreatedSince(playbackStart)
    assert(leaked.length === 0, 'playback nodes were not released: ' + leaked.map(node => node.__kind).join(', '))
  })

  await check('Cancel cleans up without downloading', async () => {
    const component = createComponent()
    const downloadsBefore = track.downloads.length
    const intervalsAtRest = track.intervals.size
    const cancelStart = track.nodes.length

    await component.startRecording()
    await sleep(800)
    await component.cancelRecording()
    await sleep(600)

    assert(track.downloads.length === downloadsBefore, 'Cancel must not download')
    const leaked = liveCreatedSince(cancelStart)
    assert(leaked.length === 0, 'nodes survived Cancel: ' + leaked.map(node => node.__kind).join(', '))
    assert(liveKind('Recorder').length === 0, 'a recorder is still alive after cancelling')
    assert(track.intervals.size <= intervalsAtRest,
      'Cancel left ' + (track.intervals.size - intervalsAtRest) + ' timers behind')
  })

  await check('playback after cancel is unaffected', async () => {
    const component = createComponent()

    await component.startRecording()
    await sleep(700)
    await component.cancelRecording()
    await sleep(500)

    const afterCancelStart = track.nodes.length
    await component.play()
    await sleep(600)

    assert(liveKind('Recorder').length === 0, 'a recorder leaked into playback after cancel')
    const reverbs = createdSince(afterCancelStart).filter(node => node.__kind === 'Reverb' && !node.__disposed)
    assert(reverbs.length === 2, 'playback after cancel should build exactly two reverbs, got ' + reverbs.length)

    await stopEverything(component)
  })

  await check('a second recording while one is running is rejected', async () => {
    const component = createComponent()
    const reentryStart = track.nodes.length

    await component.startRecording()
    await sleep(700)
    await component.startRecording()
    await sleep(400)

    const recorders = liveKind('Recorder')
    assert(recorders.length === 1, 'a second recording left ' + recorders.length + ' live recorders')

    await component.cancelRecording()
    await sleep(500)
    const leaked = liveCreatedSince(reentryStart)
    assert(leaked.length === 0, 'nodes from the re-entrant recording survived: ' + leaked.map(node => node.__kind).join(', '))
  })

  // Best-effort global cleanup so Chrome can exit promptly.
  try {
    window.Tone.Transport.stop()
  } catch (e) {
    // Already stopped.
  }

  window.__done = true
}

run().catch(error => {
  log.push('[harness] ' + (error && error.stack ? error.stack : String(error)))
  results.push({ name: 'harness crashed', ok: false, detail: String(error && error.message ? error.message : error) })
  window.__done = true
})
