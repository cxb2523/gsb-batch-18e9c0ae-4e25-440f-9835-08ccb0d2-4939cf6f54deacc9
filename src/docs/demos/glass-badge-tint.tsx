import { GlassBadge } from '@/components/liquid-glass'

const bands = ['bg-[#0a84ff]', 'bg-[#ff375f]', 'bg-[#ffd60a]', 'bg-[#30d158]']

// A lower `tint` lets more of the backdrop through: here the bands of the cover show in the
// glass. `speed` sets the pace at rest, and a wider badge (`w-24`) fits a longer word.
export default function Demo() {
  return (
    <div className="relative isolate w-full max-w-sm overflow-hidden rounded-[32px] p-7 pt-36">
      <div aria-hidden className="absolute inset-0 -z-10 flex">
        {bands.map((band) => (
          <span key={band} className={`flex-1 ${band}`} />
        ))}
      </div>
      <p className="text-2xl font-semibold tracking-tight text-white">Colour Fields</p>
      <p className="mt-1 text-[15px] text-white/80">Tonight, 21:00 · Hall B</p>
      <GlassBadge className="absolute top-5 left-5 w-24 bg-black text-white" tint={0.35} speed={0.25} dotColor="#ffd60a">
        Sold out
      </GlassBadge>
    </div>
  )
}
