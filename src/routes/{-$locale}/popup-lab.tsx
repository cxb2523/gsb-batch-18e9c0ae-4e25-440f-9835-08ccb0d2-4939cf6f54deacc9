import { createFileRoute, notFound } from '@tanstack/react-router'
import { AlarmClock, Archive, ChevronDown, Clock, Copy, Ellipsis, Flag, Moon, Pencil, Share2, Sunrise, Trash2 } from 'lucide-react'
import { useState, type ComponentType, type ReactNode } from 'react'

import * as KitGroup from '@/components/liquid-glass/glass-button-group'
import * as KitMenu from '@/components/liquid-glass/glass-dropdown-menu'
import * as KitPopover from '@/components/liquid-glass/glass-popover'
import * as KitSelect from '@/components/liquid-glass/glass-select'
import * as LabGroup from '@/lab/popup-motion/glass-button-group'
import * as LabMenu from '@/lab/popup-motion/glass-dropdown-menu'
import * as LabPopover from '@/lab/popup-motion/glass-popover'
import * as LabSelect from '@/lab/popup-motion/glass-select'

// Development only (a 404 in production): the popups as the kit has them (before) and as the
// lab's copy in src/lab/popup-motion has them (after), side by side, on the same demos. The kit's
// files are untouched; the lab's copy differs by its glass-popup.tsx and the values in tune.ts.
export const Route = createFileRoute('/{-$locale}/popup-lab')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound()
  },
  head: () => ({ meta: [{ title: 'Popup lab — Liquid Glass UI' }, { name: 'robots', content: 'noindex' }] }),
  component: PopupLab,
})

type Kit = { Group: typeof KitGroup; Menu: typeof KitMenu; Popover: typeof KitPopover; Select: typeof KitSelect }
const KIT: Kit = { Group: KitGroup, Menu: KitMenu, Popover: KitPopover, Select: KitSelect }
const LAB: Kit = { Group: LabGroup, Menu: LabMenu, Popover: LabPopover, Select: LabSelect }

const COPY = {
  en: {
    title: 'Popup lab',
    lead: 'The same demos twice: on the left the kit as it is, on the right the lab’s copy (src/lab/popup-motion). Open and close each one on both sides. The kit’s files are untouched; every change below can be taken on its own.',
    before: 'Before (kit)',
    after: 'After (lab)',
    changes: 'What the lab changes',
    where: 'Where',
  },
  tr: {
    title: 'Popup lab',
    lead: 'Aynı demolar iki kez: solda kit olduğu gibi, sağda lab kopyası (src/lab/popup-motion). Her birini iki tarafta da açıp kapatın. Kitin dosyalarına dokunulmadı; aşağıdaki her değişiklik tek başına alınabilir.',
    before: 'Önce (kit)',
    after: 'Sonra (lab)',
    changes: 'Lab neyi değiştiriyor',
    where: 'Nerede',
  },
}

// Each change, what it fixes, and where it lives in the lab's copy: one can be taken without the others.
const CHANGES: { en: string; tr: string; where: string }[] = [
  {
    en: 'Over (morph), opening: the control keeps its glass at the press. Its press light comes up softly and stays fainter instead of flooding it white in one frame.',
    tr: 'Over (morph), açılış: kontrol basışta camını koruyor. Basış ışığı tek karede beyaza boğmak yerine yavaşça geliyor ve daha hafif kalıyor.',
    where: 'tune.ts MORPH_GLOW (amount 1.4, riseSpeed 9)',
  },
  {
    en: 'Over, opening: the label and its icons no longer vanish at the press: a copy on the surface fades out with a blur as it grows (the popup sits in the top layer, over the control). Icons keep their size and place.',
    tr: 'Over, açılış: yazı ve ikonları basışta bir anda kaybolmuyor; yüzey büyürken üstündeki kopya bulanıklaşarak soluyor (popup top layer’da, kontrolün üstünde). İkonlar boyutunu ve yerini koruyor.',
    where: 'glass-popup.tsx showGhost / placeGhost, tune.ts MORPH.labelOut, labelBlur',
  },
  {
    en: 'Over: the surface and the control read as one body. The card follows how far the surface sticks out of the control, the surface wears the same blend, and the two melt where they meet, so the control’s own shading never shows inside it as a second layer.',
    tr: 'Over: yüzey ve kontrol tek gövde gibi görünüyor. Kart, yüzeyin kontrolden ne kadar taştığını izliyor, yüzey de aynı karışımı giyiyor, ikisi buluştukları yerde eriyor; kontrolün kendi gölgesi içeride ikinci bir katman gibi görünmüyor.',
    where: 'glass-popup.tsx card, blob.material, blob.k; tune.ts MORPH.melt',
  },
  {
    en: 'Over: while the surface is still round, the list shrinks until it fits inside it, so its corners are not cut.',
    tr: 'Over: yüzey henüz yuvarlakken liste ona sığana dek küçülüyor, köşeleri kesilmiyor.',
    where: 'glass-popup.tsx fitIn',
  },
  {
    en: 'Over, closing: one cross-fade. The list fades out as the label and icons fade in, both following the glass on its way in, with no empty white surface between and no letter replay at the end.',
    tr: 'Over, kapanış: tek bir çapraz geçiş. Liste sönerken yazı ve ikonlar beliriyor, ikisi de camın içeri girişini izliyor; arada boş beyaz yüzey yok, sonda harf harf tekrar yok.',
    where: 'glass-popup.tsx stepItems, carry (back); tune.ts MORPH.closeLabel, closeLabelEnd',
  },
  {
    en: 'Over: the surface opens on a calmer spring, so it does not balloon in a few frames.',
    tr: 'Over: yüzey daha sakin bir yayla açılıyor, birkaç karede şişmiyor.',
    where: 'tune.ts MORPH.openSpeed 30 → 18',
  },
  {
    en: 'Stretch (Select, Dropdown Menu without over): the list is cut to the glass and comes in while the panel grows, so no empty white panel shows. Closing starts at once and the list fades as one with the glass, instead of replaying its queue first.',
    tr: 'Stretch (Select, over’sız Dropdown Menu): liste cama kırpılıyor ve panel büyürken geliyor, boş beyaz panel görünmüyor. Kapanış hemen başlıyor, liste önce sırasını geri oynatmak yerine camla birlikte tek parça soluyor.',
    where: 'glass-popup.tsx carry (stretch clip), rewind; tune.ts GOOEY.itemsAt, closeFade, closeNeckPace',
  },
  {
    en: 'All popups: the opening light spills a little further past the surface’s edge.',
    tr: 'Bütün popup’lar: açılış ışığı yüzeyin kenarından biraz daha fazla taşıyor.',
    where: 'tune.ts GLOW.halo 0.35 → 0.5',
  },
]

const COLS = 11
const ROWS = 7
/** 1 around the middle of the grid, falling to 0 at its edge. */
const fade = (col: number, row: number) => {
  const distance = Math.hypot((col - (COLS - 1) / 2) / (COLS / 2), (row - (ROWS - 1) / 2) / (ROWS / 2))
  return Math.min(1, Math.max(0, (1 - distance) / 0.45))
}

/** One demo's stage: the Press demo's fine grid on the page's own colour, the control in its middle. */
function Stage({ children, tall = false, top = false }: { children: ReactNode; tall?: boolean; top?: boolean }) {
  return (
    <div className={`relative isolate flex w-full items-center justify-center overflow-hidden rounded-2xl bg-stage ${tall ? 'h-[30rem]' : 'h-96'} ${top ? 'items-start pt-16' : ''}`}>
      <div aria-hidden className="absolute top-1/2 left-1/2 -z-10 grid -translate-x-1/2 -translate-y-1/2 grid-cols-[repeat(11,40px)]">
        {Array.from({ length: COLS * ROWS }, (_, i) => (
          <span key={i} className="relative size-10" style={{ opacity: fade(i % COLS, Math.floor(i / COLS)) }}>
            <span className="absolute inset-x-0 top-0 h-px bg-black/10 dark:bg-white/10" />
            <span className="absolute inset-y-0 left-0 w-px bg-black/10 dark:bg-white/10" />
          </span>
        ))}
      </div>
      {children}
    </div>
  )
}

function MenuItems({ kit }: { kit: Kit }) {
  const { GlassDropdownMenuItem: Item, GlassDropdownMenuSeparator: Separator } = kit.Menu
  return (
    <>
      <Item>
        <Pencil />
        Rename
      </Item>
      <Item>
        <Copy />
        Duplicate
      </Item>
      <Item>
        <Share2 />
        Share
      </Item>
      <Separator />
      <Item destructive>
        <Trash2 />
        Delete
      </Item>
    </>
  )
}

function ButtonGroupDemo({ kit }: { kit: Kit }) {
  const { GlassButtonGroup: Group, GlassButtonGroupItem: Item } = kit.Group
  const { GlassDropdownMenu: Menu, GlassDropdownMenuTrigger: Trigger, GlassDropdownMenuContent: Content } = kit.Menu
  return (
    <Stage>
      <Group aria-label="Message">
        <Group>
          <Item aria-label="Archive" className="px-0">
            <Archive />
          </Item>
          <Item aria-label="Report" className="px-0">
            <Flag />
          </Item>
          <Item aria-label="Snooze" className="px-0">
            <Clock />
          </Item>
        </Group>
        <Menu over="center">
          <Group>
            <Trigger asChild>
              <Item aria-label="More" className="px-0">
                <Ellipsis />
              </Item>
            </Trigger>
          </Group>
          <Content>
            <MenuItems kit={kit} />
          </Content>
        </Menu>
      </Group>
    </Stage>
  )
}

function MenuDemo({ kit, over }: { kit: Kit; over: boolean }) {
  const { GlassDropdownMenu: Menu, GlassDropdownMenuTrigger: Trigger, GlassDropdownMenuContent: Content } = kit.Menu
  return (
    <Stage top={!over}>
      <Menu over={over ? 'center' : undefined}>
        <Trigger className="h-12 px-6 text-[15px]">
          {over ? 'Options' : 'Actions'}
          <ChevronDown className="opacity-60" />
        </Trigger>
        <Content>
          <MenuItems kit={kit} />
        </Content>
      </Menu>
    </Stage>
  )
}

const TIMES = [
  { id: 'hour', label: 'In an hour', icon: AlarmClock },
  { id: 'tonight', label: 'Tonight at 8', icon: Moon },
  { id: 'tomorrow', label: 'Tomorrow morning', icon: Sunrise },
]

function PopoverDemo({ kit }: { kit: Kit }) {
  const { GlassPopover: Popover, GlassPopoverTrigger: Trigger, GlassPopoverContent: Content, GlassPopoverTitle: Title, GlassPopoverDescription: Description, GlassPopoverClose: Close } = kit.Popover
  const [picked, setPicked] = useState<string | null>(null)
  return (
    <Stage tall>
      <Popover>
        <Trigger>
          <AlarmClock />
          {TIMES.find((t) => t.id === picked)?.label ?? 'Remind me'}
        </Trigger>
        <Content>
          <Title>Remind me</Title>
          <Description>We will send one notification, then leave you alone.</Description>
          <div className="flex flex-col gap-1.5">
            {TIMES.map(({ id, label, icon: Icon }) => (
              <Close key={id} className="justify-start px-4" onClick={() => setPicked(id)}>
                <Icon />
                {label}
              </Close>
            ))}
          </div>
        </Content>
      </Popover>
    </Stage>
  )
}

const OPTIONS = [
  { value: 'standard', label: 'Standard' },
  { value: 'express', label: 'Express' },
  { value: 'same-day', label: 'Same day' },
  { value: 'pickup', label: 'Pickup (closed today)', disabled: true },
]

function SelectDemo({ kit }: { kit: Kit }) {
  const [value, setValue] = useState<string | null>(null)
  const Select = kit.Select.GlassSelect
  return (
    <Stage>
      <Select label="Delivery" placeholder="Choose a speed" options={OPTIONS} value={value} onValueChange={setValue} />
    </Stage>
  )
}

const DEMOS: { name: string; Demo: ComponentType<{ kit: Kit }> }[] = [
  { name: 'Button Group · Dropdown Menu over', Demo: ButtonGroupDemo },
  { name: 'Dropdown Menu · over="center"', Demo: (p) => <MenuDemo {...p} over /> },
  { name: 'Popover', Demo: PopoverDemo },
  { name: 'Dropdown Menu · stretch', Demo: (p) => <MenuDemo {...p} over={false} /> },
  { name: 'Select · stretch', Demo: SelectDemo },
]

function PopupLab() {
  const { locale } = Route.useRouteContext()
  const t = COPY[locale]
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[1320px] flex-col gap-12 px-6 py-16">
      <header className="flex max-w-2xl flex-col gap-3">
        <h1 className="font-display text-title">{t.title}</h1>
        <p className="text-body text-muted-foreground">{t.lead}</p>
      </header>
      {DEMOS.map(({ name, Demo }) => (
        <section key={name} className="flex flex-col gap-3">
          <h2 className="text-body font-semibold">{name}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <span className="text-caption text-muted-foreground">{t.before}</span>
              <Demo kit={KIT} />
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-caption text-muted-foreground">{t.after}</span>
              <Demo kit={LAB} />
            </div>
          </div>
        </section>
      ))}
      <section className="flex max-w-3xl flex-col gap-4">
        <h2 className="text-body font-semibold">{t.changes}</h2>
        <ol className="flex list-decimal flex-col gap-3 pl-5 text-body-sm">
          {CHANGES.map((c) => (
            <li key={c.where}>
              <p>{locale === 'tr' ? c.tr : c.en}</p>
              <p className="text-caption text-muted-foreground">
                {t.where}: <code>{c.where}</code>
              </p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  )
}
