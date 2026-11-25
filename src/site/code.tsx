import { Check, Copy } from 'lucide-react'
import { useState, useSyncExternalStore, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

import { PACKAGE_MANAGERS, PM_KEY, installCommand, type Locale, type PackageManager } from './i18n'
import { UI } from './ui'

// One pass over the source: comments, strings, JSX tag names, attributes, keywords.
const TSX = new RegExp(
  [
    String.raw`(?<comment>\/\/[^\n]*|\/\*[\s\S]*?\*\/)`,
    String.raw`(?<string>'[^'\n]*'|"[^"\n]*"|\`[^\`]*\`)`,
    String.raw`(?<=<\/?)(?<tag>[A-Za-z][\w.]*)`,
    String.raw`(?<attr>\b[a-zA-Z][\w-]*)(?==[{"'])`,
    String.raw`\b(?<keyword>import|from|export|const|let|function|return|type|default|true|false|null|undefined|new)\b`,
  ].join('|'),
  'g',
)
const BASH = /(?<comment>#[^\n]*)|(?<string>'[^'\n]*'|"[^"\n]*")|^(?<keyword>[\w-]+)/gm

export type CodeLang = 'tsx' | 'bash' | 'text'

export const langOf = (title?: string): CodeLang => (title === 'terminal' ? 'bash' : title === 'prompt' ? 'text' : 'tsx')

function highlight(code: string, lang: CodeLang): ReactNode[] {
  if (lang === 'text') return [code]
  const out: ReactNode[] = []
  let last = 0
  for (const m of code.matchAll(lang === 'bash' ? BASH : TSX)) {
    const kind = Object.entries(m.groups ?? {}).find(([, v]) => v !== undefined)?.[0]
    if (!kind || m.index === undefined) continue
    if (m.index > last) out.push(code.slice(last, m.index))
    out.push(
      <span key={m.index} className={`tok-${kind}`}>
        {m[0]}
      </span>,
    )
    last = m.index + m[0].length
  }
  out.push(code.slice(last))
  return out
}

/**
 * Copies `text`. The button keeps its action name; a polite status region says "Copied" to
 * screen readers, and the icons cross-fade for everyone else.
 */
export function CopyButton({ text, locale, className = '' }: { text: string; locale: Locale; className?: string }) {
  const [done, setDone] = useState(false)
  const t = UI[locale].code
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      return
    }
    setDone(true)
    setTimeout(() => setDone(false), 1400)
  }
  return (
    <>
      <Button variant="ghost" size="icon-sm" onClick={copy} aria-label={t.copy} className={className}>
        <span aria-hidden className="icon-swap">
          <Copy data-shown={!done} className="size-3.5" />
          <Check data-shown={done} className="size-3.5" />
        </span>
      </Button>
      <span role="status" className="sr-only">
        {done ? t.copied : ''}
      </span>
    </>
  )
}

/** Highlighted source. `bare` drops the frame, for use inside another box. */
export function CodeBlock({
  code,
  title,
  locale,
  bare = false,
  className = '',
}: {
  code: string
  title?: string
  locale: Locale
  bare?: boolean
  className?: string
}) {
  return (
    <div className={cn('overflow-hidden bg-code', !bare && 'rounded-xl border border-border', className)}>
      {title && (
        <div className="flex h-10 items-center justify-between border-b border-border pr-1.5 pl-4">
          <span className="font-mono text-caption text-muted-foreground">{title}</span>
          <CopyButton text={code} locale={locale} />
        </div>
      )}
      <div className="relative">
        {!title && <CopyButton text={code} locale={locale} className="absolute top-2 right-2" />}
        <pre className="max-h-[520px] overflow-auto px-4 py-3.5 font-mono text-ui leading-[1.7] text-foreground">
          <code>{highlight(code, langOf(title))}</code>
        </pre>
      </div>
    </div>
  )
}

// ── Install command with package-manager tabs ──
// One choice for the whole site, remembered across visits (and shared by every instance).

const pmListeners = new Set<() => void>()
const readPm = (): PackageManager => {
  try {
    const v = localStorage.getItem(PM_KEY)
    if ((PACKAGE_MANAGERS as readonly string[]).includes(v ?? '')) return v as PackageManager
  } catch {}
  return 'npm'
}
function setPm(pm: PackageManager) {
  try {
    localStorage.setItem(PM_KEY, pm)
  } catch {}
  pmListeners.forEach((l) => l())
}
function usePm() {
  return useSyncExternalStore(
    (cb) => {
      pmListeners.add(cb)
      return () => pmListeners.delete(cb)
    },
    readPm,
    () => 'npm' as PackageManager,
  )
}

/**
 * `npx shadcn add …` with pnpm / npm / yarn / bun tabs (shadcn Tabs) and a copy button. The
 * command wraps instead of scrolling out of sight, so the whole URL is always readable.
 */
export function InstallCommand({ item, locale, className = '' }: { item: string; locale: Locale; className?: string }) {
  const pm = usePm()
  return (
    <Tabs value={pm} onValueChange={(v) => setPm(v as PackageManager)} className={cn('min-w-0 overflow-hidden rounded-xl border border-border bg-code', className)}>
      <div className="flex h-10 items-center gap-1 border-b border-border pr-1.5 pl-2">
        <TabsList aria-label={UI[locale].code.packageManager}>
          {PACKAGE_MANAGERS.map((k) => (
            <TabsTrigger key={k} value={k} className="px-2 font-mono text-caption data-[state=active]:font-normal">
              {k}
            </TabsTrigger>
          ))}
        </TabsList>
        <CopyButton text={installCommand(item, pm)} locale={locale} className="ml-auto" />
      </div>
      {PACKAGE_MANAGERS.map((k) => (
        <TabsContent key={k} value={k} className="flex min-w-0 items-baseline gap-3 px-4 py-3">
          <span aria-hidden="true" className="font-mono text-ui text-muted-foreground select-none">
            $
          </span>
          <code className="min-w-0 flex-1 font-mono text-ui whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">{installCommand(item, k)}</code>
        </TabsContent>
      ))}
    </Tabs>
  )
}
