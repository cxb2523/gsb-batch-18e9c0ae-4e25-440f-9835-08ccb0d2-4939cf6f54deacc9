import { AlarmClock, Moon, Sunrise } from 'lucide-react'
import { useState } from 'react'

import { GlassPopover, GlassPopoverClose, GlassPopoverContent, GlassPopoverDescription, GlassPopoverTitle, GlassPopoverTrigger } from '@/components/liquid-glass/glass-popover'

const times = [
  { id: 'hour', label: 'In an hour', icon: AlarmClock },
  { id: 'tonight', label: 'Tonight at 8', icon: Moon },
  { id: 'tomorrow', label: 'Tomorrow morning', icon: Sunrise },
]

const COLS = 13
const ROWS = 7

/** 1 around the middle of the grid, falling to 0 at its edge. */
const fade = (col: number, row: number) => {
  const distance = Math.hypot((col - (COLS - 1) / 2) / (COLS / 2), (row - (ROWS - 1) / 2) / (ROWS / 2))
  return Math.min(1, Math.max(0, (1 - distance) / 0.45))
}

// Press it: the button lets go of its label and unfolds, right where it is, into the popover:
// round all the way, a little past it, then settled. Pick a time and it folds back into the button.
// Behind it, only the Press demo's fine grid on the page's own colour, centred on the button:
// plain DOM, every cell draws its own top and left line, fainter towards the edge.
export default function Demo() {
  const [picked, setPicked] = useState<string | null>(null)
  return (
    <div className="relative isolate flex h-[30rem] w-full max-w-xl items-center justify-center">
      <div aria-hidden className="absolute top-1/2 left-1/2 -z-10 grid -translate-x-1/2 -translate-y-1/2 grid-cols-[repeat(13,40px)]">
        {Array.from({ length: COLS * ROWS }, (_, i) => (
          <span key={i} className="relative size-10" style={{ opacity: fade(i % COLS, Math.floor(i / COLS)) }}>
            <span className="absolute inset-x-0 top-0 h-px bg-black/10 dark:bg-white/10" />
            <span className="absolute inset-y-0 left-0 w-px bg-black/10 dark:bg-white/10" />
          </span>
        ))}
      </div>
      <GlassPopover>
        <GlassPopoverTrigger>
          <AlarmClock />
          {times.find((t) => t.id === picked)?.label ?? 'Remind me'}
        </GlassPopoverTrigger>
        <GlassPopoverContent>
          <GlassPopoverTitle>Remind me</GlassPopoverTitle>
          <GlassPopoverDescription>We will send one notification, then leave you alone.</GlassPopoverDescription>
          <div className="flex flex-col gap-1.5">
            {times.map(({ id, label, icon: Icon }) => (
              <GlassPopoverClose key={id} className="justify-start px-4" onClick={() => setPicked(id)}>
                <Icon />
                {label}
              </GlassPopoverClose>
            ))}
          </div>
        </GlassPopoverContent>
      </GlassPopover>
    </div>
  )
}
