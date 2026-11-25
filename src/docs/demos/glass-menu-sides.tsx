import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react'

import { GlassMenu, GlassMenuContent, GlassMenuItem, GlassMenuTrigger } from '@/components/liquid-glass/glass-menu'

const COLS = 13
const ROWS = 11

/** 1 around the middle of the grid, falling to 0 at its edge. */
const fade = (col: number, row: number) => {
  const distance = Math.hypot((col - (COLS - 1) / 2) / (COLS / 2), (row - (ROWS - 1) / 2) / (ROWS / 2))
  return Math.min(1, Math.max(0, (1 - distance) / 0.45))
}

const sides = [
  { side: 'top', label: 'Open above', icon: ArrowUp, place: 'col-start-2 row-start-1' },
  { side: 'left', label: 'Open to the left', icon: ArrowLeft, place: 'col-start-1 row-start-2' },
  { side: 'right', label: 'Open to the right', icon: ArrowRight, place: 'col-start-3 row-start-2' },
  { side: 'bottom', label: 'Open below', icon: ArrowDown, place: 'col-start-2 row-start-3' },
] as const

// Four buttons, four sides. `side` says where the menu lies and the glass finds its own way
// there: the edge that faces the menu runs ahead, the rest of the outline follows.
export default function Demo() {
  return (
    <div className="relative isolate flex h-[34rem] w-full max-w-xl items-center justify-center">
      <div aria-hidden className="absolute top-1/2 left-1/2 -z-10 grid -translate-x-1/2 -translate-y-1/2 grid-cols-[repeat(13,40px)]">
        {Array.from({ length: COLS * ROWS }, (_, i) => (
          <span key={i} className="relative size-10" style={{ opacity: fade(i % COLS, Math.floor(i / COLS)) }}>
            <span className="absolute inset-x-0 top-0 h-px bg-black/10 dark:bg-white/10" />
            <span className="absolute inset-y-0 left-0 w-px bg-black/10 dark:bg-white/10" />
          </span>
        ))}
      </div>
      <div className="grid grid-cols-3 grid-rows-3 gap-2">
        {sides.map(({ side, label, icon: Icon, place }) => (
          <div key={side} className={place}>
            <GlassMenu>
              <GlassMenuTrigger aria-label={label} className="w-12 px-0">
                <Icon />
              </GlassMenuTrigger>
              <GlassMenuContent side={side} align="center">
                <GlassMenuItem>Rename</GlassMenuItem>
                <GlassMenuItem>Duplicate</GlassMenuItem>
                <GlassMenuItem>Archive</GlassMenuItem>
              </GlassMenuContent>
            </GlassMenu>
          </div>
        ))}
      </div>
    </div>
  )
}
