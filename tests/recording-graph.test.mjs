// Runs the component's audio-graph lifecycle tests against a stubbed Tone.js.
//
// Usage: node tests/recording-graph.test.mjs
//
// The `tone` import inside src/components/noise.js is redirected to
// tests/tone-stub.mjs, so nothing here needs an AudioContext, speakers or a
// microphone, and no network access is used.

import { registerHooks } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import path from 'node:path'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const stubUrl = pathToFileURL(path.join(here, 'tone-stub.mjs')).href

// Redirect `import * as Tone from 'tone'` to the stub.
registerHooks({
  resolve (specifier, context, nextResolve) {
    if (specifier === 'tone') {
      return { url: stubUrl, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  }
})

const tone = await import(stubUrl)

const {
  installFakeTimers,
  installBrowserShims,
  createComponent,
  liveNodes,
  liveNodesOfKind,
  nodeOfKind,
  pathExists,
  assertNoLeaks,
  sample,
  profile
} = await import(pathToFileURL(path.join(here, 'harness.mjs')).href)

const noiseModule = (await import(pathToFileURL(path.join(here, '..', 'src', 'components', 'noise.js')).href)).default

const sleep = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms))

async function flush () {
  for (let i = 0; i < 8; i++) {
    await sleep(0)
  }
}

const tests = []
function test (name, fn) {
  tests.push({ name, fn })
}

// A profile with reverb, filter+LFO, tremolo and a sporadic sample: the path
// that previously left a Reverb/LFO/Tremolo attached to the Recorder.
function recordingProfiles () {
  return [
    profile(1, 'Normal', {
      samples: [
        sample(101, { reverbEnabled: true, reverbDecay: 2.5, playbackMode: 'continuous' }),
        sample(102, { reverbEnabled: false, playbackMode: 'sporadic', sporadicMin: 1, sporadicMax: 2 })
      ]
    }),
    profile(2, 'Recorded', {
      volume: -25,
      samples: [
        sample(101, { reverbEnabled: true, reverbDecay: 5, playbackMode: 'sporadic', sporadicMin: 1, sporadicMax: 3 })
      ]
    })
  ]
}

function setup () {
  tone.reset()
  const timers = installFakeTimers()
  const browser = installBrowserShims()
  const profiles = recordingProfiles()
  const component = createComponent(noiseModule, profiles)
  component.selectedProfile = { id: 1, text: 'Normal' }
  component.activeProfile = profiles[0]
  component.recordedProfile = { id: 2, text: 'Recorded' }
  component.recordingFileName = 'export'
  component.applyProfileToSettings(profiles[0])
  return { timers, browser, component }
}

// ---------------------------------------------------------------------------
// A1: playback builds a normal graph and tears it all down on stop.
// ---------------------------------------------------------------------------
test('normal playback builds source->effects->destination and tears everything down', async () => {
  const { timers, browser, component } = setup()

  try {
    await component.play()
    await flush()

    assert.ok(timers.activeCount() >= 1, 'sporadic sample schedules a timer')
    assert.equal(nodeOfKind(tone, 'Noise').length, 1, 'one noise source')
    assert.equal(nodeOfKind(tone, 'Filter').length, 1, 'one filter')
    assert.equal(nodeOfKind(tone, 'Tremolo').length, 1, 'one tremolo')
    assert.equal(nodeOfKind(tone, 'LFO').length, 1, 'one LFO')
    assert.equal(nodeOfKind(tone, 'Reverb').length, 1, 'one per-sample reverb')
    assert.equal(nodeOfKind(tone, 'Recorder').length, 0, 'no recorder during playback')

    const noise = nodeOfKind(tone, 'Noise')[0]
    const filter = nodeOfKind(tone, 'Filter')[0]
    assert.ok(pathExists(noise, filter), 'noise feeds the filter')
    assert.ok(pathExists(filter, tone.Destination), 'filter reaches the speakers')

    component.stop()
    await flush()

    assert.equal(timers.activeCount(), 0, 'no timers left after stop')
    assertNoLeaks(tone, 'after stop')
  } finally {
    timers.restore()
    browser.restore()
  }
})

// ---------------------------------------------------------------------------
// A1: recording graph goes through the record bus; after Stop and Save the
//     recording nodes are gone and only normal playback remains.
// ---------------------------------------------------------------------------
test('Stop and Save disposes the recording graph, then playback has no residue', async () => {
  const { timers, browser, component } = setup()

  try {
    await component.startRecording()
    await flush()

    assert.equal(component.isRecording, true, 'recording state is set')

    const recorder = nodeOfKind(tone, 'Recorder')[0]
    assert.ok(recorder, 'a recorder was created')

    const recordBus = nodeOfKind(tone, 'Gain').find(gain => gain.connections.includes(recorder))
    assert.ok(recordBus, 'recording audio is routed through a record bus')
    assert.ok(recordBus.connections.includes(tone.Destination), 'the record bus also keeps a monitor output')

    const recordingNoise = nodeOfKind(tone, 'Noise')[0]
    const recordingReverb = nodeOfKind(tone, 'Reverb')[0]
    assert.ok(pathExists(recordingNoise, recorder), 'noise reaches the recorder')
    assert.ok(pathExists(recordingReverb, recorder), 'the sample reverb reaches the recorder')
    assert.ok(pathExists(recordingNoise, tone.Destination), 'noise is also audible')

    const recorderNode = recorder
    const reverbNode = recordingReverb

    await component.stopRecording()
    await flush()

    assert.equal(component.isRecording, false, 'recording state is cleared')
    assert.equal(nodeOfKind(tone, 'Recorder').length, 1)
    assert.equal(recorderNode.disposed, true, 'the recorder is disposed')
    assert.equal(recorderNode.startCalls, 1)
    assert.equal(recorderNode.stopCalls, 1)
    assert.equal(reverbNode.disposed, true, 'the recording reverb is disposed')
    assert.deepEqual(recorderNode.connections, [], 'nothing is still connected to the recorder')
    assert.equal(timers.activeCount(), 0, 'recording timers are cleared')

    assertNoLeaks(tone, 'after stopRecording')

    // The download fires only for the save path.
    assert.deepEqual(browser.downloads, ['export.webm'], 'saving downloads a webm file')

    // Now play normally: exactly one graph, nothing feeding a recorder.
    await component.play()
    await flush()

    assert.equal(nodeOfKind(tone, 'Noise').length, 2, 'one noise from the aborted recording + one for playback')
    assert.equal(liveNodesOfKind(tone, 'Recorder').length, 0, 'no live recorder during playback')
    assert.equal(liveNodesOfKind(tone, 'Reverb').length, 1, 'exactly one live reverb in playback')
    assert.equal(liveNodesOfKind(tone, 'Tremolo').length, 1, 'exactly one live tremolo in playback')
    assert.equal(liveNodesOfKind(tone, 'LFO').length, 1, 'exactly one live LFO in playback')

    const playbackNoise = liveNodesOfKind(tone, 'Noise')[0]
    assert.ok(!pathExists(playbackNoise, recorderNode), 'playback audio never reaches the old recorder')
    assert.ok(pathExists(playbackNoise, tone.Destination), 'playback is audible')

    component.stop()
    await flush()
    assert.equal(timers.activeCount(), 0, 'no timers after stopping playback')
    assertNoLeaks(tone, 'after final stop')
  } finally {
    timers.restore()
    browser.restore()
  }
})

// ---------------------------------------------------------------------------
// A2: Cancel must not download, and must clean up as thoroughly as Save.
// ---------------------------------------------------------------------------
test('Cancel recording does not download and cleans up the graph and timers', async () => {
  const { timers, browser, component } = setup()

  try {
    await component.startRecording()
    await flush()

    const recorder = nodeOfKind(tone, 'Recorder')[0]
    assert.ok(recorder, 'a recorder was created')

    await component.cancelRecording()
    await flush()

    assert.equal(browser.downloads.length, 0, 'cancel never triggers a download')
    assert.equal(recorder.disposed, true, 'the recorder is disposed on cancel')
    assert.equal(recorder.stopCalls, 1, 'the recorder was stopped once')
    assert.deepEqual(recorder.connections, [], 'nothing is connected to the recorder after cancel')
    assert.equal(timers.activeCount(), 0, 'all timers cleared on cancel')
    assertNoLeaks(tone, 'after cancelRecording')

    // Playback still works right after cancelling.
    await component.play()
    await flush()
    assert.equal(liveNodesOfKind(tone, 'Recorder').length, 0, 'no recorder for normal playback')
    component.stop()
    await flush()
    assertNoLeaks(tone, 'after playback following cancel')
  } finally {
    timers.restore()
    browser.restore()
  }
})

// ---------------------------------------------------------------------------
// A3: sporadic intervals created during recording are cleared on stop.
// ---------------------------------------------------------------------------
test('recording clears initialSporadicPlayInterval and sporadicInterval', async () => {
  const { timers, browser, component } = setup()

  try {
    await component.startRecording()
    await flush()

    const recordedSamples = component.loadedSamples
    assert.equal(recordedSamples.length, 1)

    const initial = recordedSamples[0].initialSporadicPlayInterval
    assert.ok(initial, 'the sporadic sample has an initial interval')
    assert.ok(timers.activeIds().includes(initial), 'the initial interval is live')

    // Fire the initial interval once so playSporadicSample creates the
    // follow-up sporadicInterval too.
    timers.fire(initial)
    await flush()

    const recurring = recordedSamples[0].sporadicInterval
    assert.ok(recurring, 'a follow-up sporadic interval exists after the first sample')

    await component.stopRecording()
    await flush()

    assert.equal(recordedSamples[0].initialSporadicPlayInterval, null, 'initial interval handle is nulled')
    assert.equal(recordedSamples[0].sporadicInterval, null, 'recurring interval handle is nulled')
    assert.equal(timers.activeCount(), 0, 'no sporadic timers survive the recording')
  } finally {
    timers.restore()
    browser.restore()
  }
})

// ---------------------------------------------------------------------------
// A4: re-entrant recording / switching profiles mid-recording is rejected.
// ---------------------------------------------------------------------------
test('starting a second recording while one is running is a no-op', async () => {
  const { timers, browser, component } = setup()

  try {
    await component.startRecording()
    await flush()

    const beforeNoise = nodeOfKind(tone, 'Noise').length
    const beforeRecorders = nodeOfKind(tone, 'Recorder').length

    await component.startRecording()
    await flush()

    assert.equal(nodeOfKind(tone, 'Noise').length, beforeNoise, 'no second source graph was created')
    assert.equal(nodeOfKind(tone, 'Recorder').length, beforeRecorders, 'no second recorder was created')

    await component.stopRecording()
    await flush()
    assertNoLeaks(tone, 'after stopping the single recording')
  } finally {
    timers.restore()
    browser.restore()
  }
})

test('switching profiles while recording is refused without touching the graph', async () => {
  const { timers, browser, component } = setup()

  try {
    await component.startRecording()
    await flush()

    const liveBefore = liveNodes(tone).length
    component.selectedProfile = { id: 1, text: 'Normal' }
    component.loadProfile(false)
    await flush()

    assert.equal(liveNodes(tone).length, liveBefore, 'the recording graph is untouched')
    assert.equal(component.isRecording, true, 'recording continues')

    await component.cancelRecording()
    await flush()
    assertNoLeaks(tone, 'after cancel following refused profile switch')
  } finally {
    timers.restore()
    browser.restore()
  }
})

// ---------------------------------------------------------------------------
// A5: the pre-recording profile is restored; existing profile is saved first.
// ---------------------------------------------------------------------------
test('recording saves the current profile first and restores it afterwards', async () => {
  const { timers, browser, component } = setup()

  try {
    component.volume = -33
    await component.startRecording()
    await flush()

    assert.ok(
      component.requests.some(([method, url]) => method === 'PUT' && url === '/profiles/1'),
      'the current profile is saved before recording'
    )

    await component.cancelRecording()
    await flush()

    assert.equal(component.volume, -33, 'the pre-recording settings are restored')
    assert.equal(component.isFilterEnabled, true)
    assert.equal(component.isLFOFilterCutoffEnabled, true)
    assert.equal(component.isTremoloEnabled, true)

    // Playback after the recording uses the restored profile settings.
    await component.play()
    await flush()
    assert.equal(component.volume, -33)
    assert.equal(liveNodesOfKind(tone, 'Recorder').length, 0)

    component.stop()
    await flush()
    assertNoLeaks(tone, 'after playback with restored profile')
  } finally {
    timers.restore()
    browser.restore()
  }
})

// ---------------------------------------------------------------------------
// A1 extras: the "Stop" button during a recording is a deterministic abort.
// ---------------------------------------------------------------------------
test('pressing Stop during a recording aborts it without downloading', async () => {
  const { timers, browser, component } = setup()

  try {
    await component.startRecording()
    await flush()

    component.stop()
    await flush()

    assert.equal(browser.downloads.length, 0, 'Stop does not download')
    assert.equal(component.isRecording, false)
    assert.equal(timers.activeCount(), 0)
    assertNoLeaks(tone, 'after Stop during recording')
  } finally {
    timers.restore()
    browser.restore()
  }
})

// ---------------------------------------------------------------------------
// Boundary: cancel pressed during the async start (before isRecording is set).
// ---------------------------------------------------------------------------
test('cancel during the async start aborts cleanly', async () => {
  const { timers, browser, component } = setup()

  try {
    const started = component.startRecording()
    // Give startRecording a tick to enter the starting state, then cancel.
    await flush()
    await component.cancelRecording()
    await started
    await flush()

    assert.equal(browser.downloads.length, 0, 'no download from an aborted start')
    assert.equal(component.isRecording, false)
    assert.equal(liveNodesOfKind(tone, 'Recorder').length, 0, 'no recorder survives the aborted start')
    assert.equal(timers.activeCount(), 0, 'no timers survive the aborted start')
    assertNoLeaks(tone, 'after aborted start')
  } finally {
    timers.restore()
    browser.restore()
  }
})

// ---------------------------------------------------------------------------
// Regression: playback -> recording -> playback repeatedly leaves no residue.
// ---------------------------------------------------------------------------
test('repeated play/record/play cycles never accumulate nodes', async () => {
  const { timers, browser, component } = setup()

  try {
    for (let i = 0; i < 3; i++) {
      await component.play()
      await flush()
      component.stop()
      await flush()

      await component.startRecording()
      await flush()
      await component.stopRecording()
      await flush()

      const liveRecorders = liveNodesOfKind(tone, 'Recorder')
      assert.deepEqual(liveRecorders, [], `cycle ${i}: no live recorder`)

      const liveReverbs = liveNodesOfKind(tone, 'Reverb')
      assert.deepEqual(liveReverbs, [], `cycle ${i}: no live reverb between sessions`)

      assert.equal(timers.activeCount(), 0, `cycle ${i}: no timers between sessions`)
    }
  } finally {
    timers.restore()
    browser.restore()
  }
})

// ---------------------------------------------------------------------------
// Runner.
// ---------------------------------------------------------------------------
let failures = 0
for (const { name, fn } of tests) {
  try {
    await fn()
    console.log(`ok   - ${name}`)
  } catch (error) {
    failures++
    console.error(`FAIL - ${name}`)
    console.error(error)
  }
}

if (failures > 0) {
  console.error(`\n${failures} of ${tests.length} tests failed`)
  process.exit(1)
}

console.log(`\n${tests.length} tests passed`)
