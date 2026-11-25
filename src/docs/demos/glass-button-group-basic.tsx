import { Archive, ArrowLeft, BellOff, Clock, Ellipsis, Flag, MailOpen, Tag, Trash2 } from 'lucide-react'

import { GlassButtonGroup, GlassButtonGroupItem } from '@/components/liquid-glass'
import { GlassMenu, GlassMenuContent, GlassMenuItem, GlassMenuSeparator, GlassMenuTrigger } from '@/components/liquid-glass/glass-menu'

const COLS = 13
const ROWS = 7

/** 1 around the middle of the grid, falling to 0 at its edge. */
const fade = (col: number, row: number) => {
  const distance = Math.hypot((col - (COLS - 1) / 2) / (COLS / 2), (row - (ROWS - 1) / 2) / (ROWS / 2))
  return Math.min(1, Math.max(0, (1 - distance) / 0.45))
}

// The actions of a message. Some share a body of glass, some stand apart: nested groups, with
// the outer one only spacing them. The glass is white unless a group brings its own colour,
// as the back button does. Snooze stands apart in clear glass (`material="clear"`): it bends the
// grid, and its rim mirrors the white glass beside it. The three dots stand apart and are a
// Menu: their glass grows down into the menu and the dots go, and it runs back the same way.
// Where the row would not fit (a phone), the labels step aside and the icons carry it.
// Point at a body and it swells; press and it grows. Behind them, the Press demo's fine grid
// on the page's own colour, centred on the glass: plain DOM, every cell draws its own top
// and left line, fainter towards the edge.
export default function Demo() {
  return (
    <div className="@container relative isolate flex h-72 w-full max-w-xl items-center justify-center">
      <div aria-hidden className="absolute top-1/2 left-1/2 -z-10 grid -translate-x-1/2 -translate-y-1/2 grid-cols-[repeat(13,40px)]">
        {Array.from({ length: COLS * ROWS }, (_, i) => (
          <span key={i} className="relative size-10" style={{ opacity: fade(i % COLS, Math.floor(i / COLS)) }}>
            <span className="absolute inset-x-0 top-0 h-px bg-black/10 dark:bg-white/10" />
            <span className="absolute inset-y-0 left-0 w-px bg-black/10 dark:bg-white/10" />
          </span>
        ))}
      </div>
      <GlassButtonGroup aria-label="Message">
        <GlassButtonGroup className="bg-neutral-900 text-white">
          <GlassButtonGroupItem aria-label="Back" className="px-0">
            <ArrowLeft />
          </GlassButtonGroupItem>
        </GlassButtonGroup>
        <GlassButtonGroup>
          <GlassButtonGroupItem className="@max-[440px]:px-0">
            <Archive />
            <span className="@max-[440px]:sr-only">Archive</span>
          </GlassButtonGroupItem>
          <GlassButtonGroupItem className="@max-[440px]:px-0">
            <Flag />
            <span className="@max-[440px]:sr-only">Report</span>
          </GlassButtonGroupItem>
        </GlassButtonGroup>
        <GlassButtonGroup material="clear">
          <GlassButtonGroupItem className="@max-[440px]:px-0">
            <Clock />
            <span className="@max-[440px]:sr-only">Snooze</span>
          </GlassButtonGroupItem>
        </GlassButtonGroup>
        <GlassMenu>
          <GlassButtonGroup>
            <GlassMenuTrigger asChild>
              <GlassButtonGroupItem aria-label="More" className="px-0">
                <Ellipsis />
              </GlassButtonGroupItem>
            </GlassMenuTrigger>
          </GlassButtonGroup>
          <GlassMenuContent align="end">
            <GlassMenuItem>
              <MailOpen />
              Mark as read
            </GlassMenuItem>
            <GlassMenuItem>
              <Tag />
              Add label
            </GlassMenuItem>
            <GlassMenuItem>
              <BellOff />
              Mute thread
            </GlassMenuItem>
            <GlassMenuSeparator />
            <GlassMenuItem destructive>
              <Trash2 />
              Delete
            </GlassMenuItem>
          </GlassMenuContent>
        </GlassMenu>
      </GlassButtonGroup>
    </div>
  )
}
