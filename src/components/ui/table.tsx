import * as React from 'react'

import { cn } from '@/lib/utils'

// shadcn/ui Table in the site's language: a bordered, rounded frame that scrolls sideways on
// narrow screens, the UI size, and hairline rows.

function Table({ className, containerClassName, ...props }: React.ComponentProps<'table'> & { containerClassName?: string }) {
  return (
    <div data-slot="table-container" className={cn('relative w-full overflow-x-auto rounded-xl border border-border', containerClassName)}>
      <table data-slot="table" className={cn('w-full caption-bottom text-left text-ui', className)} {...props} />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={cn('bg-muted/60 text-caption text-muted-foreground [&_tr]:border-b [&_tr]:border-border', className)} {...props} />
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody data-slot="table-body" className={cn('[&_tr:last-child]:border-0', className)} {...props} />
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return <tr data-slot="table-row" className={cn('border-b border-border', className)} {...props} />
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return <th data-slot="table-head" className={cn('px-4 py-2.5 text-left align-middle font-medium whitespace-nowrap', className)} {...props} />
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return <td data-slot="table-cell" className={cn('px-4 py-3 align-top', className)} {...props} />
}

function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
  return <caption data-slot="table-caption" className={cn('mt-4 text-ui text-muted-foreground', className)} {...props} />
}

export { Table, TableHeader, TableBody, TableHead, TableRow, TableCell, TableCaption }
