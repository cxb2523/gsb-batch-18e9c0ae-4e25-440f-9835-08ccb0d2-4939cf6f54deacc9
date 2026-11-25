import NumberFlow from '@number-flow/react'
import { useNavigate } from '@tanstack/react-router'
import { ChevronRight, FileText, Link2 } from 'lucide-react'
import { Fragment, useMemo } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { CATALOG, CHANGE_KINDS, RELEASES, minorOf, pageBySlug, type Change, type ChangeKind, type Release } from '@/docs/content'

import { Inline } from './chrome'
import { Toc } from './doc-page'
import { localizedPath, type Locale } from './i18n'
import { DocLink } from './links'
import { formatDate, KindPill } from './release'
import { UI } from './ui'

// /changelog: every version on one rail. A version (v1.3) is what gets announced; its patch
// releases (v1.3.1, v1.3.2…) hang under it as a folded tree, one elbow per patch. The latest
// version shows its own notes open; older versions fold whole. Filters live in the URL, and a
// filtered list is flat.

export type ChangelogSearch = { kind?: ChangeKind; c?: string }

function groupsOf(releases: Release[]) {
  const out: { minor: string; releases: Release[] }[] = []
  for (const r of releases) {
    const m = minorOf(r.version)
    const last = out[out.length - 1]
    if (last?.minor === m) last.releases.push(r)
    else out.push({ minor: m, releases: [r] })
  }
  return out
}

const matches = (c: Change, s: ChangelogSearch) => (!s.kind || c.kind === s.kind) && (!s.c || c.page === s.c)

function ChangeList({ changes, locale }: { changes: Change[]; locale: Locale }) {
  return (
    <div className="flex flex-col gap-5">
      {CHANGE_KINDS.map((k) => {
        const items = changes.filter((c) => c.kind === k)
        if (!items.length) return null
        return (
          <div key={k} className="flex flex-col gap-2.5">
            <KindPill kind={k} locale={locale} />
            <ul className="flex flex-col gap-2">
              {items.map((c, i) => {
                const page = c.page ? pageBySlug(c.page) : undefined
                return (
                  <li
                    key={i}
                    className="relative max-w-[68ch] pl-[18px] text-body leading-[1.65] text-pretty text-muted-foreground before:absolute before:top-[0.72em] before:left-[3px] before:size-[5px] before:rounded-full before:bg-border-strong"
                  >
                    {page && (
                      <Badge asChild size="lg" className="press mr-1.5 align-[1px] text-ui text-foreground">
                        <DocLink page={page} locale={locale}>
                          {page.title[locale]}
                        </DocLink>
                      </Badge>
                    )}
                    <Inline text={c.text[locale]} />
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

function ReleaseHead({ r, locale, latest, level = 2, label = `v${r.version}` }: { r: Release; locale: Locale; latest: boolean; level?: 2 | 3; label?: string }) {
  const t = UI[locale].changelog
  const H = level === 2 ? 'h2' : 'h3'
  return (
    <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <H className={`group/anchor flex items-center gap-1.5 font-semibold tracking-[-0.02em] text-foreground ${level === 2 ? 'text-title' : 'text-lead'}`}>
        <a href={`#v${r.version}`} className="tabular-nums">
          {label}
        </a>
        <a
          href={`#v${r.version}`}
          aria-hidden
          tabIndex={-1}
          className="text-faint opacity-0 transition-[opacity,translate] duration-150 group-hover/anchor:translate-x-0 group-hover/anchor:opacity-100 motion-safe:-translate-x-[3px]"
        >
          <Link2 className="size-3.5" />
        </a>
      </H>
      <time dateTime={r.date} className="text-ui text-muted-foreground">
        {formatDate(r.date, locale)}
      </time>
      {latest && (
        <Badge variant="solid">
          <span aria-hidden className="size-1.5 rounded-full bg-kind-new" />
          {t.latest}
        </Badge>
      )}
    </header>
  )
}

/** Patch releases under their version: an elbow from the rail to each. */
function Patches({ releases, locale }: { releases: Release[]; locale: Locale }) {
  return (
    <ol className="relative mt-3 flex flex-col gap-8 pb-4">
      {releases.map((r) => (
        <li key={r.version} id={`v${r.version}`} className="relative scroll-mt-32 pl-8">
          <span aria-hidden className="absolute top-[-14px] -left-[31px] h-[25px] w-[50px] rounded-bl-[6px] border-b border-l border-border-strong" />
          <ReleaseHead r={r} locale={locale} latest={false} level={3} />
          <p className="mt-1.5 max-w-[60ch] text-body-sm leading-relaxed text-pretty text-muted-foreground">{r.title[locale]}</p>
          <div className="mt-4">
            <ChangeList changes={r.changes} locale={locale} />
          </div>
        </li>
      ))}
    </ol>
  )
}

export function ChangelogPage({ locale, search }: { locale: Locale; search: ChangelogSearch }) {
  const t = UI[locale].changelog
  const navigate = useNavigate()
  const filtering = !!(search.kind || search.c)
  const set = (next: ChangelogSearch) => void navigate({ to: '.', search: next, replace: true, resetScroll: false })

  const groups = useMemo(() => {
    const visible = RELEASES.map((r) => ({ ...r, changes: r.changes.filter((c) => matches(c, search)) })).filter((r) => r.changes.length)
    return groupsOf(visible)
  }, [search])

  const toc = useMemo(
    () =>
      groups.flatMap((g, i) =>
        filtering
          ? g.releases.map((r) => ({ id: `v${r.version}`, label: `v${r.version}` }))
          : [{ id: i === 0 ? `v${g.releases[g.releases.length - 1].version}` : `v${g.minor}`, label: `v${g.minor}` }],
      ),
    [groups, filtering],
  )

  // How many changes each kind has under the component filter, and how many are shown.
  const counts = useMemo(() => {
    const scoped = RELEASES.flatMap((r) => r.changes).filter((c) => !search.c || c.page === search.c)
    const by = Object.fromEntries(CHANGE_KINDS.map((k) => [k, scoped.filter((c) => c.kind === k).length])) as Record<ChangeKind, number>
    const total = RELEASES.reduce((n, r) => n + r.changes.length, 0)
    return { by, all: scoped.length, total, shown: groups.reduce((n, g) => n + g.releases.reduce((m, r) => m + r.changes.length, 0), 0) }
  }, [search, groups])

  // The count inside a chip: tertiary on a resting chip, the chip's own colour once it is on.
  const count = 'text-micro tabular-nums text-faint in-data-[state=on]:text-background/75'
  const clear = (
    <Button variant="link" size="sm" onClick={() => set({})} className="h-auto px-0 text-muted-foreground hover:text-foreground">
      {t.clear}
    </Button>
  )

  return (
    <div className="flex min-w-0 flex-1 gap-12">
      <article className="mx-auto flex w-full max-w-[760px] min-w-0 flex-col py-10 md:py-14">
        <header className="flex flex-col gap-3 border-b border-border pb-8">
          <p className="font-mono text-caption text-muted-foreground">{UI[locale].docs.resources}</p>
          <h1 className="font-display text-[40px] leading-[1.05] tracking-[-0.01em] text-foreground">{t.title}</h1>
          <p className="max-w-[60ch] text-lead text-muted-foreground">{t.description}</p>
          <div className="pt-1">
            <Button asChild variant="outline" size="xs" className="text-muted-foreground hover:text-foreground">
              <a href={`${localizedPath('/changelog', locale)}.md`}>
                <FileText aria-hidden />
                {t.markdown}
              </a>
            </Button>
          </div>
        </header>

        {/* Filters: kind chips (shadcn ToggleGroup) and a component picker, both in the URL. The
            chips wrap to a second row on narrow screens instead of running off the edge. */}
        <div className="sticky top-16 z-10 -mx-2 flex flex-wrap items-center gap-2 bg-background/85 px-2 py-3 backdrop-blur-md">
          <ToggleGroup
            type="single"
            aria-label={t.filters}
            value={search.kind ?? 'all'}
            onValueChange={(v) => {
              // Pressing the chip that is already on keeps it on: one kind is always chosen.
              if (v) set({ ...search, kind: v === 'all' ? undefined : (v as ChangeKind) })
            }}
            className="rounded-[18px] border border-border p-0.5"
          >
            <ToggleGroupItem value="all">
              {t.all}
              <NumberFlow value={counts.all} className={count} />
            </ToggleGroupItem>
            {CHANGE_KINDS.filter((k) => counts.by[k] || search.kind === k).map((k) => (
              <ToggleGroupItem key={k} value={k}>
                <span aria-hidden className="size-1.5 rounded-full" style={{ background: `var(--kind-${k})` }} />
                {t.kinds[k]}
                <NumberFlow value={counts.by[k]} className={count} />
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <label>
            <span className="sr-only">{t.component}</span>
            <NativeSelect value={search.c ?? ''} onChange={(e) => set({ ...search, c: e.target.value || undefined })}>
              <NativeSelectOption value="">{t.anyComponent}</NativeSelectOption>
              {CATALOG.map((p) => (
                <NativeSelectOption key={p.slug} value={p.slug}>
                  {p.title[locale]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          {filtering && clear}
          <p aria-live="polite" className="ml-auto text-ui text-muted-foreground tabular-nums max-sm:hidden">
            <NumberFlow value={counts.shown} />
            {counts.shown === counts.total ? ` ${t.shown.unit}` : ` ${t.shown.of} ${counts.total} ${t.shown.unit}`}
          </p>
        </div>

        {groups.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <p className="text-body-sm text-muted-foreground">{t.empty}</p>
            {clear}
          </div>
        ) : (
          <ol className="relative mt-8">
            {/* The rail. */}
            <span aria-hidden className="absolute top-3 bottom-0 left-[4.5px] w-px bg-[linear-gradient(to_bottom,var(--border-strong)_85%,transparent)]" />
            {groups.map((g, gi) => {
              if (filtering)
                return (
                  <Fragment key={g.minor}>
                    {g.releases.map((r) => {
                      const latest = r.version === RELEASES[0].version
                      return (
                        <li key={r.version} id={`v${r.version}`} className="relative scroll-mt-32 pb-14 pl-9">
                          <span
                            aria-hidden
                            className={`absolute top-[9px] left-0 size-2.5 rounded-full ${latest ? 'bg-foreground shadow-[0_0_0_4px_var(--background)]' : 'bg-background shadow-[0_0_0_4px_var(--background),inset_0_0_0_6px_var(--border-strong)]'}`}
                          />
                          <ReleaseHead r={r} locale={locale} latest={latest} />
                          <p className="mt-2 max-w-[60ch] text-body leading-relaxed text-pretty text-foreground/80">{r.title[locale]}</p>
                          <div className="mt-6">
                            <ChangeList changes={r.changes} locale={locale} />
                          </div>
                        </li>
                      )
                    })}
                  </Fragment>
                )
              const first = g.releases[0]
              const last = g.releases[g.releases.length - 1]
              if (gi === 0) {
                // The latest version: its own notes open, the patch releases after it folded.
                const patches = g.releases.slice(0, -1)
                return (
                  <li key={g.minor} id={`v${last.version}`} className="relative scroll-mt-32 pb-10 pl-9">
                    <span aria-hidden className="absolute top-[9px] left-0 size-2.5 rounded-full bg-foreground shadow-[0_0_0_4px_var(--background)]" />
                    <ReleaseHead r={last} locale={locale} latest label={`v${g.minor}`} />
                    <p className="mt-2 max-w-[60ch] text-body leading-relaxed text-pretty text-foreground/80">{last.title[locale]}</p>
                    <div className="mt-6">
                      <ChangeList changes={last.changes} locale={locale} />
                    </div>
                    {patches.length > 0 && (
                      <details className="disclose group mt-8">
                        <summary className="-ml-2 flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg px-2 py-2 transition-colors duration-150 hover:bg-muted/60">
                          <span className="text-body font-semibold tracking-[-0.01em] text-foreground">{t.patches(patches.length)}</span>
                          <span className="text-ui text-muted-foreground">
                            {t.upTo} <span className="font-mono text-caption tabular-nums">v{first.version}</span> · {formatDate(first.date, locale)}
                          </span>
                          <ChevronRight aria-hidden className="ml-auto size-3.5 self-center text-faint group-open:rotate-90 motion-safe:transition-transform motion-safe:duration-200" />
                        </summary>
                        <Patches releases={patches} locale={locale} />
                      </details>
                    )}
                  </li>
                )
              }
              return (
                <li key={g.minor} id={`v${g.minor}`} className="relative scroll-mt-32 pb-6 pl-9">
                  <span aria-hidden className="absolute top-[15px] left-[1px] size-2 rounded-full bg-background shadow-[0_0_0_4px_var(--background),inset_0_0_0_6px_var(--border-strong)]" />
                  <details className="disclose group">
                    <summary className="-ml-2 flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg px-2 py-2 transition-colors duration-150 hover:bg-muted/60">
                      <span className="text-lead font-semibold tracking-[-0.02em] text-foreground tabular-nums">v{g.minor}</span>
                      <span className="text-ui text-muted-foreground">
                        {t.releases(g.releases.length)} ·{' '}
                        {first.date === last.date ? formatDate(first.date, locale) : `${formatDate(last.date, locale, 'short')} – ${formatDate(first.date, locale, 'short')}`}
                      </span>
                      <ChevronRight aria-hidden className="ml-auto size-3.5 self-center text-faint group-open:rotate-90 motion-safe:transition-transform motion-safe:duration-200" />
                    </summary>
                    <Patches releases={g.releases} locale={locale} />
                  </details>
                </li>
              )
            })}
          </ol>
        )}
      </article>
      <Toc items={toc} locale={locale} />
    </div>
  )
}
