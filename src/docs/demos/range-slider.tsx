import { useState } from 'react'

import { RangeSlider } from '@/components/liquid-glass/controls/RangeSlider'

export default function Demo() {
  const [brightness, setBrightness] = useState(40)
  return (
    <div className="w-full max-w-sm">
      <RangeSlider label="Brightness" value={brightness} onChange={setBrightness} startIcon="moon" endIcon="sun" />
    </div>
  )
}
