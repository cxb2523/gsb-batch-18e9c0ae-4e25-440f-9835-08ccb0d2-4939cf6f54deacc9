import { ChevronDown, Copy, Pencil, Share2, Trash2 } from 'lucide-react'

import {
  GlassDropdownMenu,
  GlassDropdownMenuContent,
  GlassDropdownMenuItem,
  GlassDropdownMenuSeparator,
  GlassDropdownMenuTrigger,
} from '@/components/liquid-glass/glass-dropdown-menu'

const COLS = 13
const ROWS = 7

/** 1 around the middle of the grid, falling to 0 at its edge. */
const fade = (col: number, row: number) => {
  const distance = Math.hypot((col - (COLS - 1) / 2) / (COLS / 2), (row - (ROWS - 1) / 2) / (ROWS / 2))
  return Math.min(1, Math.max(0, (1 - distance) / 0.45))
}

// Open it: the button itself unfolds into the menu, which settles around it.
// Close it and the menu folds back into the button.
// Behind it, only the Press demo's fine grid on the page's own colour, centred on the button:
// plain DOM, every cell draws its own top and left line, fainter towards the edge.
export default function Demo() {
  return (
    <div className="relative isolate flex h-96 w-full max-w-xl items-center justify-center">
      <div aria-hidden className="absolute top-1/2 left-1/2 -z-10 grid -translate-x-1/2 -translate-y-1/2 grid-cols-[repeat(13,40px)]">
        {Array.from({ length: COLS * ROWS }, (_, i) => (
          <span key={i} className="relative size-10" style={{ opacity: fade(i % COLS, Math.floor(i / COLS)) }}>
            <span className="absolute inset-x-0 top-0 h-px bg-black/10 dark:bg-white/10" />
            <span className="absolute inset-y-0 left-0 w-px bg-black/10 dark:bg-white/10" />
          </span>
        ))}
      </div>
      <GlassDropdownMenu over="center">
        <GlassDropdownMenuTrigger className="h-12 px-6 text-[15px]">
          Options
          <ChevronDown className="opacity-60" />
        </GlassDropdownMenuTrigger>
        <GlassDropdownMenuContent>
          <GlassDropdownMenuItem>
            <Pencil />
            Rename
          </GlassDropdownMenuItem>
          <GlassDropdownMenuItem>
            <Copy />
            Duplicate
          </GlassDropdownMenuItem>
          <GlassDropdownMenuItem>
            <Share2 />
            Share
          </GlassDropdownMenuItem>
          <GlassDropdownMenuSeparator />
          <GlassDropdownMenuItem destructive>
            <Trash2 />
            Delete
          </GlassDropdownMenuItem>
        </GlassDropdownMenuContent>
      </GlassDropdownMenu>
    </div>
  )
}
