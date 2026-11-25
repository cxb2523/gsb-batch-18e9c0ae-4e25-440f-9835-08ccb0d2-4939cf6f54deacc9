import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import StatPanel from '../src/components/player/StatPanel.vue'
import { i18n } from '../src/locales'
import { fakeLoader, bareLoader, videoItem, audioItem, dispatchMap, type FakeLoader } from './fakes'
import type { Fastloader, LoadItem } from '../src/types'

function mountPanel(props: { loadItems?: LoadItem[]; audio?: boolean; title?: string } = {}) {
  return mount(StatPanel, {
    props: { title: 'T', loadItems: [], ...props },
    global: { plugins: [i18n] },
  })
}

function vmOf(wrapper: VueWrapper) {
  return wrapper.vm as unknown as {
    onLoadersready: (l?: Fastloader[], d?: unknown[], items?: LoadItem[]) => void
    clear: () => void
  }
}

async function ready(
  wrapper: VueWrapper,
  loaders: Fastloader[],
  dispatchs: unknown[],
  items?: LoadItem[],
) {
  vmOf(wrapper).onLoadersready(loaders, dispatchs, items)
  await nextTick()
}

const box = (wrapper: VueWrapper, track: 'video' | 'audio') =>
  wrapper.findAll(`[data-track="${track}"] .stat-box`)
const colored = (wrapper: VueWrapper, track: 'video' | 'audio', cls: string) =>
  wrapper.findAll(`[data-track="${track}"] .stat-box.${cls}`)

beforeEach(() => {
  localStorage.clear()
})

describe('StatPanel 正常切换', () => {
  it('绑定新的视频/音频加载器,事件进对应卡片;切换后旧加载器失效、状态清空', async () => {
    const items = [videoItem(137), audioItem(140)]
    const wrapper = mountPanel({ loadItems: items })

    const v1 = fakeLoader('v1')
    const a1 = fakeLoader('a1')
    await ready(wrapper, [v1, a1], [dispatchMap(1), dispatchMap(10)], items)

    // 两张卡各渲染一个分块
    expect(box(wrapper, 'video')).toHaveLength(1)
    expect(box(wrapper, 'audio')).toHaveLength(1)
    // 标题含 itag 与容器后缀
    expect(wrapper.find('[data-track="video"]').text()).toContain('137.mp4')
    expect(wrapper.find('[data-track="audio"]').text()).toContain('140.mp4')

    // 视频事件只染视频卡
    v1.emit('http.start', { no: 1 })
    await nextTick()
    expect(colored(wrapper, 'video', 'http-start')).toHaveLength(1)
    expect(colored(wrapper, 'audio', 'http-start')).toHaveLength(0)

    // 音频事件只染音频卡
    a1.emit('http.start', { no: 10 })
    await nextTick()
    expect(colored(wrapper, 'audio', 'http-start')).toHaveLength(1)

    // 节点统计与本端 id
    v1.emit('rtc.stat', { peerA: { state: 'open', tx: 100, rx: 200 } }, 'peer-self')
    await nextTick()
    expect(wrapper.text()).toContain('peer-self')
    expect(wrapper.text()).toContain('1/1')

    // 切换清晰度 -> 新一代加载器
    const v2 = fakeLoader('v2')
    const a2 = fakeLoader('a2')
    await ready(wrapper, [v2, a2], [dispatchMap(2, 3), dispatchMap(11)], items)

    // 上一轮的块状态与节点标识已清空
    expect(colored(wrapper, 'video', 'http-start')).toHaveLength(0)
    expect(wrapper.text()).not.toContain('peer-self')
    expect(box(wrapper, 'video')).toHaveLength(2)

    // 旧加载器的监听已通过 remove 摘除;再触发也不写入
    expect(v1.remove).toHaveBeenCalled()
    v1.emit('http.start', { no: 1 })
    v1.emit('rtc.stat', { x: { state: 'open' } }, 'old-self')
    await nextTick()
    expect(colored(wrapper, 'video', 'http-start')).toHaveLength(0)
    expect(wrapper.text()).not.toContain('old-self')

    // 新加载器正常写入
    v2.emit('http.start', { no: 2 })
    await nextTick()
    expect(colored(wrapper, 'video', 'http-start')).toHaveLength(1)

    wrapper.unmount()
  })
})

describe('StatPanel 连续快速切换', () => {
  it('连续三次 ready 后,只有最后一代(无 remove 的极简加载器)事件能写入', async () => {
    const wrapper = mountPanel({ loadItems: [videoItem(), audioItem()] })

    const g1 = bareLoader()
    const g2 = bareLoader()
    const g3 = bareLoader()

    // 同步连续切换,模拟快速点两档清晰度
    vmOf(wrapper).onLoadersready([g1 as unknown as Fastloader], [dispatchMap(1)])
    vmOf(wrapper).onLoadersready([g2 as unknown as Fastloader], [dispatchMap(2)])
    vmOf(wrapper).onLoadersready([g3 as unknown as Fastloader], [dispatchMap(3, 4, 5)])
    await nextTick()

    // 只保留最后一代的分块数量
    expect(box(wrapper, 'video')).toHaveLength(3)

    // 前两代的过期回调不写入
    g1.emit('http.start', { no: 1 })
    g2.emit('http.start', { no: 2 })
    g1.emit('rtc.stat', { p: { state: 'open' } }, 'stale-1')
    g2.emit('rtc.stat', { p: { state: 'open' } }, 'stale-2')
    await nextTick()
    expect(colored(wrapper, 'video', 'http-start')).toHaveLength(0)
    expect(wrapper.text()).not.toContain('stale-1')
    expect(wrapper.text()).not.toContain('stale-2')

    // 最后一代可写
    g3.emit('http.start', { no: 3 })
    g3.emit('rtc.stat', { p: { state: 'open', tx: 1, rx: 2 } }, 'last-self')
    await nextTick()
    expect(colored(wrapper, 'video', 'http-start')).toHaveLength(1)
    expect(wrapper.text()).toContain('last-self')

    wrapper.unmount()
  })

  it('@init 对应的 clear() 会立即作废旧一代并清空面板', async () => {
    const wrapper = mountPanel({ loadItems: [videoItem()] })
    const l = fakeLoader()
    await ready(wrapper, [l], [dispatchMap(1)])
    l.emit('http.start', { no: 1 })
    await nextTick()
    expect(colored(wrapper, 'video', 'http-start')).toHaveLength(1)

    vmOf(wrapper).clear()
    await nextTick()
    expect(colored(wrapper, 'video', 'http-start')).toHaveLength(0)
    expect(box(wrapper, 'video')).toHaveLength(0)

    // clear 后旧加载器事件不再写入
    l.emit('http.start', { no: 1 })
    await nextTick()
    expect(colored(wrapper, 'video', 'http-start')).toHaveLength(0)
  })
})

describe('StatPanel 音频模式', () => {
  it('只有音频加载器时绑定音频卡,视频卡不接收事件(有 mime)', async () => {
    const items = [audioItem(251)]
    const wrapper = mountPanel({ audio: true, loadItems: items })
    const a = fakeLoader('audio-only')
    await ready(wrapper, [a], [dispatchMap(8)], items)

    expect(wrapper.find('[data-track="audio"]').text()).toContain('251.')
    expect(wrapper.find('[data-track="video"] .text-base').text()).toBeTruthy()

    a.emit('http.start', { no: 8 })
    await nextTick()
    expect(colored(wrapper, 'audio', 'http-start')).toHaveLength(1)
    expect(colored(wrapper, 'video', 'http-start')).toHaveLength(0)
    wrapper.unmount()
  })

  it('极端情况下 loadItems 缺 mime, audio 开关仍把唯一加载器导向音频卡', async () => {
    const wrapper = mountPanel({ audio: true, loadItems: [] })
    const a = fakeLoader()
    // 不传第三参,走 prop(空数组)+ audio 兜底
    await ready(wrapper, [a], [dispatchMap(1)])

    a.emit('rtc.done', { no: 1 })
    await nextTick()
    expect(colored(wrapper, 'audio', 'rtc-done')).toHaveLength(1)
    expect(colored(wrapper, 'video', 'rtc-done')).toHaveLength(0)
    wrapper.unmount()
  })
})

describe('StatPanel 卸载', () => {
  it('unmount 后 remove 被调用,旧加载器再触发事件不报错也不写状态', async () => {
    const wrapper = mountPanel({ loadItems: [videoItem(), audioItem()] })
    const v = fakeLoader()
    const a = fakeLoader()
    await ready(wrapper, [v, a], [dispatchMap(1), dispatchMap(2)])

    wrapper.unmount()

    // 六个事件 + rtc.stat 均尝试解绑
    expect(v.remove).toHaveBeenCalled()
    expect(a.remove).toHaveBeenCalled()
    expect(v.removedWith.some(([e]) => e === 'http.start')).toBe(true)

    expect(() => {
      v.emit('http.start', { no: 1 })
      v.emit('rtc.stat', { p: {} }, 'after-unmount')
      a.emit('rtc.progress', { part: 2 })
    }).not.toThrow()
  })

  it('加载器没有 remove/off 时,unmount 后的残留回调被守卫拦截', async () => {
    const wrapper = mountPanel({ loadItems: [videoItem()] })
    const l = bareLoader()
    await ready(wrapper, [l as unknown as FakeLoader], [dispatchMap(1)])
    wrapper.unmount()
    expect(() => l.emit('http.done', { no: 1 })).not.toThrow()
  })
})
