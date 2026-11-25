// Test harness for the audio graph lifecycle in src/components/noise.js.
//
// The Tone.js module is replaced by tests/tone-stub.mjs (see the loader hook in
// recording-graph.test.mjs), so these tests run in plain Node with no
// AudioContext, sound card or microphone.

import assert from 'node:assert/strict'
import * as Tone from './tone-stub.mjs'

// ---------------------------------------------------------------------------
// Fake timers: intervals are recorded but never fire on their own, so tests
// can assert exactly which timers exist and fire them deterministically.
// ---------------------------------------------------------------------------
export function installFakeTimers () {
  const realSetInterval = globalThis.setInterval
  const realClearInterval = globalThis.clearInterval
  const timers = new Map()
  let nextId = 1

  globalThis.setInterval = (fn, delay) => {
    const id = nextId++
    timers.set(id, { fn, delay, cleared: false })
    return id
  }

  globalThis.clearInterval = (id) => {
    if (id === undefined || id === null) {
      return
    }
    const timer = timers.get(id)
    if (timer) {
      timer.cleared = true
    }
    timers.delete(id)
  }

  return {
    activeIds: () => Array.from(timers.keys()),
    activeCount: () => timers.size,
    fire (id) {
      const timer = timers.get(id)
      if (timer && !timer.cleared) {
        timer.fn()
      }
    },
    fireAll () {
      for (const [id, timer] of Array.from(timers.entries())) {
        if (!timer.cleared && timers.has(id)) {
          timer.fn()
        }
      }
    },
    restore () {
      globalThis.setInterval = realSetInterval
      globalThis.clearInterval = realClearInterval
    }
  }
}

// ---------------------------------------------------------------------------
// Browser shims used by the download path.
// ---------------------------------------------------------------------------
export function installBrowserShims () {
  const downloads = []
  const revoked = []

  const originalURL = globalThis.URL
  const originalDocument = globalThis.document

  globalThis.URL = Object.assign(() => {}, originalURL, {
    createObjectURL: () => 'blob:recording',
    revokeObjectURL: (url) => revoked.push(url)
  })

  globalThis.document = {
    createElement: () => ({
      setAttribute () {},
      click () { downloads.push(this.download) },
      remove () {},
      download: ''
    }),
    body: { appendChild () {} }
  }

  return {
    downloads,
    revoked,
    restore () {
      globalThis.URL = originalURL
      globalThis.document = originalDocument
    }
  }
}

// ---------------------------------------------------------------------------
// Component factory: builds an object with the real component methods, data
// defaults and a stubbed HTTP layer.
// ---------------------------------------------------------------------------
export function createComponent (module, profiles) {
  const instance = Object.assign({}, module.data())

  Object.assign(instance, module.methods)

  // Computed property used when registering the unsaved-work watcher.
  Object.defineProperty(instance, 'changeableSettings', {
    get () {
      return [instance.volume, instance.isFilterEnabled, instance.loadedSamples]
    }
  })

  const requests = []
  const watchers = []

  instance.$http = {
    get (url) {
      requests.push(['GET', url])
      if (url === '/profiles') {
        return Promise.resolve({ status: 200, data: { profiles: profiles.map(p => ({ id: p.id, text: p.name })) } })
      }
      const match = url.match(/^\/profiles\/(\d+)$/)
      if (match) {
        const profile = profiles.find(p => String(p.id) === match[1])
        if (!profile) {
          return Promise.reject(new Error('not found'))
        }
        return Promise.resolve({ status: 200, data: { profile: JSON.parse(JSON.stringify(profile)) } })
      }
      return Promise.resolve({ status: 200, data: {} })
    },
    put (url) {
      requests.push(['PUT', url])
      return Promise.resolve({ status: 200 })
    },
    post (url) {
      requests.push(['POST', url])
      return Promise.resolve({ status: 200, data: {} })
    },
    delete (url) {
      requests.push(['DELETE', url])
      return Promise.resolve({ status: 200 })
    }
  }

  instance.$watch = (path, cb) => {
    const watcher = { path, cb }
    watchers.push(watcher)
    return () => {
      const index = watchers.indexOf(watcher)
      if (index !== -1) {
        watchers.splice(index, 1)
      }
    }
  }

  instance.$nextTick = (cb) => Promise.resolve().then(cb)
  instance.$forceUpdate = () => {}

  instance.requests = requests
  instance.watchers = watchers

  // Initialise the audio state the same way the component's `created()` hook
  // does, but without its HTTP calls so tests stay deterministic.
  instance.players = new Tone.Players()
  instance.samplePreviewPlayer = new Tone.Player({}).toDestination()
  instance.samplePreviewPlayer.loop = true
  instance.noise = null
  instance.filter = null
  instance.tremolo = null
  instance.lfo = null
  instance.recorder = null
  instance.recordBus = null
  instance.sampleReverbs = []
  instance.activePlayerIds = []
  instance.sessionSamples = null
  instance.sporadicTimers = new Set()
  instance.playbackActive = false
  instance.transportInterval = null
  instance.timeRemainingInterval = null
  instance.recordingInterval = null
  instance.recordingSession = 0
  instance.recordingStartToken = null
  instance.preRecordingSettings = null
  instance.graphTarget = null

  // The Players container normally gets its buffers from /samples; register
  // the sample ids used by the profiles so players.player(id) works.
  const ids = new Set()
  profiles.forEach(profile => profile.samples.forEach(sample => ids.add(sample.id)))
  ids.forEach(id => instance.players.add(id))
  instance.mainPlayLoading = false

  return instance
}

// ---------------------------------------------------------------------------
// Graph assertions.
// ---------------------------------------------------------------------------
export function liveNodes (tone) {
  return tone.created.filter(node => !node.disposed)
}

export function nodeOfKind (tone, kind) {
  return tone.created.filter(node => node.kind === kind)
}

export function liveNodesOfKind (tone, kind) {
  return nodeOfKind(tone, kind).filter(node => !node.disposed)
}

export function incoming (tone, node) {
  return tone.created.filter(candidate => candidate.connections.includes(node))
}

export function pathExists (from, to, visited = new Set()) {
  if (from === to) {
    return true
  }
  if (visited.has(from)) {
    return false
  }
  visited.add(from)
  return from.connections.some(next => pathExists(next, to, visited))
}

// Long-lived containers that exist for the whole component lifetime and are
// only released in beforeDestroy(); they are not per-session graph nodes.
const PERSISTENT_KINDS = new Set(['Destination', 'Players', 'Player'])

export function assertNoLeaks (tone, label) {
  const leaked = liveNodes(tone).filter(node => !PERSISTENT_KINDS.has(node.kind))
  assert.deepEqual(
    leaked.map(node => `${node.kind}${node.name ? ':' + node.name : ''}`),
    [],
    `${label}: every graph node should be disposed`
  )
}

// Fixture profiles.
export function sample (id, overrides = {}) {
  return Object.assign({
    id,
    name: 'sample-' + id,
    user: 'user',
    volume: -10,
    fadeIn: 0,
    loopPointsEnabled: false,
    loopStart: 0,
    loopEnd: 0,
    reverbEnabled: false,
    reverbPreDelay: 0.01,
    reverbDecay: 1.5,
    reverbWet: 0.5,
    playbackMode: 'continuous',
    sporadicMin: 1,
    sporadicMax: 2
  }, overrides)
}

export function profile (id, name, overrides = {}) {
  return Object.assign({
    id,
    name,
    isTimerEnabled: false,
    duration: 30,
    volume: -10,
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
