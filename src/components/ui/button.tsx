import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import * as React from 'react'

import { cn } from '@/lib/utils'

// shadcn/ui Button, in the site's language: the press every control here shares (0.96 over
// 150ms), the one focus ring from styles.css, and the type scale. Docs controls are small and
// square-cornered; the header and the hero use the pill sizes (lg, icon).
const buttonVariants = cva(
  "press inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary font-medium text-primary-foreground hover:bg-primary/90',
        outline: 'border border-border bg-background text-foreground hover:bg-muted',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
        link: 'text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground',
      },
      size: {
        default: 'h-9 rounded-md px-4 text-ui',
        sm: 'h-8 rounded-md px-3 text-ui',
        xs: "h-7 rounded-md px-2.5 text-caption [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-12 gap-2 rounded-full px-5 text-body font-medium sm:px-6',
        icon: 'size-8 rounded-full',
        'icon-sm': "size-7 rounded-md [&_svg:not([class*='size-'])]:size-3.5",
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : 'button'

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...(asChild ? {} : { type: 'button' as const })}
      {...props}
    />
  )
}

export { Button, buttonVariants }
