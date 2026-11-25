import { useState } from 'react'

import { Checkbox } from '@/components/liquid-glass/controls/Checkbox'

export default function Demo() {
  const [remember, setRemember] = useState(true)
  return (
    <div className="flex flex-col gap-4">
      <Checkbox label="Remember this device" checked={remember} onChange={setRemember} />
      <Checkbox label="Circle" shape="circle" checked={false} />
    </div>
  )
}
