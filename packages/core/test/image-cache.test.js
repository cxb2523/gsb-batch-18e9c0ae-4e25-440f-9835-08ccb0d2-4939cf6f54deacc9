// @vitest-environment jsdom
//
// Image asset cache lifecycle: invalidation on remove/src-replace, in-flight
// de-duplication, failure retry, shape-vs-asset deletion distinction, and
// undo / redo / loadSnapshot recovery. All loading goes through a controllable
// FakeImage — no real network images.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Store } from '../src/store.js'
import { Editor } from '../src/editor.js'
import { themeOf } from '../src/palette.js'
import {
  assetImage,
  drawShape,
  clearAssetCache,
  invalidateAsset,
  syncAssetCache,
} from '../src/shapes.js'

const SRC_1 = 'data:image/png;base64,c3JjLTE='
const SRC_2 = 'data:image/png;base64,c3JjLTI='

const assetRec = (id = 'a1', src = SRC_1) => ({ id, typeName: 'asset', src, w: 120, h: 80 })
const imageShape = (over = {}) => ({
  id: 'sh1',
  typeName: 'shape',
  type: 'image',
  x: 10,
  y: 20,
  rot: 0,
  z: 1,
  props: { w: 100, h: 70, assetId: 'a1' },
  ...over,
})

// Controllable stand-in for the browser Image. Tests decide when load/error
// fires; setting `src` never touches the network.
class FakeImage {
  static instances = []
  constructor() {
    this.complete = false
    this.naturalWidth = 0
    this.naturalHeight = 0
    this._src = ''
    this.srcSetCount = 0
    FakeImage.instances.push(this)
  }
  get src() { return this._src }
  set src(v) { this._src = v; this.srcSetCount += 1 }
  load() {
    if (this.complete) return
    this.complete = true
    this.naturalWidth = 120
    this.naturalHeight = 80
    if (this.onload) this.onload({ type: 'load', target: this })
  }
  fail() {
    if (this.complete) return
    this.complete = true
    if (this.onerror) this.onerror({ type: 'error', target: this })
  }
}

beforeEach(() => {
  clearAssetCache()
  FakeImage.instances.length = 0
  vi.stubGlobal('Image', FakeImage)
  if (typeof window !== 'undefined') {
    try { window.Image = FakeImage } catch { /* read-only window binding */ }
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearAssetCache()
})

const lastImg = () => FakeImage.instances[FakeImage.instances.length - 1]

describe('assetImage loading and de-duplication', () => {
  it('returns null until loaded, then caches and notifies onAssetLoad once', () => {
    const store = new Store()
    store.put(assetRec())
    const onLoad = vi.fn()

    expect(assetImage(store, 'a1', onLoad)).toBeNull()
    expect(FakeImage.instances).toHaveLength(1)
    expect(lastImg().src).toBe(SRC_1)
    expect(onLoad).not.toHaveBeenCalled()

    lastImg().load()
    expect(onLoad).toHaveBeenCalledTimes(1)

    // cache hit: same decoded image, no extra loads
    expect(assetImage(store, 'a1', onLoad)).toBe(lastImg())
    expect(FakeImage.instances).toHaveLength(1)
    // ready-image reads must not re-fire the load notification
    expect(onLoad).toHaveBeenCalledTimes(1)
  })

  it('A2: concurrent draws of the same loading assetId create one Image and set src once', () => {
    const store = new Store()
    store.put(assetRec())
    const cb1 = vi.fn()
    const cb2 = vi.fn()

    assetImage(store, 'a1', cb1)
    assetImage(store, 'a1', cb2)
    assetImage(store, 'a1')
    assetImage(store, 'a1', cb2) // same callback twice is still one waiter

    expect(FakeImage.instances).toHaveLength(1)
    expect(FakeImage.instances[0].srcSetCount).toBe(1)

    lastImg().load()
    expect(cb1).toHaveBeenCalledTimes(1)
    expect(cb2).toHaveBeenCalledTimes(1)

    expect(assetImage(store, 'a1')).toBe(FakeImage.instances[0])
    expect(FakeImage.instances).toHaveLength(1)
  })

  it('keeps distinct assetIds loading independently', () => {
    const store = new Store()
    store.put(assetRec('a1', SRC_1))
    store.put(assetRec('a2', SRC_2))

    assetImage(store, 'a1')
    assetImage(store, 'a2')
    assetImage(store, 'a1')

    expect(FakeImage.instances).toHaveLength(2)
    expect(FakeImage.instances.map((i) => i.src).sort()).toEqual([SRC_1, SRC_2])
  })

  it('does not throw and returns null for an unknown assetId', () => {
    const store = new Store()
    expect(() => assetImage(store, 'missing', vi.fn())).not.toThrow()
    expect(assetImage(store, 'missing')).toBeNull()
    expect(FakeImage.instances).toHaveLength(0)
  })

  it('does not serve one document\'s decoded image to a different Store reusing the same id', () => {
    const s1 = new Store()
    s1.put(assetRec('a1', SRC_1))
    assetImage(s1, 'a1')
    FakeImage.instances[0].load()
    expect(assetImage(s1, 'a1')).toBe(FakeImage.instances[0])

    const s2 = new Store()
    s2.put(assetRec('a1', SRC_2))
    expect(assetImage(s2, 'a1')).toBeNull()
    expect(FakeImage.instances).toHaveLength(2)
    expect(FakeImage.instances[1].src).toBe(SRC_2)
  })
})

describe('A3: load failure and retry', () => {
  it('evicts the failed load so a later draw retries, then notifies on success', () => {
    const store = new Store()
    store.put(assetRec())
    const firstLoad = vi.fn()

    assetImage(store, 'a1', firstLoad)
    expect(FakeImage.instances).toHaveLength(1)
    FakeImage.instances[0].fail()
    expect(firstLoad).not.toHaveBeenCalled()

    // the failed entry is not served as a ready image
    const retryLoad = vi.fn()
    expect(assetImage(store, 'a1', retryLoad)).toBeNull()
    expect(FakeImage.instances).toHaveLength(2)
    expect(lastImg().src).toBe(SRC_1)

    // concurrent draws during the retry stay coalesced
    assetImage(store, 'a1', vi.fn())
    expect(FakeImage.instances).toHaveLength(2)

    lastImg().load()
    expect(retryLoad).toHaveBeenCalledTimes(1)
    expect(assetImage(store, 'a1')).toBe(FakeImage.instances[1])
  })

  it('keeps retrying after repeated failures until a load succeeds', () => {
    const store = new Store()
    store.put(assetRec())

    assetImage(store, 'a1')
    FakeImage.instances[0].fail()
    assetImage(store, 'a1')
    expect(FakeImage.instances).toHaveLength(2)

    FakeImage.instances[1].fail()
    const onLoad = vi.fn()
    assetImage(store, 'a1', onLoad)
    expect(FakeImage.instances).toHaveLength(3)

    lastImg().load()
    expect(onLoad).toHaveBeenCalledTimes(1)
    expect(assetImage(store, 'a1')).toBe(FakeImage.instances[2])
  })

  it('notifies a positional onError callback but does not treat failure as load', () => {
    const store = new Store()
    store.put(assetRec())
    const onLoad = vi.fn()
    const onError = vi.fn()

    assetImage(store, 'a1', onLoad, onError)
    lastImg().fail()

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onLoad).not.toHaveBeenCalled()
  })
})

describe('A1/A6: invalidation on asset remove or src replacement', () => {
  it('A1: removing the asset invalidates the old Image; an orphan draw is null and a restore reloads', () => {
    const store = new Store()
    store.put(assetRec())
    assetImage(store, 'a1')
    const oldImg = FakeImage.instances[0]
    oldImg.load()
    expect(assetImage(store, 'a1')).toBe(oldImg)

    store.remove(['a1'])

    // shape still references the deleted asset: placeholder, never the old img
    expect(() => assetImage(store, 'a1')).not.toThrow()
    expect(assetImage(store, 'a1')).toBeNull()
    expect(assetImage(store, 'a1')).toBeNull()

    // undo / re-add brings the record back: fresh load, not the stale Image
    store.put(assetRec())
    const onLoad = vi.fn()
    expect(assetImage(store, 'a1', onLoad)).toBeNull()
    expect(FakeImage.instances.length).toBeGreaterThan(1)
    expect(lastImg()).not.toBe(oldImg)
    expect(lastImg().src).toBe(SRC_1)

    lastImg().load()
    expect(onLoad).toHaveBeenCalledTimes(1)
    expect(assetImage(store, 'a1')).toBe(lastImg())
  })

  it('remove followed immediately by undo (no orphan draw in between) keeps the valid decode', () => {
    const store = new Store()
    store.put(assetRec())
    store.put(imageShape())
    assetImage(store, 'a1')
    FakeImage.instances[0].load()
    const img = FakeImage.instances[0]

    // delete both parts, then undo before any draw observes the gap
    store.remove(['sh1', 'a1'])
    store.undo()

    expect(store.asset('a1')).toBeTruthy()
    expect(store.get('sh1')).toBeTruthy()
    // identical record restored: the decoded image is still valid
    expect(assetImage(store, 'a1')).toBe(img)
    expect(FakeImage.instances).toHaveLength(1)
  })

  it('src replacement reloads with the new src instead of painting the old image', () => {
    const store = new Store()
    store.put(assetRec('a1', SRC_1))
    assetImage(store, 'a1')
    FakeImage.instances[0].load()
    expect(assetImage(store, 'a1')).toBe(FakeImage.instances[0])

    // replace the resource record with new pixels under the same id
    store.put(assetRec('a1', SRC_2))

    const onLoad = vi.fn()
    expect(assetImage(store, 'a1', onLoad)).toBeNull()
    expect(FakeImage.instances).toHaveLength(2)
    expect(FakeImage.instances[1].src).toBe(SRC_2)
    expect(FakeImage.instances[1]).not.toBe(FakeImage.instances[0])

    FakeImage.instances[1].load()
    expect(onLoad).toHaveBeenCalledTimes(1)
    expect(assetImage(store, 'a1')).toBe(FakeImage.instances[1])
  })

  it('store.update of only unrelated metadata with the same src keeps the cache', () => {
    const store = new Store()
    store.put(assetRec())
    assetImage(store, 'a1')
    FakeImage.instances[0].load()

    store.update('a1', { w: 200, h: 160 })
    expect(assetImage(store, 'a1')).toBe(FakeImage.instances[0])
    expect(FakeImage.instances).toHaveLength(1)
  })

  it('A6: loadSnapshot with a different src for the same assetId re-resolves to the new src', () => {
    const store = new Store()
    store.put(assetRec('a1', SRC_1))
    assetImage(store, 'a1')
    FakeImage.instances[0].load()

    store.loadSnapshot({ document: { store: { a1: assetRec('a1', SRC_2) } } })
    expect(store.asset('a1').src).toBe(SRC_2)

    const onLoad = vi.fn()
    expect(assetImage(store, 'a1', onLoad)).toBeNull()
    expect(FakeImage.instances).toHaveLength(2)
    expect(lastImg().src).toBe(SRC_2)

    lastImg().load()
    expect(onLoad).toHaveBeenCalledTimes(1)
    expect(assetImage(store, 'a1')).toBe(lastImg())
  })

  it('loadSnapshot keeping the same id+src reuses the decoded image', () => {
    const store = new Store()
    store.put(assetRec())
    assetImage(store, 'a1')
    FakeImage.instances[0].load()
    const img = FakeImage.instances[0]

    store.loadSnapshot({ document: { store: { a1: assetRec() } } })
    expect(assetImage(store, 'a1')).toBe(img)
    expect(FakeImage.instances).toHaveLength(1)
  })

  it('syncAssetCache / invalidateAsset drop entries directly', () => {
    const store = new Store()
    store.put(assetRec())
    assetImage(store, 'a1')
    FakeImage.instances[0].load()

    invalidateAsset('a1')
    expect(assetImage(store, 'a1')).toBeNull()
    expect(FakeImage.instances).toHaveLength(2)

    clearAssetCache()
    expect(FakeImage.instances).toHaveLength(2) // clear itself does not load
    assetImage(store, 'a1')
    expect(FakeImage.instances).toHaveLength(3)

    // syncAssetCache understands removed and src-changed asset diffs
    syncAssetCache({ removed: { a1: assetRec() }, added: {}, updated: {} })
    expect(assetImage(store, 'a1')).toBeNull()
  })
})

describe('A4/A5: shape deletion vs asset deletion, undo and redo', () => {
  it('A4: deleting only the image shape keeps the asset and the decoded cache', () => {
    const store = new Store()
    store.put(assetRec())
    store.put(imageShape())
    assetImage(store, 'a1')
    FakeImage.instances[0].load()
    const img = FakeImage.instances[0]

    store.remove(['sh1'])

    expect(store.get('sh1')).toBeUndefined()
    expect(store.asset('a1')).toBeTruthy()
    // no reload: same decoded Image still resolves
    expect(assetImage(store, 'a1')).toBe(img)
    expect(FakeImage.instances).toHaveLength(1)
  })

  it('A5: undo of shape-only deletion restores the shape and the image immediately', () => {
    const store = new Store()
    store.put(assetRec())
    store.put(imageShape())
    assetImage(store, 'a1')
    FakeImage.instances[0].load()
    const img = FakeImage.instances[0]

    store.remove(['sh1'])
    expect(store.get('sh1')).toBeUndefined()

    store.undo()
    const shape = store.get('sh1')
    expect(shape).toBeTruthy()
    expect(shape.props.assetId).toBe('a1')
    expect(store.asset('a1')).toBeTruthy()
    expect(assetImage(store, 'a1')).toBe(img)
    expect(FakeImage.instances).toHaveLength(1)
  })

  it('redo/undo cycle keeps the retained asset image available', () => {
    const store = new Store()
    store.put(assetRec())
    store.put(imageShape())
    assetImage(store, 'a1')
    FakeImage.instances[0].load()
    const img = FakeImage.instances[0]

    store.remove(['sh1'])
    store.undo()
    expect(store.get('sh1')).toBeTruthy()

    store.redo()
    expect(store.get('sh1')).toBeUndefined()
    expect(store.asset('a1')).toBeTruthy()
    expect(assetImage(store, 'a1')).toBe(img)

    store.undo()
    expect(store.get('sh1')).toBeTruthy()
    expect(assetImage(store, 'a1')).toBe(img)
    expect(FakeImage.instances).toHaveLength(1)
  })

  it('undo deleting both shape and asset restores both records and the picture can reload', () => {
    const store = new Store()
    store.put(assetRec())
    store.put(imageShape())
    assetImage(store, 'a1')
    FakeImage.instances[0].load()
    const oldImg = FakeImage.instances[0]

    // one delete step removes both records
    store.remove(['sh1', 'a1'])
    expect(store.get('sh1')).toBeUndefined()
    expect(store.asset('a1')).toBeNull()

    // a repaint while deleted must show the placeholder path, not throw
    expect(assetImage(store, 'a1')).toBeNull()

    store.undo()
    expect(store.get('sh1')).toBeTruthy()
    expect(store.asset('a1')).toBeTruthy()
    expect(store.get('sh1').props.assetId).toBe('a1')

    // the removal invalidated the cache; recovery goes through a fresh load
    const onLoad = vi.fn()
    const img = assetImage(store, 'a1', onLoad)
    expect(img).toBeNull()
    expect(FakeImage.instances.length).toBeGreaterThan(1)
    expect(lastImg()).not.toBe(oldImg)

    lastImg().load()
    expect(onLoad).toHaveBeenCalledTimes(1)
    expect(assetImage(store, 'a1')).toBe(lastImg())
  })

  it('getSnapshot -> fresh Store.loadSnapshot brings the image document back', () => {
    const store = new Store()
    store.put(assetRec())
    store.put(imageShape())
    const snap = store.getSnapshot()

    const restored = new Store()
    restored.loadSnapshot(snap)
    expect(restored.asset('a1')).toBeTruthy()
    expect(restored.get('sh1')).toBeTruthy()

    const onLoad = vi.fn()
    assetImage(restored, 'a1', onLoad)
    expect(FakeImage.instances).toHaveLength(1)
    lastImg().load()
    expect(onLoad).toHaveBeenCalledTimes(1)
    expect(assetImage(restored, 'a1')).toBe(lastImg())
  })
})

describe('drawShape image rendering', () => {
  function recordingCtx() {
    const ctx = document.createElement('canvas').getContext('2d')
    return {
      ctx,
      drawImage: vi.spyOn(ctx, 'drawImage'),
      fill: vi.spyOn(ctx, 'fill'),
    }
  }

  it('placeholder while loading, bitmap after onAssetLoad, placeholder again if asset vanishes', () => {
    const store = new Store()
    store.put(assetRec())
    const shape = imageShape()
    const onAssetLoad = vi.fn()
    const opts = { theme: themeOf('light'), store, onAssetLoad }

    let { ctx, drawImage, fill } = recordingCtx()
    drawShape(ctx, shape, opts)
    expect(drawImage).not.toHaveBeenCalled()
    expect(fill).toHaveBeenCalled() // semi placeholder

    FakeImage.instances[0].load()
    expect(onAssetLoad).toHaveBeenCalledTimes(1)

    ;({ ctx, drawImage, fill } = recordingCtx())
    drawShape(ctx, shape, opts)
    expect(drawImage).toHaveBeenCalledTimes(1)
    expect(drawImage.mock.calls[0][0]).toBe(FakeImage.instances[0])

    // asset record deleted while the shape stays: placeholder, no throw
    store.remove(['a1'])
    ;({ ctx, drawImage, fill } = recordingCtx())
    expect(() => drawShape(ctx, shape, opts)).not.toThrow()
    expect(drawImage).not.toHaveBeenCalled()
    expect(fill).toHaveBeenCalled()
  })

  it('renders the retried bitmap after an initial error and later successful draw', () => {
    const store = new Store()
    store.put(assetRec())
    const shape = imageShape()
    const onAssetLoad = vi.fn()

    let { ctx, drawImage } = recordingCtx()
    drawShape(ctx, shape, { theme: themeOf('light'), store, onAssetLoad })
    FakeImage.instances[0].fail()

    // next frame/draw retries
    ;({ ctx, drawImage } = recordingCtx())
    drawShape(ctx, shape, { theme: themeOf('light'), store, onAssetLoad })
    expect(FakeImage.instances).toHaveLength(2)
    lastImg().load()
    expect(onAssetLoad).toHaveBeenCalledTimes(1)

    ;({ ctx, drawImage } = recordingCtx())
    drawShape(ctx, shape, { theme: themeOf('light'), store, onAssetLoad })
    expect(drawImage).toHaveBeenCalledTimes(1)
    expect(drawImage.mock.calls[0][0]).toBe(FakeImage.instances[1])
  })
})

describe('Editor integration: delete selection and undo', () => {
  let container
  let editor

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    editor = new Editor({ container })
  })

  afterEach(() => {
    editor.destroy()
    container.remove()
  })

  it('deleteSelection keeps the asset; undo brings the image shape back visible', () => {
    const store = editor.store
    store.put(assetRec())
    store.put(imageShape())

    // first paint starts the image load through the editor's render path
    editor.render()
    expect(FakeImage.instances.length).toBeGreaterThan(0)
    const img = FakeImage.instances[0]
    img.load()

    editor.setSelection(['sh1'])
    editor.deleteSelection()
    expect(store.get('sh1')).toBeUndefined()
    expect(store.asset('a1')).toBeTruthy()
    expect(assetImage(store, 'a1')).toBe(img) // cache not cleared by shape delete

    store.undo()
    expect(store.get('sh1')).toBeTruthy()
    expect(assetImage(store, 'a1')).toBe(img)

    // a synchronous repaint with the restored shape does not throw
    expect(() => editor.render()).not.toThrow()
  })

  it('keyboard undo after deleting an image restores it', () => {
    const store = editor.store
    store.put(assetRec())
    store.put(imageShape())
    editor.render()
    FakeImage.instances[0].load()

    editor.setSelection(['sh1'])
    editor.deleteSelection()
    expect(store.canUndo).toBe(true)

    store.undo()
    expect(store.get('sh1')).toBeTruthy()
    expect(store.asset('a1')).toBeTruthy()
  })
})
