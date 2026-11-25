import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import VPlayer from '../src/components/player/VPlayer.vue'
import { i18n } from '../src/locales'
import type { PlayerInfo } from '../src/types'

type Cb = (...args: any[]) => void
const instances: FakeEngine[] = []

class FakeEngine {
  listeners: Record<string, Cb[]> = {}
  destroyed = false
  attach = vi.fn(async () => {})
  destroy = vi.fn(() => {
    this.destroyed = true
  })
  constructor(public opts?: unknown) {
    instances.push(this)
  }
  listen(ev: string, cb: Cb) {
    ;(this.listeners[ev] ??= []).push(cb)
    return this
  }
  trigger(ev: string, ...args: unknown[]) {
    for (const cb of [...(this.listeners[ev] ?? [])]) cb(...args)
  }
  pause() {}
  seekTo() {}
  start() {
    return this
  }
  setBufferHealth() {
    return this
  }
}

function playerInfo(id: string): PlayerInfo {
  return {
    id,
    title: `T-${id}`,
    duration: 100,
    streams: {
      137: {
        itag: 137,
        quality: '1080p',
        type: 'video/mp4; codecs="avc1.4d401f"',
        len: 10000,
        initRange: { start: '0', end: '100' },
        indexRange: { start: '101', end: '200' },
      },
      140: {
        itag: 140,
        quality: 'audio',
        type: 'audio/mp4; codecs="mp4a.40.2"',
        len: 5000,
        initRange: { start: '0', end: '50' },
        indexRange: { start: '51', end: '99' },
      },
    },
  } as PlayerInfo
}

async function flushInit() {
  // init() 内有两层嵌套 nextTick 才会 new fastload()
  await nextTick()
  await nextTick()
  await Promise.resolve()
  await nextTick()
  await nextTick()
}

beforeEach(() => {
  instances.length = 0
  localStorage.clear()
  // happy-dom 不提供完整 MSE;isModern/useWebm 只需静态判定通过
  ;(window as unknown as { MediaSource: unknown }).MediaSource = class {
    static isTypeSupported() {
      return false
    }
  }
  ;(window as unknown as { fastloadjs: unknown }).fastloadjs = FakeEngine
})

afterEach(() => {
  delete (window as unknown as { fastloadjs?: unknown }).fastloadjs
  vi.clearAllMocks()
})

describe('VPlayer 重建竞态', () => {
  it('挂载后创建引擎并在 ready 时转发 loadersready', async () => {
    const wrapper = mount(VPlayer, {
      props: { playerInfo: playerInfo('v1') },
      global: { plugins: [i18n] },
    })
    await flushInit()

    expect(instances).toHaveLength(1)
    instances[0].trigger('ready', ['loader-a', 'loader-b'], ['disp-a', 'disp-b'])
    const ev = wrapper.emitted('loadersready')
    expect(ev).toHaveLength(1)
    expect(ev![0]).toEqual([
      ['loader-a', 'loader-b'],
      ['disp-a', 'disp-b'],
    ])
    wrapper.unmount()
  })

  it('切换视频 id 重建后,旧引擎的迟到 ready 被 initGen 守卫丢弃,只转发最后一代', async () => {
    const wrapper = mount(VPlayer, {
      props: { playerInfo: playerInfo('v1') },
      global: { plugins: [i18n] },
    })
    await flushInit()
    expect(instances).toHaveLength(1)
    const first = instances[0]

    await wrapper.setProps({ playerInfo: playerInfo('v2') })
    await flushInit()

    expect(instances.length).toBeGreaterThanOrEqual(2)
    const second = instances[instances.length - 1]
    expect(first.destroy).toHaveBeenCalled()

    // 被作废的旧引擎迟到 ready:不得转发
    first.trigger('ready', ['stale-loader'], ['stale-disp'])
    expect(wrapper.emitted('loadersready')).toBeUndefined()

    // 最后一代 ready:正常转发
    second.trigger('ready', ['fresh-loader'], ['fresh-disp'])
    const ev = wrapper.emitted('loadersready')
    expect(ev).toHaveLength(1)
    expect(ev![0][0]).toEqual(['fresh-loader'])

    wrapper.unmount()
  })
})
