import { RotateCcw } from 'lucide-react'
import { useState } from 'react'

import { GlassActionButton } from '@/components/liquid-glass'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Press it: the arrow droplet melts into the button and stays merged.
// "Start over" changes `resetKey`: the droplet splits off again and the label morphs back.
// Each new label comes in letter by letter.
export default function Demo() {
  const [run, setRun] = useState(0)
  return (
    <div className="flex flex-col items-center gap-6">
      <GlassActionButton
        resetKey={run}
        size="lg"
        material="tinted"
        className="bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
        pendingLabel="Deploying"
        successLabel="Deployed"
        onAction={() => wait(1400)}
      >
        Deploy to production
      </GlassActionButton>
      <button
        type="button"
        onClick={() => setRun((n) => n + 1)}
        className="flex cursor-pointer items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white"
      >
        <RotateCcw className="size-3.5" />
        Start over
      </button>
    </div>
  )
}
