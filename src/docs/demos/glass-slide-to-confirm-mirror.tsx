import { AlarmClock } from 'lucide-react'
import { useEffect, useState } from 'react'

import { GlassSlideToConfirm } from '@/components/liquid-glass'

const clock = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

// An alarm laid on its side: your own clock on the left, Snooze and the slide stacked on the
// right. Snooze is a plain button, no glass: flat orange. The track is bare (`fill={false}`):
// the thumb pulls no fill behind it and bends the label alone. With `mirror`, the held thumb's
// rim picks up the orange button above it.
// Where the two would not fit side by side (a phone), the clock moves on top.
export default function Demo() {
  // Read after mounting, so the server's time is never shown.
  const [time, setTime] = useState('')
  useEffect(() => {
    setTime(clock())
    const id = setInterval(() => setTime(clock()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="@container w-full max-w-2xl">
      <div className="flex flex-col items-center gap-8 @lg:flex-row @lg:justify-between">
        <div className="flex flex-col items-center @lg:items-start">
          <p className="flex items-center gap-2 text-lg text-neutral-500 dark:text-neutral-400">
            <AlarmClock className="size-5" />
            <span>
              <span className="font-light">Time to</span> <span className="font-display">wake up</span>
            </span>
          </p>
          <p className={`mt-1 text-7xl font-semibold tracking-tight text-neutral-900 tabular-nums dark:text-white ${time ? '' : 'invisible'}`}>{time || '00:00'}</p>
        </div>
        <div className="flex w-full max-w-72 flex-col gap-3">
          <button
            type="button"
            className="h-24 w-full cursor-pointer rounded-full bg-orange-500 text-xl font-semibold text-white transition-transform duration-150 outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 motion-safe:active:scale-[0.97]"
          >
            Snooze
          </button>
          <GlassSlideToConfirm
            size="xl"
            fill={false}
            mirror
            icon={<span className="size-7 rounded-md bg-current" />}
            fillClassName="bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
            successLabel="Stopped"
            resetAfter={2600}
            onConfirm={() => {}}
          >
            Slide to stop
          </GlassSlideToConfirm>
        </div>
      </div>
    </div>
  )
}
