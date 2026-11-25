import { createFileRoute, notFound } from '@tanstack/react-router'
import { useEffect, useState, type ComponentType } from 'react'

import { LIGHT } from '@/components/liquid-glass/engine'
import CheckboxDemo from '@/docs/demos/checkbox'
import ActionButtonDemo from '@/docs/demos/glass-action-button-basic'
import BadgeDemo from '@/docs/demos/glass-badge-basic'
import ButtonClearDemo from '@/docs/demos/glass-button-clear'
import ButtonGroupDemo from '@/docs/demos/glass-button-group-basic'
import ButtonTintedDemo from '@/docs/demos/glass-button-tinted'
import CardDemo from '@/docs/demos/glass-card-basic'
import SlideDemo from '@/docs/demos/glass-slide-to-confirm-compact'
import TabsDemo from '@/docs/demos/glass-tabs-basic'
import TabsIconsDemo from '@/docs/demos/glass-tabs-icons'
import SliderDemo from '@/docs/demos/range-slider'
import SwitchDemo from '@/docs/demos/switch'

// The kit's own values, kept apart from what the sliders change.
const LIGHT_DEFAULTS = { ...LIGHT }

// Development only (a 404 in production): the light under the pointer (LIGHT in engine.ts) on
// every component that does not open a surface, each in its own docs demo. Press a
// glass, hold and drag away. Select, Dropdown Menu and Popover keep their own light.
export const Route = createFileRoute('/{-$locale}/light-lab')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound()
  },
  head: () => ({ meta: [{ title: 'Light lab — Liquid Glass UI' }, { name: 'robots', content: 'noindex' }] }),
  component: LightLab,
})

type Locale = 'en' | 'tr'
type Key = Exclude<keyof typeof LIGHT, 'on'>
type Knob = { key: Key; min: number; max: number; step: number; en: string; tr: string; hintEn: string; hintTr: string }

// Each knob: its range and what it does, in both languages.
const KNOBS: Knob[] = [
  { key: 'strength', min: 0, max: 1, step: 0.01, en: 'Strength, light page', tr: 'Güç, açık sayfa', hintEn: 'How white the glass is under the pointer at full light', hintTr: 'Tam ışıkta camın imleç altında ne kadar beyazladığı' },
  { key: 'strengthDark', min: 0, max: 1, step: 0.01, en: 'Strength, dark page', tr: 'Güç, koyu sayfa', hintEn: 'The same on a dark page, where white shows sooner', hintTr: 'Aynısı koyu sayfada; beyaz orada daha çabuk görünür' },
  { key: 'press', min: 0, max: 1, step: 0.01, en: 'Press', tr: 'Basış', hintEn: 'How much of the full light a press brings', hintTr: 'Basınca tam ışığın ne kadarı yanar' },
  { key: 'size', min: 0.1, max: 3, step: 0.05, en: 'Radius × longer side', tr: 'Yarıçap × uzun kenar', hintEn: 'The light reaches this far, as a share of the glass\'s longer side', hintTr: 'Işığın uzandığı mesafe, camın uzun kenarına oranla' },
  { key: 'sizeMin', min: 0, max: 200, step: 1, en: 'Radius at least (px)', tr: 'En az yarıçap (px)', hintEn: 'Small glass still gets a light this wide', hintTr: 'Küçük camda ışık en az bu kadar geniştir' },
  { key: 'sizeMax', min: 20, max: 600, step: 5, en: 'Radius at most (px)', tr: 'En çok yarıçap (px)', hintEn: 'Large glass (a card) never gets a wider light', hintTr: 'Büyük camda (kart) ışık bundan geniş olmaz' },
  { key: 'rise', min: 0.05, max: 1, step: 0.01, en: 'Press comes up (s)', tr: 'Basışta yanma (sn)', hintEn: 'How long a press takes to light up', hintTr: 'Basınca ışığın yanma süresi' },
  { key: 'riseBounce', min: 0, max: 0.9, step: 0.01, en: 'Press overshoot', tr: 'Basışta taşma', hintEn: '0: comes up evenly. Higher: flashes past and settles', hintTr: '0: düzgün yanar. Yükseldikçe önce taşar, sonra oturur' },
  { key: 'fade', min: 0.05, max: 2, step: 0.01, en: 'Fade (s)', tr: 'Sönme (sn)', hintEn: 'How long the light takes to sink back', hintTr: 'Işığın sönme süresi' },
]

const COPY = {
  en: {
    title: 'Pointer light',
    note: 'Press any glass: it lights up where the press landed and stays lit there for as long as you hold. Changes apply at once.',
    on: 'Light on',
    copy: 'Copy values',
    copied: 'Copied',
    reset: 'Reset',
    button: 'Button',
    tinted: 'Button, tinted',
    action: 'Action Button',
    group: 'Button Group',
    tabs: 'Tabs',
    tabsIcons: 'Tabs, icons',
    badge: 'Badge',
    slide: 'Slide to Confirm',
    card: 'Card',
    slider: 'Slider',
    switch: 'Switch',
    checkbox: 'Checkbox',
  },
  tr: {
    title: 'İmleç ışığı',
    note: 'Herhangi bir cama bas: bastığın yerde ışıklanır ve basılı tuttuğun sürece orada yanar. Değişiklikler anında uygulanır.',
    on: 'Işık açık',
    copy: 'Değerleri kopyala',
    copied: 'Kopyalandı',
    reset: 'Sıfırla',
    button: 'Button',
    tinted: 'Button, renkli',
    action: 'Action Button',
    group: 'Button Group',
    tabs: 'Tabs',
    tabsIcons: 'Tabs, ikonlu',
    badge: 'Badge',
    slide: 'Slide to Confirm',
    card: 'Card',
    slider: 'Slider',
    switch: 'Switch',
    checkbox: 'Checkbox',
  },
}

// Each component once, in the demo its docs page shows. The opening ones are left out on purpose.
const TILES: { name: keyof (typeof COPY)['en']; Demo: ComponentType; wide?: boolean }[] = [
  { name: 'button', Demo: ButtonClearDemo },
  { name: 'tinted', Demo: ButtonTintedDemo },
  { name: 'action', Demo: ActionButtonDemo },
  { name: 'group', Demo: ButtonGroupDemo },
  { name: 'tabs', Demo: TabsDemo },
  { name: 'tabsIcons', Demo: TabsIconsDemo },
  { name: 'slide', Demo: SlideDemo },
  { name: 'badge', Demo: BadgeDemo },
  { name: 'slider', Demo: SliderDemo },
  { name: 'switch', Demo: SwitchDemo },
  { name: 'checkbox', Demo: CheckboxDemo },
  { name: 'card', Demo: CardDemo, wide: true },
]

// Bumped when the set of values changes, so stale saved ones do not override the kit's.
const STORE = 'glass-light-tuning-2'

function Tuner({ locale }: { locale: Locale }) {
  const t = COPY[locale]
  const [values, setValues] = useState({ ...LIGHT_DEFAULTS })
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
  // The engine reads LIGHT on every frame it draws; a resize makes every glass draw again.
  useEffect(() => {
    Object.assign(LIGHT, values)
    window.dispatchEvent(new Event('resize'))
    try {
      localStorage.setItem(STORE, JSON.stringify(values))
    } catch {
      // Storage is unavailable: the values still apply for this visit.
    }
  }, [values])
  // Leaving the lab puts the kit's own values back.
  useEffect(
    () => () => {
      Object.assign(LIGHT, LIGHT_DEFAULTS)
    },
    [],
  )

  const { on, ...numbers } = values
  const text = JSON.stringify({ LIGHT: numbers }, null, 2)
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
      className="fixed top-24 right-4 bottom-4 z-40 flex w-64 flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-background p-4 text-ui text-foreground xl:w-72 max-lg:static max-lg:mx-auto max-lg:mt-6 max-lg:w-[calc(100%-2rem)]"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-body-sm font-semibold">{t.title}</h2>
        <button type="button" onClick={() => setValues({ ...LIGHT_DEFAULTS })} className="press rounded-md px-2 py-1 text-caption text-muted-foreground hover:bg-accent">
          {t.reset}
        </button>
      </div>
      <p className="text-caption text-muted-foreground">{t.note}</p>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={on} onChange={(e) => setValues((v) => ({ ...v, on: e.target.checked }))} />
        <span>{t.on}</span>
      </label>
      <button type="button" onClick={copy} className="press shrink-0 rounded-md bg-foreground px-3 py-2 text-ui font-medium text-background">
        {copied ? t.copied : t.copy}
      </button>
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
      <textarea readOnly value={text} rows={8} onFocus={(e) => e.currentTarget.select()} className="rounded-md border border-border bg-background p-2 font-mono text-micro" />
    </aside>
  )
}

function LightLab() {
  const { locale } = Route.useRouteContext()
  const t = COPY[locale]

  return (
    <main className="min-h-dvh bg-background pt-24 pb-10 lg:pr-72 xl:pr-80">
      <div className="mx-auto grid max-w-5xl gap-4 px-4 md:grid-cols-2">
        {TILES.map(({ name, Demo, wide }) => (
          <section key={name} className={`flex flex-col gap-3 overflow-hidden rounded-xl bg-stage p-4${wide ? 'md:col-span-2' : ''}`}>
            <h2 className="text-caption text-muted-foreground">{t[name]}</h2>
            <div className="flex min-h-56 flex-1 items-center justify-center">
              <Demo />
            </div>
          </section>
        ))}
      </div>
      <Tuner locale={locale} />
    </main>
  )
}
