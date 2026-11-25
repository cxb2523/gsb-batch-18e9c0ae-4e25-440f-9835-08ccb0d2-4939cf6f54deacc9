import { GlassButton } from '@/components/liquid-glass'

// Tinted glass takes the button's own background class, then adds light and shadow.
// Top row: your colours. Bottom row: the four sizes.
export default function Demo() {
  return (
    <div className="flex flex-col items-center gap-10">
      <div className="flex flex-wrap items-center justify-center gap-3">
        <GlassButton material="tinted" size="lg" className="bg-blue-600 text-white">
          Continue
        </GlassButton>
        <GlassButton material="tinted" size="lg" className="bg-neutral-900 text-white dark:bg-white dark:text-neutral-900">
          Publish
        </GlassButton>
        <GlassButton material="tinted" size="lg" className="bg-rose-600 text-white">
          Delete
        </GlassButton>
        <GlassButton material="tinted" size="lg" className="border border-black/15 bg-white text-neutral-900">
          Cancel
        </GlassButton>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <GlassButton material="tinted" size="sm" className="bg-emerald-600 text-white">
          Small
        </GlassButton>
        <GlassButton material="tinted" size="md" className="bg-emerald-600 text-white">
          Medium
        </GlassButton>
        <GlassButton material="tinted" size="lg" className="bg-emerald-600 text-white">
          Large
        </GlassButton>
        <GlassButton material="tinted" size="xl" className="bg-emerald-600 text-white">
          Extra large
        </GlassButton>
      </div>
    </div>
  )
}
