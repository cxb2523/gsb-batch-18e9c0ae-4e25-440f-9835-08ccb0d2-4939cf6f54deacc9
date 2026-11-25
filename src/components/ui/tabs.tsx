import { Tabs as TabsPrimitive } from 'radix-ui'
import * as React from 'react'

import { cn } from '@/lib/utils'

// shadcn/ui Tabs (Radix: roving focus, arrow keys, tab ↔ panel wiring), styled as the site's
// small segmented switch: the selected tab sits on a muted chip.

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn('flex flex-col', className)} {...props} />
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List data-slot="tabs-list" className={cn('inline-flex items-center gap-0.5', className)} {...props} />
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'inline-flex h-7 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2.5 text-ui whitespace-nowrap text-muted-foreground transition-colors duration-150 hover:text-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-muted data-[state=active]:font-medium data-[state=active]:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

/** Radix makes a panel focusable; its ring sits inside, so a clipping frame never hides it. */
function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn('focus-visible:outline-offset-[-2px]', className)} {...props} />
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
