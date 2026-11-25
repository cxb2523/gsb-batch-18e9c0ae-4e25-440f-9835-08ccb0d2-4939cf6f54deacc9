import assert from 'node:assert/strict'
import { afterEach, beforeEach, mock, test } from 'node:test'

const elements = new Set()
const frames = []
const observers = []
const loseContext = mock.fn()
// A restored WebGL context is a brand-new object with empty call history; each
// context (re)creation therefore returns a fresh mock, and getContext hands out
// the current one while a context is alive.
const makeGL = () => {
  const locations = new Map()
  return new Proxy({
    // Real contexts hand back a stable location object per uniform name.
    getUniformLocation: mock.fn((program, name) => {
      if (!locations.has(name)) locations.set(name, { name })
      return locations.get(name)
    }),
    getExtension: mock.fn(() => ({ loseContext })),
  }, {
    get: (target, key) => {
      if (key in target) return target[key]
      const value = /^[A-Z_]+$/.test(key)
        ? 1
        : mock.fn(() => key.includes('InfoLog') ? '' : {})
      target[key] = value
      return value
    },
  })
}
let gl = makeGL()
class Element {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase()
    this.parentElement = null
    this.clientWidth = 640
    this.clientHeight = 480
    // Plain data properties would swallow strict-mode assignments; model the
    // real canvas accessors so backing-store writes are observable.
    this.#width = 0
    this.#height = 0
    this.contextLost = false
    this.listeners = new Map()
    elements.add(this)
  }
  #width
  #height
  get width() { return this.#width }
  set width(value) { this.#width = value }
  get height() { return this.#height }
  set height(value) { this.#height = value }
  get isConnected() {
    return this === document.body || Boolean(this.parentElement?.isConnected)
  }
  appendChild(child) {
    child.parentElement = this
    return child
  }
  remove() { this.parentElement = null }
  addEventListener(type, handler, options = {}) {
    const entries = this.listeners.get(type) ?? []
    entries.push({ handler, signal: options.signal ?? null })
    this.listeners.set(type, entries)
  }
  dispatchEvent(type, event) {
    for (const entry of this.listeners.get(type) ?? []) {
      if (entry.signal?.aborted) continue
      entry.handler.call(this, event)
    }
  }
  getContext() { return this.contextLost ? null : gl }
}
const matches = (element, selector) => {
  const [tag, id] = selector.split('#')
  const tagOk = !tag || element.tagName === tag.toUpperCase()
  const idOk = !selector.includes('#') || element.id === id
  return element.isConnected && tagOk && idOk
}
globalThis.document = {
  createElement: tag => new Element(tag),
  querySelector: selector => [...elements].find(element => matches(element, selector)),
  querySelectorAll: selector => [...elements].filter(element => matches(element, selector)),
}
document.body = new Element('body')
globalThis.window = {}
globalThis.requestAnimationFrame = frame => frames.push(frame)
globalThis.ResizeObserver = class {
  constructor(callback) {
    this.callback = callback
    this.disconnected = false
    observers.push(this)
  }
  observe(canvas) {
    this.canvas = canvas
    this.fire()
  }
  fire() {
    if (this.disconnected) return
    this.callback([{
      contentBoxSize: [{
        inlineSize: this.canvas.clientWidth,
        blockSize: this.canvas.clientHeight,
      }],
    }])
  }
  disconnect() { this.disconnected = true }
}
const { default: gradientGL } = await import('../index.js')
const mount = (id = 'meeting-gradient', tag = 'main') => document.body.appendChild(
  Object.assign(new Element(tag), { id }),
)
const canvas = () => document.querySelector('#gradient-gl')
const tick = () => frames.splice(0).map(frame => frame())
const tickAt = now => frames.splice(0).map(frame => frame(now))
const emitLost = element => {
  element.contextLost = true
  const event = {
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true },
  }
  element.dispatchEvent('webglcontextlost', event)
  return event.defaultPrevented
}
const emitRestored = element => {
  gl = makeGL()
  element.contextLost = false
  element.dispatchEvent('webglcontextrestored', {})
}
beforeEach(() => mount())
afterEach(async () => {
  const program = await gradientGL('c1.915c')
  program.destroy()
  frames.splice(0)
  elements.clear()
  observers.length = 0
})

test('same shader and target reuses a live program and updates seed', async () => {
  const program = await gradientGL('c1.915c', '#meeting-gradient')
  const calls = gl.uniform1iv.mock.callCount()
  assert.equal(await gradientGL('c1.a15c', '#meeting-gradient'), program)
  assert.equal(gl.uniform1iv.mock.callCount(), calls + 1)
  assert.equal(canvas().parentElement.id, 'meeting-gradient')
})

;['c1.915c', 'c1.a15c'].map(seed => test(`destroy then boot ${seed} recreates`, async () => {
  const program = await gradientGL('c1.915c', '#meeting-gradient')
  const oldCanvas = canvas()
  program.destroy()
  const next = await gradientGL(seed, '#meeting-gradient')
  assert.notEqual(next, program)
  assert.notEqual(canvas(), oldCanvas)
  assert.ok(canvas().isConnected)
  program.destroy()
  assert.equal(await gradientGL(seed, '#meeting-gradient'), next)
}))

;['replaced container', 'different target', 'detached canvas'].map(scenario =>
  test(`${scenario} recreates the same shader`, async () => {
    const program = await gradientGL('c1.915c', '#meeting-gradient')
    const oldCanvas = canvas()
    const selector = scenario === 'different target' ? '#other' : '#meeting-gradient'
    if (scenario === 'replaced container') document.querySelector(selector).remove()
    if (scenario === 'detached canvas') oldCanvas.remove()
    if (scenario !== 'detached canvas') mount(selector.slice(1))
    const next = await gradientGL('c1.915c', selector)
    assert.notEqual(next, program)
    assert.notEqual(canvas(), oldCanvas)
    assert.equal(canvas().parentElement, document.querySelector(selector))
    assert.equal(document.querySelectorAll('#gradient-gl').length, 1)
  }),
)

test('direct canvas identity controls reuse', async () => {
  const first = mount('first', 'canvas')
  const program = await gradientGL('c1.915c', '#first')
  assert.equal(await gradientGL('c1.a15c', '#first'), program)
  const second = mount('second', 'canvas')
  assert.notEqual(await gradientGL('c1.915c', '#second'), program)
  assert.ok(second.isConnected)
  assert.ok(first.isConnected)
})

test('generated canvas can become the direct target when switching shaders', async () => {
  const program = await gradientGL('c1.915c')
  const target = canvas()
  const next = await gradientGL('b1.915c', '#gradient-gl')
  tick()
  assert.notEqual(next, program)
  assert.ok(next.isMounted(target))
})

test('shader switch preserves the requested caller-owned canvas', async () => {
  const target = mount('target', 'canvas')
  const program = await gradientGL('c1.915c', '#target')
  const next = await gradientGL('b1.915c', '#target')
  assert.notEqual(next, program)
  tick()
  assert.ok(next.isMounted(target))
  next.destroy()
  assert.ok(target.isConnected)
  assert.notEqual(await gradientGL('b1.915c', '#target'), next)
})

;['destroyed', 'detached'].map(state => test(`${state} stops drawing and scheduling`, async () => {
  const program = await gradientGL('c1.915c', '#meeting-gradient')
  tick()
  const calls = gl.drawArrays.mock.callCount()
  const lost = loseContext.mock.callCount()
  if (state === 'destroyed') program.destroy()
  if (state === 'detached') canvas().remove()
  tick()
  assert.equal(gl.drawArrays.mock.callCount(), calls)
  assert.equal(frames.length, 0)
  assert.equal(loseContext.mock.callCount(), lost + 1)
  program.destroy()
}))

test('owned canvas style stays overrideable', async () => {
  await gradientGL('c1.915c')
  assert.equal(canvas().style.includes('!important'), false)
  assert.match(canvas().style, /z-index:-1/)
})

test('canvas query uses that canvas', async () => {
  const target = mount('gradient', 'canvas')
  await gradientGL('c1.915c', 'canvas#gradient')
  assert.equal(target.id, 'gradient')
  assert.equal(target.style, undefined)
  assert.equal(document.querySelectorAll('#gradient-gl').length, 0)
})

test('unsized canvas gets minimum size', async () => {
  const target = mount('gradient', 'canvas')
  target.clientWidth = 0
  target.clientHeight = 0
  target.style = { width: '', height: '' }
  await gradientGL('c1.915c', 'canvas#gradient')
  assert.equal(target.style.width, '100%')
  assert.equal(target.style.height, '100%')
  assert.equal(target.id, 'gradient')
})

test('resolution is set when the buffer already matches', async () => {
  const target = mount('gradient', 'canvas')
  target.width = target.clientWidth
  target.height = target.clientHeight
  await gradientGL('c1.915c', 'canvas#gradient')
  tick()
  const hit = gl.uniform3f.mock.calls.some(call =>
    call.arguments[1] === target.width && call.arguments[2] === target.height)
  assert.equal(hit, true)
})

test('caller canvas destroy keeps the live context', async () => {
  const target = mount('target', 'canvas')
  const program = await gradientGL('c1.915c', '#target')
  const lost = loseContext.mock.callCount()
  program.destroy()
  assert.equal(loseContext.mock.callCount(), lost)
  assert.ok(target.isConnected)
})

// ---------------------------------------------------------------------------
// WebGL context loss / restoration
// ---------------------------------------------------------------------------

test('context loss freezes frames and restore resumes the accumulated timeline', async () => {
  const target = mount('target', 'canvas')
  const program = await gradientGL('c1.915c', '#target')
  const lostGL = gl
  const iTimeLocation = lostGL.getUniformLocation.mock.calls
    .filter(call => call.arguments[1] === 'iTime').at(-1).result
  const iTimeValues = context => context.uniform1f.mock.calls
    .filter(call => call.arguments[0] === iTimeLocation)
    .map(call => call.arguments[1])

  // Drive the loop with explicit timestamps: elapsed reaches 100ms (iTime 0.1).
  tickAt(0)
  tickAt(50)
  tickAt(100)
  const timeAtLoss = iTimeValues(lostGL).at(-1)
  assert.ok(Math.abs(timeAtLoss - 0.1) < Number.EPSILON)
  const drawsAtLoss = lostGL.drawArrays.mock.callCount()
  assert.equal(frames.length, 1)

  // Loss is preventDefault-ed (so the browser will restore it), stops the loop
  // immediately, and the program still counts as mounted while waiting.
  assert.equal(emitLost(target), true)
  assert.equal(program.isMounted(target), true)
  assert.equal(target.width, 0)
  tickAt(200) // the already-scheduled frame must die without rescheduling
  assert.equal(frames.length, 0)
  assert.equal(lostGL.drawArrays.mock.callCount(), drawsAtLoss)
  assert.equal(iTimeValues(lostGL).at(-1), timeAtLoss)

  // Resize while the context is gone; the observer keeps tracking dimensions,
  // and the restored program adopts them on its first frame.
  target.clientWidth = 1600
  target.clientHeight = 1200
  observers.forEach(observer => observer.fire())

  // Restore rebuilds the GL program/buffers/uniforms and schedules exactly one loop.
  emitRestored(target)
  const restoredGL = gl
  assert.notEqual(restoredGL, lostGL)
  assert.equal(restoredGL.createProgram.mock.callCount(), 1)
  assert.equal(frames.length, 1)
  // First restored frame: lastTime is null, so it always renders without
  // accumulating the time the context spent lost.
  tickAt(1000)
  const restoredLocation = restoredGL.getUniformLocation.mock.calls
    .filter(call => call.arguments[1] === 'iTime').at(-1).result
  // Read live on each assertion: mock calls keep accumulating after this point.
  const restoredITime = () => restoredGL.uniform1f.mock.calls
    .filter(call => call.arguments[0] === restoredLocation).map(call => call.arguments[1])
  assert.equal(restoredITime()[0], timeAtLoss)
  assert.equal(target.width, 1600)
  assert.equal(target.height, 1200)
  const resized = restoredGL.viewport.mock.calls.some(call =>
    call.arguments[1] === 1600 && call.arguments[2] === 1200)
  // viewport only fires when the backing store changes; either way the
  // resolution uniform must carry the post-restore dimensions.
  assert.ok(resized || restoredGL.uniform3f.mock.calls.some(call =>
    call.arguments[1] === 1600 && call.arguments[2] === 1200))

  // The timeline continues from the accumulated elapsed time, not from zero.
  // A far-future frame clears the 30fps cap; the delta is clamped to 50ms, so
  // elapsed advances exactly from 100ms to 150ms instead of jumping by seconds.
  tickAt(60000)
  assert.equal(frames.length, 1)
  const resumed = restoredITime().at(-1)
  assert.ok(Math.abs(resumed - 0.15) < 1e-9)
  assert.ok(resumed > 0) // never restarted at t=0
  assert.equal(restoredGL.drawArrays.mock.callCount(), 2)
  assert.equal(frames.length, 1)
})

test('a relaunch during context loss reuses the program and applies the seed on restore', async () => {
  const target = mount('target', 'canvas')
  const program = await gradientGL('c1.915c', '#target')
  emitLost(target)
  tick()

  const next = await gradientGL('c1.a15c', '#target')
  assert.equal(next, program)
  assert.equal(document.querySelectorAll('canvas').length, 1)
  assert.equal(program.isMounted(target), true)

  // The restore rebuilds the context and pushes the deferred seed exactly once
  // (a1 11 55 cc normalized to 0-255).
  emitRestored(target)
  assert.equal(gl.createProgram.mock.callCount(), 1)
  assert.equal(gl.uniform1iv.mock.callCount(), 1)
  assert.deepEqual([...gl.uniform1iv.mock.calls[0].arguments[1]], [170, 17, 85, 204])
  tickAt(1000)
  assert.equal(frames.length, 1)
})

test('a library-owned canvas is reused, not recreated, across a loss window', async () => {
  const program = await gradientGL('c1.915c')
  const owned = canvas()
  emitLost(owned)
  tick()

  const next = await gradientGL('c1.a15c')
  assert.equal(next, program)
  assert.equal(canvas(), owned)
  assert.equal(document.querySelectorAll('#gradient-gl').length, 1)

  emitRestored(owned)
  tickAt(1000)
  assert.equal(frames.length, 1)
  assert.equal(program.isMounted(document.body), true)
})

test('destroying while lost makes a later restore stay inert', async () => {
  const target = mount('target', 'canvas')
  const program = await gradientGL('c1.915c', '#target')
  emitLost(target)
  tick()

  program.destroy()
  assert.ok(target.isConnected) // caller-owned canvas is retained
  emitRestored(target)
  // The restored context is handed out by the mock but never initialized.
  assert.equal(gl.createProgram.mock.callCount(), 0)
  assert.equal(frames.length, 0)
  tickAt(9999)
  assert.equal(frames.length, 0)
})

test('a restore after an owned-canvas destroy neither rebuilds nor reschedules', async () => {
  const program = await gradientGL('c1.915c')
  const owned = canvas()
  emitLost(owned)
  tick()

  program.destroy()
  assert.equal(owned.isConnected, false) // library-owned canvas is removed
  emitRestored(owned)
  assert.equal(gl.createProgram.mock.callCount(), 0)
  assert.equal(frames.length, 0)
})

test('a shader switch after restore leaves exactly one active program', async () => {
  const target = mount('target', 'canvas')
  const program = await gradientGL('c1.915c', '#target')
  emitLost(target)
  tick()
  // A canvas whose context is still lost cannot host a new GL program; once the
  // browser restores it, a shader switch rebuilds on the same caller canvas.
  emitRestored(target)
  tickAt(1000)

  const next = await gradientGL('b1.915c', '#target')
  assert.notEqual(next, program)
  assert.ok(target.isConnected)
  assert.equal(document.querySelectorAll('canvas').length, 1)
  // The destroyed program's stale frame expires via its token; after flushing,
  // only the replacement keeps a single self-perpetuating loop.
  tickAt(2000)
  assert.equal(frames.length, 1)
  tickAt(3000)
  assert.equal(frames.length, 1)
  next.destroy()
  tickAt(4000)
  assert.equal(frames.length, 0)
})

test('duplicate restore events never start a second frame loop', async () => {
  const target = mount('target', 'canvas')
  const program = await gradientGL('c1.915c', '#target')
  emitLost(target)
  tick()

  // The second restore must be ignored while the program is already active;
  // only one rAF chain may exist regardless of how restore events interleave.
  emitRestored(target)
  const activeGL = gl
  const programsAfterFirstRestore = activeGL.createProgram.mock.callCount()
  emitRestored(target)
  // The active program did not rebuild again on the spurious restore.
  assert.equal(activeGL.createProgram.mock.callCount(), programsAfterFirstRestore)
  assert.equal(frames.length, 1)
  tickAt(1000)
  assert.equal(frames.length, 1)
  program.destroy()
})
