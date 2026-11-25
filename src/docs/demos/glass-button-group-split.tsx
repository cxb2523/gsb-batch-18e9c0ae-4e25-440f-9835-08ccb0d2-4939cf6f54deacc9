import { ChevronDown, Copy, GitBranch } from 'lucide-react'

import { GlassButtonGroup, GlassButtonGroupItem, GlassButtonGroupSeparator, GlassButtonGroupText } from '@/components/liquid-glass'

// The glass takes the group's own background class. Top: a split button, the main action
// and its options in one body. Bottom: text that is not a button, and the three sizes.
export default function Demo() {
  return (
    <div className="flex flex-col items-center gap-10">
      <div className="flex flex-wrap items-center justify-center gap-4">
        <GlassButtonGroup size="lg" className="bg-blue-600 text-white">
          <GlassButtonGroupItem>Follow</GlassButtonGroupItem>
          <GlassButtonGroupSeparator />
          <GlassButtonGroupItem aria-label="Follow options">
            <ChevronDown />
          </GlassButtonGroupItem>
        </GlassButtonGroup>
        <GlassButtonGroup size="lg" className="bg-neutral-900 text-white dark:bg-white dark:text-neutral-900">
          <GlassButtonGroupText>
            <GitBranch />
            main
          </GlassButtonGroupText>
          <GlassButtonGroupSeparator />
          <GlassButtonGroupItem>
            <Copy />
            Copy
          </GlassButtonGroupItem>
        </GlassButtonGroup>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-4">
        {(['sm', 'md', 'lg'] as const).map((size) => (
          <GlassButtonGroup key={size} size={size} className="bg-emerald-600 text-white">
            <GlassButtonGroupItem>Cut</GlassButtonGroupItem>
            <GlassButtonGroupItem>Copy</GlassButtonGroupItem>
            <GlassButtonGroupItem>Paste</GlassButtonGroupItem>
          </GlassButtonGroup>
        ))}
      </div>
    </div>
  )
}
