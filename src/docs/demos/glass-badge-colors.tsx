import { GlassBadge } from '@/components/liquid-glass'

const apps = [
  { name: 'Notes', tile: 'bg-[#ffd60a]', badge: 'bg-neutral-900 text-white', dot: '#ffd60a', label: 'Beta' },
  { name: 'Radio', tile: 'bg-[#ff375f]', badge: 'bg-white text-neutral-900', dot: '#ff375f', label: 'Live' },
  { name: 'Studio', tile: 'bg-[#0a84ff]', badge: 'bg-amber-400 text-neutral-900', dot: '#ffffff', label: 'Pro' },
]

// `bg-*` is the glass colour, `text-*` the flowing text, `dotColor` the separator.
// Each badge sits on the corner of its own tile, so each tile speeds up its own badge.
export default function Demo() {
  return (
    <div className="flex flex-wrap items-start justify-center gap-10">
      {apps.map((app) => (
        <div key={app.name} className="flex flex-col items-center gap-3">
          <div className={`relative size-28 rounded-[30px] ${app.tile}`}>
            <GlassBadge className={`absolute -top-2 -right-3 ${app.badge}`} dotColor={app.dot}>
              {app.label}
            </GlassBadge>
          </div>
          <p className="text-sm font-medium text-neutral-900 dark:text-white">{app.name}</p>
        </div>
      ))}
    </div>
  )
}
