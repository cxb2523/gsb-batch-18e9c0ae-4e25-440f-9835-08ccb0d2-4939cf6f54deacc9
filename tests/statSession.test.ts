import { describe, it, expect, vi } from 'vitest'
import {
  StatSession,
  resolveTrackIndexes,
  kindOfMime,
  applyCardEvent,
  normalizeReadyArgs,
  type StatSink,
  type StatCardLike,
} from '../src/components/player/statSession'
import { fakeLoader, bareLoader, videoItem, audioItem } from './fakes'

function spySink(): StatSink & {
  stats: Array<[unknown, unknown]>
  cards: Array<[string, string, unknown]>
} {
  const s = {
    stats: [] as Array<[unknown, unknown]>,
    cards: [] as Array<[string, string, unknown]>,
    rtcStat: vi.fn((stat: unknown, uid?: unknown) => {
      s.stats.push([stat, uid])
    }),
    cardEvent: vi.fn((kind: 'video' | 'audio', type: string, res: unknown) => {
      s.cards.push([kind, type, res])
    }),
  }
  return s
}

describe('kindOfMime / resolveTrackIndexes', () => {
  it('按 mime 前缀区分视频轨与音频轨', () => {
    expect(kindOfMime('video/mp4; codecs="avc1"')).toBe('video')
    expect(kindOfMime('audio/webm; codecs="opus"')).toBe('audio')
    expect(kindOfMime('')).toBeUndefined()
    expect(kindOfMime(undefined)).toBeUndefined()
  })

  it('视频模式 [video, audio] 各自归位', () => {
    const items = [videoItem(), audioItem()]
    expect(resolveTrackIndexes(items, 2, false)).toEqual({ video: 0, audio: 1 })
  })

  it('音频模式只有一个音频加载器时归音频卡,不错绑视频卡', () => {
    const items = [audioItem()]
    expect(resolveTrackIndexes(items, 1, true)).toEqual({ audio: 0 })
  })

  it('缺少 mime 时:双加载器沿用 0 视频 1 音频;单加载器看 audioOnly', () => {
    expect(resolveTrackIndexes([{}, {}], 2, false)).toEqual({ video: 0, audio: 1 })
    expect(resolveTrackIndexes([{}], 1, false)).toEqual({ video: 0 })
    expect(resolveTrackIndexes([{}], 1, true)).toEqual({ audio: 0 })
    expect(resolveTrackIndexes([], 0, true)).toEqual({})
  })

  it('mime 优先于位置:即使音频排在数组首位也能识别', () => {
    expect(resolveTrackIndexes([audioItem(), videoItem()], 2, false)).toEqual({
      audio: 0,
      video: 1,
    })
  })
})

describe('StatSession 正常切换', () => {
  it('新一代绑定后事件写入 sink, restart 解绑旧加载器', () => {
    const session = new StatSession()
    const sink = spySink()
    const oldL = fakeLoader('old')
    const newL = fakeLoader('new')

    session.restart()
    session.bind(oldL, 'video', sink)
    oldL.emit('http.start', { no: 1 })
    expect(sink.cards).toHaveLength(1)
    expect(sink.cards[0][0]).toBe('video')

    // 切换清晰度 -> 新一代
    session.restart()
    session.bind(newL, 'video', sink)

    // 旧加载器的 remove(event, cb) 被调用,旧监听已摘除
    expect(oldL.remove).toHaveBeenCalled()
    const removedEvents = oldL.removedWith.map((x) => x[0])
    expect(removedEvents).toContain('http.start')
    expect(removedEvents).toContain('rtc.stat')

    oldL.emit('http.start', { no: 2 })
    expect(sink.cards).toHaveLength(1) // 没有新增

    newL.emit('http.done', { no: 3 })
    expect(sink.cards).toHaveLength(2)
    expect(sink.cards[1][1]).toBe('http.done')
  })
})

describe('StatSession 连续快速切换', () => {
  it('没有 remove 方法的极简加载器上,旧代回调也会被代次守卫丢弃,只有最后一代可写', () => {
    const session = new StatSession()
    const sink = spySink()
    const gens = [bareLoader(), bareLoader(), bareLoader()]

    for (const l of gens) {
      session.restart()
      session.bind(l, 'video', sink)
    }
    expect(session.currentGeneration).toBe(3)

    // 前两代(已作废)的各类回调一律不得写入
    gens[0].emit('http.start', { no: 1 })
    gens[1].emit('rtc.done', { no: 2 })
    gens[0].emit('rtc.stat', { peer: {} }, 'uid-old')
    gens[1].emit('http.done', { no: 2, err: new Error('x') })
    expect(sink.cards).toHaveLength(0)
    expect(sink.stats).toHaveLength(0)

    // 最后一代正常写入
    gens[2].emit('rtc.stat', { p: { state: 'open' } }, 'uid-last')
    gens[2].emit('http.start', { no: 9 })
    expect(sink.stats).toHaveLength(1)
    expect(sink.stats[0][1]).toBe('uid-last')
    expect(sink.cards).toHaveLength(1)
    expect(sink.cards[0][2]).toEqual({ no: 9 })
  })
})

describe('StatSession 卸载', () => {
  it('dispose 后调用 remove 解绑,且残留事件不再写入、不抛错', () => {
    const session = new StatSession()
    const sink = spySink()
    const l = fakeLoader()
    session.restart()
    session.bind(l, 'audio', sink)

    session.dispose()
    expect(l.remove).toHaveBeenCalled()
    expect(() => {
      l.emit('http.start', { no: 1 })
      l.emit('rtc.stat', {}, 'uid')
    }).not.toThrow()
    expect(sink.cards).toHaveLength(0)
    expect(sink.stats).toHaveLength(0)
  })

  it('假加载器没有任何解绑方法时,dispose 后守卫同样拦截回调', () => {
    const session = new StatSession()
    const sink = spySink()
    const l = bareLoader()
    session.restart()
    session.bind(l, 'audio', sink)

    session.dispose()
    expect(() => l.emit('rtc.progress', { part: 1 })).not.toThrow()
    expect(sink.cards).toHaveLength(0)
  })
})

describe('normalizeReadyArgs 调用约定兼容', () => {
  it('既有 (loaders, dispatchs, items?)', () => {
    const l = fakeLoader()
    const d = [{ x: 1 }]
    const items = [videoItem()]
    const r = normalizeReadyArgs([l], d, items)
    expect(r.loaders[0]).toBe(l)
    expect(r.dispatchs).toBe(d)
    expect(r.items).toBe(items)
  })

  it('另一种 (items, loaders, dispatchs) 顺序也能辨认', () => {
    const l = fakeLoader()
    const d = [{ x: 1 }]
    const items = [audioItem()]
    const r = normalizeReadyArgs(items, [l], d)
    expect(r.items).toBe(items)
    expect(r.loaders[0]).toBe(l)
    expect(r.dispatchs).toBe(d)
  })

  it('空 items + (items, loaders, dispatchs) 不被空首参误导', () => {
    const l = fakeLoader()
    const d = [{}]
    const r = normalizeReadyArgs([], [l], d)
    expect(r.items).toEqual([])
    expect(r.loaders[0]).toBe(l)
    expect(r.dispatchs).toBe(d)
  })
})

describe('applyCardEvent', () => {
  it('http.done 带 err 时落 http-error;progress 映射 part -> no', () => {
    const update = vi.fn()
    const card: StatCardLike = { statusupdate: update }
    applyCardEvent(card, 'http.done', { no: 2, err: 'boom' })
    expect(update).toHaveBeenCalledWith('http-error', { no: 2, err: 'boom' })
    applyCardEvent(card, 'rtc.progress', { part: 7, i: 1, n: 4 })
    expect(update).toHaveBeenCalledWith('progress', { no: 7, i: 1, n: 4 })
    applyCardEvent(null, 'http.start', { no: 1 }) // 空卡不报错
  })
})
