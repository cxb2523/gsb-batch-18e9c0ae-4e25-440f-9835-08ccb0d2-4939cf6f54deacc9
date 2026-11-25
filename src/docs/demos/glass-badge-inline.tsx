import { GlassBadge } from '@/components/liquid-glass'

const plans = [
  { name: 'Starter', price: '$0', note: 'One project, community support' },
  { name: 'Team', price: '$24', note: 'Unlimited projects, shared library', badge: 'Popular' },
  { name: 'Scale', price: '$96', note: 'Audit log, SSO and priority support' },
]

// Without a position class the badge flows inline, next to a label. One per list:
// it marks the single row worth a second look. Hover that row and the text speeds up.
export default function Demo() {
  return (
    <ul className="flex w-full max-w-md flex-col gap-2">
      {plans.map((plan) => (
        <li key={plan.name} className="relative flex items-center gap-4 rounded-2xl bg-white px-5 py-4 dark:bg-neutral-800">
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2.5">
              <span className="text-[17px] font-semibold tracking-tight text-neutral-900 dark:text-white">{plan.name}</span>
              {plan.badge && (
                <GlassBadge className="w-[72px] bg-violet-600" dotColor="#c4b5fd">
                  {plan.badge}
                </GlassBadge>
              )}
            </span>
            <span className="mt-0.5 block text-sm text-neutral-500 dark:text-neutral-400">{plan.note}</span>
          </span>
          <span className="text-xl font-semibold tracking-tight text-neutral-900 tabular-nums dark:text-white">{plan.price}</span>
        </li>
      ))}
    </ul>
  )
}
