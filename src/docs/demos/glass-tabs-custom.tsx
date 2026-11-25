import NumberFlow from '@number-flow/react'
import { useState } from 'react'

import { GlassLens } from '@/components/liquid-glass'

const plans = {
  Monthly: { price: 12, note: 'per month, cancel any time' },
  Yearly: { price: 96, note: 'per year, four months free' },
}
type Plan = keyof typeof plans
const usd = { style: 'currency', currency: 'USD', maximumFractionDigits: 0 } as const

// Your own segmented control: role="radio" options and a `data-glass-highlight` pill.
// The price rolls to its new value with NumberFlow (`@number-flow/react`).
export default function Demo() {
  const [plan, setPlan] = useState<Plan>('Yearly')
  return (
    <div className="flex flex-col items-center gap-8">
      <div className="text-center">
        <p className="text-6xl font-semibold tracking-tight text-neutral-900 tabular-nums dark:text-white">
          <NumberFlow value={plans[plan].price} locales="en-US" format={usd} />
        </p>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">{plans[plan].note}</p>
      </div>
      <div role="radiogroup" aria-label="Billing" className="relative isolate inline-flex gap-1 rounded-2xl bg-neutral-900 p-1.5">
        <GlassLens value={plan} />
        {(Object.keys(plans) as Plan[]).map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={p === plan}
            onClick={() => setPlan(p)}
            className={`relative h-11 cursor-pointer rounded-xl px-7 text-[15px] font-semibold ${
              p === plan ? 'text-neutral-900 [[data-glass-traveling]_&]:text-white/60' : 'text-white/60'
            }`}
          >
            {p === plan && <span data-glass-highlight className="absolute inset-0 rounded-xl bg-white [[data-glass-moving]_&]:opacity-0" />}
            <span className="relative z-20">{p}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
