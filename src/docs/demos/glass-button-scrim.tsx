import { ArrowRight, Play } from 'lucide-react'

import { GlassButton } from '@/components/liquid-glass'

// Clear glass over colour. The backdrop is plain DOM: flat discs of colour on a dark scene
// and a dark scrim over them. The glass sees both, and the text, so the buttons sit in the scene.
export default function Demo() {
  return (
    <div className="relative isolate flex h-96 w-full max-w-2xl flex-col items-start justify-end overflow-hidden rounded-3xl bg-[#0b1030] p-8">
      <div aria-hidden className="absolute inset-0 -z-20">
        <span className="absolute -top-24 -left-16 size-80 rounded-full bg-[#22d3ee]" />
        <span className="absolute -top-32 right-4 size-72 rounded-full bg-[#a855f7]" />
        <span className="absolute -right-20 -bottom-28 size-96 rounded-full bg-[#ec4899]" />
        <span className="absolute -bottom-40 left-24 size-80 rounded-full bg-[#1d4ed8]" />
      </div>
      <div aria-hidden className="absolute inset-0 -z-10 bg-black/35" />
      <p className="text-xs font-semibold tracking-[0.18em] text-white/70">TROMSØ · WINTER SEASON</p>
      <h3 className="mt-2 max-w-sm text-4xl leading-[1.05] font-semibold tracking-tight text-white">Chase the northern lights</h3>
      <div className="mt-6 flex flex-wrap gap-3">
        <GlassButton size="lg" tint={0.35} icon={<ArrowRight />}>
          Plan the trip
        </GlassButton>
        <GlassButton size="lg" tint={0.15} icon={<Play />} iconPosition="start">
          Watch the film
        </GlassButton>
      </div>
    </div>
  )
}
