// A minimal, dependency-free stand-in for Tone.js used by the audio-graph
// tests. It records every node that is created, what it is connected to, and
// whether it was disposed, so the tests can assert that the playback and
// recording graphs are built and torn down completely — without an
// AudioContext, a sound card or a microphone.

export const created = []
export const receivers = []

function track (node, kind) {
  node.kind = kind
  node.connections = []
  node.disposed = false
  created.push(node)
  return node
}

class BaseNode {
  constructor (kind) {
    track(this, kind)
    this.started = false
    this.stopped = false
  }

  connect (destination) {
    if (destination && !this.connections.includes(destination)) {
      this.connections.push(destination)
    }
    return this
  }

  toDestination () {
    return this.connect(Destination)
  }

  disconnect (destination) {
    if (destination) {
      this.connections = this.connections.filter(node => node !== destination)
    } else {
      this.connections = []
    }
    return this
  }

  dispose () {
    this.disposed = true
    this.connections = []
    return this
  }
}

class SourceNode extends BaseNode {
  constructor (kind, options = {}) {
    super(kind)
    this.volume = { value: options.volume !== undefined ? options.volume : 0 }
    this.type = options.type
    this._synced = false
    this.syncArgs = null
    this.state = 'stopped'
  }

  sync () {
    this._synced = true
    return this
  }

  unsync () {
    this._synced = false
    this.syncArgs = null
    return this
  }

  start (...args) {
    this.started = true
    this.state = 'started'
    this.syncArgs = args
    return this
  }

  stop (...args) {
    this.stopped = true
    this.state = 'stopped'
    this.stopArgs = args
    return this
  }
}

export class Noise extends SourceNode {
  constructor (options = {}) {
    super('Noise', options)
    this.name = 'Noise'
  }
}

export class Filter extends BaseNode {
  constructor (frequency, type) {
    super('Filter')
    this.frequency = { value: frequency }
    this.type = type
  }

  set (options) {
    Object.assign(this, options)
    return this
  }
}

export class Tremolo extends BaseNode {
  constructor (options = {}) {
    super('Tremolo')
    this.options = options
    this.state = 'stopped'
  }

  start () {
    this.started = true
    this.state = 'started'
    return this
  }

  stop () {
    this.stopped = true
    this.state = 'stopped'
    return this
  }

  set (options) {
    Object.assign(this.options, options)
    return this
  }
}

export class LFO extends BaseNode {
  constructor (options = {}) {
    super('LFO')
    this.options = options
    this.state = 'stopped'
  }

  start () {
    this.started = true
    this.state = 'started'
    return this
  }

  stop () {
    this.stopped = true
    this.state = 'stopped'
    return this
  }

  set (options) {
    Object.assign(this.options, options)
    return this
  }
}

export class Reverb extends BaseNode {
  constructor (decay) {
    super('Reverb')
    this.decay = decay
  }

  set (options) {
    Object.assign(this, options)
    return this
  }

  get ready () {
    return Promise.resolve(this)
  }
}

export class Gain extends BaseNode {
  constructor (value = 1) {
    super('Gain')
    this.gain = { value }
  }
}

export class Player extends SourceNode {
  constructor (options = {}) {
    super('Player', options)
    this.buffer = { duration: 10 }
    this.loop = false
    this.fadeIn = 0
    this.loopPoints = [0, 0]
    this._state = 'stopped'
    this.url = options.url
  }

  setLoopPoints (start, end) {
    this.loopPoints = [start, end]
    return this
  }

  get state () {
    return this._state
  }

  set state (value) {
    this._state = value
  }

  start (...args) {
    this.started = true
    this._state = 'started'
    this.syncArgs = args
    return this
  }

  stop (...args) {
    this.stopped = true
    this._state = 'stopped'
    this.stopArgs = args
    return this
  }
}

export class Players extends BaseNode {
  constructor () {
    super('Players')
    this._players = new Map()
    this._buffers = new Set()
    this.output = this
  }

  get loaded () {
    return true
  }

  has (name) {
    return this._buffers.has(name)
  }

  add (name) {
    this._buffers.add(name)
    return this
  }

  player (name) {
    if (!this._players.has(name)) {
      const player = new Player({})
      player.name = name
      this._players.set(name, player)
    }
    return this._players.get(name)
  }

  stopAll () {
    this._players.forEach(player => player.stop())
    return this
  }

  dispose () {
    this._players.forEach(player => player.dispose())
    return super.dispose()
  }
}

export class Recorder extends BaseNode {
  constructor () {
    super('Recorder')
    this.name = 'Recorder'
    this._state = 'stopped'
    this.startCalls = 0
    this.stopCalls = 0
    receivers.push(this)
  }

  static get supported () {
    return true
  }

  get state () {
    return this._state
  }

  start () {
    this.startCalls++
    this._state = 'started'
    return Promise.resolve()
  }

  stop () {
    this.stopCalls++
    this._state = 'stopped'
    return Promise.resolve({ size: 1024, mimeType: 'audio/webm' })
  }
}

export const Destination = track(new BaseNode('Destination'), 'Destination')

export const Transport = {
  state: 'stopped',
  loopEnd: 0,
  seconds: 0,
  cancelCalls: 0,
  start (time) {
    this.state = 'started'
    this.startArgs = time
    return this
  },
  stop () {
    this.state = 'stopped'
    return this
  },
  cancel () {
    this.cancelCalls++
    return this
  }
}

export function start () {
  return Promise.resolve()
}

export function reset () {
  created.length = 0
  receivers.length = 0
  Transport.state = 'stopped'
  Transport.loopEnd = 0
  Transport.seconds = 0
  Transport.cancelCalls = 0
  Destination.connections = []
  Destination.disposed = false
  created.push(Destination)
}
