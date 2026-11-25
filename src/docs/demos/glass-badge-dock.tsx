import { House, Library, Search, ShoppingBag } from 'lucide-react'

import { GlassBadge } from '@/components/liquid-glass'

const items = [
  { label: 'Home', icon: House, active: true },
  { label: 'Search', icon: Search },
  { label: 'Library', icon: Library },
  { label: 'Store', icon: ShoppingBag, badge: 'New' },
]

// An orange badge on one item of a dock. The button is `relative`: the badge hangs off
// its corner and speeds up when that button is hovered.
export default function Demo() {
  return (
    <nav aria-label="Dock" className="flex items-center gap-1.5 rounded-full bg-white p-2 dark:bg-neutral-800">
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          aria-label={item.label}
          className={`relative flex size-14 items-center justify-center rounded-full ${
            item.active ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'text-neutral-500 dark:text-neutral-400'
          }`}
        >
          <item.icon className="size-6" />
          {item.badge && (
            <GlassBadge className="absolute -top-3 left-8 bg-orange-500" dotColor="#fff7ed">
              {item.badge}
            </GlassBadge>
          )}
        </button>
      ))}
    </nav>
  )
}
