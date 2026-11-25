import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import PlayView from '../src/views/PlayView.vue'
import StatPanel from '../src/components/player/StatPanel.vue'
import { i18n } from '../src/locales'
import { fakeLoader, videoItem, dispatchMap } from './fakes'

// 用可控桩替换真实 VPlayer(避免拉起 MSE/fastloadjs),只验证 PlayView 的事件转发链路
vi.mock('@/components/player/VPlayer.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'VPlayer',
      setup: (_props, { expose }) => {
        expose({})
        return () => h('div', { 'data-testid': 'vplayer-stub' })
      },
    }),
  }
})

// 保留 service 其余导出,仅把网络请求 playerInfo 换成可控返回
vi.mock('@/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/service/index')>()
  return {
    ...actual,
    playerInfo: vi.fn(),
  }
})

import VPlayerStub from '@/components/player/VPlayer.vue'
import { playerInfo } from '@/service'

const mockedPlayerInfo = vi.mocked(playerInfo)

function playerData(id: string) {
  return {
    ok: true as const,
    status: 200,
    data: { id, title: `T-${id}`, duration: 10, streams: {} },
  }
}

async function mountAt(vid: string, query: Record<string, string> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/play', component: PlayView }],
  })
  await router.push({ path: '/play', query: { v: vid, ...query } })
  await router.isReady()
  const wrapper = mount(PlayView, { global: { plugins: [router, i18n] } })
  await flushPromises()
  await nextTick()
  return { wrapper, router }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedPlayerInfo.mockResolvedValue(playerData('vid1') as never)
})

describe('PlayView -> StatPanel 链路', () => {
  it('load/loadersready 被转发:假加载器事件能写到页面下方的统计面板', async () => {
    const { wrapper } = await mountAt('vid1')

    const stub = wrapper.findComponent(VPlayerStub)
    expect(stub.exists()).toBe(true)
    expect(wrapper.findComponent(StatPanel).exists()).toBe(true)

    const loader = fakeLoader()
    stub.vm.$emit('load', [videoItem(137)])
    stub.vm.$emit('loadersready', [loader], [dispatchMap(1)])
    await nextTick()

    loader.emit('http.start', { no: 1 })
    await nextTick()
    expect(wrapper.findAll('[data-track="video"] .stat-box.http-start')).toHaveLength(1)
  })

  it('切换清晰度:@init 立即作废旧监听,新 ready 后只接收新加载器', async () => {
    const { wrapper } = await mountAt('vid1')
    const stub = wrapper.findComponent(VPlayerStub)

    const oldL = fakeLoader()
    stub.vm.$emit('load', [videoItem(137)])
    stub.vm.$emit('loadersready', [oldL], [dispatchMap(1)])
    await nextTick()
    oldL.emit('http.start', { no: 1 })
    await nextTick()
    expect(wrapper.findAll('[data-track="video"] .http-start')).toHaveLength(1)

    // VPlayer.switchQuality -> init() 开头同步 emit('init')
    stub.vm.$emit('init')
    await nextTick()
    expect(wrapper.findAll('[data-track="video"] .stat-box')).toHaveLength(0)

    // 旧加载器已解绑/作废
    oldL.emit('http.start', { no: 1 })
    await nextTick()
    expect(wrapper.findAll('[data-track="video"] .http-start')).toHaveLength(0)

    // 引擎 ready,新代加载器
    const newL = fakeLoader()
    stub.vm.$emit('load', [videoItem(248)])
    stub.vm.$emit('loadersready', [newL], [dispatchMap(5, 6)])
    await nextTick()
    expect(wrapper.findAll('[data-track="video"] .stat-box')).toHaveLength(2)
    newL.emit('http.start', { no: 5 })
    await nextTick()
    expect(wrapper.findAll('[data-track="video"] .http-start')).toHaveLength(1)
  })

  it('切换视频 id:旧面板卸载并解绑旧加载器,新视频的 ready 绑定新面板', async () => {
    const { wrapper, router } = await mountAt('vid1')
    let stub = wrapper.findComponent(VPlayerStub)
    const oldL = fakeLoader()
    stub.vm.$emit('load', [videoItem(137)])
    stub.vm.$emit('loadersready', [oldL], [dispatchMap(1)])
    await nextTick()

    mockedPlayerInfo.mockResolvedValueOnce(playerData('vid2') as never)
    await router.push({ path: '/play', query: { v: 'vid2' } })
    await flushPromises()
    await nextTick()

    expect(mockedPlayerInfo).toHaveBeenCalledWith('vid2')
    // pinfo 先清空导致 StatPanel 卸载,卸载时对旧加载器执行了解绑
    expect(oldL.remove).toHaveBeenCalled()

    // 新数据到达后出现新的播放器桩与统计面板
    stub = wrapper.findComponent(VPlayerStub)
    expect(stub.exists()).toBe(true)
    const newL = fakeLoader()
    stub.vm.$emit('load', [videoItem(244)])
    stub.vm.$emit('loadersready', [newL], [dispatchMap(9)])
    await nextTick()
    newL.emit('rtc.done', { no: 9 })
    await nextTick()
    expect(wrapper.findAll('[data-track="video"] .rtc-done')).toHaveLength(1)

    // 旧加载器在新面板上的延迟回调不写入
    oldL.emit('rtc.done', { no: 1 })
    await nextTick()
    expect(wrapper.findAll('[data-track="video"] .rtc-done')).toHaveLength(1)
  })

  it('audio=true 时整条链路把唯一加载器送到音频卡', async () => {
    const { wrapper } = await mountAt('vid1', { audio: 'true' })
    const stub = wrapper.findComponent(VPlayerStub)
    const a = fakeLoader()
    stub.vm.$emit('load', [
      { ...videoItem(), itag: 251, mimeCodec: 'audio/webm; codecs="opus"' },
    ])
    stub.vm.$emit('loadersready', [a], [dispatchMap(3)])
    await nextTick()

    a.emit('http.start', { no: 3 })
    await nextTick()
    expect(wrapper.findAll('[data-track="audio"] .http-start')).toHaveLength(1)
    expect(wrapper.findAll('[data-track="video"] .http-start')).toHaveLength(0)
  })
})
