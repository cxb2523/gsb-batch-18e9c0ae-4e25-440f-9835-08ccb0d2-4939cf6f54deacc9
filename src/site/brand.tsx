import { Check, Copy, Download, X } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'

import { Inline, LOGO_LETTERS, LOGO_MARK, Logo, LogoMark } from './chrome'
import { Toc } from './doc-page'
import { REPO_URL, type Locale } from './i18n'
import { UI } from './ui'

// /brand: the logo, its symbol, the colours and the type, with the files. The files are made in
// the browser from the same paths the header draws (chrome.tsx), so they can never drift from
// the logo on the site. The tiles here are fixed colours on purpose: they show the artwork on a
// given ground, not the reader's theme.

const COPY = {
  en: {
    eyebrow: 'Resources',
    sections: { logo: 'Logo', symbol: 'Symbol', space: 'Clear space and size', colour: 'On colour', palette: 'Colours', type: 'Typography', name: 'Writing the name', misuse: 'Misuse', usage: 'Using the brand' },
    logo: 'The logo is the hand and the two words together. It is one drawing: the hand raises one finger and the words finish the sentence. Use it whenever there is room, in black on light grounds and in white on dark ones.',
    symbol: 'The hand alone is the symbol. Use it where the whole logo would be too small to read: a browser tab, an avatar, an app icon, a row of other projects\' symbols.',
    onLight: 'Black, for light grounds',
    onDark: 'White, for dark grounds',
    actions: { copy: 'Copy SVG', copied: 'Copied', svg: 'SVG', png: 'PNG', download: 'Download' },
    space: 'Leave a margin of **x** on every side, where x is the height of the lowercase letters in the logo (one fifth of the logo\'s height). Nothing else enters that margin: no text, no edge, no other logo.',
    spaceCaption: 'x = the height of the lowercase letters',
    size: 'On a screen the logo is never shorter than **32px** and the symbol never shorter than **16px**. Below that the words close up, so switch to the symbol.',
    colour: 'The logo is only ever black or white. Pick the one that reads on the ground behind it; the colour belongs to the ground, never to the logo. These are the site\'s own colours with the right version on each.',
    black: 'Black logo',
    white: 'White logo',
    palette: 'The site is neutral on purpose: the glass needs colour behind it only inside the demos. Every value has a light and a dark twin. Click a value to copy it.',
    groups: { neutral: 'Neutrals', accent: 'Accents', kinds: 'Release kinds' },
    theme: { token: 'Token', light: 'Light', dark: 'Dark', use: 'Used for' },
    uses: {
      background: 'The page',
      surface: 'Cards and raised surfaces',
      muted: 'Hover and quiet fills',
      stage: 'The ground behind every live preview',
      'muted-foreground': 'Secondary text',
      foreground: 'Text and the logo',
      brand: 'Text selection',
      ring: 'The focus ring',
      'kind-new': 'New',
      'kind-improved': 'Improved',
      'kind-fixed': 'Fixed',
      'kind-removed': 'Removed',
    },
    type: 'Three typefaces, each with one job. All three are open source and load from Google Fonts.',
    faces: {
      display: { role: 'Display', use: 'Page titles and landing headings. One weight, so never bold.', sample: 'Glass that bends the page.' },
      sans: { role: 'Text', use: 'Everything you read: running text, navigation, controls.', sample: 'React components drawn in WebGL2.' },
      mono: { role: 'Mono', use: 'Code, versions and small labels.', sample: 'pnpm dlx shadcn@latest add button' },
    },
    scale: 'The type scale',
    scaleRoles: { micro: 'Badges, mono tags', caption: 'Captions, meta', ui: 'Controls, navigation, code', 'body-sm': 'Short secondary text', body: 'Running text', lead: 'Page descriptions', title: 'Section headings' },
    names: [
      'The kit is **Liquid Glass UI** the first time it is named, and **Liquid Glass** after that. Three words, each capitalised, never "LiquidGlass" or "liquid-glass" in a sentence.',
      'The exports keep their prefix in code: `GlassButton`, `GlassTabs`. In a sentence the components are plain words: Button, Tabs.',
      'The address is `onemorethink.dev`: lowercase, one word.',
      'The logo reads "one more think". The hand is the "one", so never set the word "one" beside it.',
    ],
    misuse: 'The logo is one drawing. Use the files as they are.',
    donts: { stretch: 'Don\'t stretch or squeeze it.', colour: 'Don\'t colour it.', rotate: 'Don\'t rotate it.', outline: 'Don\'t outline it.', rearrange: 'Don\'t move the hand or the words.', contrast: 'Don\'t set it where it can\'t be read.' },
    dont: 'Don\'t',
    usage: [
      'The code is MIT licensed: copy it, change it, ship it. The licence covers the code, not the logo.',
      'You are welcome to use the logo to point at the project: in an article, a talk, a list of tools, a "built with" line. Link it to `onemorethink.dev` where you can.',
    ],
    contact: 'Not sure about a use? Open an issue on GitHub.',
  },
  tr: {
    eyebrow: 'Kaynaklar',
    sections: { logo: 'Logo', symbol: 'Sembol', space: 'Güvenli alan ve boyut', colour: 'Renk üstünde', palette: 'Renkler', type: 'Tipografi', name: 'Adın yazımı', misuse: 'Yanlış kullanım', usage: 'Markayı kullanmak' },
    logo: 'Logo, el ile iki kelimenin birlikteliğidir. Tek bir çizimdir: el bir parmağını kaldırır, kelimeler cümleyi tamamlar. Yer olan her yerde logoyu kullan; açık zeminde siyah, koyu zeminde beyaz.',
    symbol: 'El tek başına semboldür. Logonun okunamayacak kadar küçük kalacağı yerlerde kullan: tarayıcı sekmesi, avatar, uygulama simgesi, başka projelerin sembolleriyle yan yana durduğu bir satır.',
    onLight: 'Siyah, açık zeminler için',
    onDark: 'Beyaz, koyu zeminler için',
    actions: { copy: 'SVG\'yi kopyala', copied: 'Kopyalandı', svg: 'SVG', png: 'PNG', download: 'İndir' },
    space: 'Her yanda **x** kadar boşluk bırak; x, logodaki küçük harflerin yüksekliğidir (logo yüksekliğinin beşte biri). O boşluğa hiçbir şey girmez: ne yazı, ne kenar, ne başka bir logo.',
    spaceCaption: 'x = küçük harflerin yüksekliği',
    size: 'Ekranda logo **32px**\'ten, sembol **16px**\'ten kısa olmaz. Daha küçüğünde kelimeler birbirine girer; onun yerine sembolü kullan.',
    colour: 'Logo yalnızca siyah ya da beyaz olur. Arkasındaki zeminde hangisi okunuyorsa onu seç; renk zemine aittir, logoya değil. Aşağıdakiler sitenin kendi renkleri, her birinin üstünde doğru sürümle.',
    black: 'Siyah logo',
    white: 'Beyaz logo',
    palette: 'Site bilerek nötr: camın arkasında renge yalnızca demoların içinde ihtiyaç var. Her değerin bir açık, bir koyu karşılığı bulunur. Kopyalamak için değere tıkla.',
    groups: { neutral: 'Nötrler', accent: 'Vurgular', kinds: 'Sürüm türleri' },
    theme: { token: 'Değişken', light: 'Açık', dark: 'Koyu', use: 'Kullanım' },
    uses: {
      background: 'Sayfa',
      surface: 'Kartlar ve yükseltilmiş yüzeyler',
      muted: 'Üzerine gelme ve sakin dolgular',
      stage: 'Her canlı önizlemenin zemini',
      'muted-foreground': 'İkincil metin',
      foreground: 'Metin ve logo',
      brand: 'Metin seçimi',
      ring: 'Odak halkası',
      'kind-new': 'Yeni',
      'kind-improved': 'İyileştirildi',
      'kind-fixed': 'Düzeltildi',
      'kind-removed': 'Kaldırıldı',
    },
    type: 'Üç yazı tipi, her birinin tek bir işi var. Üçü de açık kaynak ve Google Fonts\'tan yüklenir.',
    faces: {
      display: { role: 'Başlık', use: 'Sayfa başlıkları ve ana sayfa başlıkları. Tek ağırlık; asla kalın yapılmaz.', sample: 'Sayfayı büken cam.' },
      sans: { role: 'Metin', use: 'Okunan her şey: akan metin, gezinme, kontroller.', sample: 'WebGL2 ile çizilen React bileşenleri.' },
      mono: { role: 'Eş aralıklı', use: 'Kod, sürüm numaraları ve küçük etiketler.', sample: 'pnpm dlx shadcn@latest add button' },
    },
    scale: 'Yazı ölçeği',
    scaleRoles: { micro: 'Rozetler, mono etiketler', caption: 'Alt yazılar, künye', ui: 'Kontroller, gezinme, kod', 'body-sm': 'Kısa ikincil metin', body: 'Akan metin', lead: 'Sayfa açıklamaları', title: 'Bölüm başlıkları' },
    names: [
      'Kitin adı ilk geçtiği yerde **Liquid Glass UI**, sonrasında **Liquid Glass**. Üç kelime, her biri büyük harfle başlar; cümle içinde asla "LiquidGlass" ya da "liquid-glass" yazılmaz.',
      'Dışa aktarımlar kodda ön ekini korur: `GlassButton`, `GlassTabs`. Cümle içinde bileşenler düz kelimedir: Button, Tabs.',
      'Adres `onemorethink.dev`: küçük harfle, tek kelime.',
      'Logo "one more think" diye okunur. "One" eldir; yanına ayrıca "one" kelimesini yazma.',
    ],
    misuse: 'Logo tek bir çizimdir. Dosyaları olduğu gibi kullan.',
    donts: { stretch: 'Uzatma ya da sıkıştırma.', colour: 'Renklendirme.', rotate: 'Döndürme.', outline: 'Kontur olarak çizme.', rearrange: 'Elin ya da kelimelerin yerini değiştirme.', contrast: 'Okunamayacağı bir zemine koyma.' },
    dont: 'Yapma',
    usage: [
      'Kod MIT lisanslıdır: kopyala, değiştir, yayınla. Lisans kodu kapsar, logoyu değil.',
      'Projeyi işaret etmek için logoyu kullanabilirsin: bir yazıda, bir konuşmada, bir araç listesinde, "şununla yapıldı" satırında. Mümkünse `onemorethink.dev` adresine bağla.',
    ],
    contact: 'Bir kullanımdan emin değil misin? GitHub\'da bir issue aç.',
  },
} as const

type Copy = (typeof COPY)[Locale]

// ── The files ──

type Art = 'logo' | 'symbol'
type Ink = 'black' | 'white'

const BOX: Record<Art, [number, number]> = { logo: [483, 347], symbol: [219, 347] }
const INK: Record<Ink, string> = { black: '#000000', white: '#ffffff' }

function svgOf(art: Art, ink: Ink) {
  const [w, h] = BOX[art]
  const letters = art === 'logo' ? LOGO_LETTERS.map((d) => `<path d="${d}"/>`).join('') : ''
  const mark = LOGO_MARK.map((d) => `<path fill-rule="evenodd" clip-rule="evenodd" d="${d}"/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="${INK[ink]}">${letters}${mark}</svg>`
}

const fileName = (art: Art, ink: Ink, ext: string) => `onemorethink-${art}-${ink}.${ext}`

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const saveSvg = (art: Art, ink: Ink) => save(new Blob([svgOf(art, ink)], { type: 'image/svg+xml' }), fileName(art, ink, 'svg'))

/** A transparent PNG, 2000px on its long side, drawn from the same SVG. */
function savePng(art: Art, ink: Ink) {
  const [w, h] = BOX[art]
  const k = 2000 / Math.max(w, h)
  const img = new Image()
  const url = URL.createObjectURL(new Blob([svgOf(art, ink)], { type: 'image/svg+xml' }))
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w * k)
    canvas.height = Math.round(h * k)
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
    URL.revokeObjectURL(url)
    canvas.toBlob((b) => b && save(b, fileName(art, ink, 'png')), 'image/png')
  }
  img.src = url
}

/** Copies text; `copied` is the key that was copied last, for 1.4s. */
function useCopy() {
  const [copied, setCopied] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = (key: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(key)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(null), 1400)
    })
  }
  return { copied, copy }
}

// ── Blocks ──

const prose = 'max-w-[62ch] text-body text-pretty text-muted-foreground'
const tile = 'relative flex items-center justify-center overflow-hidden rounded-xl border border-border'

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-24 flex-col gap-5 border-b border-border py-12 last:border-b-0">
      <h2 className="text-title font-semibold tracking-[-0.02em] text-foreground">
        <a href={`#${id}`}>{title}</a>
      </h2>
      {children}
    </section>
  )
}

/** One piece of artwork on its ground, with its files underneath. */
function AssetTile({ art, ink, caption, t }: { art: Art; ink: Ink; caption: string; t: Copy }) {
  const { copied, copy } = useCopy()
  const Art = art === 'logo' ? Logo : LogoMark
  const key = `${art}-${ink}`
  return (
    <figure className="flex min-w-0 flex-col gap-3">
      <div className={`${tile} aspect-[4/3]`} style={{ background: ink === 'black' ? '#ffffff' : '#000000', color: INK[ink] }}>
        <Art className={art === 'logo' ? 'h-[38%] w-auto' : 'h-[34%] w-auto'} />
      </div>
      <figcaption className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="text-ui text-muted-foreground">{caption}</span>
        <span className="flex items-center gap-1.5">
          <Button variant="outline" size="xs" onClick={() => copy(key, svgOf(art, ink))}>
            {copied === key ? <Check aria-hidden /> : <Copy aria-hidden />}
            <span aria-live="polite">{copied === key ? t.actions.copied : t.actions.copy}</span>
          </Button>
          <Button variant="outline" size="xs" onClick={() => saveSvg(art, ink)} aria-label={`${t.actions.download} ${fileName(art, ink, 'svg')}`}>
            <Download aria-hidden />
            {t.actions.svg}
          </Button>
          <Button variant="outline" size="xs" onClick={() => savePng(art, ink)} aria-label={`${t.actions.download} ${fileName(art, ink, 'png')}`}>
            <Download aria-hidden />
            {t.actions.png}
          </Button>
        </span>
      </figcaption>
    </figure>
  )
}

function AssetPair({ art, t }: { art: Art; t: Copy }) {
  return (
    <div className="grid gap-x-4 gap-y-8 sm:grid-cols-2">
      <AssetTile art={art} ink="black" caption={t.onLight} t={t} />
      <AssetTile art={art} ink="white" caption={t.onDark} t={t} />
    </div>
  )
}

/** The logo inside its margin: x on every side, a square of x in each corner. */
function ClearSpace({ caption }: { caption: string }) {
  const corner = 'absolute flex size-(--x) items-center justify-center bg-foreground/[0.06] font-mono text-micro text-muted-foreground'
  return (
    <figure className="flex flex-col gap-3">
      <div className={`${tile} bg-surface py-12 text-foreground [--h:112px] [--x:calc(var(--h)*0.2)] sm:py-16 sm:[--h:168px]`}>
        <div className="relative border border-dashed border-border-strong p-(--x)">
          <span aria-hidden className={`${corner} top-0 left-0`}>
            x
          </span>
          <span aria-hidden className={`${corner} top-0 right-0`}>
            x
          </span>
          <span aria-hidden className={`${corner} bottom-0 left-0`}>
            x
          </span>
          <span aria-hidden className={`${corner} right-0 bottom-0`}>
            x
          </span>
          <div className="border border-dashed border-border-strong">
            <Logo className="block h-(--h) w-auto" />
          </div>
        </div>
      </div>
      <figcaption className="font-mono text-caption text-muted-foreground">{caption}</figcaption>
    </figure>
  )
}

function Sizes() {
  const cell = 'flex flex-col items-center gap-3'
  const label = 'font-mono text-caption text-muted-foreground'
  return (
    <div className={`${tile} flex-wrap items-end gap-x-10 gap-y-8 bg-surface px-6 py-10 text-foreground`}>
      {[72, 48, 32].map((h) => (
        <div key={h} className={cell}>
          <Logo className="w-auto" style={{ height: h }} />
          <span className={label}>{h}px</span>
        </div>
      ))}
      <span aria-hidden className="h-10 w-px self-center bg-border" />
      {[32, 24, 16].map((h) => (
        <div key={h} className={cell}>
          <LogoMark className="w-auto" style={{ height: h }} />
          <span className={label}>{h}px</span>
        </div>
      ))}
    </div>
  )
}

// The site's colours as grounds. `ink` is the logo that reads on each.
const GROUNDS: { name: string; hex: string; ink: Ink }[] = [
  { name: 'background', hex: '#fbfbfc', ink: 'black' },
  { name: 'stage', hex: '#ececee', ink: 'black' },
  { name: 'brand', hex: '#3291ff', ink: 'black' },
  { name: 'foreground', hex: '#0b0b0c', ink: 'white' },
  { name: 'stage · dark', hex: '#121315', ink: 'white' },
  { name: 'kind-improved', hex: '#205fd1', ink: 'white' },
  { name: 'kind-new', hex: '#007447', ink: 'white' },
  { name: 'kind-fixed', hex: '#995300', ink: 'white' },
  { name: 'kind-removed', hex: '#b4234a', ink: 'white' },
]

function Grounds({ t }: { t: Copy }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3">
      {GROUNDS.map((g) => (
        <figure key={g.name} className="flex min-w-0 flex-col gap-2">
          <div className={`${tile} aspect-[3/2]`} style={{ background: g.hex, color: INK[g.ink] }}>
            <Logo className="h-[44%] w-auto" />
          </div>
          <figcaption className="flex flex-col">
            <span className="flex items-baseline justify-between gap-2">
              <span className="truncate font-mono text-caption text-foreground">{g.name}</span>
              <span className="font-mono text-caption text-muted-foreground">{g.hex}</span>
            </span>
            <span className="text-caption text-muted-foreground">{g.ink === 'black' ? t.black : t.white}</span>
          </figcaption>
        </figure>
      ))}
    </div>
  )
}

type Token = keyof Copy['uses']
const PALETTE: { group: keyof Copy['groups']; tokens: [Token, string, string][] }[] = [
  {
    group: 'neutral',
    tokens: [
      ['background', '#fbfbfc', '#08090a'],
      ['surface', '#ffffff', '#0d0e10'],
      ['muted', '#f3f3f5', '#131416'],
      ['stage', '#ececee', '#121315'],
      ['muted-foreground', '#66666e', '#8e8f98'],
      ['foreground', '#0b0b0c', '#f4f4f5'],
    ],
  },
  {
    group: 'accent',
    tokens: [
      ['brand', '#3291ff', '#3291ff'],
      ['ring', '#2788f5', '#3291ff'],
    ],
  },
  {
    group: 'kinds',
    tokens: [
      ['kind-new', '#007447', '#4fd6a0'],
      ['kind-improved', '#205fd1', '#7cb0ff'],
      ['kind-fixed', '#995300', '#f2c27b'],
      ['kind-removed', '#b4234a', '#f58aa6'],
    ],
  },
]

function Swatch({ id, hex, label, copied, copy }: { id: string; hex: string; label: string; copied: string | null; copy: (key: string, text: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => copy(id, hex)}
      aria-label={`${label} ${hex}`}
      className="press -mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-1 font-mono text-caption text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <span aria-hidden className="size-5 shrink-0 rounded-full border border-border-strong" style={{ background: hex }} />
      <span className="tabular-nums">{copied === id ? '✓' : hex}</span>
    </button>
  )
}

function Palette({ t }: { t: Copy }) {
  const { copied, copy } = useCopy()
  const head = 'pb-2 text-left text-caption font-medium text-muted-foreground'
  return (
    <div className="flex flex-col gap-8">
      {PALETTE.map((g) => (
        <table key={g.group} className="w-full border-collapse">
          <caption className="pb-3 text-left text-body-sm font-medium text-foreground">{t.groups[g.group]}</caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className={`${head} w-[32%]`}>
                {t.theme.token}
              </th>
              <th scope="col" className={`${head} w-[19%]`}>
                {t.theme.light}
              </th>
              <th scope="col" className={`${head} w-[19%]`}>
                {t.theme.dark}
              </th>
              <th scope="col" className={`${head} max-sm:hidden`}>
                {t.theme.use}
              </th>
            </tr>
          </thead>
          <tbody>
            {g.tokens.map(([name, light, dark]) => (
              <tr key={name} className="border-b border-border last:border-b-0">
                <th scope="row" className="py-2 pr-3 text-left font-mono text-caption font-normal text-foreground">
                  --{name}
                </th>
                <td className="py-1">
                  <Swatch id={`${name}-l`} hex={light} label={`${name}, ${t.theme.light}`} copied={copied} copy={copy} />
                </td>
                <td className="py-1">
                  <Swatch id={`${name}-d`} hex={dark} label={`${name}, ${t.theme.dark}`} copied={copied} copy={copy} />
                </td>
                <td className="py-2 text-ui text-muted-foreground max-sm:hidden">{t.uses[name]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  )
}

const FACES = [
  { key: 'display', name: 'Cal Sans', font: 'font-display', sample: 'font-display text-[34px] leading-[1.1] tracking-[-0.01em]', weights: '400' },
  { key: 'sans', name: 'Geist', font: 'font-sans font-medium', sample: 'text-[22px] leading-[1.3] tracking-[-0.01em]', weights: '300 · 400 · 500 · 600' },
  { key: 'mono', name: 'Geist Mono', font: 'font-mono', sample: 'font-mono text-[17px] leading-[1.4]', weights: '400 · 500' },
] as const

// Literal class names, so Tailwind sees them.
const SCALE = [
  { key: 'title', cls: 'text-title font-semibold tracking-[-0.02em]', px: 22 },
  { key: 'lead', cls: 'text-lead', px: 17 },
  { key: 'body', cls: 'text-body', px: 15 },
  { key: 'body-sm', cls: 'text-body-sm', px: 14 },
  { key: 'ui', cls: 'text-ui', px: 13 },
  { key: 'caption', cls: 'text-caption', px: 12 },
  { key: 'micro', cls: 'text-micro', px: 11 },
] as const

function Typography({ t }: { t: Copy }) {
  return (
    <>
      <div className="flex flex-col">
        {FACES.map((f) => {
          const c = t.faces[f.key]
          return (
            <div key={f.key} className="grid gap-x-8 gap-y-4 border-b border-border py-7 first:pt-2 sm:grid-cols-[208px_1fr]">
              <div className="flex flex-col gap-1">
                <span aria-hidden className={`${f.font} text-[52px] leading-none text-foreground`}>
                  Aa
                </span>
                <span className="pt-2 text-body-sm font-medium text-foreground">{f.name}</span>
                <span className="font-mono text-caption text-muted-foreground">
                  {c.role} · {f.weights}
                </span>
              </div>
              <div className="flex min-w-0 flex-col justify-center gap-2">
                <p className={`${f.sample} text-balance break-words text-foreground`}>{c.sample}</p>
                <p className="text-ui text-muted-foreground">{c.use}</p>
              </div>
            </div>
          )
        })}
      </div>
      <h3 className="pt-4 text-body font-semibold text-foreground">{t.scale}</h3>
      <ul className="flex flex-col">
        {SCALE.map((s) => (
          <li key={s.key} className="flex items-baseline gap-4 border-b border-border py-3 last:border-b-0">
            <span className="w-[4.5rem] shrink-0 font-mono text-caption text-muted-foreground">{s.key}</span>
            <span className="w-10 shrink-0 font-mono text-caption text-faint tabular-nums">{s.px}px</span>
            <span className={`${s.cls} min-w-0 text-foreground`}>{t.scaleRoles[s.key]}</span>
          </li>
        ))}
      </ul>
    </>
  )
}

/** The hand to the right of the words: the rearranged logo, for the misuse grid only. */
function Rearranged() {
  return (
    <svg viewBox="150 0 500 347" fill="currentColor" aria-hidden="true" className="h-[46%] w-auto">
      {LOGO_LETTERS.map((d) => (
        <path key={d} d={d} />
      ))}
      <g transform="translate(420 0)">
        {LOGO_MARK.map((d) => (
          <path key={d} d={d} fillRule="evenodd" clipRule="evenodd" />
        ))}
      </g>
    </svg>
  )
}

function Misuse({ t }: { t: Copy }) {
  const logo = 'h-[46%] w-auto'
  const items: { key: keyof Copy['donts']; style?: CSSProperties; art: ReactNode }[] = [
    { key: 'stretch', art: <Logo className={`${logo} scale-x-[1.55]`} /> },
    { key: 'colour', style: { color: '#3291ff' }, art: <Logo className={logo} /> },
    { key: 'rotate', art: <Logo className={`${logo} -rotate-[14deg]`} /> },
    { key: 'outline', art: <Logo className={`${logo} fill-none stroke-current stroke-[3]`} /> },
    { key: 'rearrange', art: <Rearranged /> },
    { key: 'contrast', style: { background: '#8e8f98', color: '#a9aab1' }, art: <Logo className={logo} /> },
  ]
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3">
      {items.map((d) => (
        <figure key={d.key} className="flex min-w-0 flex-col gap-2">
          <div className={`${tile} aspect-[3/2] bg-surface text-foreground`} style={d.style}>
            {d.art}
            <span className="absolute top-2 left-2 flex size-5 items-center justify-center rounded-full bg-kind-removed text-background">
              <X aria-hidden className="size-3" strokeWidth={3} />
              <span className="sr-only">{t.dont}</span>
            </span>
          </div>
          <figcaption className="text-ui text-pretty text-muted-foreground">{t.donts[d.key]}</figcaption>
        </figure>
      ))}
    </div>
  )
}

function Rules({ items }: { items: readonly string[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((x) => (
        <li
          key={x}
          className="relative max-w-[66ch] pl-[18px] text-body text-pretty text-muted-foreground before:absolute before:top-[0.72em] before:left-[3px] before:size-[5px] before:rounded-full before:bg-border-strong"
        >
          <Inline text={x} />
        </li>
      ))}
    </ul>
  )
}

export function BrandPage({ locale }: { locale: Locale }) {
  const t = COPY[locale]
  const s = t.sections
  const toc = (Object.keys(s) as (keyof typeof s)[]).map((id) => ({ id, label: s[id] }))
  return (
    <div className="flex min-w-0 flex-1 gap-12">
      <article className="mx-auto flex w-full max-w-[760px] min-w-0 flex-col py-10 md:py-14">
        <header className="flex flex-col gap-3 border-b border-border pb-8">
          <p className="font-mono text-caption text-muted-foreground">{t.eyebrow}</p>
          <h1 className="font-display text-[40px] leading-[1.05] tracking-[-0.01em] text-foreground">{UI[locale].brand.title}</h1>
          <p className="max-w-[60ch] text-lead text-muted-foreground">{UI[locale].brand.description}</p>
        </header>

        <Section id="logo" title={s.logo}>
          <p className={prose}>{t.logo}</p>
          <AssetPair art="logo" t={t} />
        </Section>

        <Section id="symbol" title={s.symbol}>
          <p className={prose}>{t.symbol}</p>
          <AssetPair art="symbol" t={t} />
        </Section>

        <Section id="space" title={s.space}>
          <p className={prose}>
            <Inline text={t.space} />
          </p>
          <ClearSpace caption={t.spaceCaption} />
          <p className={`${prose} pt-3`}>
            <Inline text={t.size} />
          </p>
          <Sizes />
        </Section>

        <Section id="colour" title={s.colour}>
          <p className={prose}>{t.colour}</p>
          <Grounds t={t} />
        </Section>

        <Section id="palette" title={s.palette}>
          <p className={prose}>{t.palette}</p>
          <Palette t={t} />
        </Section>

        <Section id="type" title={s.type}>
          <p className={prose}>{t.type}</p>
          <Typography t={t} />
        </Section>

        <Section id="name" title={s.name}>
          <Rules items={t.names} />
        </Section>

        <Section id="misuse" title={s.misuse}>
          <p className={prose}>{t.misuse}</p>
          <Misuse t={t} />
        </Section>

        <Section id="usage" title={s.usage}>
          <Rules items={t.usage} />
          <p className="text-body-sm text-muted-foreground">
            <a href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer" className="underline decoration-border-strong underline-offset-4 hover:text-foreground hover:decoration-foreground">
              {t.contact}
            </a>
          </p>
        </Section>
      </article>
      <Toc items={toc} locale={locale} />
    </div>
  )
}
