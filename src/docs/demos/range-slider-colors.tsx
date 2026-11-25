import { RangeSlider } from '@/components/liquid-glass/controls/RangeSlider'

// `color` is the filled part of the track. Without it the slider is the kit's blue.
export default function Demo() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-8">
      <RangeSlider label="Blue" value={30} />
      <RangeSlider label="Green" color="#34c759" value={45} />
      <RangeSlider label="Orange" color="#ff9500" value={60} />
      <RangeSlider label="Pink" color="#ff2d55" value={75} />
    </div>
  )
}
