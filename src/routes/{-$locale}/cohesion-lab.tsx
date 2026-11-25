import { createFileRoute, notFound } from '@tanstack/react-router'
import { Mic, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { GlassButton, GlassLayer } from '@/components/liquid-glass'
import { COHESION } from '@/components/liquid-glass/engine'

// The kit's own values, kept apart from what the sliders change.
const COHESION_DEFAULTS = { ...COHESION }

// Development only (a 404 in production): cohesion, buttons melting into each other as they come
// near (COHESION in engine.ts). Drag the loose glass towards the round one, as in Liquid Glass
// Studio, or hold a button in a row and pull it towards its neighbour.
export const Route = createFileRoute('/{-$locale}/cohesion-lab')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound()
  },
  head: () => ({ meta: [{ title: 'Cohesion lab — Liquid Glass UI' }, { name: 'robots', content: 'noindex' }] }),
  component: CohesionLab,
})

// `?pump`: frames advance only when `__pump(n)` is called, so the motion can be stepped and
// inspected frame by frame (and tested in a hidden tab, where real frames never fire).
if (import.meta.env.DEV && typeof window !== 'undefined' && window.location.search.includes('pump')) {
  const w = window as unknown as { __pump: (n: number) => void; requestAnimationFrame: (cb: FrameRequestCallback) => number; cancelAnimationFrame: (id: number) => void }
  let queue: FrameRequestCallback[] = []
  let now = performance.now()
  w.requestAnimationFrame = (cb) => queue.push(cb)
  w.cancelAnimationFrame = () => {}
  // A hidden tab never reports intersections either: everything observed counts as on screen.
  window.IntersectionObserver = class {
    constructor(private cb: IntersectionObserverCallback) {}
    observe(target: Element) {
      queueMicrotask(() => this.cb([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver))
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  } as unknown as typeof IntersectionObserver
  w.__pump = (n) => {
    for (let i = 0; i < n; i++) {
      now += 1000 / 60
      const run = queue
      queue = []
      for (const cb of run) cb(now)
    }
  }
}

type Locale = 'en' | 'tr'
type Values = Omit<typeof COHESION, 'on'>
type Knob = { key: keyof Values; min: number; max: number; step: number; en: string; tr: string; hintEn: string; hintTr: string }

// Each knob: its range and what it does, in both languages.
const KNOBS: Knob[] = [
  {
    key: 'reach',
    min: 0,
    max: 1.2,
    step: 0.01,
    en: 'Reach (× height)',
    tr: 'Erim (× yükseklik)',
    hintEn: 'How soft the bridge is, as a share of the shorter glass’s height. They begin to melt once the gap between them is under it, and join once it is under half of it',
    hintTr: 'Köprünün yumuşaklığı, kısa camın yüksekliğine oranla. Aradaki boşluk bunun altına inince kaynaşmaya başlarlar, yarısının altına inince birleşirler',
  },
  { key: 'reachMin', min: 0, max: 40, step: 1, en: 'At least (px)', tr: 'En az (px)', hintEn: 'The softness is never under this', hintTr: 'Yumuşaklık bunun altına inmez' },
  { key: 'reachMax', min: 0, max: 80, step: 1, en: 'At most (px)', tr: 'En çok (px)', hintEn: 'The softness is never over this', hintTr: 'Yumuşaklık bunu aşmaz' },
  {
    key: 'light',
    min: 0,
    max: 1,
    step: 0.01,
    en: 'Light into the other',
    tr: 'Komşuya geçen ışık',
    hintEn: 'How much of the light of a press on one glass runs on into the glass it has melted into: 0 keeps each light to its own glass, 1 lights both as one body',
    hintTr: 'Bir camdaki basışın ışığının kaynaştığı cama ne kadar geçtiği: 0 her ışığı kendi camında tutar, 1 ikisini tek gövde gibi aydınlatır',
  },
  {
    key: 'lightFade',
    min: 0.05,
    max: 4,
    step: 0.05,
    en: 'Light fade (× half height)',
    tr: 'Işığın sönmesi (× yarı yükseklik)',
    hintEn: 'How far that light runs into the other glass from where they meet before it is down to a third: low = only near the bridge, high = the whole body',
    hintTr: 'O ışığın, buluştukları yerden öteki camın içine üçte birine inene kadar ne kadar ilerlediği: düşük = yalnız köprünün yanı, yüksek = bütün gövde',
  },
]

/** The kit's own values for the sliders. */
const defaults = (): Values => ({ reach: COHESION_DEFAULTS.reach, reachMin: COHESION_DEFAULTS.reachMin, reachMax: COHESION_DEFAULTS.reachMax, light: COHESION_DEFAULTS.light, lightFade: COHESION_DEFAULTS.lightFade })

const COPY = {
  en: {
    title: 'Cohesion',
    note: 'Drag the loose glass towards the round one, or hold a button in a row and pull it towards its neighbour. Held, a button that has melted into another lights it too. Changes apply at once.',
    on: 'Melt into each other',
    copy: 'Copy all values',
    copied: 'Copied',
    reset: 'Reset',
    drag: 'Drag me',
    round: 'Still',
    add: 'Add',
    wide: 'Hold and pull',
    record: 'Record',
    save: 'Save',
    share: 'Share',
    delete: 'Delete',
    up: 'Up',
    down: 'Down',
  },
  tr: {
    title: 'Kohezyon',
    note: 'Serbest camı yuvarlak olana doğru sürükle ya da sıradaki bir butonu basılı tutup komşusuna doğru çek. Başka bir cama kaynaşmış buton basılı tutulunca onu da aydınlatır. Değişiklikler anında uygulanır.',
    on: 'Birbirine kaynaşsın',
    copy: 'Tüm değerleri kopyala',
    copied: 'Kopyalandı',
    reset: 'Sıfırla',
    drag: 'Sürükle',
    round: 'Sabit',
    add: 'Ekle',
    wide: 'Basılı tut, çek',
    record: 'Kaydet',
    save: 'Kaydet',
    share: 'Paylaş',
    delete: 'Sil',
    up: 'Yukarı',
    down: 'Aşağı',
  },
}

// Bumped when the set of values changes, so stale saved ones do not override the kit's.
const STORE = 'glass-cohesion-tuning-2'

function Tuner({ locale }: { locale: Locale }) {
  const t = COPY[locale]
  const [values, setValues] = useState<Values>(defaults)
  const [on, setOn] = useState(true)
  const [copied, setCopied] = useState(false)

  // Values survive a reload, so tuning can go on across sessions.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null')
      if (saved) setValues((v) => ({ ...v, ...saved }))
    } catch {
      // Nothing saved, or storage is unavailable: the defaults stand.
    }
  }, [])
  // The engine reads COHESION on every frame; a resize makes every glass measure and draw again.
  useEffect(() => {
    Object.assign(COHESION, values, { on })
    window.dispatchEvent(new Event('resize'))
    try {
      localStorage.setItem(STORE, JSON.stringify(values))
    } catch {
      // Storage is unavailable: the values still apply for this visit.
    }
  }, [values, on])
  // Leaving the lab puts the kit's own values back.
  useEffect(
    () => () => {
      Object.assign(COHESION, COHESION_DEFAULTS)
    },
    [],
  )

  const text = JSON.stringify({ COHESION: { on: true, ...values } }, null, 2)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // No clipboard access: the values are in the box below, ready to select.
    }
  }

  return (
    <aside
      data-glass-skip=""
      className="fixed top-24 right-4 bottom-4 z-10 flex w-64 flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-background p-4 text-ui text-foreground xl:w-72 max-md:static max-md:mt-6 max-md:w-[calc(100%-2rem)]"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-body-sm font-semibold">{t.title}</h2>
        <button type="button" onClick={() => setValues(defaults())} className="press rounded-md px-2 py-1 text-caption text-muted-foreground hover:bg-accent">
          {t.reset}
        </button>
      </div>
      <p className="text-caption text-muted-foreground">{t.note}</p>
      <button type="button" onClick={copy} className="press shrink-0 rounded-md bg-foreground px-3 py-2 text-ui font-medium text-background">
        {copied ? t.copied : t.copy}
      </button>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
        <span>{t.on}</span>
      </label>
      {KNOBS.map((k) => (
        <label key={k.key} className="flex flex-col gap-1" title={locale === 'tr' ? k.hintTr : k.hintEn}>
          <span className="flex items-baseline justify-between">
            <span>{locale === 'tr' ? k.tr : k.en}</span>
            <span className="font-mono text-caption text-muted-foreground tabular-nums">{values[k.key]}</span>
          </span>
          <input type="range" min={k.min} max={k.max} step={k.step} value={values[k.key]} onChange={(e) => setValues((v) => ({ ...v, [k.key]: Number(e.target.value) }))} className="w-full" />
          <span className="text-micro text-muted-foreground">{locale === 'tr' ? k.hintTr : k.hintEn}</span>
        </label>
      ))}
      <textarea readOnly value={text} rows={6} onFocus={(e) => e.currentTarget.select()} className="rounded-md border border-border bg-background p-2 font-mono text-micro" />
    </aside>
  )
}

/**
 * Glass that follows the pointer while it is dragged, on a spring that lags a little behind it (as
 * the moving shape of Liquid Glass Studio does). The host's `translate` is written here and the
 * glass is never pulled. A moved host is news to the glass: each move is announced as a scroll,
 * which makes clear glass take its place and what lies behind it again.
 */
function Loose({ label }: { label: string }) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const host = ref.current
    if (!host) return
    const at = { x: 0, y: 0, vx: 0, vy: 0 }
    const goal = { x: 0, y: 0 }
    let grab: { id: number; dx: number; dy: number } | null = null
    let raf = 0
    let last = 0
    const tick = (now: number) => {
      raf = 0
      const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60
      last = now
      // A spring a little softer than the finger: the glass trails it and settles without a bounce.
      const omega = 18
      for (const axis of ['x', 'y'] as const) {
        const v = axis === 'x' ? 'vx' : 'vy'
        const a = -omega * omega * (at[axis] - goal[axis]) - 2 * omega * at[v]
        at[v] += a * dt
        at[axis] += at[v] * dt
      }
      host.style.translate = `${at.x.toFixed(2)}px ${at.y.toFixed(2)}px`
      window.dispatchEvent(new Event('scroll'))
      const moving = Math.abs(at.x - goal.x) > 0.05 || Math.abs(at.y - goal.y) > 0.05 || Math.hypot(at.vx, at.vy) > 0.5
      if (moving || grab) raf = requestAnimationFrame(tick)
      else last = 0
    }
    const start = () => {
      if (!raf) raf = requestAnimationFrame(tick)
    }
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return
      host.setPointerCapture(e.pointerId)
      grab = { id: e.pointerId, dx: e.clientX - goal.x, dy: e.clientY - goal.y }
      start()
    }
    const move = (e: PointerEvent) => {
      if (grab?.id !== e.pointerId) return
      goal.x = e.clientX - grab.dx
      goal.y = e.clientY - grab.dy
      start()
    }
    const up = (e: PointerEvent) => {
      if (grab?.id === e.pointerId) grab = null
    }
    host.addEventListener('pointerdown', down)
    host.addEventListener('pointermove', move)
    host.addEventListener('pointerup', up)
    host.addEventListener('pointercancel', up)
    return () => {
      cancelAnimationFrame(raf)
      host.removeEventListener('pointerdown', down)
      host.removeEventListener('pointermove', move)
      host.removeEventListener('pointerup', up)
      host.removeEventListener('pointercancel', up)
    }
  }, [])
  return (
    <button
      ref={ref}
      type="button"
      data-glass-host=""
      className="absolute top-[calc(50%-2rem)] left-[12%] inline-flex h-16 w-40 cursor-grab touch-none items-center justify-center rounded-full bg-white/60 text-[17px] font-semibold text-neutral-900 select-none active:cursor-grabbing"
    >
      <GlassLayer tint={0.15} pull={false} />
      {label}
    </button>
  )
}

function CohesionLab() {
  const { locale } = Route.useRouteContext()
  const t = COPY[locale]

  return (
    <main className="relative isolate flex min-h-dvh flex-col items-center gap-16 overflow-hidden bg-stage px-4 pt-28 pb-16 md:pr-80">
      {/* A field for the loose glass: flat colour shapes for it to bend, and the round glass it melts into. */}
      <section className="relative h-80 w-full max-w-3xl overflow-hidden rounded-3xl bg-[#f4efe6] dark:bg-[#1d1b18]">
        <div aria-hidden className="absolute top-8 left-[8%] size-40 rounded-full bg-[#ff6b35]" />
        <div aria-hidden className="absolute right-[10%] bottom-6 size-48 rounded-full bg-[#2f6bff]" />
        <div aria-hidden className="absolute top-0 left-1/2 h-full w-10 -translate-x-1/2 bg-[#ffd23f]" />
        <div aria-hidden className="absolute top-1/2 left-0 h-6 w-full -translate-y-1/2 bg-[#1b998b]" />
        <button
          type="button"
          data-glass-host=""
          aria-label={t.round}
          className="absolute top-1/2 left-1/2 size-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/60"
        >
          <GlassLayer tint={0.15} pull={false} />
        </button>
        <Loose label={t.drag} />
      </section>

      {/* A row set close together: hold one and pull it towards its neighbour. */}
      <section className="flex items-center gap-2.5">
        <GlassButton size="lg" tint={0.2} aria-label={t.add} className="w-12 !px-0">
          <Plus />
        </GlassButton>
        <GlassButton size="lg" tint={0.2}>
          {t.wide}
        </GlassButton>
        <GlassButton size="lg" tint={0.2} aria-label={t.record} className="w-12 !px-0">
          <Mic />
        </GlassButton>
      </section>

      {/* Tinted glass of different colours, and a stack. */}
      <section className="flex flex-wrap items-center justify-center gap-10">
        <div className="flex items-center gap-2.5">
          <GlassButton material="tinted" size="lg" className="bg-blue-600 text-white">
            {t.save}
          </GlassButton>
          <GlassButton material="tinted" size="lg" className="bg-rose-600 text-white">
            {t.delete}
          </GlassButton>
          <GlassButton material="tinted" size="lg" className="border border-black/15 bg-white text-neutral-900">
            {t.share}
          </GlassButton>
        </div>
        <div className="flex flex-col items-center gap-2.5">
          <GlassButton size="lg" tint={0.2}>
            {t.up}
          </GlassButton>
          <GlassButton size="lg" material="tinted" className="bg-neutral-900 text-white dark:bg-white dark:text-neutral-900">
            {t.down}
          </GlassButton>
        </div>
      </section>
      <Tuner locale={locale} />
    </main>
  )
}
