import { useState } from 'react'

import { GlassSelect } from '@/components/liquid-glass/glass-select'

const options = [
  { value: 'standard', label: 'Standard' },
  { value: 'express', label: 'Express' },
  { value: 'same-day', label: 'Same day' },
  { value: 'pickup', label: 'Pickup (closed today)', disabled: true },
]

const COLS = 13
const ROWS = 7

/** 1 around the middle of the grid, falling to 0 at its edge. */
const fade = (col: number, row: number) => {
  const distance = Math.hypot((col - (COLS - 1) / 2) / (COLS / 2), (row - (ROWS - 1) / 2) / (ROWS / 2))
  return Math.min(1, Math.max(0, (1 - distance) / 0.45))
}

// Open it: the list swells out of the whole button, a neck stretches between them and snaps,
// and the options arrive one by one. Close it and the same motion plays backwards.
// Behind it, only a fine grid on the page's own colour, centred on the button (which sits
// 14px below the middle, under its label).
// The grid is plain DOM: every cell draws its own top and left line, fainter towards the edge.
export default function Demo() {
  const [value, setValue] = useState<string | null>(null)
  return (
    <div className="relative isolate flex h-96 w-full max-w-xl items-center justify-center">
      <div aria-hidden className="absolute top-[calc(50%+14px)] left-1/2 -z-10 grid -translate-x-1/2 -translate-y-1/2 grid-cols-[repeat(13,40px)]">
        {Array.from({ length: COLS * ROWS }, (_, i) => (
          <span key={i} className="relative size-10" style={{ opacity: fade(i % COLS, Math.floor(i / COLS)) }}>
            <span className="absolute inset-x-0 top-0 h-px bg-black/10 dark:bg-white/10" />
            <span className="absolute inset-y-0 left-0 w-px bg-black/10 dark:bg-white/10" />
          </span>
        ))}
      </div>
      <GlassSelect label="Delivery" placeholder="Choose a speed" options={options} value={value} onValueChange={setValue} />
    </div>
  )
}
