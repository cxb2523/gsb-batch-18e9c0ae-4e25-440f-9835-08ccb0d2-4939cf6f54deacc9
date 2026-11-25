import { ArrowUpRight } from 'lucide-react'

import { GlassButton } from '@/components/liquid-glass'

// `asChild` puts the glass on your own element. The same works with a Next.js or
// TanStack Router <Link>: it stays a real link with its own navigation.
export default function Demo() {
  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div>
        <p className="text-3xl font-semibold tracking-tight text-neutral-900 dark:text-white">Free and open source</p>
        <p className="mt-2 text-base text-neutral-500 dark:text-neutral-400">MIT licensed. Copy the files, they are yours.</p>
      </div>
      <GlassButton asChild material="tinted" size="lg" icon={<ArrowUpRight />} className="bg-violet-600 text-white">
        <a href="https://github.com/bilalgursen/liquid-glass" target="_blank" rel="noreferrer">
          Star on GitHub
        </a>
      </GlassButton>
    </div>
  )
}
