import { Plus } from 'lucide-react'

import { GlassButton } from '@/components/liquid-glass'

// The glass takes the button's own corners: add a `rounded-*` class and the lens follows.
// Fine ruled lines show the bend running along the straight edges and around each corner.
export default function Demo() {
  return (
    <div className="relative isolate flex h-72 w-full max-w-2xl flex-wrap items-center justify-center gap-4 overflow-hidden rounded-3xl">
      <div aria-hidden className="absolute inset-0 -z-10 flex flex-col justify-between">
        {Array.from({ length: 33 }, (_, i) => (
          <span key={i} className="h-px bg-black/10 dark:bg-white/10" />
        ))}
      </div>
      <GlassButton size="xl" tint={0.3} className="rounded-2xl" icon={<Plus />} iconPosition="start">
        New project
      </GlassButton>
      <GlassButton size="xl" material="tinted" className="rounded-2xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900">
        Open
      </GlassButton>
    </div>
  )
}
