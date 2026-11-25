import { Mic, Plus } from 'lucide-react'

import { GlassButton } from '@/components/liquid-glass'

const TICKS = 61

// Hold a button and drag away (`pull`, on by default). It comes after the pointer a little way through a rubber
// band, stretches along the pull and thins across it, and swings back like gel when you let go.
// The round ones are small, so they follow from the very point you pressed; the wide one waits
// until the pointer is past its edge. Behind them a ruler to read the stretch against: plain
// DOM, one thin line per tick, fainter towards the ends.
export default function Demo() {
  return (
    <div className="relative isolate flex h-72 w-full max-w-xl items-center justify-center gap-4 overflow-hidden">
      <div aria-hidden className="absolute top-1/2 left-1/2 -z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-[7px]">
        {Array.from({ length: TICKS }, (_, i) => (
          <span
            key={i}
            className={`w-px bg-black/15 dark:bg-white/15 ${i % 10 === 0 ? 'h-28' : i % 5 === 0 ? 'h-20' : 'h-10'}`}
            style={{ opacity: Math.min(1, (1 - Math.abs(i - (TICKS - 1) / 2) / ((TICKS - 1) / 2)) / 0.4) }}
          />
        ))}
      </div>
      <GlassButton size="lg" tint={0.2} aria-label="Add" className="w-12 !px-0">
        <Plus />
      </GlassButton>
      <GlassButton size="lg" tint={0.2}>
        Hold and drag
      </GlassButton>
      <GlassButton size="lg" material="tinted" aria-label="Record" className="w-12 bg-neutral-900 !px-0 text-white dark:bg-white dark:text-neutral-900">
        <Mic />
      </GlassButton>
    </div>
  )
}
