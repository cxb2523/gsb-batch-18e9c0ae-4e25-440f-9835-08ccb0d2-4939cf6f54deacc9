import { ArrowLeft, ArrowRight, Plus } from 'lucide-react'
import type { ReactNode } from 'react'

import { GlassButton } from '@/components/liquid-glass'

// One row per prop, its values side by side. The buttons of a row sit 10 px apart: hold one
// and pull it towards its neighbour, and under 6 px the two melt into one body.
function Row({ prop, children }: { prop: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
      <code className="w-20 shrink-0 font-mono text-xs text-neutral-500 dark:text-neutral-400">{prop}</code>
      <div className="relative isolate flex flex-wrap items-center gap-2.5">{children}</div>
    </div>
  )
}

export default function Demo() {
  return (
    <div className="flex w-full max-w-xl flex-col gap-10">
      {/* Clear glass bends the page; tinted glass takes the button's own background class. */}
      <Row prop="material">
        <GlassButton size="lg">Clear</GlassButton>
        <GlassButton size="lg" material="tinted" className="bg-blue-600 text-white">
          Save
        </GlassButton>
        <GlassButton size="lg" material="tinted" className="bg-rose-600 text-white">
          Delete
        </GlassButton>
        <GlassButton size="lg" material="tinted" className="border border-black/15 bg-white text-neutral-900">
          Share
        </GlassButton>
      </Row>

      {/* Clear glass only: 0 lets what lies behind it through, 1 covers it. A flat disc to see it by. */}
      <Row prop="tint">
        <span aria-hidden className="absolute top-6 left-[25px] -z-10 size-20 -translate-y-1/2 rounded-full bg-[#ff6b35]" />
        <GlassButton size="lg" tint={0}>
          0
        </GlassButton>
        <GlassButton size="lg" tint={1}>
          1
        </GlassButton>
      </Row>

      <Row prop="size">
        <GlassButton size="sm" material="tinted" className="bg-emerald-600 text-white">
          sm
        </GlassButton>
        <GlassButton size="md" material="tinted" className="bg-emerald-600 text-white">
          md
        </GlassButton>
        <GlassButton size="lg" material="tinted" className="bg-emerald-600 text-white">
          lg
        </GlassButton>
        <GlassButton size="xl" material="tinted" className="bg-emerald-600 text-white">
          xl
        </GlassButton>
      </Row>

      {/* `icon` with `iconPosition`; an icon alone needs an `aria-label`. */}
      <Row prop="icon">
        <GlassButton size="lg" icon={<ArrowLeft />} iconPosition="start">
          Back
        </GlassButton>
        <GlassButton size="lg" material="tinted" className="bg-violet-600 text-white" icon={<ArrowRight />}>
          Next
        </GlassButton>
        <GlassButton size="lg" material="tinted" aria-label="Add" className="w-12 bg-amber-500 !px-0 text-neutral-950">
          <Plus />
        </GlassButton>
      </Row>

      {/* Held and dragged, a button follows the pointer a little way; `pull={false}` keeps it in place. */}
      <Row prop="pull">
        <GlassButton size="lg" material="tinted" className="bg-neutral-900 text-white dark:bg-white dark:text-neutral-900">
          Hold and drag
        </GlassButton>
        <GlassButton size="lg" pull={false}>
          Stays put
        </GlassButton>
      </Row>
    </div>
  )
}
