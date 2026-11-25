import { createFileRoute, notFound } from '@tanstack/react-router'
import { AlarmClock, ChevronDown, Copy, Moon, Pencil, Share2, Sunrise, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { MORPH, MORPH_GLOW as GLOW } from '@/components/liquid-glass/engine'
import { GlassDropdownMenu, GlassDropdownMenuContent, GlassDropdownMenuItem, GlassDropdownMenuSeparator, GlassDropdownMenuTrigger } from '@/components/liquid-glass/glass-dropdown-menu'
import { GlassPopover, GlassPopoverClose, GlassPopoverContent, GlassPopoverDescription, GlassPopoverTitle, GlassPopoverTrigger } from '@/components/liquid-glass/glass-popover'

// The kit's own values, kept apart from what the sliders change.
const MORPH_DEFAULTS = { ...MORPH }
const GLOW_DEFAULTS = { ...GLOW }

// The light a press lets in, on a morphing control (MORPH_GLOW). It is saved apart from
// /select-lab's: tuning it here leaves Select's light alone.
const GLOW_KNOBS: { key: keyof typeof GLOW; min: number; max: number; step: number; en: string; tr: string; hintEn: string; hintTr: string }[] = [
  { key: 'amount', min: 0, max: 6, step: 0.05, en: 'Strength', tr: 'Güç', hintEn: 'How much one press brightens the glass', hintTr: 'Tek basışın camı ne kadar parlattığı' },
  { key: 'stack', min: 1, max: 6, step: 0.5, en: 'Presses that add up', tr: 'Biriken basış', hintEn: 'Quick presses add up, to this many at most', hintTr: 'Art arda basışlar en fazla bu kadar birikir' },
  { key: 'reach', min: 0.1, max: 3, step: 0.05, en: 'Reach', tr: 'Yarıçap', hintEn: 'Size of the light at first (× the button\'s height)', hintTr: 'Işığın baştaki boyu (× buton yüksekliği)' },
  { key: 'spread', min: 0, max: 3, step: 0.05, en: 'Spread', tr: 'Yayılma', hintEn: 'How much wider it gets as it fades (× the height)', hintTr: 'Sönerken ne kadar genişlediği (× yükseklik)' },
  { key: 'spreadSpeed', min: 1, max: 30, step: 0.5, en: 'Spread speed', tr: 'Yayılma hızı', hintEn: 'How fast it widens', hintTr: 'Genişleme hızı' },
  { key: 'hold', min: 0, max: 1, step: 0.01, en: 'Hold (s)', tr: 'Tutma (sn)', hintEn: 'A quick tap stays lit at least this long', hintTr: 'Hızlı bir dokunuş en az bu kadar yanık kalır' },
  { key: 'riseSpeed', min: 2, max: 60, step: 1, en: 'Rise speed', tr: 'Yanma hızı', hintEn: 'How fast the light comes up', hintTr: 'Işığın yanma hızı' },
  { key: 'fadeSpeed', min: 1, max: 30, step: 0.5, en: 'Fade speed', tr: 'Sönme hızı', hintEn: 'How fast a press fades (lower = a longer tail)', hintTr: 'Basışın sönme hızı (düştükçe kuyruk uzar)' },
  { key: 'cover', min: 0, max: 2, step: 0.05, en: 'Opening: cover', tr: 'Açılış: kaplama', hintEn: 'The opening light ends this wide (× the card\'s diagonal); 0 keeps it at the press', hintTr: 'Açılış ışığının vardığı genişlik (× kartın köşegeni); 0 basılan yerde tutar' },
  { key: 'coverUntil', min: 0, max: 1, step: 0.01, en: 'Opening: lets go at', tr: 'Açılış: bırakma noktası', hintEn: 'The light stays on until the card is this far open', hintTr: 'Işık, kart bu kadar açılana dek yanık kalır' },
  { key: 'coverFadeSpeed', min: 1, max: 40, step: 0.5, en: 'Opening: fade speed', tr: 'Açılış: sönme hızı', hintEn: 'How fast the opening light fades (higher = a shorter flash)', hintTr: 'Açılış ışığının sönme hızı (yükseldikçe daha kısa parlar)' },
  { key: 'halo', min: 0, max: 1, step: 0.05, en: 'Spill past the card', tr: 'Kartın dışına taşma', hintEn: 'How much light shows outside the card\'s edge (0 = none)', hintTr: 'Kartın kenarının dışında görünen ışık (0 = yok)' },
]

// Development only (a 404 in production): the arrival of a morphing surface (GlassPopup with
// `opening: 'morph'`), on a Popover. The button, the card and the light are Select's own and are
// tuned in /select-lab; here only the motion is.
export const Route = createFileRoute('/{-$locale}/popover-lab')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound()
  },
  head: () => ({ meta: [{ title: 'GlassPopover lab — Liquid Glass UI' }, { name: 'robots', content: 'noindex' }] }),
  component: PopoverLab,
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

const COPY = {
  en: {
    trigger: 'Remind me',
    title: 'Remind me',
    description: 'We will send one notification, then leave you alone.',
    times: ['In an hour', 'Tonight at 8', 'Tomorrow morning'],
    menu: 'Options',
    actions: ['Rename', 'Duplicate', 'Share'],
    remove: 'Delete',
  },
  tr: {
    trigger: 'Hatırlat',
    title: 'Hatırlat',
    description: 'Tek bir bildirim göndeririz, sonra seni rahat bırakırız.',
    times: ['Bir saat sonra', 'Bu akşam 8\'de', 'Yarın sabah'],
    menu: 'Seçenekler',
    actions: ['Yeniden adlandır', 'Çoğalt', 'Paylaş'],
    remove: 'Sil',
  },
}

const ICONS = [AlarmClock, Moon, Sunrise]
const ACTION_ICONS = [Pencil, Copy, Share2]

type Key = keyof typeof MORPH

// Each knob: its range and what it does, in both languages.
type Knob = { key: Key; min: number; max: number; step: number; en: string; tr: string; hintEn: string; hintTr: string }

// Its weight: how it is thrown as it comes out.
const WEIGHT_KNOBS: Knob[] = [
  { key: 'weight', min: 0.3, max: 8, step: 0.1, en: 'Weight', tr: 'Ağırlık', hintEn: 'Heavier: thrown less, swings slower', hintTr: 'Ağırlaştıkça daha az savrulur, daha yavaş sallanır' },
  { key: 'throw', min: 0, max: 80, step: 1, en: 'Throw down (px)', tr: 'Aşağı savrulma (px)', hintEn: 'How far down the button is thrown at the press (0 = not at all)', hintTr: 'Butonun basışta ne kadar aşağı savrulduğu (0 = hiç)' },
  { key: 'kick', min: 0, max: 40, step: 0.5, en: 'Throw strength', tr: 'Savrulma darbesi', hintEn: 'How hard it is thrown', hintTr: 'Savrulmanın gücü' },
  { key: 'openDelay', min: 0, max: 0.6, step: 0.01, en: 'Opens after (s)', tr: 'Açılış gecikmesi (sn)', hintEn: 'The button is thrown first; the surface comes out this long after the press', hintTr: 'Önce buton savrulur; yüzey basıştan bu kadar sonra çıkar' },
  { key: 'swingSpeed', min: 2, max: 40, step: 0.5, en: 'Swing speed', tr: 'Sallantı hızı', hintEn: 'How fast it comes back', hintTr: 'Geri gelme hızı' },
  { key: 'swingDamping', min: 0.05, max: 1, step: 0.01, en: 'Settling', tr: 'Sönümleme', hintEn: 'Below 1 it swings to and fro before it rests; higher dies out sooner', hintTr: '1 altında oturmadan önce gidip gelir; yükseldikçe daha çabuk durur' },
]

// Its shape as it grows.
const SHAPE_KNOBS: Knob[] = [
  { key: 'seed', min: 0, max: 1, step: 0.05, en: 'Starts as', tr: 'Başlangıç şekli', hintEn: '0: a circle in the button\'s middle. 1: the button\'s own shape', hintTr: '0: butonun ortasında bir daire. 1: butonun kendi şekli' },
  { key: 'cornersFrom', min: 0, max: 0.95, step: 0.01, en: 'Round until', tr: 'Yuvarlak kalma', hintEn: 'It stays fully round until the follow is this far; its own corners come after', hintTr: 'Takip bu noktaya gelene dek tam yuvarlak kalır; köşeleri sonra gelir' },
  { key: 'pinch', min: 0, max: 1.5, step: 0.05, en: 'Pinch', tr: 'Büzülme', hintEn: 'How much thinner the glass gets while the long side runs ahead (0 = none)', hintTr: 'Uzun kenar öndeyken camın ne kadar inceldiği (0 = yok)' },
]

// The card's way into place.
const DROP_KNOBS: Knob[] = [
  { key: 'drop', min: -200, max: 200, step: 5, en: 'Drops from (px)', tr: 'Düşüş mesafesi (px)', hintEn: 'As it grows the card is carried this far above its place, then comes down into it (negative: from below; 0 = it does not drop)', hintTr: 'Kart büyürken yerinin bu kadar üstüne taşınır, sonra yerine iner (eksi: aşağıdan gelir; 0 = düşmez)' },
  { key: 'dropDelay', min: 0, max: 0.8, step: 0.01, en: 'Drops after (s)', tr: 'Düşüş gecikmesi (sn)', hintEn: 'How long after the press it starts coming down', hintTr: 'Basıştan ne kadar sonra inmeye başladığı' },
  { key: 'dropSpeed', min: 2, max: 40, step: 0.5, en: 'Drop speed', tr: 'Düşüş hızı', hintEn: 'How fast it comes down', hintTr: 'İniş hızı' },
  { key: 'dropDamping', min: 0.3, max: 1, step: 0.01, en: 'Drop settling', tr: 'Düşüş sönümü', hintEn: 'Below 1 it lands past its place and comes back', hintTr: '1 altında yerini aşıp geri gelir' },
]

// Closing as a motion of its own (MORPH.closeSoft).
const CLOSE_SOFT_KNOB: Knob = { key: 'closeSpeed', min: 4, max: 40, step: 0.5, en: 'Soft close: speed', tr: 'Yumuşak kapanış: hız', hintEn: 'How fast the surface goes back in; it slows down as it lands', hintTr: 'Yüzeyin geri girme hızı; yerine yaklaşırken yavaşlar' }
const CLOSE_FADE_KNOB: Knob = { key: 'closeFade', min: 0.02, max: 0.6, step: 0.01, en: 'Soft close: content gone in (s)', tr: 'Yumuşak kapanış: içerik sönmesi (sn)', hintEn: 'The content fades out this fast, ahead of the glass (lower = sooner)', hintTr: 'İçerik camdan önce, bu sürede saydamlaşır (düştükçe daha çabuk)' }
const CLOSE_GLOW_KNOB: Knob = { key: 'closeGlowReach', min: 0.3, max: 3, step: 0.05, en: 'Soft close: light on the button', tr: 'Yumuşak kapanış: butondaki ışık', hintEn: 'How wide a choice\'s light is once it is on the button (× the button\'s height)', hintTr: 'Seçimin ışığının butona vardığındaki genişliği (× buton yüksekliği)' }
const CLOSE_KICK_KNOB: Knob = { key: 'closeKick', min: 0, max: 1.5, step: 0.05, en: 'Button\'s answer', tr: 'Butonun tepkisi', hintEn: 'How hard the button is thrown once the surface is back in (0 = it stays still)', hintTr: 'Yüzey geri girince butonun ne kadar savrulduğu (0 = yerinde kalır)' }

const GOOEY_KNOB: Knob = { key: 'softness', min: 0, max: 40, step: 1, en: 'Gooey: softness (px)', tr: 'Gooey: yumuşaklık (px)', hintEn: 'How far the surface and the button melt into each other where they meet', hintTr: 'Yüzey ile butonun birleştikleri yerde birbirine ne kadar eridiği' }

const KNOBS: Knob[] = [
  { key: 'openSpeed', min: 4, max: 40, step: 0.5, en: 'Growth speed', tr: 'Büyüme hızı', hintEn: 'How fast the long side grows', hintTr: 'Uzun kenarın büyüme hızı' },
  { key: 'openDamping', min: 0.3, max: 1, step: 0.01, en: 'Growth settling', tr: 'Büyüme sönümü', hintEn: 'Below 1 it lands past the surface and comes back', hintTr: '1 altında yüzeyi aşıp geri gelir' },
  { key: 'crossSpeed', min: 4, max: 40, step: 0.5, en: 'Other side: speed', tr: 'Diğer kenar: hız', hintEn: 'How fast the other side follows', hintTr: 'Diğer kenarın takip hızı' },
  { key: 'crossDamping', min: 0.3, max: 1, step: 0.01, en: 'Other side: settling', tr: 'Diğer kenar: sönüm', hintEn: 'Lower: it swings wider before it rests', hintTr: 'Düştükçe oturmadan önce daha çok açılır' },
  { key: 'calmSpeed', min: 2, max: 30, step: 0.5, en: 'Follow speed', tr: 'Takip hızı', hintEn: 'Corners, frost and focus follow at this speed, with no bounce', hintTr: 'Köşeler, buz ve netlik bu hızla, sekmeden takip eder' },
  { key: 'frostFrom', min: 0, max: 0.95, step: 0.01, en: 'Button gives way: from', tr: 'Buton camı: başlangıç', hintEn: 'The button\'s clear glass starts turning into the card here (0–1 of the follow)', hintTr: 'Butonun berrak camı karta burada dönmeye başlar (takibin 0–1\'i)' },
  { key: 'frostTo', min: 0.05, max: 1, step: 0.01, en: 'Button gives way: to', tr: 'Buton camı: bitiş', hintEn: '...and is all card by here', hintTr: '...ve burada tamamen kart olur' },
  { key: 'labelOut', min: 0.02, max: 1, step: 0.01, en: 'Label gone at', tr: 'Etiketin kaybolması', hintEn: 'The button\'s label is gone once the surface is this far out', hintTr: 'Yüzey bu kadar çıkınca butonun etiketi kaybolmuş olur' },
  { key: 'labelBlur', min: 0, max: 12, step: 0.5, en: 'Label blur (px)', tr: 'Etiket bulanıklığı (px)', hintEn: 'How soft the label gets as it goes', hintTr: 'Etiketin giderken ne kadar yumuşadığı' },
  { key: 'contentFade', min: 0.02, max: 1, step: 0.01, en: 'Content fade', tr: 'İçerik opaklığı', hintEn: 'The content fades in with the follow and is fully visible at this point (lower = sooner)', hintTr: 'İçerik takiple birlikte belirir ve bu noktada tamamen görünür (düştükçe daha erken)' },
  { key: 'contentBlur', min: 0, max: 16, step: 0.5, en: 'Content blur (px)', tr: 'İçerik bulanıklığı (px)', hintEn: 'How soft the content starts; it sharpens with the follow', hintTr: 'İçeriğin baştaki yumuşaklığı; takiple netleşir' },
  { key: 'zoom', min: 0, max: 1, step: 0.05, en: 'Content zoom', tr: 'İçerik ölçeği', hintEn: '1: the content is as small as the glass is. 0: full size from the start, only cut to the glass', hintTr: '1: içerik cam kadar küçük başlar. 0: baştan tam boy, yalnızca cama göre kesilir' },
  { key: 'closeDelay', min: 0, max: 0.6, step: 0.01, en: 'Closes after (s)', tr: 'Kapanış gecikmesi (sn)', hintEn: 'Asked to close, the surface stays as it is this long before it goes back in', hintTr: 'Kapanması istenince yüzey geri girmeden önce bu kadar bekler' },
  { key: 'closePace', min: 0.5, max: 6, step: 0.1, en: 'Close pace', tr: 'Kapanış temposu', hintEn: 'Closing plays the opening backwards, this many times faster', hintTr: 'Kapanış, açılışı bu kat hızla tersine oynatır' },
]

const RATES = [1, 0.5, 0.25, 0.1]

const PANEL = {
  en: {
    play: 'Playback',
    playNote: 'Slow the glass down to see the arrival frame by frame, or let it open and close by itself while you move the sliders.',
    speed: 'Speed',
    loop: 'Open and close by itself',
    options: 'How it opens',
    subject: 'Component',
    popover: 'Popover',
    menu: 'Options',
    from: 'Comes from',
    top: 'Above',
    bottom: 'Below',
    fromNote: 'The `from` prop. Above: the button is thrown down and the card comes down into place. Below: the other way up, the card comes up into place. Popover starts from below, the menu from above.',
    place: 'Opens',
    center: 'In the middle',
    edge: 'From the edge',
    gooey: 'Gooey',
    gooeyNote: 'Off: the surface and the button are two clean shapes. On: they melt into each other where they meet.',
    weight: 'Weight',
    weightNote: 'The press throws the button a little way down; then the surface opens out of it, towards its middle.',
    shape: 'Shape',
    content: 'Card drop',
    contentNote: 'The card comes down into its place from above, softly, a moment after the press.',
    glow: 'Light (glow)',
    glowNote: 'The light a press lets in: it grows with the card until it covers it, then fades. Select\'s own light; the same values move in /select-lab.',
    close: 'Closing',
    closeNote: 'Off: the opening is played backwards, so it starts slowly and hits the button at full speed. On: the surface goes back in on a spring of its own and slows down as it lands; the button is not thrown and does not light up.',
    closeSoft: 'Soft close',
    title: 'Arrival',
    note: 'Changes apply at once: open the popover to see them. The button, the card and the light are Select\'s own; tune those in /select-lab.',
    copy: 'Copy values',
    copied: 'Copied',
    reset: 'Reset',
  },
  tr: {
    play: 'Oynatma',
    playNote: 'Gelişi kare kare görmek için camı yavaşlat ya da sürgüleri oynatırken kendi kendine açılıp kapanmasına izin ver.',
    speed: 'Hız',
    loop: 'Kendi kendine aç kapa',
    options: 'Nasıl açılır',
    subject: 'Bileşen',
    popover: 'Popover',
    menu: 'Options',
    from: 'Geliş yönü',
    top: 'Yukarıdan',
    bottom: 'Aşağıdan',
    fromNote: '`from` prop\'u. Yukarıdan: buton aşağı savrulur, kart yukarıdan yerine iner. Aşağıdan: tersi, buton yukarı savrulur, kart aşağıdan yerine çıkar. Popover aşağıdan, menü yukarıdan başlar.',
    place: 'Açılış yeri',
    center: 'Tam ortada',
    edge: 'Kenardan',
    gooey: 'Gooey',
    gooeyNote: 'Kapalı: yüzey ve buton iki temiz şekildir. Açık: birleştikleri yerde birbirine erir.',
    weight: 'Ağırlık',
    weightNote: 'Basış butonu hafifçe aşağı savurur; ardından yüzey butondan çıkıp ortasına doğru açılır.',
    shape: 'Şekil',
    content: 'Kartın düşüşü',
    contentNote: 'Kart, basıştan bir an sonra yukarıdan yumuşakça yerine iner.',
    glow: 'Işık (glow)',
    glowNote: 'Basışın cama saldığı ışık: kartla birlikte büyüyüp onu kaplar, sonra söner. Select\'in kendi ışığıdır; aynı değerler /select-lab\'de de değişir.',
    close: 'Kapanış',
    closeNote: 'Kapalı: açılış tersine oynar; yavaş başlar, butona en yüksek hızda çarpar. Açık: yüzey kendi yayıyla geri girer ve yerine yaklaşırken yavaşlar; buton savrulmaz, ışık da yanmaz.',
    closeSoft: 'Yumuşak kapanış',
    title: 'Geliş',
    note: 'Değişiklikler anında uygulanır: görmek için popover\'ı aç. Buton, kart ve ışık Select\'in kendisidir; onları /select-lab\'de ayarla.',
    copy: 'Değerleri kopyala',
    copied: 'Kopyalandı',
    reset: 'Sıfırla',
  },
}

// Bumped when the set of values changes, so stale saved ones do not override the kit's.
const STORE = 'glass-morph-tuning-5'
const PLACE_STORE = 'glass-morph-place-2'
/** /select-lab's key for the light: `{ wide, small }`. This lab tunes `wide`, the set a button this size takes. */
const GLOW_STORE = 'glass-morph-glow-1'

const FROM_STORE = 'glass-morph-from-2'
const SUBJECT_STORE = 'glass-morph-subject-1'

type Place = 'center' | 'edge'
const PLACES: Place[] = ['center', 'edge']
/** Which way the surface comes into place: the components' `from` prop. */
type From = 'top' | 'bottom'
const FROMS: From[] = ['top', 'bottom']
/** What each component does when nothing is passed (the menu's place: its docs example's). */
const DEFAULTS: Record<'popover' | 'menu', { from: From; place: Place }> = { popover: { from: 'bottom', place: 'center' }, menu: { from: 'top', place: 'center' } }
/** What opens on the stage: the Popover, or the Dropdown Menu of the docs (its "Options" button). */
type Subject = 'popover' | 'menu'
const SUBJECTS: Subject[] = ['popover', 'menu']

/** A choice that survives a reload. */
function useSaved<T extends string>(key: string, choices: readonly T[], initial: T) {
  const [value, setValue] = useState<T>(initial)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(key) as T | null
      setValue(saved && choices.includes(saved) ? saved : initial)
    } catch {
      // Storage is unavailable: the first choice stands.
      setValue(initial)
    }
  }, [key, choices, initial])
  const choose = (next: T) => {
    setValue(next)
    try {
      localStorage.setItem(key, next)
    } catch {
      // Storage is unavailable: the choice still applies for this visit.
    }
  }
  return [value, choose] as const
}

type TunerProps = {
  locale: 'en' | 'tr'
  rate: number
  setRate: (rate: number) => void
  loop: boolean
  setLoop: (loop: boolean) => void
  place: Place
  setPlace: (place: Place) => void
  from: From
  setFrom: (from: From) => void
  subject: Subject
  setSubject: (subject: Subject) => void
}

function Tuner({ locale, rate, setRate, loop, setLoop, place, setPlace, from, setFrom, subject, setSubject }: TunerProps) {
  const t = PANEL[locale]
  const [values, setValues] = useState({ ...MORPH_DEFAULTS })
  const [glow, setGlow] = useState({ ...GLOW_DEFAULTS })
  const [copied, setCopied] = useState(false)

  // Values survive a reload, so tuning can go on across sessions.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null')
      if (saved) setValues((v) => ({ ...v, ...saved }))
      const light = JSON.parse(localStorage.getItem(GLOW_STORE) ?? 'null')
      if (light?.wide) setGlow((v) => ({ ...v, ...light.wide }))
    } catch {
      // Nothing saved, or storage is unavailable: the defaults stand.
    }
  }, [])
  useEffect(() => {
    Object.assign(MORPH, values)
    try {
      localStorage.setItem(STORE, JSON.stringify(values))
    } catch {
      // Storage is unavailable: the values still apply for this visit.
    }
  }, [values])
  useEffect(() => {
    Object.assign(GLOW, glow)
    try {
      const light = JSON.parse(localStorage.getItem(GLOW_STORE) ?? 'null') ?? {}
      localStorage.setItem(GLOW_STORE, JSON.stringify({ ...light, wide: glow }))
    } catch {
      // Storage is unavailable: the values still apply for this visit.
    }
  }, [glow])
  // Leaving the lab puts the kit's own values back.
  useEffect(
    () => () => {
      Object.assign(MORPH, MORPH_DEFAULTS)
      Object.assign(GLOW, GLOW_DEFAULTS)
    },
    [],
  )

  const text = JSON.stringify({ component: subject, over: place, from, MORPH: values, GLOW: glow }, null, 2)
  const set = (key: Key, value: number) => setValues((v) => ({ ...v, [key]: value }))
  const sliders = (knobs: Knob[]) =>
    knobs.map((k) => (
      <label key={k.key} className="flex flex-col gap-1" title={locale === 'tr' ? k.hintTr : k.hintEn}>
        <span className="flex items-baseline justify-between">
          <span>{locale === 'tr' ? k.tr : k.en}</span>
          <span className="font-mono text-caption text-muted-foreground tabular-nums">{values[k.key]}</span>
        </span>
        <input type="range" min={k.min} max={k.max} step={k.step} value={values[k.key]} onChange={(e) => set(k.key, Number(e.target.value))} className="w-full" />
        <span className="text-micro text-muted-foreground">{locale === 'tr' ? k.hintTr : k.hintEn}</span>
      </label>
    ))
  const choice = (on: boolean) => `press rounded-md px-2 py-1 text-caption ${on ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent'}`
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
      // Under the popover on a narrow screen, with room left for it to open into.
      className="fixed top-24 right-4 bottom-4 z-10 flex w-56 flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-background p-4 text-ui text-foreground xl:w-72 max-md:static max-md:mt-72 max-md:w-[calc(100%-2rem)]"
    >
      <h2 className="text-body-sm font-semibold">{t.play}</h2>
      <p className="text-caption text-muted-foreground">{t.playNote}</p>
      <div className="flex items-center justify-between gap-2">
        <span>{t.speed}</span>
        <span className="flex gap-1">
          {RATES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={rate === r}
              onClick={() => setRate(r)}
              className={`press rounded-md px-2 py-1 font-mono text-caption tabular-nums ${rate === r ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent'}`}
            >
              {r}×
            </button>
          ))}
        </span>
      </div>
      <label className="flex items-center justify-between gap-2">
        <span>{t.loop}</span>
        <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
      </label>
      <hr className="border-border" />
      <div className="flex items-center justify-between">
        <h2 className="text-body-sm font-semibold">{t.options}</h2>
        <button
          type="button"
          onClick={() => {
            setValues({ ...MORPH_DEFAULTS })
            setPlace(DEFAULTS[subject].place)
            setFrom(DEFAULTS[subject].from)
          }}
          className="press rounded-md px-2 py-1 text-caption text-muted-foreground hover:bg-accent"
        >
          {t.reset}
        </button>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span>{t.subject}</span>
        <span className="flex gap-1">
          {SUBJECTS.map((s) => (
            <button key={s} type="button" aria-pressed={subject === s} onClick={() => setSubject(s)} className={choice(subject === s)}>
              {t[s]}
            </button>
          ))}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <span>{t.from}</span>
        <span className="grid grid-cols-2 gap-1">
          {FROMS.map((f) => (
            <button key={f} type="button" aria-pressed={from === f} onClick={() => setFrom(f)} className={choice(from === f)}>
              {t[f]}
            </button>
          ))}
        </span>
        <span className="text-micro text-muted-foreground">{t.fromNote}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span>{t.place}</span>
        <span className="flex gap-1">
          {PLACES.map((p) => (
            <button key={p} type="button" aria-pressed={place === p} onClick={() => setPlace(p)} className={choice(place === p)}>
              {t[p]}
            </button>
          ))}
        </span>
      </div>
      <label className="flex items-center justify-between gap-2">
        <span>{t.gooey}</span>
        <input type="checkbox" checked={values.gooey > 0.5} onChange={(e) => set('gooey', e.target.checked ? 1 : 0)} />
      </label>
      <p className="text-micro text-muted-foreground">{t.gooeyNote}</p>
      {values.gooey > 0.5 && sliders([GOOEY_KNOB])}
      <hr className="border-border" />
      <div className="flex items-center justify-between">
        <h2 className="text-body-sm font-semibold">{t.glow}</h2>
        <button type="button" onClick={() => setGlow({ ...GLOW_DEFAULTS })} className="press rounded-md px-2 py-1 text-caption text-muted-foreground hover:bg-accent">
          {t.reset}
        </button>
      </div>
      <p className="text-caption text-muted-foreground">{t.glowNote}</p>
      {GLOW_KNOBS.map((k) => (
        <label key={k.key} className="flex flex-col gap-1" title={locale === 'tr' ? k.hintTr : k.hintEn}>
          <span className="flex items-baseline justify-between">
            <span>{locale === 'tr' ? k.tr : k.en}</span>
            <span className="font-mono text-caption text-muted-foreground tabular-nums">{glow[k.key]}</span>
          </span>
          <input type="range" min={k.min} max={k.max} step={k.step} value={glow[k.key]} onChange={(e) => setGlow((v) => ({ ...v, [k.key]: Number(e.target.value) }))} className="w-full" />
          <span className="text-micro text-muted-foreground">{locale === 'tr' ? k.hintTr : k.hintEn}</span>
        </label>
      ))}
      <hr className="border-border" />
      <h2 className="text-body-sm font-semibold">{t.weight}</h2>
      <p className="text-caption text-muted-foreground">{t.weightNote}</p>
      {sliders(WEIGHT_KNOBS)}
      <hr className="border-border" />
      <h2 className="text-body-sm font-semibold">{t.shape}</h2>
      {sliders(SHAPE_KNOBS)}
      <hr className="border-border" />
      <h2 className="text-body-sm font-semibold">{t.content}</h2>
      <p className="text-caption text-muted-foreground">{t.contentNote}</p>
      {sliders(DROP_KNOBS)}
      <hr className="border-border" />
      <h2 className="text-body-sm font-semibold">{t.title}</h2>
      <p className="text-caption text-muted-foreground">{t.note}</p>
      {sliders(KNOBS)}
      <hr className="border-border" />
      <h2 className="text-body-sm font-semibold">{t.close}</h2>
      <label className="flex items-center justify-between gap-2">
        <span>{t.closeSoft}</span>
        <input type="checkbox" checked={values.closeSoft > 0.5} onChange={(e) => set('closeSoft', e.target.checked ? 1 : 0)} />
      </label>
      <p className="text-micro text-muted-foreground">{t.closeNote}</p>
      {sliders(values.closeSoft > 0.5 ? [CLOSE_SOFT_KNOB, CLOSE_FADE_KNOB, CLOSE_GLOW_KNOB] : [CLOSE_KICK_KNOB])}
      <button type="button" onClick={copy} className="press mt-1 rounded-md bg-foreground px-3 py-2 text-ui font-medium text-background">
        {copied ? t.copied : t.copy}
      </button>
      <textarea readOnly value={text} rows={8} onFocus={(e) => e.currentTarget.select()} className="rounded-md border border-border bg-background p-2 font-mono text-micro" />
    </aside>
  )
}

const COLS = 13
const ROWS = 7

/** 1 around the middle of the grid, falling to 0 at its edge. */
const fade = (col: number, row: number) => {
  const distance = Math.hypot((col - (COLS - 1) / 2) / (COLS / 2), (row - (ROWS - 1) / 2) / (ROWS / 2))
  return Math.min(1, Math.max(0, (1 - distance) / 0.45))
}

function PopoverLab() {
  const { locale } = Route.useRouteContext()
  const t = COPY[locale]
  const [open, setOpen] = useState(false)
  const [rate, setRate] = useState(1)
  const [loop, setLoop] = useState(false)
  const [picked, setPicked] = useState<number | null>(null)
  const [subject, setSubject] = useSaved<Subject>(SUBJECT_STORE, SUBJECTS, 'popover')
  // Each component keeps its own choices, and starts from its own defaults.
  const [place, choosePlace] = useSaved<Place>(`${PLACE_STORE}-${subject}`, PLACES, DEFAULTS[subject].place)
  const [from, setFrom] = useSaved<From>(`${FROM_STORE}-${subject}`, FROMS, DEFAULTS[subject].from)

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
    const id = setInterval(() => setOpen((o) => !o), 1500 / rate)
    return () => clearInterval(id)
  }, [loop, rate])

  return (
    <main className="relative isolate flex min-h-dvh items-start justify-center overflow-hidden bg-stage pt-64 max-md:flex-col max-md:items-center max-md:justify-start max-md:pb-6">
      {/* The Press demo's fine grid, centred on the button (24px to its middle), with room above for a popover that opens around it. */}
      <div aria-hidden className="absolute top-[280px] left-1/2 -z-10 grid -translate-x-1/2 -translate-y-1/2 grid-cols-[repeat(13,40px)]">
        {Array.from({ length: COLS * ROWS }, (_, i) => (
          <span key={i} className="relative size-10" style={{ opacity: fade(i % COLS, Math.floor(i / COLS)) }}>
            <span className="absolute inset-x-0 top-0 h-px bg-black/10 dark:bg-white/10" />
            <span className="absolute inset-y-0 left-0 w-px bg-black/10 dark:bg-white/10" />
          </span>
        ))}
      </div>
      {/* While it opens and closes by itself, a press on a slider must not close it. */}
      {subject === 'menu' ? (
        <GlassDropdownMenu over={place} from={from} open={open} onOpenChange={(next: boolean) => !loop && setOpen(next)}>
          <GlassDropdownMenuTrigger className="h-12 px-6 text-[15px]">
            {t.menu}
            <ChevronDown className="opacity-60" />
          </GlassDropdownMenuTrigger>
          <GlassDropdownMenuContent>
            {t.actions.map((label, i) => {
              const Icon = ACTION_ICONS[i]
              return (
                <GlassDropdownMenuItem key={label}>
                  <Icon />
                  {label}
                </GlassDropdownMenuItem>
              )
            })}
            <GlassDropdownMenuSeparator />
            <GlassDropdownMenuItem destructive>
              <Trash2 />
              {t.remove}
            </GlassDropdownMenuItem>
          </GlassDropdownMenuContent>
        </GlassDropdownMenu>
      ) : (
      <GlassPopover from={from} open={open} onOpenChange={(next: boolean) => !loop && setOpen(next)} dismissible={!loop}>
        <GlassPopoverTrigger>
          <AlarmClock />
          {picked === null ? t.trigger : t.times[picked]}
        </GlassPopoverTrigger>
        <GlassPopoverContent over={place}>
          <GlassPopoverTitle>{t.title}</GlassPopoverTitle>
          <GlassPopoverDescription>{t.description}</GlassPopoverDescription>
          <div className="flex flex-col gap-1.5">
            {t.times.map((label, i) => {
              const Icon = ICONS[i]
              return (
                <GlassPopoverClose key={label} className="justify-start px-4" onClick={() => setPicked(i)}>
                  <Icon />
                  {label}
                </GlassPopoverClose>
              )
            })}
          </div>
        </GlassPopoverContent>
      </GlassPopover>
      )}
      <Tuner
        locale={locale}
        rate={rate}
        setRate={setRate}
        loop={loop}
        setLoop={setLoop}
        place={place}
        setPlace={choosePlace}
        from={from}
        setFrom={setFrom}
        subject={subject}
        setSubject={(next) => {
          setOpen(false)
          setSubject(next)
        }}
      />
    </main>
  )
}
