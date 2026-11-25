import { createFileRoute, notFound } from '@tanstack/react-router'
import { ChevronDown, Download, Ellipsis, FolderInput, Heart, Share2, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { MENU } from '@/components/liquid-glass/engine'
import { GlassMenu, GlassMenuContent, GlassMenuItem, GlassMenuSeparator, GlassMenuSub, GlassMenuSubContent, GlassMenuSubTrigger, GlassMenuTrigger } from '@/components/liquid-glass/glass-menu'

// The kit's own values, kept apart from what the sliders change.
const DEFAULTS = { ...MENU }

// Development only (a 404 in production): the growing popup (GlassPopup with `opening: 'grow'`,
// MENU in engine.ts) on a Menu. The button and the card are Select's own and are tuned in
// /select-lab; here only this motion is. The menu takes no light from a press.
export const Route = createFileRoute('/{-$locale}/menu-lab')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound()
  },
  head: () => ({ meta: [{ title: 'GlassMenu lab — Liquid Glass UI' }, { name: 'robots', content: 'noindex' }] }),
  component: MenuLab,
})

// Slow motion: frames arrive as often as ever, but the clock they carry runs at `rate`, so the
// engine's springs (and nothing else on the page) move that much slower.
const clock = { rate: 1, real: 0, shown: 0 }

// `?pump`: frames advance only when `__pump(n)` is called, so the motion can be stepped and
// inspected frame by frame (and tested in a hidden tab, where real frames never fire).
const pumped = import.meta.env.DEV && typeof window !== 'undefined' && window.location.search.includes('pump')
if (pumped) {
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
      now += (1000 / 60) * clock.rate
      const run = queue
      queue = []
      for (const cb of run) cb(now)
    }
  }
}

type Locale = 'en' | 'tr'
type Key = keyof typeof MENU
type Knob = { key: Key; min: number; max: number; step: number; en: string; tr: string; hintEn: string; hintTr: string }

// The spring, both ways.
const SPRING_KNOBS: Knob[] = [
  { key: 'open', min: 0.1, max: 1.5, step: 0.01, en: 'Opening (s)', tr: 'Açılış (sn)', hintEn: 'About how long the glass takes to reach the menu', hintTr: 'Camın menüye varması yaklaşık bu kadar sürer' },
  { key: 'openBounce', min: 0, max: 0.8, step: 0.01, en: 'Opening bounce', tr: 'Açılış esnemesi', hintEn: '0: it lands without passing the menu. Higher: it lands past it and comes back', hintTr: '0: menüyü aşmadan oturur. Yükseldikçe aşıp geri gelir' },
  { key: 'close', min: 0.1, max: 1.5, step: 0.01, en: 'Closing (s)', tr: 'Kapanış (sn)', hintEn: 'About how long the glass takes to get back to the button', hintTr: 'Camın butona dönmesi yaklaşık bu kadar sürer' },
  { key: 'closeBounce', min: 0, max: 0.8, step: 0.01, en: 'Closing bounce', tr: 'Kapanış esnemesi', hintEn: '0: it lands on the button and stops. Higher: it dips past it first', hintTr: '0: butona oturup durur. Yükseldikçe önce biraz içine çöker' },
]

// The path: which side runs ahead, and how round it stays on the way.
const SHAPE_KNOBS: Knob[] = [
  { key: 'lead', min: 1, max: 4, step: 0.05, en: 'Leading side', tr: 'Öndeki kenar', hintEn: 'How far ahead the side the menu lies on runs (1 = evenly)', hintTr: 'Menünün durduğu yöndeki kenarın ne kadar önden gittiği (1 = eşit)' },
  { key: 'follow', min: 1, max: 4, step: 0.05, en: 'Following side', tr: 'Arkadaki kenar', hintEn: 'How late the other side sets off (1 = evenly)', hintTr: 'Öbür kenarın ne kadar geç yola çıktığı (1 = eşit)' },
  { key: 'round', min: 0, max: 0.5, step: 0.01, en: 'Roundness on the way', tr: 'Yoldaki yuvarlaklık', hintEn: 'Corners no tighter than this × the shorter side (0.5 = a pill all the way)', hintTr: 'Köşeler kısa kenarın bu katından dar olmaz (0.5 = yol boyu hap)' },
  { key: 'roundFrom', min: 0, max: 1, step: 0.01, en: 'Round until', tr: 'Yuvarlak kalır', hintEn: 'It stays that round until this far along (0–1)', hintTr: 'Yolun bu kadarına dek o kadar yuvarlak kalır (0–1)' },
  { key: 'roundUntil', min: 0, max: 1, step: 0.01, en: 'Own corners by', tr: 'Kendi köşeleri', hintEn: 'The menu\'s own corners are reached by this far along', hintTr: 'Menünün kendi köşelerine yolun bu kadarında varır' },
]

// What lies on the glass: the button's label and the menu's content, and the glass itself.
const CONTENT_KNOBS: Knob[] = [
  { key: 'labelFrom', min: 0, max: 1, step: 0.01, en: 'Label goes from', tr: 'Etiket gitmeye başlar', hintEn: 'The button\'s label starts to go this far along', hintTr: 'Butonun etiketi yolun bu kadarında gitmeye başlar' },
  { key: 'labelTo', min: 0, max: 1, step: 0.01, en: 'Label gone by', tr: 'Etiket biter', hintEn: 'And is gone by here; the menu\'s layer takes the glass over then', hintTr: 'Burada tamamen gider; cam o an menünün katmanına geçer' },
  { key: 'labelBlur', min: 0, max: 12, step: 0.5, en: 'Label blur (px)', tr: 'Etiket bulanıklığı (px)', hintEn: 'How soft the label gets as it goes', hintTr: 'Etiketin giderken ne kadar yumuşadığı' },
  { key: 'contentFrom', min: 0, max: 1, step: 0.01, en: 'Content shows from', tr: 'İçerik görünmeye başlar', hintEn: 'The menu\'s items start to show this far along', hintTr: 'Menünün öğeleri yolun bu kadarında görünmeye başlar' },
  { key: 'contentTo', min: 0, max: 1, step: 0.01, en: 'Content in by', tr: 'İçerik tamam', hintEn: 'And are fully there by here', hintTr: 'Burada tamamen yerindedir' },
  { key: 'contentBlur', min: 0, max: 14, step: 0.5, en: 'Content blur (px)', tr: 'İçerik bulanıklığı (px)', hintEn: 'The blur the items come out of (0 = none: the cheapest)', hintTr: 'Öğelerin içinden çıktığı bulanıklık (0 = yok: en hafifi)' },
  { key: 'frostFrom', min: 0, max: 1, step: 0.01, en: 'Card glass from', tr: 'Kart camı başlar', hintEn: 'The button\'s clear glass starts to give way to the card\'s', hintTr: 'Butonun berrak camı yerini kartınkine bırakmaya başlar' },
  { key: 'frostTo', min: 0, max: 1, step: 0.01, en: 'Card glass by', tr: 'Kart camı tamam', hintEn: 'And is the card\'s by here. Keep it at or below "Label gone by"', hintTr: 'Burada tümüyle kartın camıdır. "Etiket biter" değerini geçmesin' },
]

const RATES = [1, 0.5, 0.25, 0.1]
const SIDES = ['bottom', 'top', 'right', 'left'] as const
const ALIGNS = ['start', 'center', 'end'] as const
const TRIGGERS = ['icon', 'label'] as const

const COPY = {
  en: {
    title: 'Menu',
    note: 'Changes apply at once: open the menu to see them. The button and the card are Select\'s own; tune those in /select-lab. The menu takes no light from a press.',
    play: 'Playback',
    playNote: 'Slow the glass down to see it frame by frame, or let it open and close by itself while you move the sliders.',
    speed: 'Speed',
    loop: 'Open and close by itself',
    place: 'Where the menu lies',
    side: 'Side',
    align: 'Align',
    trigger: 'Button',
    sides: { bottom: 'Below', top: 'Above', right: 'Right', left: 'Left' },
    aligns: { start: 'Start', center: 'Centre', end: 'End' },
    triggers: { icon: 'Icon', label: 'Label' },
    spring: 'Spring',
    shape: 'Shape',
    content: 'Label, content, glass',
    copy: 'Copy values',
    copied: 'Copied',
    reset: 'Reset',
    label: 'Options',
    more: 'More',
    items: ['Save to library', 'Share', 'Download'],
    move: 'Move to',
    places: ['Favourites', 'Archive', 'New folder…'],
    remove: 'Delete',
  },
  tr: {
    title: 'Menü',
    note: 'Değişiklikler anında uygulanır: görmek için menüyü aç. Buton ve kart Select\'in kendisidir; onları /select-lab\'de ayarla. Menü basışta ışık almaz.',
    play: 'Oynatma',
    playNote: 'Camı kare kare görmek için yavaşlat ya da sürgüleri oynatırken kendi kendine açılıp kapanmasına izin ver.',
    speed: 'Hız',
    loop: 'Kendi kendine aç kapa',
    place: 'Menünün durduğu yer',
    side: 'Yön',
    align: 'Hiza',
    trigger: 'Buton',
    sides: { bottom: 'Altta', top: 'Üstte', right: 'Sağda', left: 'Solda' },
    aligns: { start: 'Başta', center: 'Ortada', end: 'Sonda' },
    triggers: { icon: 'İkon', label: 'Etiket' },
    spring: 'Yay',
    shape: 'Şekil',
    content: 'Etiket, içerik, cam',
    copy: 'Değerleri kopyala',
    copied: 'Kopyalandı',
    reset: 'Sıfırla',
    label: 'Seçenekler',
    more: 'Daha fazla',
    items: ['Kitaplığa kaydet', 'Paylaş', 'İndir'],
    move: 'Taşı',
    places: ['Favoriler', 'Arşiv', 'Yeni klasör…'],
    remove: 'Sil',
  },
}

const ICONS = [Heart, Share2, Download]

// Bumped when the set of values changes, so stale saved ones do not override the kit's.
const STORE = 'glass-menu-tuning-1'
const PLACE_STORE = 'glass-menu-place-1'

function Knobs({ knobs, values, onChange, locale }: { knobs: Knob[]; values: typeof MENU; onChange: (key: Key, value: number) => void; locale: Locale }) {
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

/** A row of choices, one pressed. */
function Choice<T extends string>({ label, options, names, value, onChange }: { label: string; options: readonly T[]; names: Record<T, string>; value: T; onChange: (value: T) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span>{label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => onChange(option)}
            className="press rounded-md border border-border px-2 py-1 text-caption text-muted-foreground aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background"
          >
            {names[option]}
          </button>
        ))}
      </div>
    </div>
  )
}

type Place = { side: (typeof SIDES)[number]; align: (typeof ALIGNS)[number]; trigger: (typeof TRIGGERS)[number] }

function MenuLab() {
  const { locale } = Route.useRouteContext()
  const t = COPY[locale]
  const [open, setOpen] = useState(false)
  const [rate, setRate] = useState(1)
  const [loop, setLoop] = useState(false)
  const [values, setValues] = useState({ ...DEFAULTS })
  const [place, setPlace] = useState<Place>({ side: 'bottom', align: 'end', trigger: 'icon' })
  const [copied, setCopied] = useState(false)

  // Values survive a reload, so tuning can go on across sessions.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null')
      if (saved) setValues((v) => ({ ...v, ...saved }))
      const where = JSON.parse(localStorage.getItem(PLACE_STORE) ?? 'null')
      if (where) setPlace((p) => ({ ...p, ...where }))
    } catch {
      // Nothing saved, or storage is unavailable: the defaults stand.
    }
  }, [])
  useEffect(() => {
    Object.assign(MENU, values)
    try {
      localStorage.setItem(STORE, JSON.stringify(values))
    } catch {
      // Storage is unavailable: the values still apply for this visit.
    }
  }, [values])
  useEffect(() => {
    try {
      localStorage.setItem(PLACE_STORE, JSON.stringify(place))
    } catch {
      // Storage is unavailable.
    }
  }, [place])
  // Leaving the lab puts the kit's own values back.
  useEffect(() => () => void Object.assign(MENU, DEFAULTS), [])

  // The slowed clock, for as long as the lab is on screen.
  useEffect(() => {
    if (pumped) return
    const real = window.requestAnimationFrame
    clock.real = 0
    window.requestAnimationFrame = (cb) =>
      real.call(window, (now) => {
        if (!clock.real) clock.real = clock.shown = now
        // Every callback of one frame is handed the same moment.
        clock.shown += (now - clock.real) * clock.rate
        clock.real = now
        cb(clock.shown)
      })
    return () => {
      window.requestAnimationFrame = real
      clock.rate = 1
    }
  }, [])
  useEffect(() => {
    clock.rate = rate
  }, [rate])
  // Opens and closes by itself, leaving the glass time to settle at the speed it is played at.
  useEffect(() => {
    if (!loop) return
    const id = setInterval(() => setOpen((o) => !o), 1300 / rate)
    return () => clearInterval(id)
  }, [loop, rate])

  const text = JSON.stringify(values, null, 2)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // No clipboard access: the values are in the box below, ready to select.
    }
  }
  const change = (key: Key, value: number) => setValues((v) => ({ ...v, [key]: value }))
  const panel = 'fixed top-24 bottom-4 z-10 flex w-56 flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-background p-4 text-ui text-foreground xl:w-72 max-md:static max-md:mt-6 max-md:w-[calc(100%-2rem)]'
  const heading = 'text-body-sm font-semibold'

  return (
    <main className="relative isolate flex min-h-dvh items-start justify-center overflow-hidden bg-stage pt-80 max-md:flex-col max-md:items-center max-md:justify-start max-md:pb-6">
      {/* The Press demo's fine grid, centred on the button (24px to its middle), with room on every side for a menu. */}
      <div aria-hidden className="absolute top-[344px] left-1/2 -z-10 grid -translate-x-1/2 -translate-y-1/2 grid-cols-[repeat(13,40px)]">
        {Array.from({ length: COLS * ROWS }, (_, i) => (
          <span key={i} className="relative size-10" style={{ opacity: fade(i % COLS, Math.floor(i / COLS)) }}>
            <span className="absolute inset-x-0 top-0 h-px bg-black/10 dark:bg-white/10" />
            <span className="absolute inset-y-0 left-0 w-px bg-black/10 dark:bg-white/10" />
          </span>
        ))}
      </div>
      {/* While it opens and closes by itself, a press on a slider must not close it. */}
      <GlassMenu open={open} onOpenChange={(next: boolean) => !loop && setOpen(next)}>
        {place.trigger === 'icon' ? (
          <GlassMenuTrigger aria-label={t.more} className="w-12 px-0">
            <Ellipsis />
          </GlassMenuTrigger>
        ) : (
          <GlassMenuTrigger>
            {t.label}
            <ChevronDown className="opacity-60" />
          </GlassMenuTrigger>
        )}
        <GlassMenuContent side={place.side} align={place.align}>
          {t.items.map((label, i) => {
            const Icon = ICONS[i]
            return (
              <GlassMenuItem key={label}>
                <Icon />
                {label}
              </GlassMenuItem>
            )
          })}
          <GlassMenuSub>
            <GlassMenuSubTrigger>
              <FolderInput />
              {t.move}
            </GlassMenuSubTrigger>
            <GlassMenuSubContent>
              {t.places.map((label) => (
                <GlassMenuItem key={label}>{label}</GlassMenuItem>
              ))}
            </GlassMenuSubContent>
          </GlassMenuSub>
          <GlassMenuSeparator />
          <GlassMenuItem destructive>
            <Trash2 />
            {t.remove}
          </GlassMenuItem>
        </GlassMenuContent>
      </GlassMenu>
      {/* Playback and placement, on the left. */}
      <aside data-glass-skip="" className={`${panel} left-4`}>
        <h2 className={heading}>{t.play}</h2>
        <p className="text-caption text-muted-foreground">{t.playNote}</p>
        <div className="flex flex-col gap-1.5">
          <span>{t.speed}</span>
          <div className="flex flex-wrap gap-1">
            {RATES.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={rate === r}
                onClick={() => setRate(r)}
                className="press rounded-md border border-border px-2 py-1 font-mono text-caption text-muted-foreground aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background"
              >
                {r}×
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center justify-between gap-2">
          <span>{t.loop}</span>
          <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
        </label>
        <h2 className={`${heading} mt-2`}>{t.place}</h2>
        <Choice label={t.side} options={SIDES} names={t.sides} value={place.side} onChange={(side) => setPlace((p) => ({ ...p, side }))} />
        <Choice label={t.align} options={ALIGNS} names={t.aligns} value={place.align} onChange={(align) => setPlace((p) => ({ ...p, align }))} />
        <Choice label={t.trigger} options={TRIGGERS} names={t.triggers} value={place.trigger} onChange={(trigger) => setPlace((p) => ({ ...p, trigger }))} />
      </aside>
      {/* The motion itself, on the right. */}
      <aside data-glass-skip="" className={`${panel} right-4`}>
        <div className="flex items-center justify-between">
          <h2 className={heading}>{t.title}</h2>
          <button type="button" onClick={() => setValues({ ...DEFAULTS })} className="press rounded-md px-2 py-1 text-caption text-muted-foreground hover:bg-accent">
            {t.reset}
          </button>
        </div>
        <p className="text-caption text-muted-foreground">{t.note}</p>
        <button type="button" onClick={copy} className="press shrink-0 rounded-md bg-foreground px-3 py-2 text-ui font-medium text-background">
          {copied ? t.copied : t.copy}
        </button>
        <h3 className="mt-1 font-medium">{t.spring}</h3>
        <Knobs knobs={SPRING_KNOBS} values={values} onChange={change} locale={locale} />
        <h3 className="mt-1 font-medium">{t.shape}</h3>
        <Knobs knobs={SHAPE_KNOBS} values={values} onChange={change} locale={locale} />
        <h3 className="mt-1 font-medium">{t.content}</h3>
        <Knobs knobs={CONTENT_KNOBS} values={values} onChange={change} locale={locale} />
        <textarea readOnly value={text} rows={8} onFocus={(e) => e.currentTarget.select()} className="rounded-md border border-border bg-background p-2 font-mono text-micro" />
      </aside>
    </main>
  )
}

const COLS = 13
const ROWS = 13

/** 1 around the middle of the grid, falling to 0 at its edge. */
const fade = (col: number, row: number) => {
  const distance = Math.hypot((col - (COLS - 1) / 2) / (COLS / 2), (row - (ROWS - 1) / 2) / (ROWS / 2))
  return Math.min(1, Math.max(0, (1 - distance) / 0.45))
}
