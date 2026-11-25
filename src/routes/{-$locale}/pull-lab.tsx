import { createFileRoute, notFound } from '@tanstack/react-router'
import { ArrowRight, Mic, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'

import { GlassButton } from '@/components/liquid-glass'
import { MIRROR, PULL } from '@/components/liquid-glass/engine'

import { MIRROR_KNOBS, MIRROR_STORE } from './-mirror-knobs'

// The kit's own values, kept apart from what the sliders change.
const PULL_DEFAULTS = { ...PULL }
const MIRROR_DEFAULTS = { ...MIRROR }

// Development only (a 404 in production): the pull (`pull` on GlassButton and GlassLayer, PULL
// in engine.ts). Hold a button and drag away from it. Pulled, a clear button comes nearer to its
// neighbours and its rim mirrors them: that reflection (MIRROR) is on sliders here too, the same
// values /mirror-lab tunes.
export const Route = createFileRoute('/{-$locale}/pull-lab')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound()
  },
  head: () => ({ meta: [{ title: 'Pull lab — Liquid Glass UI' }, { name: 'robots', content: 'noindex' }] }),
  component: PullLab,
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
type Knob<K extends string> = { key: K; min: number; max: number; step: number; en: string; tr: string; hintEn: string; hintTr: string }

// Each knob: its range and what it does, in both languages.
const KNOBS: Knob<Exclude<keyof typeof PULL, 'on'>>[] = [
  { key: 'smallUntil', min: 0, max: 240, step: 1, en: 'Small up to (px)', tr: 'Küçük sayılan boy (px)', hintEn: 'Glass up to this size follows from the point it was pressed at; larger, once the pointer is past its edge', hintTr: 'Bu boya kadar cam basıldığı noktadan izler; daha büyüğü, imleç kenarını geçince' },
  { key: 'smallReach', min: 0, max: 24, step: 0.5, en: 'Small: reach (px)', tr: 'Küçük: menzil (px)', hintEn: 'The furthest small glass is pulled, before its size is added', hintTr: 'Küçük camın en çok çekildiği mesafe, boyu eklenmeden önce' },
  { key: 'smallReachPerPx', min: 0, max: 0.6, step: 0.01, en: 'Small: reach per px', tr: 'Küçük: px başına menzil', hintEn: 'More reach for each px of its longer side', hintTr: 'Uzun kenarının her px\'i için eklenen menzil' },
  { key: 'reach', min: 0, max: 24, step: 0.5, en: 'Large: reach (px)', tr: 'Büyük: menzil (px)', hintEn: 'The furthest larger glass is pulled, before its size is added', hintTr: 'Büyük camın en çok çekildiği mesafe, boyu eklenmeden önce' },
  { key: 'reachPerPx', min: 0, max: 0.3, step: 0.005, en: 'Large: reach per px', tr: 'Büyük: px başına menzil', hintEn: 'More reach for each px of its longer side', hintTr: 'Uzun kenarının her px\'i için eklenen menzil' },
  { key: 'reachMax', min: 0, max: 60, step: 1, en: 'Large: reach at most (px)', tr: 'Büyük: en çok menzil (px)', hintEn: 'Larger glass is never pulled further than this', hintTr: 'Büyük cam bundan uzağa çekilmez' },
  { key: 'resistance', min: 0.05, max: 2, step: 0.05, en: 'Band stiffness', tr: 'Lastik sertliği', hintEn: 'Higher: the glass reaches its limit sooner', hintTr: 'Yükseldikçe cam sınırına daha çabuk varır' },
  { key: 'follow', min: 0.03, max: 0.8, step: 0.01, en: 'Follow (s)', tr: 'İzleme (sn)', hintEn: 'How long the glass takes to catch up with the pointer', hintTr: 'Camın imlece yetişme süresi' },
  { key: 'followPerPx', min: 0, max: 0.003, step: 0.0001, en: 'Follow per px (s)', tr: 'px başına izleme (sn)', hintEn: 'Larger glass is slower by this much per px', hintTr: 'Büyük cam px başına bu kadar yavaşlar' },
  { key: 'release', min: 0.1, max: 1.5, step: 0.01, en: 'Release (s)', tr: 'Bırakma (sn)', hintEn: 'How long it takes to swing back', hintTr: 'Yerine yaylanma süresi' },
  { key: 'releaseBounce', min: 0, max: 0.9, step: 0.01, en: 'Release bounce', tr: 'Bırakma esnemesi', hintEn: '0: settles without overshoot. Higher: wobbles more', hintTr: '0: taşmadan oturur. Yükseldikçe daha çok sallanır' },
  { key: 'stretch', min: 0, max: 3, step: 0.05, en: 'Stretch per pull', tr: 'Çekişe göre uzama', hintEn: 'How much the glass stretches for the distance it is pulled', hintTr: 'Camın çekildiği mesafeye göre ne kadar uzadığı' },
  { key: 'stretchPerSpeed', min: 0, max: 0.0006, step: 0.00001, en: 'Stretch per speed', tr: 'Hıza göre uzama', hintEn: 'More stretch while the pull itself moves fast', hintTr: 'Çekiş hızlı hareket ederken eklenen uzama' },
  { key: 'stretchPerDrift', min: 0, max: 0.0006, step: 0.00001, en: 'Stretch per drift', tr: 'Kaymaya göre uzama', hintEn: 'More stretch while the glass\'s own place on the page moves', hintTr: 'Camın sayfadaki yeri hareket ederken eklenen uzama' },
  { key: 'smallStretchMax', min: 0, max: 0.6, step: 0.01, en: 'Small: stretch at most', tr: 'Küçük: en çok uzama', hintEn: 'Small glass never stretches more than this', hintTr: 'Küçük cam bundan fazla uzamaz' },
  { key: 'stretchMax', min: 0, max: 0.6, step: 0.01, en: 'Large: stretch at most', tr: 'Büyük: en çok uzama', hintEn: 'Larger glass never stretches more than this', hintTr: 'Büyük cam bundan fazla uzamaz' },
]

const COPY = {
  en: {
    title: 'Pull',
    note: 'Hold a button and drag away from it, then let go. Changes apply at once.',
    mirror: 'Reflection',
    mirrorNote: 'What the rim of clear glass mirrors of its neighbours: pull a clear button towards the white one or the blue one and watch the rim that faces it. The picture of the surroundings is taken again a few times a second at most. The same values as in /mirror-lab.',
    copy: 'Copy all values',
    copied: 'Copied',
    reset: 'Reset',
    add: 'Add',
    record: 'Record',
    wide: 'Hold and drag',
    tinted: 'Continue',
    square: 'New project',
  },
  tr: {
    title: 'Çekiş',
    note: 'Bir butonu basılı tutup uzağa sürükle, sonra bırak. Değişiklikler anında uygulanır.',
    mirror: 'Yansıma',
    mirrorNote: 'Şeffaf camın kenarının komşularından yansıttığı: şeffaf bir butonu beyaz ya da mavi olana doğru çek, ona bakan kenarı izle. Çevrenin resmi saniyede en fazla birkaç kez yeniden çekilir. /mirror-lab ile aynı değerler.',
    copy: 'Tüm değerleri kopyala',
    copied: 'Kopyalandı',
    reset: 'Sıfırla',
    add: 'Ekle',
    record: 'Kaydet',
    wide: 'Basılı tut, çek',
    tinted: 'Devam et',
    square: 'Yeni proje',
  },
}

// Bumped when the set of values changes, so stale saved ones do not override the kit's.
const STORE = 'glass-pull-tuning-1'

/** One group of sliders over one set of values. */
function Knobs<K extends string>({ knobs, values, onChange, locale }: { knobs: Knob<K>[]; values: Record<K, number>; onChange: (key: K, value: number) => void; locale: Locale }) {
  return knobs.map((k) => (
    <label key={k.key} className="flex flex-col gap-1" title={locale === 'tr' ? k.hintTr : k.hintEn}>
      <span className="flex items-baseline justify-between">
        <span>{locale === 'tr' ? k.tr : k.en}</span>
        <span className="font-mono text-caption text-muted-foreground tabular-nums">{values[k.key]}</span>
      </span>
      <input type="range" min={k.min} max={k.max} step={k.step} value={values[k.key]} onChange={(e) => onChange(k.key, Number(e.target.value))} className="w-full" />
      <span className="text-micro text-muted-foreground">{locale === 'tr' ? k.hintTr : k.hintEn}</span>
    </label>
  ))
}

function Tuner({ locale }: { locale: Locale }) {
  const t = COPY[locale]
  const [values, setValues] = useState({ ...PULL_DEFAULTS })
  const [mirror, setMirror] = useState({ ...MIRROR_DEFAULTS })
  const [copied, setCopied] = useState(false)

  // Values survive a reload, so tuning can go on across sessions.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null')
      if (saved) setValues((v) => ({ ...v, ...saved }))
      const light = JSON.parse(localStorage.getItem(MIRROR_STORE) ?? 'null')
      if (light) setMirror((v) => ({ ...v, ...light }))
    } catch {
      // Nothing saved, or storage is unavailable: the defaults stand.
    }
  }, [])
  useEffect(() => {
    Object.assign(PULL, values)
    try {
      localStorage.setItem(STORE, JSON.stringify(values))
    } catch {
      // Storage is unavailable: the values still apply for this visit.
    }
  }, [values])
  // The engine reads MIRROR on every frame it draws; a resize makes every glass draw again
  // and take a new picture of what is around it.
  useEffect(() => {
    Object.assign(MIRROR, mirror)
    window.dispatchEvent(new Event('resize'))
    try {
      localStorage.setItem(MIRROR_STORE, JSON.stringify(mirror))
    } catch {
      // Storage is unavailable: the values still apply for this visit.
    }
  }, [mirror])
  // Leaving the lab puts the kit's own values back.
  useEffect(
    () => () => {
      Object.assign(PULL, PULL_DEFAULTS)
      Object.assign(MIRROR, MIRROR_DEFAULTS)
    },
    [],
  )

  const text = JSON.stringify({ PULL: values, MIRROR: mirror }, null, 2)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // No clipboard access: the values are in the box below, ready to select.
    }
  }
  // Narrower below a wide screen, so the buttons still fit between the two; stacked under them on a phone.
  const panel = 'fixed top-24 bottom-4 z-10 flex w-56 flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-background p-4 text-ui text-foreground xl:w-72 max-md:static max-md:mt-6 max-md:w-[calc(100%-2rem)]'
  const resetButton = 'press rounded-md px-2 py-1 text-caption text-muted-foreground hover:bg-accent'
  // At the top of each panel, where it shows without scrolling: both copy both sets of values.
  const copyButton = (
    <button type="button" onClick={copy} className="press shrink-0 rounded-md bg-foreground px-3 py-2 text-ui font-medium text-background">
      {copied ? t.copied : t.copy}
    </button>
  )

  return (
    <>
      {/* The reflection, on the left: what a rim mirrors of the glass beside it. */}
      <aside data-glass-skip="" className={`${panel} left-4`}>
        <div className="flex items-center justify-between">
          <h2 className="text-body-sm font-semibold">{t.mirror}</h2>
          <button type="button" onClick={() => setMirror({ ...MIRROR_DEFAULTS })} className={resetButton}>
            {t.reset}
          </button>
        </div>
        <p className="text-caption text-muted-foreground">{t.mirrorNote}</p>
        {copyButton}
        <Knobs knobs={MIRROR_KNOBS} values={mirror} onChange={(key, value) => setMirror((v) => ({ ...v, [key]: value }))} locale={locale} />
      </aside>
      {/* The pull itself, on the right. */}
      <aside data-glass-skip="" className={`${panel} right-4`}>
        <div className="flex items-center justify-between">
          <h2 className="text-body-sm font-semibold">{t.title}</h2>
          <button type="button" onClick={() => setValues({ ...PULL_DEFAULTS })} className={resetButton}>
            {t.reset}
          </button>
        </div>
        <p className="text-caption text-muted-foreground">{t.note}</p>
        {copyButton}
        <Knobs knobs={KNOBS} values={values} onChange={(key, value) => setValues((v) => ({ ...v, [key]: value }))} locale={locale} />
        <textarea readOnly value={text} rows={8} onFocus={(e) => e.currentTarget.select()} className="rounded-md border border-border bg-background p-2 font-mono text-micro" />
      </aside>
    </>
  )
}

const TICKS = 61

function PullLab() {
  const { locale } = Route.useRouteContext()
  const t = COPY[locale]

  return (
    <main className="relative isolate flex min-h-dvh flex-col items-center overflow-hidden bg-stage pt-44 max-md:pb-6">
      {/* A ruler to read the pull and the stretch against: one thin line per tick, fainter towards the ends. */}
      <div aria-hidden className="absolute top-[200px] left-1/2 -z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-[7px]">
        {Array.from({ length: TICKS }, (_, i) => (
          <span
            key={i}
            className={`w-px bg-black/15 dark:bg-white/15 ${i % 10 === 0 ? 'h-28' : i % 5 === 0 ? 'h-20' : 'h-10'}`}
            style={{ opacity: Math.min(1, (1 - Math.abs(i - (TICKS - 1) / 2) / ((TICKS - 1) / 2)) / 0.4) }}
          />
        ))}
      </div>
      {/* Small glass (the round ones) follows from the press; the wide one, once the pointer is past its edge. */}
      <div className="flex h-12 items-center gap-4">
        <GlassButton pull size="lg" tint={0.2} aria-label={t.add} className="w-12 !px-0">
          <Plus />
        </GlassButton>
        <GlassButton pull size="lg" tint={0.2}>
          {t.wide}
        </GlassButton>
        <GlassButton pull size="lg" material="tinted" aria-label={t.record} className="w-12 bg-neutral-900 !px-0 text-white dark:bg-white dark:text-neutral-900">
          <Mic />
        </GlassButton>
      </div>
      {/* Tinted and square, and the largest size. */}
      <div className="mt-24 flex flex-wrap items-center justify-center gap-4">
        <GlassButton pull size="xl" material="tinted" className="bg-sky-500 text-white" icon={<ArrowRight />}>
          {t.tinted}
        </GlassButton>
        <GlassButton pull size="xl" tint={0.3} className="rounded-2xl" icon={<Plus />} iconPosition="start">
          {t.square}
        </GlassButton>
      </div>
      <Tuner locale={locale} />
    </main>
  )
}
