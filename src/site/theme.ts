import { useSyncExternalStore } from 'react'

import { THEME_KEY } from './i18n'

export type Theme = 'light' | 'dark'

const listeners = new Set<() => void>()
const read = (): Theme => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light')

/** The page theme, held on <html data-theme> (set before paint by the head script). */
export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    read,
    () => 'light' as Theme,
  )
  return [theme, setTheme]
}

export function setTheme(t: Theme) {
  // Switch with every transition off, so the colours swap at once instead of smearing.
  const freeze = document.createElement('style')
  freeze.textContent = '*,*::before,*::after{transition:none!important}'
  document.head.appendChild(freeze)
  document.documentElement.setAttribute('data-theme', t)
  document.documentElement.style.colorScheme = t
  try {
    localStorage.setItem(THEME_KEY, t)
  } catch {}
  listeners.forEach((l) => l())
  void getComputedStyle(document.body).opacity
  requestAnimationFrame(() => requestAnimationFrame(() => freeze.remove()))
}
