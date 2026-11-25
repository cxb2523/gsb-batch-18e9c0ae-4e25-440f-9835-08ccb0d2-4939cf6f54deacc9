import { createFileRoute, notFound } from '@tanstack/react-router'
import { Play } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import { GlassButton, GlassSlideToConfirm, GlassTabs } from '@/components/liquid-glass'
import { MIRROR } from '@/components/liquid-glass/engine'
import { GlassSelect } from '@/components/liquid-glass/glass-select'

import { MIRROR_KNOBS as KNOBS, MIRROR_STORE as STORE } from './-mirror-knobs'

// The kit's own values, kept apart from what the sliders change.
const MIRROR_DEFAULTS = { ...MIRROR }

// Development only (a 404 in production): what the rim mirrors of its surroundings, on sliders.
// A flat-colour neighbour sits beside each glass; move it, recolour it, and tune how the rim
// that faces it takes its colour. Copy the values into MIRROR (engine.ts) when they look right.
export const Route = createFileRoute('/{-$locale}/mirror-lab')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound()
  },
  head: () => ({ meta: [{ title: 'Mirror lab — Liquid Glass UI' }, { name: 'robots', content: 'noindex' }] }),
  component: MirrorLab,
})

type Locale = 'en' | 'tr'

const COPY = {
  en: {
    title: 'Reflection',
    note: 'Changes apply at once. The picture of the surroundings is taken again a few times a second at most, so a moved neighbour may take a moment to show.',
    scene: 'Scene',
    sceneNote: 'Only clear glass mirrors. Hold the thumb, or press a tab: their glass is clear only while it is held. The two coloured buttons are there to show that they mirror nothing. The theme switch is in the header.',
    colour: 'Neighbour colour',
    custom: 'Custom',
    gap: 'Distance (px)',
    size: 'Neighbour height (px)',
    side: 'Side',
    above: 'Above',
    below: 'Below',
    off: 'Hide the neighbours',
    copy: 'Copy values',
    copied: 'Copied',
    reset: 'Reset',
    slide: 'Stop',
    play: 'Play',
    publish: 'Publish',
    cancel: 'Cancel',
    tabs: ['Day', 'Week', 'Month'],
    select: 'Delivery',
    placeholder: 'Choose a speed',
    options: ['Standard', 'Express', 'Same day'],
  },
  tr: {
    title: 'Yansıma',
    note: 'Değişiklikler anında uygulanır. Çevrenin resmi saniyede en fazla birkaç kez yeniden çekilir; yeri değişen komşunun görünmesi bir an sürebilir.',
    scene: 'Sahne',
    sceneNote: 'Yalnız şeffaf cam yansıtır. Topuzu basılı tut ya da bir sekmeye bas: onların camı yalnız tutulurken şeffaftır. İki renkli buton, hiçbir şey yansıtmadıklarını göstermek için orada. Tema düğmesi üst çubukta.',
    colour: 'Komşu rengi',
    custom: 'Özel',
    gap: 'Uzaklık (px)',
    size: 'Komşu yüksekliği (px)',
    side: 'Taraf',
    above: 'Üstte',
    below: 'Altta',
    off: 'Komşuları gizle',
    copy: 'Değerleri kopyala',
    copied: 'Kopyalandı',
    reset: 'Sıfırla',
    slide: 'Durdur',
    play: 'Oynat',
    publish: 'Yayınla',
    cancel: 'Vazgeç',
    tabs: ['Gün', 'Hafta', 'Ay'],
    select: 'Teslimat',
    placeholder: 'Hız seç',
    options: ['Standart', 'Ekspres', 'Aynı gün'],
  },
}

const SWATCHES = ['#ff9330', '#ff3b5c', '#2f6bff', '#22c55e', '#ffd60a', '#ffffff', '#000000']

type Scene = { colour: string; gap: number; size: number; side: 'above' | 'below'; off: boolean }
const SCENE_DEFAULTS: Scene = { colour: SWATCHES[0], gap: 14, size: 56, side: 'above', off: false }

// Bumped when the set of values changes, so stale saved ones do not override the kit's.
const SCENE_STORE = 'glass-mirror-scene-1'

/** A range input with its name, its value and what it does. */
function Knob({ label, hint, value, min, max, step, onChange }: { label: string; hint?: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return (
    <label className="flex flex-col gap-1" title={hint}>
      <span className="flex items-baseline justify-between">
        <span>{label}</span>
        <span className="font-mono text-caption text-muted-foreground tabular-nums">{value}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
      {hint && <span className="text-micro text-muted-foreground">{hint}</span>}
    </label>
  )
}

/** A row of choices, one of them picked. */
function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span>{label}</span>
      <div className="flex gap-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={o.value === value}
            onClick={() => onChange(o.value)}
            className="press flex-1 rounded-md border border-border px-2 py-1 text-caption hover:bg-accent aria-pressed:bg-foreground aria-pressed:text-background"
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** One glass with its neighbour: a flat-colour pill at `gap` px, above or below. */
function Specimen({ scene, children }: { scene: Scene; children: ReactNode }) {
  return (
    <div className={`flex w-64 items-center ${scene.side === 'above' ? 'flex-col' : 'flex-col-reverse'}`} style={{ gap: scene.gap }}>
      <div aria-hidden className="w-full shrink-0 rounded-full" style={{ height: scene.size, backgroundColor: scene.colour, visibility: scene.off ? 'hidden' : 'visible' }} />
      {children}
    </div>
  )
}

function MirrorLab() {
  const { locale } = Route.useRouteContext() as { locale: Locale }
  const t = COPY[locale]
  const [values, setValues] = useState({ ...MIRROR_DEFAULTS })
  const [scene, setScene] = useState<Scene>(SCENE_DEFAULTS)
  const [copied, setCopied] = useState(false)
  const [tab, setTab] = useState('week')
  const [speed, setSpeed] = useState<string | null>(null)

  // Values survive a reload, so tuning can go on across sessions.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null')
      if (saved) setValues((v) => ({ ...v, ...saved }))
      const place = JSON.parse(localStorage.getItem(SCENE_STORE) ?? 'null')
      if (place) setScene((s) => ({ ...s, ...place }))
    } catch {
      // Nothing saved, or storage is unavailable: the defaults stand.
    }
  }, [])
  // The engine reads MIRROR on every frame it draws; a resize makes every glass draw again
  // and take a new picture of what is around it.
  useEffect(() => {
    Object.assign(MIRROR, values)
    window.dispatchEvent(new Event('resize'))
    try {
      localStorage.setItem(STORE, JSON.stringify(values))
      localStorage.setItem(SCENE_STORE, JSON.stringify(scene))
    } catch {
      // Storage is unavailable: the values still apply for this visit.
    }
  }, [values, scene])
  // Leaving the lab puts the kit's own values back.
  useEffect(() => () => void Object.assign(MIRROR, MIRROR_DEFAULTS), [])

  const text = JSON.stringify({ MIRROR: values }, null, 2)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // No clipboard access: the values are in the box below, ready to select.
    }
  }
  const place = <K extends keyof Scene>(key: K, value: Scene[K]) => setScene((s) => ({ ...s, [key]: value }))

  // Narrower below a wide screen, so the glass still fits between the two; stacked under it on a phone.
  const panel = 'fixed top-24 bottom-4 z-10 flex w-56 flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-background p-4 text-ui text-foreground xl:w-72 max-md:static max-md:mt-6 max-md:w-[calc(100%-2rem)]'
  const resetButton = 'press rounded-md px-2 py-1 text-caption text-muted-foreground hover:bg-accent'

  return (
    <main className="relative isolate flex min-h-dvh flex-col items-center gap-14 overflow-hidden pt-32 pb-24 bg-stage max-md:pb-6">
      <Specimen scene={scene}>
        {/* A fill as quiet as the track, so the held thumb is dark glass, as on the reference. */}
        <GlassSlideToConfirm className="w-full" size="xl" resetAfter={1200} onConfirm={() => undefined} fillClassName="bg-neutral-300 text-neutral-900 dark:bg-neutral-700 dark:text-white">
          {t.slide}
        </GlassSlideToConfirm>
      </Specimen>
      <Specimen scene={scene}>
        <GlassButton size="xl" tint={0} icon={<Play />} iconPosition="start">
          {t.play}
        </GlassButton>
      </Specimen>
      <Specimen scene={scene}>
        <div className="flex gap-3">
          <GlassButton material="tinted" size="lg" className="bg-neutral-900 text-white">
            {t.publish}
          </GlassButton>
          <GlassButton material="tinted" size="lg" className="border border-black/15 bg-white text-neutral-900">
            {t.cancel}
          </GlassButton>
        </div>
      </Specimen>
      <Specimen scene={scene}>
        <div>
          <GlassTabs aria-label={t.scene} size="lg" value={tab} onValueChange={setTab} options={['day', 'week', 'month'].map((value, i) => ({ value, label: t.tabs[i] }))} />
        </div>
      </Specimen>
      <Specimen scene={scene}>
        <div className="w-full">
          <GlassSelect label={t.select} placeholder={t.placeholder} options={['standard', 'express', 'same-day'].map((value, i) => ({ value, label: t.options[i] }))} value={speed} onValueChange={setSpeed} name="speed" />
        </div>
      </Specimen>

      {/* The scene, on the left: the neighbour and what the glass sits on. */}
      <aside data-glass-skip="" className={`${panel} left-4`}>
        <div className="flex items-center justify-between">
          <h2 className="text-body-sm font-semibold">{t.scene}</h2>
          <button type="button" onClick={() => setScene(SCENE_DEFAULTS)} className={resetButton}>
            {t.reset}
          </button>
        </div>
        <p className="text-caption text-muted-foreground">{t.sceneNote}</p>
        <div className="flex flex-col gap-1">
          <span>{t.colour}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {SWATCHES.map((colour) => (
              <button
                key={colour}
                type="button"
                aria-label={colour}
                aria-pressed={scene.colour === colour}
                onClick={() => place('colour', colour)}
                className="press size-6 rounded-full border border-border aria-pressed:outline-2 aria-pressed:outline-offset-2 aria-pressed:outline-foreground"
                style={{ backgroundColor: colour }}
              />
            ))}
            <label className="flex items-center gap-1 text-caption text-muted-foreground">
              <input type="color" value={scene.colour} onChange={(e) => place('colour', e.target.value)} className="size-6 cursor-pointer rounded border border-border bg-transparent p-0" />
              {t.custom}
            </label>
          </div>
        </div>
        <Knob label={t.gap} value={scene.gap} min={0} max={120} step={1} onChange={(v) => place('gap', v)} />
        <Knob label={t.size} value={scene.size} min={8} max={120} step={1} onChange={(v) => place('size', v)} />
        <Choice
          label={t.side}
          value={scene.side}
          onChange={(v) => place('side', v)}
          options={[
            { value: 'above', label: t.above },
            { value: 'below', label: t.below },
          ]}
        />
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={scene.off} onChange={(e) => place('off', e.target.checked)} />
          {t.off}
        </label>
      </aside>

      {/* The reflection itself, on the right. */}
      <aside data-glass-skip="" className={`${panel} right-4`}>
        <div className="flex items-center justify-between">
          <h2 className="text-body-sm font-semibold">{t.title}</h2>
          <button type="button" onClick={() => setValues({ ...MIRROR_DEFAULTS })} className={resetButton}>
            {t.reset}
          </button>
        </div>
        <p className="text-caption text-muted-foreground">{t.note}</p>
        {KNOBS.map((k) => (
          <Knob
            key={k.key}
            label={locale === 'tr' ? k.tr : k.en}
            hint={locale === 'tr' ? k.hintTr : k.hintEn}
            value={values[k.key]}
            min={k.min}
            max={k.max}
            step={k.step}
            onChange={(value) => setValues((v) => ({ ...v, [k.key]: value }))}
          />
        ))}
        <button type="button" onClick={copy} className="press mt-1 rounded-md bg-foreground px-3 py-2 text-ui font-medium text-background">
          {copied ? t.copied : t.copy}
        </button>
        <textarea readOnly value={text} rows={8} onFocus={(e) => e.currentTarget.select()} className="rounded-md border border-border bg-background p-2 font-mono text-micro" />
      </aside>
    </main>
  )
}
