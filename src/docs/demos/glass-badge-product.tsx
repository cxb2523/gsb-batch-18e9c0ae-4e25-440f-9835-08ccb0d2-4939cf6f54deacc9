import { GlassBadge } from '@/components/liquid-glass'

// A rose badge on the corner of a product. Half of it hangs over the yellow cover and
// half over the page, so both show through the glass.
export default function Demo() {
  return (
    <div className="relative w-full max-w-xs">
      <div className="flex aspect-[4/3] items-center justify-center rounded-[28px] bg-[#ffd60a]">
        <span className="flex size-40 items-center justify-center rounded-full bg-neutral-900">
          <span className="flex size-14 items-center justify-center rounded-full bg-[#ff375f]">
            <span className="size-2 rounded-full bg-[#ffd60a]" />
          </span>
        </span>
      </div>
      <div className="mt-4 flex items-baseline justify-between gap-4 px-1">
        <p className="text-[17px] font-semibold tracking-tight text-neutral-900 dark:text-white">Night Drive LP</p>
        <p className="text-[15px] text-neutral-500 tabular-nums dark:text-neutral-400">
          <s>$26</s> <span className="font-semibold text-neutral-900 dark:text-white">$18</span>
        </p>
      </div>
      <GlassBadge className="absolute -top-2.5 -right-2.5 bg-rose-600" dotColor="#ffd60a">
        Sale
      </GlassBadge>
    </div>
  )
}
