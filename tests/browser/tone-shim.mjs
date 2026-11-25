// Re-exports the real Tone.js UMD build (loaded by index.html) as an ES module
// so the component's `import * as Tone from 'tone'` resolves to the actual
// library inside the browser.
//
// Each constructor is wrapped so the harness can observe the real nodes the
// component creates, their connections and whether they were disposed.

const tracking = window.__tracking

function register (instance, kind) {
  instance.__kind = kind
  instance.__connections = []
  instance.__disposed = false

  const connect = instance.connect.bind(instance)
  const disconnect = instance.disconnect.bind(instance)
  const dispose = instance.dispose.bind(instance)

  instance.connect = (destination, ...rest) => {
    const result = connect(destination, ...rest)
    if (!instance.__connections.includes(destination)) {
      instance.__connections.push(destination)
    }
    return result
  }

  instance.disconnect = (destination, ...rest) => {
    const result = disconnect(destination, ...rest)
    instance.__connections = destination
      ? instance.__connections.filter(node => node !== destination)
      : []
    return result
  }

  instance.dispose = (...args) => {
    instance.__disposed = true
    instance.__connections = []
    return dispose(...args)
  }

  tracking.nodes.push(instance)
  return instance
}

function wrap (kind) {
  const Original = window.Tone[kind]
  if (!Original) {
    return undefined
  }

  const Wrapped = function (...args) {
    return register(new Original(...args), kind)
  }
  Wrapped.prototype = Original.prototype

  // Mirror static members the component reads (e.g. Recorder.supported).
  Object.getOwnPropertyNames(Original).forEach(key => {
    if (key === 'length' || key === 'name' || key === 'prototype') {
      return
    }
    try {
      Wrapped[key] = Original[key]
    } catch (e) {
      // Non-writable static; skip it.
    }
  })

  return Wrapped
}

export const Noise = wrap('Noise')
export const Filter = wrap('Filter')
export const Tremolo = wrap('Tremolo')
export const LFO = wrap('LFO')
export const Reverb = wrap('Reverb')
export const Gain = wrap('Gain')
export const Player = wrap('Player')
export const Players = wrap('Players')
export const Recorder = wrap('Recorder')

export const Destination = window.Tone.Destination
export const Transport = window.Tone.Transport
export const start = (...args) => window.Tone.start(...args)
