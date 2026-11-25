import { useEffect, useState } from 'react'

import { GlassBadge } from '@/components/liquid-glass'

// A plain card with one orange badge on its corner. Hover the card: the text flows faster.
export default function Demo() {
  // The month we are in, in Turkish. Set after mount: a prerendered page may be months old.
  const [month, setMonth] = useState('Kasım')
  useEffect(() => {
    setMonth(new Intl.DateTimeFormat('tr-TR', { month: 'long' }).format(new Date()))
  }, [])

  return (
    <div className="relative w-full max-w-xs rounded-[28px] border border-neutral-950/15 p-6 dark:border-white/20">
      <p className="font-display text-2xl text-neutral-950 dark:text-white">{month}</p>
      <p className="mt-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">Sliders, switches and checkboxes, now in liquid glass.</p>
      <GlassBadge className="absolute -top-2.5 -right-2.5 bg-orange-600">New</GlassBadge>
    </div>
  )
}
