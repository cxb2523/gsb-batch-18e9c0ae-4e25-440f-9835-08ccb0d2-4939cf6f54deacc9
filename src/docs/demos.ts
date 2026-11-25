import type { ComponentType } from 'react'

// Live demos and their exact source. The code shown under a preview IS the demo file.
const modules = import.meta.glob<{ default: ComponentType }>('./demos/*.tsx', { eager: true })
const sources = import.meta.glob<string>('./demos/*.tsx', { eager: true, query: '?raw', import: 'default' })

const id = (path: string) => path.slice('./demos/'.length, -'.tsx'.length)

export const DEMOS: Record<string, { Component: ComponentType; source: string }> = Object.fromEntries(
  Object.keys(modules).map((p) => [id(p), { Component: modules[p].default, source: sources[p].trimEnd() }]),
)
