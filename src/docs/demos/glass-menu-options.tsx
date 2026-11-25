import { SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'

import {
  GlassMenu,
  GlassMenuCheckboxItem,
  GlassMenuContent,
  GlassMenuGroup,
  GlassMenuItem,
  GlassMenuLabel,
  GlassMenuRadioGroup,
  GlassMenuRadioItem,
  GlassMenuSeparator,
  GlassMenuShortcut,
  GlassMenuTrigger,
} from '@/components/liquid-glass/glass-menu'

const COLS = 13
const ROWS = 11

/** 1 around the middle of the grid, falling to 0 at its edge. */
const fade = (col: number, row: number) => {
  const distance = Math.hypot((col - (COLS - 1) / 2) / (COLS / 2), (row - (ROWS - 1) / 2) / (ROWS / 2))
  return Math.min(1, Math.max(0, (1 - distance) / 0.45))
}

// A view menu: options that stay on (checkbox items), one choice among a few (radio items),
// a label over each group and a shortcut at the end of an action. Checking an option keeps the
// menu open; the action closes it.
export default function Demo() {
  const [sidebar, setSidebar] = useState(true)
  const [preview, setPreview] = useState(false)
  const [sort, setSort] = useState('name')
  return (
    <div className="relative isolate flex h-[32rem] w-full max-w-xl items-center justify-center">
      <div aria-hidden className="absolute top-1/2 left-1/2 -z-10 grid -translate-x-1/2 -translate-y-1/2 grid-cols-[repeat(13,40px)]">
        {Array.from({ length: COLS * ROWS }, (_, i) => (
          <span key={i} className="relative size-10" style={{ opacity: fade(i % COLS, Math.floor(i / COLS)) }}>
            <span className="absolute inset-x-0 top-0 h-px bg-black/10 dark:bg-white/10" />
            <span className="absolute inset-y-0 left-0 w-px bg-black/10 dark:bg-white/10" />
          </span>
        ))}
      </div>
      <GlassMenu>
        <GlassMenuTrigger>
          <SlidersHorizontal />
          View
        </GlassMenuTrigger>
        <GlassMenuContent align="center" className="min-w-56">
          <GlassMenuGroup>
            <GlassMenuLabel>Show</GlassMenuLabel>
            <GlassMenuCheckboxItem value="sidebar" checked={sidebar} onCheckedChange={setSidebar}>
              Sidebar
            </GlassMenuCheckboxItem>
            <GlassMenuCheckboxItem value="preview" checked={preview} onCheckedChange={setPreview}>
              Preview
            </GlassMenuCheckboxItem>
          </GlassMenuGroup>
          <GlassMenuSeparator />
          <GlassMenuGroup>
            <GlassMenuLabel>Sort by</GlassMenuLabel>
            <GlassMenuRadioGroup value={sort} onValueChange={setSort}>
              <GlassMenuRadioItem value="name">Name</GlassMenuRadioItem>
              <GlassMenuRadioItem value="date">Date modified</GlassMenuRadioItem>
              <GlassMenuRadioItem value="size">Size</GlassMenuRadioItem>
            </GlassMenuRadioGroup>
          </GlassMenuGroup>
          <GlassMenuSeparator />
          <GlassMenuItem shortcut="Mod+R">
            Refresh
            <GlassMenuShortcut />
          </GlassMenuItem>
        </GlassMenuContent>
      </GlassMenu>
    </div>
  )
}
