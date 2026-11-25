import NumberFlow from '@number-flow/react'
import { useState } from 'react'

import { GlassTabs } from '@/components/liquid-glass'

const distance = { day: 8.4, week: 52.1, month: 214, year: 2480 }

// Click or drag: the selection slides as a lens that bends the labels it passes.
// The figure rolls to its new value with NumberFlow (`@number-flow/react`).
export default function Demo() {
  const [range, setRange] = useState<keyof typeof distance>('week')
  return (
    <div className="flex flex-col items-center gap-8">
      <div className="text-center">
        <p className="text-6xl font-semibold tracking-tight text-neutral-900 tabular-nums dark:text-white">
          <NumberFlow value={distance[range]} locales="en-US" />
          <span className="ml-1.5 text-2xl font-medium text-neutral-400 dark:text-neutral-500">km</span>
        </p>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">Distance this {range}</p>
      </div>
      <GlassTabs
        aria-label="Range"
        size="lg"
        value={range}
        onValueChange={setRange}
        options={[
          { value: 'day', label: 'Day' },
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
          { value: 'year', label: 'Year' },
        ]}
      />
    </div>
  )
}
