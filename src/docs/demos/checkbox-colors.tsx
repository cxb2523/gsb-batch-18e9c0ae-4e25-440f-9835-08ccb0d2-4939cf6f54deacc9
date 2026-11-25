import { Checkbox } from '@/components/liquid-glass/controls/Checkbox'

// `color` is the box while checked. Without it the checkbox is the kit's blue.
export default function Demo() {
  return (
    <div className="flex flex-col gap-5">
      <Checkbox label="Blue" />
      <Checkbox label="Green" color="#34c759" />
      <Checkbox label="Orange" color="#ff9500" />
      <Checkbox label="Pink" color="#ff2d55" />
    </div>
  )
}
