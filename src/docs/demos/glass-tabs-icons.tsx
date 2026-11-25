import { LayoutGrid, List, Rows3 } from 'lucide-react'
import { useState } from 'react'

import { GlassTabs } from '@/components/liquid-glass'

// What each layout looks like: how many blocks, in how many columns, how tall.
const layouts = {
  list: { blocks: 4, columns: 'grid-cols-1', block: 'h-6' },
  grid: { blocks: 6, columns: 'grid-cols-3', block: 'h-14' },
  rows: { blocks: 2, columns: 'grid-cols-1', block: 'h-14' },
}

// Icons next to the labels, at a larger size.
export default function Demo() {
  const [layout, setLayout] = useState<keyof typeof layouts>('grid')
  const { blocks, columns, block } = layouts[layout]
  return (
    <div className="flex flex-col items-center gap-8">
      <div aria-hidden className={`grid h-[120px] w-72 content-start gap-2 ${columns}`}>
        {Array.from({ length: blocks }, (_, i) => (
          <span key={i} className={`rounded-lg bg-black/10 dark:bg-white/10 ${block}`} />
        ))}
      </div>
      <GlassTabs
        aria-label="Layout"
        size="lg"
        value={layout}
        onValueChange={setLayout}
        options={[
          { value: 'list', label: 'List', icon: <List /> },
          { value: 'grid', label: 'Grid', icon: <LayoutGrid /> },
          { value: 'rows', label: 'Rows', icon: <Rows3 /> },
        ]}
      />
    </div>
  )
}
