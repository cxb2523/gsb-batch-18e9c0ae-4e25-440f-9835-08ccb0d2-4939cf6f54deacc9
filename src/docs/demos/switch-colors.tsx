import { Switch } from '@/components/liquid-glass/controls/Switch'

// `color` is the track while on. Without it the switch is the kit's blue.
export default function Demo() {
  return (
    <div className="flex flex-col gap-5">
      <Switch label="Blue" checked />
      <Switch label="Green" color="#34c759" checked />
      <Switch label="Orange" color="#ff9500" checked />
      <Switch label="Pink" color="#ff2d55" checked />
    </div>
  )
}
