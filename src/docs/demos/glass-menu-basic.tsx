import { Download, Ellipsis, FolderInput, Heart, Share2, Trash2 } from 'lucide-react'

import {
  GlassMenu,
  GlassMenuContent,
  GlassMenuItem,
  GlassMenuSeparator,
  GlassMenuSub,
  GlassMenuSubContent,
  GlassMenuSubTrigger,
  GlassMenuTrigger,
} from '@/components/liquid-glass/glass-menu'

const COLS = 13
const ROWS = 9

/** 1 around the middle of the grid, falling to 0 at its edge. */
const fade = (col: number, row: number) => {
  const distance = Math.hypot((col - (COLS - 1) / 2) / (COLS / 2), (row - (ROWS - 1) / 2) / (ROWS / 2))
  return Math.min(1, Math.max(0, (1 - distance) / 0.45))
}

// Press the three dots: the round button's own glass pours down into the menu and the dots go.
// Press outside, pick an item or press Escape and it runs the same way back into the button.
// Behind it, only the Press demo's fine grid on the page's own colour, centred on the button:
// plain DOM, every cell draws its own top and left line, fainter towards the edge.
export default function Demo() {
  return (
    <div className="relative isolate flex h-[26rem] w-full max-w-xl items-center justify-center">
      <div aria-hidden className="absolute top-1/2 left-1/2 -z-10 grid -translate-x-1/2 -translate-y-1/2 grid-cols-[repeat(13,40px)]">
        {Array.from({ length: COLS * ROWS }, (_, i) => (
          <span key={i} className="relative size-10" style={{ opacity: fade(i % COLS, Math.floor(i / COLS)) }}>
            <span className="absolute inset-x-0 top-0 h-px bg-black/10 dark:bg-white/10" />
            <span className="absolute inset-y-0 left-0 w-px bg-black/10 dark:bg-white/10" />
          </span>
        ))}
      </div>
      <GlassMenu>
        <GlassMenuTrigger aria-label="More" className="w-12 px-0">
          <Ellipsis />
        </GlassMenuTrigger>
        <GlassMenuContent align="center">
          <GlassMenuItem>
            <Heart />
            Save to library
          </GlassMenuItem>
          <GlassMenuItem>
            <Share2 />
            Share
          </GlassMenuItem>
          <GlassMenuItem>
            <Download />
            Download
          </GlassMenuItem>
          <GlassMenuSub>
            <GlassMenuSubTrigger>
              <FolderInput />
              Move to
            </GlassMenuSubTrigger>
            <GlassMenuSubContent>
              <GlassMenuItem>Favourites</GlassMenuItem>
              <GlassMenuItem>Archive</GlassMenuItem>
              <GlassMenuItem>New folder…</GlassMenuItem>
            </GlassMenuSubContent>
          </GlassMenuSub>
          <GlassMenuSeparator />
          <GlassMenuItem destructive>
            <Trash2 />
            Delete
          </GlassMenuItem>
        </GlassMenuContent>
      </GlassMenu>
    </div>
  )
}
