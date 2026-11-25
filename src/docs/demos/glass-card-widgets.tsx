import { Flame, Headphones, Smartphone, Watch } from 'lucide-react'

import { GlassCard } from '@/components/liquid-glass'

// A home screen of widgets over a still wallpaper: bands of colour and three hard-edged discs,
// all plain CSS, and the rims bend them. Nothing moves behind the cards, so they need no
// `live`: like every glass in the kit, they repaint only when something changes, and stop
// drawing at rest.
const wallpaper = 'linear-gradient(155deg, #0a84ff 0 24%, #5e5ce6 24% 46%, #bf5af2 46% 66%, #ff375f 66% 84%, #ff9f0a 84%)'

/** A progress ring in plain CSS: a conic gradient with its middle masked out. */
function Ring({ value, colour }: { value: number; colour: string }) {
  const hole = 'radial-gradient(farthest-side, transparent calc(100% - 9px), #000 calc(100% - 8px))'
  return (
    <span
      role="img"
      aria-label={`${Math.round(value * 100)}%`}
      className="block aspect-square rounded-full"
      style={{
        background: `conic-gradient(${colour} ${value * 100}%, color-mix(in srgb, ${colour} 22%, transparent) 0)`,
        maskImage: hole,
        WebkitMaskImage: hole,
      }}
    />
  )
}

const move = { done: 420, goal: 600 }
const devices = [
  { name: 'Phone', level: 82, icon: Smartphone },
  { name: 'Earbuds', level: 64, icon: Headphones },
  { name: 'Watch', level: 18, icon: Watch },
]
const track = { title: 'Slow Liquid', artist: 'Glasswork', played: 0.38, elapsed: '1:12', left: '-2:04' }

export default function Demo() {
  return (
    <div className="relative flex w-full max-w-2xl justify-center overflow-hidden rounded-3xl px-3 py-10 sm:px-5 sm:py-16" style={{ background: wallpaper }}>
      <div aria-hidden className="absolute inset-0">
        <span className="absolute -top-10 left-[8%] size-40 rounded-full bg-[#ffd60a]" />
        <span className="absolute top-[38%] right-[6%] size-56 rounded-full bg-[#30d158]" />
        <span className="absolute -bottom-16 left-[22%] size-48 rounded-full bg-white" />
      </div>

      <div className="relative grid w-full max-w-[316px] grid-cols-2 gap-3 sm:max-w-[372px] sm:gap-5">
        {/* Activity: one ring, one number. */}
        <GlassCard className="flex aspect-square flex-col justify-between p-3 sm:p-4">
          <span className="relative w-12 sm:w-[72px]">
            <Ring value={move.done / move.goal} colour="#ff375f" />
            <Flame className="absolute inset-0 m-auto size-4 fill-current text-[#ff375f] sm:size-5" />
          </span>
          <div>
            <p className="text-[20px] leading-none font-semibold tracking-[-0.03em] tabular-nums sm:text-[26px]">
              {move.done}
              <span className="opacity-50">/{move.goal}</span>
            </p>
            <p className="mt-1 text-[10px] font-semibold tracking-wide whitespace-nowrap text-[#ff375f] uppercase sm:text-[11px]">Move · kcal</p>
          </div>
        </GlassCard>

        {/* Batteries: a level for each device. */}
        <GlassCard className="flex aspect-square flex-col justify-between p-3 sm:p-4">
          {devices.map(({ name, level, icon: Icon }) => (
            <div key={name}>
              <p className="flex items-center gap-1 text-[11px] leading-none font-semibold sm:gap-1.5 sm:text-[12px]">
                <Icon className="size-3.5 shrink-0" />
                <span className="flex-1">{name}</span>
                <span className="tabular-nums opacity-60">{level}%</span>
              </p>
              <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-current/15">
                <span className="block h-full rounded-full" style={{ width: `${level}%`, background: level > 20 ? '#30d158' : '#ff375f' }} />
              </span>
            </div>
          ))}
        </GlassCard>

        {/* Now playing: the cover, the track, and how far in. */}
        <GlassCard className="col-span-2 flex items-center gap-3.5 p-3.5 sm:gap-5 sm:p-5">
          <span
            aria-hidden
            className="size-[72px] shrink-0 rounded-2xl sm:size-[104px]"
            style={{ background: 'radial-gradient(circle at 30% 30%, #ffd60a 0 22%, transparent 23%), linear-gradient(135deg, #ff375f, #5e5ce6)' }}
          />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold tracking-wide uppercase opacity-60">Now playing</p>
            <p className="mt-1 truncate text-[17px] leading-tight font-semibold tracking-[-0.01em]">{track.title}</p>
            <p className="truncate text-[13px] font-medium opacity-60">{track.artist}</p>
            <span className="mt-3 block h-1 overflow-hidden rounded-full bg-current/15">
              <span className="block h-full rounded-full bg-current" style={{ width: `${track.played * 100}%` }} />
            </span>
            <p className="mt-1.5 flex justify-between text-[11px] font-medium tabular-nums opacity-60">
              <span>{track.elapsed}</span>
              <span>{track.left}</span>
            </p>
          </div>
        </GlassCard>
      </div>
    </div>
  )
}
