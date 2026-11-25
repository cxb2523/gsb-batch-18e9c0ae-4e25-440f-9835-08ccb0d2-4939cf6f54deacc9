import { ChevronDown } from 'lucide-react'
import { NavigationMenu as NavigationMenuPrimitive } from 'radix-ui'
import * as React from 'react'

import { cn } from '@/lib/utils'

// shadcn/ui NavigationMenu (Radix): hover intent, Escape, arrow keys along the list, and focus
// that moves from an open trigger straight into its panel. Styled as the header dock: pill
// items, and one panel (the viewport) that takes the size of what it shows, so it morphs
// between menus. The motion lives in styles.css, keyed on data-state and data-motion.

function NavigationMenu({
  className,
  children,
  viewport = true,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Root> & {
  viewport?: boolean
}) {
  return (
    <NavigationMenuPrimitive.Root data-slot="navigation-menu" data-viewport={viewport} className={cn('relative', className)} {...props}>
      {children}
      {viewport && <NavigationMenuViewport />}
    </NavigationMenuPrimitive.Root>
  )
}

function NavigationMenuList({ className, ...props }: React.ComponentProps<typeof NavigationMenuPrimitive.List>) {
  return <NavigationMenuPrimitive.List data-slot="navigation-menu-list" className={cn('relative flex list-none items-center', className)} {...props} />
}

function NavigationMenuItem(props: React.ComponentProps<typeof NavigationMenuPrimitive.Item>) {
  return <NavigationMenuPrimitive.Item data-slot="navigation-menu-item" {...props} />
}

/** A dock item: triggers and the plain links beside them look the same. */
const navigationMenuTriggerStyle = () =>
  'relative z-10 flex h-8 cursor-pointer items-center gap-1 rounded-full px-3.5 text-ui whitespace-nowrap text-muted-foreground transition-colors duration-150 hover:text-foreground data-[state=open]:text-foreground'

function NavigationMenuTrigger({ className, children, ...props }: React.ComponentProps<typeof NavigationMenuPrimitive.Trigger>) {
  return (
    <NavigationMenuPrimitive.Trigger data-slot="navigation-menu-trigger" className={cn(navigationMenuTriggerStyle(), 'group', className)} {...props}>
      {children}
      <ChevronDown aria-hidden className="size-3 opacity-60 group-data-[state=open]:rotate-180 motion-safe:transition-transform motion-safe:duration-200" />
    </NavigationMenuPrimitive.Trigger>
  )
}

function NavigationMenuContent({ className, ...props }: React.ComponentProps<typeof NavigationMenuPrimitive.Content>) {
  return <NavigationMenuPrimitive.Content data-slot="navigation-menu-content" className={cn('absolute top-0 left-0 w-max', className)} {...props} />
}

function NavigationMenuViewport({ className, ...props }: React.ComponentProps<typeof NavigationMenuPrimitive.Viewport>) {
  return (
    // Centred under the list; the top padding is the hover bridge from the dock to the panel.
    <div className="absolute top-full left-1/2 z-50 -translate-x-1/2 pt-2.5">
      <NavigationMenuPrimitive.Viewport
        data-slot="navigation-menu-viewport"
        className={cn(
          'relative h-(--radix-navigation-menu-viewport-height) w-(--radix-navigation-menu-viewport-width) origin-top overflow-hidden rounded-[18px] border border-border bg-popover text-popover-foreground shadow-[0_16px_48px_-12px_rgba(0,0,0,0.25),0_2px_6px_rgba(0,0,0,0.05)]',
          className,
        )}
        {...props}
      />
    </div>
  )
}

function NavigationMenuLink(props: React.ComponentProps<typeof NavigationMenuPrimitive.Link>) {
  return <NavigationMenuPrimitive.Link data-slot="navigation-menu-link" {...props} />
}

export {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuContent,
  NavigationMenuTrigger,
  NavigationMenuLink,
  NavigationMenuViewport,
  navigationMenuTriggerStyle,
}
