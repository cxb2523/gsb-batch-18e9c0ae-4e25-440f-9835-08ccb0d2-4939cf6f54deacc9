/**
 * StatPanel 与 fastloadjs 加载器之间的绑定生命周期核心。
 *
 * 不依赖 Vue,便于用假加载器直接验证:
 * - 重建代次(generation):连续切换时只有最后一代回调允许写入统计;
 * - 监听解绑:每一代登记自己的解绑函数,重建/卸载时统一执行;
 * - 轨道识别:按 LoadItem.mimeCodec 区分视频轨/音频轨,音频模式单加载器兜底到音频卡。
 */
import type { Fastloader, LoadItem, SegmentItem } from '@/types'

export type TrackKind = 'video' | 'audio'

/** StatCard 暴露给父组件的最小命令式接口 */
export interface StatCardLike {
  statusupdate(type: string, res: SegmentItem & { i?: number; n?: number }): void
  reset?(): void
}

/** StatPanel 提供的写入落点(隔离 Vue ref,核心逻辑不直接碰视图状态) */
export interface StatSink {
  rtcStat(stat: unknown, uid?: unknown): void
  cardEvent(kind: TrackKind, type: string, res: unknown): void
}

export type StatEventHandler = (...args: unknown[]) => void

/** fastloadjs 真实解绑方法为 remove(event, cb);不同假对象/版本可能叫别的名字 */
type LoaderWithOff = Fastloader & {
  remove?: (event?: string, cb?: StatEventHandler) => unknown
  unlisten?: (event: string, cb?: StatEventHandler) => unknown
  off?: (event: string, cb?: StatEventHandler) => unknown
  removeListener?: (event: string, cb?: StatEventHandler) => unknown
  removeEventListener?: (event: string, cb?: StatEventHandler) => unknown
}

/** 依据 mimeCodec(形如 `video/mp4; codecs="avc1.4d401f"`)判断轨道类型 */
export function kindOfMime(mimeCodec?: string | null): TrackKind | undefined {
  if (!mimeCodec) return undefined
  const m = String(mimeCodec).toLowerCase()
  if (m.startsWith('audio/')) return 'audio'
  if (m.startsWith('video/')) return 'video'
  // 个别降级响应的 type 可能不带 video//audio/ 前缀,用编码标识兜底
  if (/mp4a|opus|vorbis|aac|mpeg[- ]?audio/.test(m)) return 'audio'
  if (/avc1|avc3|hev1|hvc1|vp0?8|vp0?9|av01/.test(m)) return 'video'
  return undefined
}

export interface TrackIndexes {
  video?: number
  audio?: number
}

/**
 * 决定 loaders/dispatchs/loadItems 数组中每个下标所属的轨道。
 *
 * 引擎 attach 时按 items 顺序创建 loaders 与 dispatch map(见 fastload.min.js),
 * 因此三者同序。优先用 mimeCodec 识别;全部无法识别时沿用
 * 「0=视频,1=音频」的 DASH 双轨约定;只有一个加载器且处于音频模式时归音频,
 * 避免把唯一的音频加载器错绑到视频卡。
 */
export function resolveTrackIndexes(
  items: Array<Pick<LoadItem, 'mimeCodec'> | null | undefined> | undefined | null,
  loaderCount: number,
  audioOnly = false,
): TrackIndexes {
  const n = Math.max(loaderCount, items?.length ?? 0)
  const byMime: TrackIndexes = {}
  const unknown: number[] = []
  for (let i = 0; i < n; i++) {
    const kind = kindOfMime(items?.[i]?.mimeCodec)
    if (kind) {
      // 同类型多轨(多音轨等)只绑第一个,统计面板只有一张音频卡
      if (byMime[kind] === undefined) byMime[kind] = i
    } else {
      unknown.push(i)
    }
  }

  if (byMime.video === undefined && byMime.audio === undefined) {
    if (n >= 2) return { video: 0, audio: 1 }
    if (n === 1) return audioOnly ? { audio: 0 } : { video: 0 }
    return {}
  }

  // mime 只识别出部分轨道时,未识别下标按空缺补位(仍受 audioOnly 约束)
  for (const i of unknown) {
    if (byMime.video === undefined && !audioOnly) byMime.video = i
    else if (byMime.audio === undefined) byMime.audio = i
  }
  return byMime
}

/** 解绑单个加载器上的指定监听,兼容 fastloadjs 的 remove 与常见 off 命名 */
export function offLoader(loader: Fastloader | LoaderWithOff, event: string, handler: StatEventHandler): void {
  const l = loader as LoaderWithOff
  try {
    if (typeof l.remove === 'function') l.remove(event, handler)
    else if (typeof l.unlisten === 'function') l.unlisten(event, handler)
    else if (typeof l.off === 'function') l.off(event, handler)
    else if (typeof l.removeListener === 'function') l.removeListener(event, handler)
    else if (typeof l.removeEventListener === 'function') l.removeEventListener(event, handler)
  } catch {
    // 加载器可能已销毁、事件表已清空;解绑失败不应影响新一轮绑定
  }
}

const GLOBAL_EVENTS = ['rtc.stat'] as const
const CARD_EVENTS = ['http.start', 'http.done', 'rtc.start', 'rtc.done', 'rtc.progress'] as const

function isLoaderLike(x: unknown): x is Fastloader {
  return !!x && typeof x === 'object' && typeof (x as { listen?: unknown }).listen === 'function'
}

/** 数组且(为空或至少一个元素带 listen),用于从实参中辨认 loaders 位 */
function isLoaderArray(x: unknown): x is Fastloader[] {
  return Array.isArray(x) && (x.length === 0 || x.some(isLoaderLike))
}

export interface ReadyArgs {
  items?: LoadItem[]
  loaders: Fastloader[]
  dispatchs: unknown[]
}

/**
 * 归一化 onLoadersready 实参,兼容两种调用约定:
 * 既有 `(loaders, dispatchs, items?)` 与 `(items, loaders, dispatchs)`。
 * 常规(非空 loaders 首参)路径与旧实现完全一致。
 */
export function normalizeReadyArgs(a: unknown, b?: unknown, c?: unknown): ReadyArgs {
  if (isLoaderArray(a)) {
    // 空首参数组有歧义:若第二参是非空 loader 数组,按 items-first 处理
    if (Array.isArray(a) && a.length === 0 && Array.isArray(b) && b.length > 0 && isLoaderArray(b)) {
      return { items: a as unknown as LoadItem[], loaders: b, dispatchs: (c as unknown[]) ?? [] }
    }
    return {
      loaders: a,
      dispatchs: Array.isArray(b) ? b : [],
      items: Array.isArray(c) ? (c as LoadItem[]) : undefined,
    }
  }
  if (isLoaderArray(b)) {
    return { items: a as LoadItem[] | undefined, loaders: b, dispatchs: Array.isArray(c) ? c : [] }
  }
  return {
    loaders: Array.isArray(a) ? (a as Fastloader[]) : [],
    dispatchs: Array.isArray(b) ? b : [],
  }
}


/**
 * 管理统计面板与各代加载器之间的监听。
 * 一个 StatPanel 实例持有一个 StatSession;每次 loadersready 调 restart() 开新代。
 */
export class StatSession {
  private generation = 0
  private cleanups: Array<() => void> = []
  private disposed = false

  /** 开启新一代:代次 +1 并摘除上一代全部监听。返回新代次。已 dispose 后不再复活。 */
  restart(): number {
    this.generation += 1
    this.unbindAll()
    return this.generation
  }

  get currentGeneration(): number {
    return this.generation
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  /** 当前代次是否仍可写入(未卸载且没有被更新的重建作废) */
  private isLive(gen: number): boolean {
    return !this.disposed && gen === this.generation
  }

  /** 为指定轨道的加载器挂上全部统计监听;所有回调都带代次/卸载守卫 */
  bind(loader: Fastloader | undefined | null, kind: TrackKind, sink: StatSink): void {
    if (!isLoaderLike(loader) || this.disposed) return
    const gen = this.generation

    const subscribe = (event: string, raw: StatEventHandler) => {
      // 包一层守卫:即使假加载器没有 remove/off(旧监听仍留在其监听表里),
      // 过期代次与卸载后的回调也只会走到这里并被丢弃,不会写统计。
      const guarded: StatEventHandler = (...args) => {
        if (!this.isLive(gen)) return
        raw(...args)
      }
      const ret = loader.listen(event, guarded as (a?: unknown, b?: unknown) => void) as unknown
      // 部分事件目标的 listen/subscribe 会返回退订函数,作为解绑途径之一
      if (typeof ret === 'function') this.cleanups.push(ret as () => void)
      this.cleanups.push(() => offLoader(loader, event, guarded))
    }

    subscribe(GLOBAL_EVENTS[0], (stat, uid) => sink.rtcStat(stat, uid))

    for (const event of CARD_EVENTS) {
      subscribe(event, (...args) => sink.cardEvent(kind, event, args[0]))
    }
  }

  /** 摘除当前已登记的全部监听(不增加代次之外的副作用) */
  unbindAll(): void {
    const cleanups = this.cleanups
    this.cleanups = []
    for (const off of cleanups) off()
  }

  /** 面板卸载:永久作废并解绑,之后任何延迟事件都不得再写入 */
  dispose(): void {
    this.disposed = true
    this.generation += 1
    this.unbindAll()
  }
}

/** 把 fastloadjs 的分块事件载荷转成 StatCard.statusupdate 调用 */
export function applyCardEvent(card: StatCardLike | null | undefined, type: string, raw: unknown): void {
  if (!card) return
  switch (type) {
    case 'http.start':
      card.statusupdate('http-start', raw as SegmentItem)
      break
    case 'http.done': {
      const r = (raw ?? {}) as SegmentItem & { err?: unknown }
      card.statusupdate(r.err ? 'http-error' : 'http-done', r)
      break
    }
    case 'rtc.start':
      card.statusupdate('rtc-start', raw as SegmentItem)
      break
    case 'rtc.done':
      card.statusupdate('rtc-done', raw as SegmentItem)
      break
    case 'rtc.progress': {
      const r = (raw ?? {}) as { i?: number; n?: number; part?: number }
      card.statusupdate('progress', { no: r.part ?? 0, i: r.i, n: r.n } as SegmentItem)
      break
    }
    default:
      break
  }
}
