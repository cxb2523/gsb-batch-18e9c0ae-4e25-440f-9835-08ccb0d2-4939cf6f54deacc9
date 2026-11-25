import { GlassSlideToConfirm } from '@/components/liquid-glass'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Short and chunky: the `xl` track in a narrow width, with a one-word label.
export default function Demo() {
  return (
    <GlassSlideToConfirm className="max-w-64" size="xl" pendingLabel="Sending" successLabel="Sent" resetAfter={2600} onConfirm={() => wait(1400)}>
      Send
    </GlassSlideToConfirm>
  )
}
