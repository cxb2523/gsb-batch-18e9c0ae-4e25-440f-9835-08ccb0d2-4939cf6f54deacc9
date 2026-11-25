import NumberFlow from '@number-flow/react'
import { Check, Cloud, Copy, Navigation, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { GlassCard, type GlassOptics } from '@/components/liquid-glass'

import { column } from './chrome'
import type { Locale } from './i18n'
import { setTheme, useTheme, type Theme } from './theme'

// Development only (route /tune, a 404 in production): GlassCard's glass on sliders, like the
// reference shader's panel. Tune it by eye on the card demo, copy the values, and they become
// the card's fixed defaults. Colours are kept per theme; everything else is shared.

type Tone = { tint: string; tintAlpha: number; border: string; borderAlpha: number }
type Tuning = {
  light: Tone
  dark: Tone
  borderWidth: number
  frostedRadius: number
  frostedOverlay: number
  frostEdge: number
  saturation: number
  clearBlur: number
  clearBlurEdge: number
  refract: number
  bendDepth: number
  bendCurve: number
  dispersion: number
  magnify: number
  lighting: number
  rim: number
  rimWidth: number
  bevel: number
  fresnel: number
  inner: number
  reflection: number
  caustic: number
  cursorLight: boolean
  shadow: number
  shadowSoftness: number
  shadowOffset: number
}
type Num = Exclude<keyof Tuning, 'light' | 'dark' | 'cursorLight'>

/** Today's look: what GlassCard draws with no tuning. */
const DEFAULTS: Tuning = {
  light: { tint: '#ffffff', tintAlpha: 0.7, border: '#ffffff', borderAlpha: 0.6 },
  dark: { tint: '#000000', tintAlpha: 0.7, border: '#ffffff', borderAlpha: 0.25 },
  borderWidth: 1.3,
  frostedRadius: 10,
  frostedOverlay: 1,
  frostEdge: 1,
  saturation: 1,
  clearBlur: 0.35,
  clearBlurEdge: 2.2,
  refract: 1,
  bendDepth: 1.35,
  bendCurve: 9.75,
  dispersion: 0,
  magnify: 0,
  lighting: 0,
  rim: 1,
  rimWidth: 1,
  bevel: 1,
  fresnel: 1,
  inner: 1,
  reflection: 1,
  caustic: 1,
  cursorLight: false,
  shadow: 1,
  shadowSoftness: 1,
  shadowOffset: 1,
}

// Renamed when the defaults change, so values saved for the old look don't come back.
const STORE = 'liquid-glass-tuner-card'

type L = { en: string; tr: string }
type Control = { key: Num; label: string; min: number; max: number; step: number; digits?: number; hint?: string | ((t: Tuning) => string) }
type Section = { title: L; note?: L; controls: Control[] }

// The labels follow the reference panel's English names; notes say what each group does.
const SECTIONS: Section[] = [
  {
    title: { en: 'Frost', tr: 'Buzlu cam' },
    note: {
      en: 'Radius is the reference’s: the blur is half of it. Clear blur only shows where the frost does not cover (overlay below 1, or radius 0).',
      tr: 'Yarıçap referanstaki gibi: bulanıklık bunun yarısı. Berrak bulanıklık yalnız buzun örtmediği yerde görünür (örtü 1’in altında ya da yarıçap 0).',
    },
    controls: [
      { key: 'frostedRadius', label: 'Frosted radius', min: 0, max: 40, step: 0.5, digits: 1, hint: (t) => `blur ${(t.frostedRadius / 2).toFixed(1)} px` },
      { key: 'frostedOverlay', label: 'Frosted overlay', min: 0, max: 1, step: 0.01 },
      { key: 'frostEdge', label: 'Rim frost', min: 0.1, max: 3, step: 0.05, hint: '×' },
      { key: 'saturation', label: 'Saturation', min: 0, max: 2.5, step: 0.05 },
      { key: 'clearBlur', label: 'Clear blur · middle', min: 0, max: 6, step: 0.05, hint: 'mip' },
      { key: 'clearBlurEdge', label: 'Clear blur · rim', min: 0, max: 6, step: 0.05, hint: 'mip' },
    ],
  },
  {
    title: { en: 'Refraction', tr: 'Kırılma' },
    note: {
      en: 'The rim pulls what is behind towards the centre: strength × 6.5% of the window, depth × half the card, curve is how fast it fades (an exponent). Magnify and clear blur do nothing, dispersion shows only when frost overlay is below 1.',
      tr: 'Kenar arkada kalanı merkeze doğru çeker: güç × pencerenin %6.5\'i, derinlik × kartın yarısı, eğri ne kadar çabuk söndüğü (bir üs). Büyütme ve berrak bulanıklık etkisiz, renk ayrışması yalnız buz örtüsü 1\'in altındayken görünür.',
    },
    controls: [
      { key: 'refract', label: 'Refract strength', min: 0, max: 3, step: 0.05, hint: '×' },
      { key: 'bendDepth', label: 'Bend depth', min: 0.2, max: 3, step: 0.05, hint: '×' },
      { key: 'bendCurve', label: 'Bend curve', min: 0.3, max: 12, step: 0.05, hint: 'exp' },
      { key: 'dispersion', label: 'Dispersion', min: 0, max: 1, step: 0.01 },
      { key: 'magnify', label: 'Magnify', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: { en: 'Light', tr: 'Işık' },
    note: {
      en: 'Rim width is the thickness of the light along the edge; bevel widens the whole shaded rim.',
      tr: 'Kenar kalınlığı, kenar boyunca uzanan ışığın kalınlığı; eğim tüm gölgeli kenarı genişletir.',
    },
    controls: [
      { key: 'lighting', label: 'Glass light', min: 0, max: 2, step: 0.05 },
      { key: 'rim', label: 'Rim light', min: 0, max: 3, step: 0.05, hint: '×' },
      { key: 'rimWidth', label: 'Rim width', min: 0.25, max: 4, step: 0.05, hint: '×' },
      { key: 'bevel', label: 'Bevel', min: 0.25, max: 3, step: 0.05, hint: '×' },
      { key: 'fresnel', label: 'Fresnel', min: 0, max: 5, step: 0.05, hint: '×' },
      { key: 'inner', label: 'Inner shade', min: 0, max: 3, step: 0.05, hint: '×' },
      { key: 'reflection', label: 'Top reflection', min: 0, max: 3, step: 0.05, hint: '×' },
      { key: 'caustic', label: 'Caustic', min: 0, max: 3, step: 0.05, hint: '×' },
    ],
  },
  {
    title: { en: 'Shadow', tr: 'Gölge' },
    controls: [
      { key: 'shadow', label: 'Shadow', min: 0, max: 3, step: 0.05, hint: '×' },
      { key: 'shadowSoftness', label: 'Softness', min: 0.2, max: 3, step: 0.05, hint: '×' },
      { key: 'shadowOffset', label: 'Offset', min: 0, max: 3, step: 0.05, hint: '×' },
    ],
  },
]

const COPY = {
  en: {
    title: 'GlassCard tuner',
    note: 'Development only. Colours are kept per theme: switch the mode to tune the other one. Everything else is shared. When it looks right, copy the values and send them: they become the card’s defaults.',
    mode: 'Mode',
    colour: 'Colour',
    reset: 'Reset all',
    resetOne: 'Back to default',
    copy: 'Copy values',
    copied: 'Copied',
    cursor: 'Rim light follows the cursor',
  },
  tr: {
    title: 'GlassCard ayarları',
    note: 'Yalnız geliştirmede. Renkler her tema için ayrı tutulur: diğerini ayarlamak için modu değiştir. Geri kalan her şey iki temada ortak. Doğru görününce değerleri kopyalayıp gönder: kartın varsayılanları olacaklar.',
    mode: 'Mod',
    colour: 'Renk',
    reset: 'Hepsini sıfırla',
    resetOne: 'Varsayılana dön',
    copy: 'Değerleri kopyala',
    copied: 'Kopyalandı',
    cursor: 'Kenar ışığı imleci izlesin',
  },
} as const

const label = 'text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase'
const number = 'font-mono text-[13px] text-foreground tabular-nums'
const range = 'h-5 w-full cursor-pointer accent-[var(--brand)]'

/** A small "back to default" button, shown only once the value has moved. */
function ResetOne({ show, title, onClick }: { show: boolean; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`flex size-5 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-opacity duration-150 hover:bg-muted hover:text-foreground ${show ? '' : 'pointer-events-none opacity-0'}`}
      tabIndex={show ? 0 : -1}
    >
      <RotateCcw className="size-3" />
    </button>
  )
}

function Slider(props: { label: string; value: number; def: number; min: number; max: number; step: number; digits?: number; hint?: string; resetTitle: string; onChange: (v: number) => void }) {
  const { digits = 2 } = props
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center justify-between gap-3">
        {/* lang="en": the labels are the reference panel's English names; a Turkish page would capitalise their i as İ. */}
        <span lang="en" className={label}>
          {props.label}
          {props.hint && <span className="ml-1.5 tracking-normal normal-case opacity-70">{props.hint}</span>}
        </span>
        <span className="flex items-center gap-1">
          <ResetOne show={props.value !== props.def} title={`${props.resetTitle}: ${props.def}`} onClick={() => props.onChange(props.def)} />
          <NumberFlow value={props.value} locales="en-US" format={{ minimumFractionDigits: digits, maximumFractionDigits: digits }} className={number} />
        </span>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        aria-label={props.label}
        className={range}
      />
    </div>
  )
}

function ColorAlpha(props: { label: string; color: string; alpha: number; def: { color: string; alpha: number }; resetTitle: string; onColor: (c: string) => void; onAlpha: (a: number) => void }) {
  const changed = props.alpha !== props.def.alpha || props.color.toLowerCase() !== props.def.color
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center justify-between gap-3">
        <span lang="en" className={label}>
          {props.label}
        </span>
        <span className="flex items-center gap-1">
          <ResetOne
            show={changed}
            title={`${props.resetTitle}: ${props.def.color} ${props.def.alpha}`}
            onClick={() => {
              props.onColor(props.def.color)
              props.onAlpha(props.def.alpha)
            }}
          />
          <NumberFlow value={props.alpha} locales="en-US" format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} className={number} />
        </span>
      </span>
      <span className="flex items-center gap-3">
        <input
          type="color"
          value={props.color}
          onChange={(e) => props.onColor(e.target.value)}
          aria-label={`${props.label}: colour`}
          className="size-8 shrink-0 cursor-pointer rounded-lg border border-border bg-transparent p-0.5"
        />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={props.alpha}
          onChange={(e) => props.onAlpha(Number(e.target.value))}
          aria-label={`${props.label}: alpha`}
          className={range}
        />
      </span>
    </div>
  )
}

function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-border pt-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
        {note && <p className="text-[12px] leading-snug text-muted-foreground">{note}</p>}
      </div>
      {children}
    </section>
  )
}

// The card demo's backdrop: two rows of colour sliding behind the cards.
const colours = ['#0a84ff', '#ff6b3d', '#30d158', '#ff375f', '#ffd60a', '#bf5af2']

function Row({ shift, seconds, reverse = false }: { shift: number; seconds: number; reverse?: boolean }) {
  const pills = [...colours, ...colours].map((_, i) => colours[(i + shift) % colours.length])
  return (
    <div
      data-glass-marquee
      className="flex w-max"
      style={{ '--glass-marquee-duration': `${seconds}s`, animationDirection: reverse ? 'reverse' : undefined } as CSSProperties}
    >
      {[0, 1].map((half) => (
        <div key={half} className="flex gap-3 pr-3">
          {pills.map((colour, i) => (
            <span key={i} className="h-12 w-24 shrink-0 rounded-full" style={{ background: colour }} />
          ))}
        </div>
      ))}
    </div>
  )
}

function Stage({ tone, tuning }: { tone: Tone; tuning: Tuning }) {
  const [today, setToday] = useState<Date | null>(null)
  useEffect(() => setToday(new Date()), [])
  const optics: GlassOptics = {
    tintColor: tone.tint,
    borderColor: tone.border,
    borderAlpha: tone.borderAlpha,
    borderWidth: tuning.borderWidth,
    frostMix: tuning.frostedOverlay,
    frostEdge: tuning.frostEdge,
    saturation: tuning.saturation,
    clearBlur: tuning.clearBlur,
    clearBlurEdge: tuning.clearBlurEdge,
    refraction: tuning.refract,
    bendDepth: tuning.bendDepth,
    bendCurve: tuning.bendCurve,
    dispersion: tuning.dispersion,
    magnify: tuning.magnify,
    light: tuning.lighting,
    rim: tuning.rim,
    rimWidth: tuning.rimWidth,
    bevel: tuning.bevel,
    fresnel: tuning.fresnel,
    inner: tuning.inner,
    reflection: tuning.reflection,
    caustic: tuning.caustic,
    cursorLight: tuning.cursorLight,
    shadow: tuning.shadow,
    shadowSoftness: tuning.shadowSoftness,
    shadowOffset: tuning.shadowOffset,
  }
  const glass = { live: true, tint: tone.tintAlpha, blur: tuning.frostedRadius / 2, optics }
  return (
    <div className="relative flex min-h-[420px] flex-wrap items-center justify-center gap-5 overflow-hidden rounded-[28px] bg-stage py-14 lg:min-h-[560px]">
      <div aria-hidden className="absolute inset-0 flex flex-col justify-center gap-3 [mask-image:linear-gradient(to_right,transparent,#000_12%,#000_88%,transparent)]">
        <Row shift={0} seconds={40} />
        <Row shift={3} seconds={48} reverse />
      </div>
      <GlassCard {...glass} className="flex size-44 flex-col justify-between p-4">
        <div>
          <p className="flex items-center gap-1 text-[13px] font-semibold">
            Istanbul
            <Navigation className="size-2.5 fill-current" />
          </p>
          <p className="mt-0.5 text-[44px] leading-none font-light tracking-[-0.04em]">16°</p>
        </div>
        <div className="text-[12px] leading-snug font-semibold">
          <Cloud className="mb-1 size-4 fill-current" />
          <p>Cloudy</p>
          <p className="opacity-60">H:19° L:15°</p>
        </div>
      </GlassCard>
      <GlassCard {...glass} className="flex h-44 w-64 flex-col justify-between p-5">
        <div className="flex items-baseline justify-between">
          <p className="text-[14px] font-semibold">{today ? today.toLocaleDateString(undefined, { weekday: 'long' }) : 'Today'}</p>
          <p className="text-[34px] leading-none font-semibold tracking-[-0.05em] tabular-nums">{today?.getDate()}</p>
        </div>
        <ul className="flex flex-col gap-2">
          {[
            { title: 'Visit my GitHub', note: 'github.com/bilalgursen', colour: '#0a84ff' },
            { title: 'Star liquid-glass', note: 'Leave a star on the repo', colour: '#ff6b3d' },
          ].map((e) => (
            <li key={e.title} className="flex items-stretch gap-2.5">
              <span className="w-1 shrink-0 rounded-full" style={{ background: e.colour }} />
              <span>
                <span className="block text-[13px] leading-tight font-semibold">{e.title}</span>
                <span className="block text-[11px] font-medium opacity-60">{e.note}</span>
              </span>
            </li>
          ))}
        </ul>
      </GlassCard>
    </div>
  )
}

export function GlassTuner({ locale }: { locale: Locale }) {
  const t = COPY[locale]
  const [theme] = useTheme()
  const [tuning, setTuning] = useState<Tuning>(DEFAULTS)
  const [copied, setCopied] = useState(false)
  const loaded = useRef(false)

  // Kept across reloads while tuning (this browser only).
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Partial<Tuning> | null
      if (saved) setTuning((d) => ({ ...d, ...saved, light: { ...d.light, ...saved.light }, dark: { ...d.dark, ...saved.dark } }))
    } catch {}
    loaded.current = true
  }, [])
  useEffect(() => {
    if (!loaded.current) return
    try {
      localStorage.setItem(STORE, JSON.stringify(tuning))
    } catch {}
  }, [tuning])

  const tone = tuning[theme]
  const setTone = (patch: Partial<Tone>) => setTuning((s) => ({ ...s, [theme]: { ...s[theme], ...patch } }))
  const set = (patch: Partial<Tuning>) => setTuning((s) => ({ ...s, ...patch }))

  const json = JSON.stringify({ ...tuning, blur: tuning.frostedRadius / 2 }, null, 2)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {}
  }

  const slider = (c: Control) => (
    <Slider
      key={c.key}
      label={c.label}
      hint={typeof c.hint === 'function' ? c.hint(tuning) : c.hint}
      value={tuning[c.key]}
      def={DEFAULTS[c.key]}
      min={c.min}
      max={c.max}
      step={c.step}
      digits={c.digits}
      resetTitle={t.resetOne}
      onChange={(v) => set({ [c.key]: v } as Partial<Tuning>)}
    />
  )

  return (
    <div className={`${column} px-4 py-10 sm:px-6 lg:py-14`}>
      <h1 className="text-[28px] font-semibold tracking-[-0.03em] text-foreground">{t.title}</h1>
      <p className="mt-2 max-w-[70ch] text-[14px] leading-relaxed text-muted-foreground">{t.note}</p>
      <div className="mt-8 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="lg:sticky lg:top-24">
          <Stage tone={tone} tuning={tuning} />
        </div>
        <div className="flex flex-col gap-5 rounded-[20px] border border-border bg-surface p-5">
          <div className="flex items-center justify-between gap-3">
            <span className={label}>{t.mode}</span>
            <div role="group" aria-label={t.mode} className="flex rounded-full border border-border p-0.5 text-[12px]">
              {(['light', 'dark'] as Theme[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={theme === m}
                  onClick={() => setTheme(m)}
                  className={`h-7 cursor-pointer rounded-full px-3 capitalize transition-colors duration-150 ${theme === m ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTuning(DEFAULTS)}
              className="press flex h-9 cursor-pointer items-center gap-2 rounded-full border border-border px-4 text-[13px] text-foreground transition-colors duration-150 hover:bg-muted"
            >
              <RotateCcw className="size-3.5" />
              {t.reset}
            </button>
            <button
              type="button"
              onClick={copy}
              className="press flex h-9 flex-1 cursor-pointer items-center justify-center gap-2 rounded-full bg-foreground px-4 text-[13px] font-medium text-background transition-opacity duration-150 hover:opacity-90"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? t.copied : t.copy}
            </button>
          </div>

          <Group title={t.colour}>
            <ColorAlpha
              label="Tint color (RGB + alpha)"
              color={tone.tint}
              alpha={tone.tintAlpha}
              def={{ color: DEFAULTS[theme].tint, alpha: DEFAULTS[theme].tintAlpha }}
              resetTitle={t.resetOne}
              onColor={(c) => setTone({ tint: c })}
              onAlpha={(a) => setTone({ tintAlpha: a })}
            />
            <ColorAlpha
              label="Border color (RGB + alpha)"
              color={tone.border}
              alpha={tone.borderAlpha}
              def={{ color: DEFAULTS[theme].border, alpha: DEFAULTS[theme].borderAlpha }}
              resetTitle={t.resetOne}
              onColor={(c) => setTone({ border: c })}
              onAlpha={(a) => setTone({ borderAlpha: a })}
            />
            {slider({ key: 'borderWidth', label: 'Border width', min: 0, max: 4, step: 0.1, digits: 1, hint: 'px' })}
          </Group>

          {SECTIONS.map((s) => (
            <Group key={s.title.en} title={s.title[locale]} note={s.note?.[locale]}>
              {s.controls.map(slider)}
              {s.title.en === 'Light' && (
                <label className="flex cursor-pointer items-center gap-2.5 text-[12.5px] text-foreground">
                  <input type="checkbox" checked={tuning.cursorLight} onChange={(e) => set({ cursorLight: e.target.checked })} className="size-4 cursor-pointer accent-[var(--brand)]" />
                  {t.cursor}
                </label>
              )}
            </Group>
          ))}

          <details className="border-t border-border pt-4">
            <summary className="cursor-pointer text-[12px] text-muted-foreground hover:text-foreground">JSON</summary>
            <pre className="mt-3 max-h-72 overflow-auto rounded-xl border border-border bg-background p-3 font-mono text-[11.5px] leading-relaxed text-muted-foreground">{json}</pre>
          </details>
        </div>
      </div>
    </div>
  )
}
