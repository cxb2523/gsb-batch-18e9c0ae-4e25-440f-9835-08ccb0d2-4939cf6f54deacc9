<script setup lang="ts">
import { ref, computed, useTemplateRef, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LoadItem, RtcPeerStat, SegmentItem } from '@/types'
import { byteFormat } from '@/utils'
import StatCard from './StatCard.vue'
import { StatSession, applyCardEvent, normalizeReadyArgs, resolveTrackIndexes } from './statSession'
import type { StatSink } from './statSession'

const { t } = useI18n()
const props = withDefaults(
  defineProps<{
    title: string
    loadItems: LoadItem[]
    /** 嵌入页音频模式:只有音频轨,单加载器兜底绑到音频卡 */
    audio?: boolean
  }>(),
  { audio: false },
)

const vCard = useTemplateRef<InstanceType<typeof StatCard>>('vcard')
const aCard = useTemplateRef<InstanceType<typeof StatCard>>('acard')

const vdispatch = ref<Record<number, SegmentItem>>({})
const adispatch = ref<Record<number, SegmentItem>>({})
const stat = ref<Record<string, RtcPeerStat>>({})
/** 本端节点标识(引擎回传的 rtc.id),非资源的 swarmId */
const mid = ref('')

const names = computed(() => {
  // 不能直接按 [v, a] 解构:音频模式下 loadItems 只有一个音频轨,位置 0 并非视频
  const idx = resolveTrackIndexes(props.loadItems, props.loadItems.length, props.audio)
  const titleOf = (i: number | undefined) => {
    const item = i === undefined ? undefined : props.loadItems[i]
    if (!item) return ''
    const ext = /webm/.test(item.mimeCodec) ? 'webm' : 'mp4'
    return `${props.title}-${item.itag}.${ext}`
  }
  return { vtitle: titleOf(idx.video), atitle: titleOf(idx.audio) }
})

const statOnNum = computed(() =>
  Object.values(stat.value).filter((s) => s.state === 'open').length,
)

const LEGEND: { cls: string; key: string }[] = [
  { cls: 'http-start', key: 'stats.httpStart' },
  { cls: 'rtc-start', key: 'stats.rtcProbe' },
  { cls: 'http-start http-done', key: 'stats.httpDone' },
  { cls: 'rtc-start rtc-done', key: 'stats.rtcDone' },
  { cls: 'http-error', key: 'stats.httpError' },
  { cls: 'http-start rtc-start http-done', key: 'stats.bothHttp' },
  { cls: 'http-start rtc-start rtc-done', key: 'stats.bothRtc' },
]

/** 本面板当前的加载器绑定会话;每次重建开新一代,旧代监听被摘除且回调失效 */
const session = new StatSession()

const sink: StatSink = {
  rtcStat(s, uid) {
    stat.value = (s as Record<string, RtcPeerStat>) ?? {}
    // open/close/error 触发时只回传 stat;后者不能把已取得的节点标识清空
    if (uid) mid.value = String(uid)
  },
  cardEvent(kind, type, res) {
    const card = kind === 'video' ? vCard.value : aCard.value
    applyCardEvent(card, type, res)
  },
}

/** fastloadjs 的分块对象用 start/end 表示字节区间,StatCard 需要 m/n */
function toSegments(raw: unknown): Record<number, SegmentItem> {
  const src = (raw ?? {}) as Record<number, { no: number; start: number; end: number }>
  const out: Record<number, SegmentItem> = {}
  for (const k of Object.keys(src)) {
    const s = src[Number(k)]
    out[Number(k)] = { no: s.no, m: s.start, n: s.end }
  }
  return out
}

/** 清空上一轮的分块/节点状态与两张卡的块状态 */
function resetState() {
  stat.value = {}
  mid.value = ''
  vdispatch.value = {}
  adispatch.value = {}
  vCard.value?.reset()
  aCard.value?.reset()
}

/**
 * 由播放页在 loadersready 事件后调用。
 * 既支持既有约定 (loaders, dispatchs, items?),也兼容 (items, loaders, dispatchs);
 * 显式 items 优先,否则用面板 loadItems prop。
 */
function onLoadersready(a?: unknown, b?: unknown, c?: unknown) {
  const ready = normalizeReadyArgs(a ?? [], b, c)
  session.restart()
  resetState()

  const trackItems = ready.items ?? props.loadItems
  const indexes = resolveTrackIndexes(trackItems, ready.loaders.length, props.audio)

  if (indexes.video !== undefined) {
    vdispatch.value = toSegments(ready.dispatchs[indexes.video])
    session.bind(ready.loaders[indexes.video], 'video', sink)
  }
  if (indexes.audio !== undefined) {
    adispatch.value = toSegments(ready.dispatchs[indexes.audio])
    session.bind(ready.loaders[indexes.audio], 'audio', sink)
  }
}

/** 重建开始时可由父组件(@init)立即调用:摘除旧监听并清空统计,不等新 ready */
function clear() {
  session.restart()
  resetState()
}

onBeforeUnmount(() => {
  session.dispose()
})

defineExpose({ onLoadersready, clear })
</script>

<template>
  <div class="my-8">
    <!-- 图例 -->
    <div class="mb-4 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-zinc-600">
      <div v-for="l in LEGEND" :key="l.key" class="flex items-center gap-2">
        <span class="stat-box inline-block h-3 w-3 border border-white" :class="l.cls"></span>
        <span>{{ t(l.key) }}</span>
      </div>
    </div>

    <!-- P2P 节点 -->
    <div class="mb-4 font-mono text-xs">
      <div class="mb-2 flex items-center gap-4">
        <span class="max-w-[340px] truncate uppercase text-brand-600">{{ mid }}</span>
        <span v-if="mid">{{ statOnNum }}/{{ Object.keys(stat).length }}</span>
      </div>
      <div
        v-for="(item, key) in stat"
        :key="key"
        class="mb-1.5 flex flex-wrap items-center gap-4 rounded bg-zinc-200 px-2 py-1"
        :class="{
          'bg-green-300': item.state === 'open',
          'bg-yellow-200': item.state === 'connecting',
          'bg-rose-200': item.state === 'closing' || item.state === 'closed',
          'bg-red-400 text-white': item.cstate === 'failed' || item.istate === 'failed',
        }"
      >
        <span class="max-w-[300px] truncate uppercase">{{ t('stats.node', { key }) }}</span>
        <span>{{ t('stats.sent', { n: byteFormat(item.tx) }) }}</span>
        <span>{{ t('stats.received', { n: byteFormat(item.rx) }) }}</span>
      </div>
    </div>

    <!-- 视频/音频分块统计 -->
    <div data-track="video" class="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <div class="text-base font-medium">{{ t('stats.video') }}</div>
      <StatCard ref="vcard" :title="names.vtitle" :segments="vdispatch" />
    </div>
    <div data-track="audio" class="mt-4 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <div class="text-base font-medium">{{ t('stats.audio') }}</div>
      <StatCard ref="acard" :title="names.atitle" :segments="adispatch" />
    </div>
  </div>
</template>

<style scoped>
.stat-box.http-start {
  background: #e6af13;
}
.stat-box.http-start.http-done {
  background: #070;
}
.stat-box.http-start.http-done.rtc-start {
  background: #0d0;
}
.stat-box.rtc-start {
  opacity: 0.3;
  background: #0dd6e0;
}
.stat-box.rtc-start.rtc-done {
  background: #e50bff;
  opacity: 1;
}
.stat-box.rtc-start.rtc-done.http-start {
  background: #fe03bb;
}
.stat-box.http-start.rtc-start:not(.http-done):not(.rtc-done):not(.http-error) {
  background: #e6af13;
}
.stat-box.http-error {
  background: #a00;
  opacity: 1;
}
</style>
