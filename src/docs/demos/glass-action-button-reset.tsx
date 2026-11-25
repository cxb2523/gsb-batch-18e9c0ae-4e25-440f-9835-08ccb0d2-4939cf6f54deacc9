import { Plus } from 'lucide-react'

import { GlassActionButton } from '@/components/liquid-glass'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Left: `resetAfter` splits the droplet off again after a success.
// Right: a rejected action splits it off at once, and `onActionError` gets the error.
export default function Demo() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-5">
      <GlassActionButton
        size="lg"
        material="tinted"
        className="bg-blue-600 text-white"
        icon={<Plus />}
        pendingLabel="Adding"
        successLabel="Added"
        resetAfter={2400}
        onAction={() => wait(900)}
      >
        Add to cart
      </GlassActionButton>
      <GlassActionButton
        size="lg"
        material="tinted"
        className="bg-rose-600 text-white"
        pendingLabel="Sending"
        onAction={() => wait(900).then(() => Promise.reject(new Error('Offline')))}
        onActionError={(error) => console.warn(error)}
      >
        Send (fails)
      </GlassActionButton>
    </div>
  )
}
