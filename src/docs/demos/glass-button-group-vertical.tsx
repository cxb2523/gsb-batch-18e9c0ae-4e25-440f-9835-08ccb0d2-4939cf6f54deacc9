import { LocateFixed, Minus, Plus } from 'lucide-react'
import { useState } from 'react'

import { GlassButtonGroup, GlassButtonGroupItem, GlassButtonGroupSeparator } from '@/components/liquid-glass'

// `orientation="vertical"` stacks the items, and the separators turn with them. Here it is
// the zoom control of a map drawn in flat colour: blocks, a park, water and two roads.
export default function Demo() {
  const [zoom, setZoom] = useState(3)
  return (
    <div className="relative isolate flex h-80 w-full max-w-xl items-center justify-end overflow-hidden rounded-3xl bg-stone-200 pr-8 dark:bg-stone-800">
      <div aria-hidden className="absolute inset-0 -z-10">
        <span className="absolute top-0 right-0 h-28 w-56 bg-sky-400 dark:bg-sky-700" />
        <span className="absolute right-24 bottom-0 h-36 w-40 bg-emerald-400 dark:bg-emerald-700" />
        <span className="absolute top-8 left-8 h-24 w-40 rounded-xl bg-stone-300 dark:bg-stone-700" />
        <span className="absolute bottom-8 left-8 h-28 w-28 rounded-xl bg-stone-300 dark:bg-stone-700" />
        <span className="absolute bottom-8 left-44 h-28 w-24 rounded-xl bg-amber-300 dark:bg-amber-600" />
        <span className="absolute inset-x-0 top-36 h-5 bg-white dark:bg-stone-600" />
        <span className="absolute inset-y-0 right-16 w-5 bg-white dark:bg-stone-600" />
        <span className="absolute top-12 left-12 text-sm font-semibold text-stone-500 dark:text-stone-400">Zoom {zoom}</span>
      </div>
      <GlassButtonGroup aria-label="Map" orientation="vertical" size="lg">
        <GlassButtonGroupItem aria-label="Zoom in" disabled={zoom === 5} onClick={() => setZoom(zoom + 1)} className="px-0">
          <Plus />
        </GlassButtonGroupItem>
        <GlassButtonGroupItem aria-label="Zoom out" disabled={zoom === 1} onClick={() => setZoom(zoom - 1)} className="px-0">
          <Minus />
        </GlassButtonGroupItem>
        <GlassButtonGroupSeparator />
        <GlassButtonGroupItem aria-label="My location" className="px-0">
          <LocateFixed />
        </GlassButtonGroupItem>
      </GlassButtonGroup>
    </div>
  )
}
