import { ChevronDown } from 'lucide-react'
import * as React from 'react'

import { cn } from '@/lib/utils'

// shadcn/ui NativeSelect: the platform's own <select> (its picker on phones, works before
// hydration) in the site's pill. 16px text below `sm`, so iOS Safari never zooms the page
// when it takes focus; the UI size from there up.

function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <div data-slot="native-select-wrapper" className="group/native-select relative w-fit has-[select:disabled]:opacity-50">
      <select
        data-slot="native-select"
        className={cn(
          'h-8 w-full min-w-0 cursor-pointer appearance-none rounded-full border border-border bg-background pr-8 pl-3 text-base text-foreground transition-colors duration-150 hover:bg-muted disabled:pointer-events-none sm:text-ui',
          className,
        )}
        {...props}
      />
      <ChevronDown aria-hidden data-slot="native-select-icon" className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
    </div>
  )
}

function NativeSelectOption({ className, ...props }: React.ComponentProps<'option'>) {
  return <option data-slot="native-select-option" className={cn('bg-[Canvas] text-[CanvasText]', className)} {...props} />
}

function NativeSelectOptGroup({ className, ...props }: React.ComponentProps<'optgroup'>) {
  return <optgroup data-slot="native-select-optgroup" className={cn('bg-[Canvas] text-[CanvasText]', className)} {...props} />
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption }
