import { Link } from '@tanstack/react-router'
import { ChevronDown, ChevronRight } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { FEATURED, minorOf, newsOf, type ChangeKind } from '@/docs/content'

import { Inline } from './chrome'
import { localeParam, type Locale } from './i18n'
import { UI } from './ui'

// Release UI shared by the docs and /changelog. All of it reads RELEASES in content.ts.

/** "18 November 2026" / "18 Kasım 2026". UTC, so the prerender and the browser agree. */
export const formatDate = (iso: string, locale: Locale, month: 'long' | 'short' = 'long') =>
  new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-GB', { day: 'numeric', month, year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))

/** New / Improved / Fixed / Removed: the word is always there, the colour only repeats it. */
export function KindPill({ kind, locale, size = 'sm' }: { kind: ChangeKind; locale: Locale; size?: 'sm' | 'xs' }) {
  return (
    <Badge variant={kind} size={size === 'xs' ? 'default' : 'lg'}>
      {UI[locale].changelog.kinds[kind]}
    </Badge>
  )
}

/** The small pill on sidebar rows and page titles: New on a component the announced version added, Updated on one a later patch changed. */
export function BadgePill({ locale, kind = 'new' }: { locale: Locale; kind?: 'new' | 'updated' }) {
  return (
    <Badge variant={kind === 'new' ? 'new' : 'improved'} size="sm">
      {kind === 'new' ? UI[locale].docs.badgeNew : UI[locale].docs.badgeUpdated}
    </Badge>
  )
}

/** Pinned at the bottom of the docs sidebar: one quiet row, one click from the changelog. */
export function WhatsNewCard({ locale }: { locale: Locale }) {
  const t = UI[locale]
  return (
    <Link
      to="/{-$locale}/changelog"
      params={{ locale: localeParam(locale) }}
      title={FEATURED.title[locale]}
      className="group flex min-h-9 items-center gap-2 rounded-xl border border-border bg-surface py-1.5 pr-2 pl-3 text-ui transition-colors duration-150 hover:bg-muted"
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-kind-new" />
      <span className="font-medium text-foreground">{t.nav.whatsNew}</span>
      <span className="ml-auto font-mono text-micro text-muted-foreground tabular-nums">v{minorOf(FEATURED.version)}</span>
      <ChevronRight className="size-3.5 text-muted-foreground group-hover:text-foreground motion-safe:transition-transform motion-safe:duration-150 motion-safe:group-hover:translate-x-0.5" />
    </Link>
  )
}

/**
 * Under a component's title: its latest change on one line (patch releases included: this is
 * the component's own history, not an announcement). With history behind it, the line
 * opens to the earlier changes (never repeating the one already shown).
 */
export function ComponentNews({ slug, locale }: { slug: string; locale: Locale }) {
  const news = newsOf(slug)
  if (!news.length) return null
  const t = UI[locale]
  const [first, ...older] = news
  const p = { locale: localeParam(locale) }
  // `compact`: in the one-line row, phones show only the arrow (the words stay for screen readers).
  const all = (compact: boolean) => (
    <Link
      to="/{-$locale}/changelog"
      params={p}
      search={{ c: slug }}
      className={`text-caption text-muted-foreground underline decoration-border-strong underline-offset-4 transition-colors hover:text-foreground ${
        compact ? 'ml-auto shrink-0 max-sm:px-1 max-sm:no-underline' : ''
      }`}
    >
      <span className={compact ? 'max-sm:sr-only' : undefined}>{t.docs.allChanges} </span>→
    </Link>
  )
  const line = (
    <>
      {/* The one part that gives way on a narrow phone. */}
      <span className="min-w-0 truncate font-medium text-foreground">{t.docs.whatsNewHere}</span>
      <KindPill kind={first.kind} locale={locale} size="xs" />
      <span className="shrink-0 font-mono text-micro text-muted-foreground">v{first.version}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground max-sm:hidden">
        <Inline text={first.text[locale]} />
      </span>
    </>
  )
  if (!older.length)
    return (
      <div className="flex min-h-11 items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-1.5 text-ui">
        {line}
        {all(true)}
      </div>
    )
  return (
    <details className="disclose group rounded-xl border border-border bg-surface">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 rounded-xl px-3 py-1.5 text-ui transition-colors duration-150 hover:bg-muted/60">
        {line}
        <ChevronDown aria-hidden className="ml-auto size-3.5 shrink-0 text-muted-foreground group-open:rotate-180 motion-safe:transition-transform motion-safe:duration-200" />
      </summary>
      <ol className="flex flex-col gap-2.5 border-t border-border px-3 py-3">
        {/* The newest change heads the list on phones, where the summary hides its text. */}
        {news.slice(0, 6).map((n, i) => (
          <li key={i} className={`grid grid-cols-[64px_1fr] items-baseline gap-3 text-ui ${i === 0 ? 'sm:hidden' : ''}`}>
            <Link to="/{-$locale}/changelog" params={p} hash={`v${n.version}`} className="font-mono text-caption text-muted-foreground transition-colors hover:text-foreground">
              v{n.version}
            </Link>
            <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1 leading-relaxed text-muted-foreground">
              <KindPill kind={n.kind} locale={locale} size="xs" />
              <Inline text={n.text[locale]} />
              <time dateTime={n.date} className="text-caption text-muted-foreground">
                {formatDate(n.date, locale, 'short')}
              </time>
            </span>
          </li>
        ))}
        <li>{all(false)}</li>
      </ol>
    </details>
  )
}
