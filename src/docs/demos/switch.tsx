import { useState } from 'react'

import { Switch } from '@/components/liquid-glass/controls/Switch'

export default function Demo() {
  const [on, setOn] = useState(true)
  return <Switch label="Notifications" description="Banners and sounds" checked={on} onChange={setOn} />
}
