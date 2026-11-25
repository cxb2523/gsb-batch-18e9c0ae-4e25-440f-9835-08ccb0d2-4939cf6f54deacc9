import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import * as React from 'react'

import { cn } from '@/lib/utils'

// shadcn/ui Badge for the site's pills: the release kinds (New, Improved, Fixed, Removed) on a
// 13% wash of their own colour, quiet outlines for versions and facts, and one solid pill.
// Every kind colour clears 4.5:1 on its wash (styles.css).
const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        outline: 'border border-border font-normal text-muted-foreground [a&]:hover:bg-muted [a&]:hover:text-foreground',
        solid: 'bg-foreground text-background',
        new: 'bg-kind-new/13 text-kind-new',
        improved: 'bg-kind-improved/13 text-kind-improved',
        fixed: 'bg-kind-fixed/13 text-kind-fixed',
        removed: 'bg-kind-removed/13 text-kind-removed',
      },
      size: {
        sm: 'h-4 px-1.5 text-micro leading-none',
        default: 'h-5 px-2 text-micro',
        lg: 'h-6 px-2.5 text-micro',
      },
    },
    defaultVariants: {
      variant: 'outline',
      size: 'default',
    },
  },
)

function Badge({
  className,
  variant = 'outline',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span'

  return <Comp data-slot="badge" data-variant={variant} className={cn(badgeVariants({ variant, size }), className)} {...props} />
}

export { Badge, badgeVariants }
