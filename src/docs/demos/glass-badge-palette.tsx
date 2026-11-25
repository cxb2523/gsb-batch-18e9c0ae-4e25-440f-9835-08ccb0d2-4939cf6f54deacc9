import { GlassBadge } from '@/components/liquid-glass'

const swatches = [
  { label: 'Open', badge: 'bg-emerald-600 text-white', dot: '#a7f3d0' },
  { label: 'Sale', badge: 'bg-rose-600 text-white', dot: '#fecdd3' },
  { label: 'Soon', badge: 'bg-amber-400 text-neutral-900', dot: '#78350f' },
  { label: 'Beta', badge: 'bg-sky-500 text-white', dot: '#e0f2fe' },
  { label: 'Pro', badge: 'bg-violet-600 text-white', dot: '#ddd6fe' },
  { label: 'New', badge: 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900', dot: '#f97316' },
]

// One badge, six colours: any `bg-*` with a `text-*` that reads on it, and a `dotColor`
// a shade away. Each cell is `relative`, so hovering a cell speeds up only its badge.
export default function Demo() {
  return (
    <div className="grid w-full max-w-md grid-cols-3 gap-2">
      {swatches.map((swatch) => (
        <div key={swatch.label} className="relative flex flex-col items-center gap-4 rounded-3xl bg-white px-4 py-7 dark:bg-neutral-800">
          <GlassBadge className={swatch.badge} dotColor={swatch.dot}>
            {swatch.label}
          </GlassBadge>
          <code className="text-xs text-neutral-500 dark:text-neutral-400">{swatch.badge.split(' ')[0]}</code>
        </div>
      ))}
    </div>
  )
}
