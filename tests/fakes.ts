import { vi } from 'vitest'
import type { Fastloader, LoadItem } from '../src/types'

export type EmitFn = (event: string, ...args: unknown[]) => void

export interface FakeLoader extends Fastloader {
  /** 事件名 -> 按注册顺序保存的回调 */
  listeners: Record<string, Array<(...args: any[]) => void>>
  emit: EmitFn
  listenerCount: (event?: string) => number
  removedWith: Array<[string | undefined, unknown]>
}

/**
 * 假的 fastloadjs 加载器对象:listen 注册、emit 模拟引擎回调,
 * remove 与线上引擎的 remove(event, cb) 行为一致。
 */
export function fakeLoader(tag = 'fake'): FakeLoader {
  const listeners: FakeLoader['listeners'] = {}
  const removedWith: FakeLoader['removedWith'] = []
  const l: FakeLoader = {
    listeners,
    removedWith,
    listen: vi.fn((event: string, cb: (...args: any[]) => void) => {
      ;(listeners[event] ??= []).push(cb)
      return l
    }) as unknown as Fastloader['listen'],
    remove: vi.fn(((event?: string, cb?: (...args: any[]) => void) => {
      removedWith.push([event, cb])
      if (!event) {
        for (const k of Object.keys(listeners)) listeners[k].length = 0
        return l
      }
      if (!cb) {
        if (listeners[event]) listeners[event].length = 0
        return l
      }
      const arr = listeners[event]
      if (arr) {
        const i = arr.indexOf(cb)
        if (i >= 0) arr.splice(i, 1)
      }
      return l
    }) as Fastloader['remove']),
    emit(event: string, ...args: unknown[]) {
      // 复制一份,避免回调内解绑改变遍历下标
      for (const cb of [...(listeners[event] ?? [])]) cb(...args)
    },
    listenerCount(event?: string) {
      if (event) return listeners[event]?.length ?? 0
      return Object.values(listeners).reduce((n, a) => n + a.length, 0)
    },
    start: vi.fn(() => l),
    pause: vi.fn(() => l),
    setBufferHealth: vi.fn(() => l),
    seekTo: vi.fn(),
    destroy: vi.fn(),
  }
  return l
}

/** 极简假加载器:只有 listen,没有任何解绑方法,用于验证代次守卫 */
export function bareLoader(): Fastloader & { emit: EmitFn; listenerCount: (e: string) => number } {
  const listeners: Record<string, Array<(...args: any[]) => void>> = {}
  return {
    listen(event, cb) {
      ;(listeners[event] ??= []).push(cb)
      return this as unknown as Fastloader
    },
    emit(event, ...args) {
      for (const cb of [...(listeners[event] ?? [])]) cb(...args)
    },
    listenerCount(event: string) {
      return listeners[event]?.length ?? 0
    },
    start() {
      return this as unknown as Fastloader
    },
    pause() {
      return this as unknown as Fastloader
    },
    setBufferHealth() {
      return this as unknown as Fastloader
    },
    seekTo() {},
    destroy() {},
  }
}

let itagSeq = 100
export function makeItem(partial: Partial<LoadItem> = {}): LoadItem {
  const itag = partial.itag ?? ++itagSeq
  return {
    itag,
    quality: 'q',
    req: `/${itag}.mp4`,
    init: { start: 0, end: 1 },
    index: { start: 2, end: 3 },
    mimeCodec: 'video/mp4; codecs="avc1.4d401f"',
    len: 1000,
    meta: `vid:${itag}`,
    mirrors: [],
    ...partial,
  }
}

export const videoItem = (itag = 137) =>
  makeItem({ itag, mimeCodec: 'video/mp4; codecs="avc1.4d401f"' })
export const audioItem = (itag = 140) =>
  makeItem({ itag, mimeCodec: 'audio/mp4; codecs="mp4a.40.2"' })

/** fastloadjs dispatch map:键为块号,值用 start/end 表示字节区间 */
export function dispatchMap(...nos: number[]) {
  const m: Record<number, { no: number; start: number; end: number }> = {}
  for (const no of nos) m[no] = { no, start: no * 100, end: no * 100 + 99 }
  return m
}
