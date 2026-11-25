import { Cloud, Navigation } from 'lucide-react'
import { useEffect, useState, type CSSProperties } from 'react'

import { GlassCard } from '@/components/liquid-glass'

// Two rows of colour slide behind two cards, and the rims bend them as they pass. The rows
// move, so the cards are `live`: they repaint what is behind them every frame.
const colours = ['#0a84ff', '#ff6b3d', '#30d158', '#ff375f', '#ffd60a', '#bf5af2']

function Row({ shift, seconds, reverse = false }: { shift: number; seconds: number; reverse?: boolean }) {
  const pills = [...colours, ...colours].map((_, i) => colours[(i + shift) % colours.length])
  return (
    // Two identical halves slide by exactly one half, on the kit's own marquee (it stops under reduced motion).
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

type ProgressiveBlurProps = {
  className?: string
  backgroundColor?: string
  position?: 'left' | 'right'
  width?: string
  blurAmount?: string
}

/** A progressive blur at one end of the rows: the stage colour over a backdrop blur, fading towards the middle. */
function ProgressiveBlur({
  className = '',
  backgroundColor = 'var(--stage, #ececee)',
  position = 'left',
  width = '150px',
  blurAmount = '4px',
}: ProgressiveBlurProps) {
  const isLeft = position === 'left'
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute top-0 h-full select-none ${className}`}
      style={{
        [isLeft ? 'left' : 'right']: 0,
        width,
        background: `linear-gradient(to ${isLeft ? 'left' : 'right'}, transparent, ${backgroundColor})`,
        maskImage: `linear-gradient(to ${isLeft ? 'right' : 'left'}, #000 50%, transparent)`,
        WebkitMaskImage: `linear-gradient(to ${isLeft ? 'right' : 'left'}, #000 50%, transparent)`,
        WebkitBackdropFilter: `blur(${blurAmount})`,
        backdropFilter: `blur(${blurAmount})`,
        WebkitUserSelect: 'none',
        userSelect: 'none',
      }}
    />
  )
}

/** Today, read after mount so a prerendered page doesn't freeze the day it was built. */
function useToday() {
  const [today, setToday] = useState<Date | null>(null)
  useEffect(() => setToday(new Date()), [])
  return today
}

export default function Demo() {
  const today = useToday()
  const events = [
    { title: 'Visit my GitHub', note: 'github.com/bilalgursen', href: 'https://github.com/bilalgursen', colour: '#0a84ff' },
    { title: 'Star liquid-glass', note: 'Leave a star on the repo', href: 'https://github.com/bilalgursen/liquid-glass', colour: '#ff6b3d' },
  ]
  return (
    // Where the two cards do not fit side by side (a phone), only the first one shows, centred on the two rows.
    <div className="@container relative flex w-full items-center justify-center gap-5 py-14">
      <div
        aria-hidden
        className="absolute inset-0 flex flex-col justify-center gap-3 overflow-hidden"
      >
        <Row shift={0} seconds={40} />
        <Row shift={3} seconds={48} reverse />
        <ProgressiveBlur position="left" />
        <ProgressiveBlur position="right" />
      </div>

      <GlassCard live className="flex size-44 flex-col justify-between p-4">
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

      <GlassCard live className="hidden h-44 w-64 flex-col justify-between p-5 @min-[452px]:flex">
        <div className="flex items-baseline justify-between">
          <p className="text-[14px] font-semibold">{today ? today.toLocaleDateString(undefined, { weekday: 'long' }) : 'Today'}</p>
          <p className="text-[34px] leading-none font-semibold tracking-[-0.05em] tabular-nums">{today?.getDate()}</p>
        </div>
        <ul className="flex flex-col gap-2">
          {events.map((e) => (
            <li key={e.title}>
              <a href={e.href} target="_blank" rel="noreferrer" className="flex items-stretch gap-2.5 rounded-sm">
                <span className="w-1 shrink-0 rounded-full" style={{ background: e.colour }} />
                <span>
                  <span className="block text-[13px] leading-tight font-semibold">{e.title}</span>
                  <span className="block text-[11px] font-medium opacity-60">{e.note}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </GlassCard>
    </div>
  )
}
