import { Play } from 'lucide-react'

import { GlassButton } from '@/components/liquid-glass'

const COLS = 13
const ROWS = 7

/** 1 around the middle of the grid, falling to 0 at its edge. */
const fade = (col: number, row: number) => {
  const distance = Math.hypot((col - (COLS - 1) / 2) / (COLS / 2), (row - (ROWS - 1) / 2) / (ROWS / 2))
  return Math.min(1, Math.max(0, (1 - distance) / 0.45))
}

// Clear glass bends whatever sits behind it: here, only a fine grid centred on the glass,
// on the page's own colour. Watch its lines bend at the rim. The grid is plain DOM: every
// cell draws its own top and left line, fainter the further it is from the glass.
export default function Demo() {
  return (
    <div className="relative isolate flex h-72 w-full max-w-xl items-center justify-center">
      <div aria-hidden className="absolute top-1/2 left-1/2 -z-10 grid -translate-x-1/2 -translate-y-1/2 grid-cols-[repeat(13,40px)]">
        {Array.from({ length: COLS * ROWS }, (_, i) => (
          <span key={i} className="relative size-10" style={{ opacity: fade(i % COLS, Math.floor(i / COLS)) }}>
            <span className="absolute inset-x-0 top-0 h-px bg-black/10 dark:bg-white/10" />
            <span className="absolute inset-y-0 left-0 w-px bg-black/10 dark:bg-white/10" />
          </span>
        ))}
      </div>
      <GlassButton size="xl" tint={0} icon={<Play />} iconPosition="start">
        Play
      </GlassButton>
    </div>
  )
}
