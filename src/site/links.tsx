import { Link } from '@tanstack/react-router'
import type { ComponentPropsWithRef } from 'react'

import type { DocPage } from '@/docs/content'

import { localeParam, type Locale } from './i18n'

/**
 * A link is the current page only on that exact page. TanStack's default also marks every
 * parent route, which told screen readers that the home page and the docs introduction were
 * "current" on every docs page. Pass to every <Link> that can match a parent route.
 */
export const exactActive = { exact: true } as const

/** Links to a docs page; the introduction lives at /docs itself. Other props (ref, handlers)
 * reach the <a>, so it works inside shadcn's `asChild` slots. */
export function DocLink({ page, locale, children, ...rest }: { page: DocPage; locale: Locale } & Omit<ComponentPropsWithRef<'a'>, 'href'>) {
  const p = { locale: localeParam(locale) }
  return page.slug === 'introduction' ? (
    <Link to="/{-$locale}/docs" params={p} activeOptions={exactActive} {...rest}>
      {children}
    </Link>
  ) : (
    <Link to="/{-$locale}/docs/$slug" params={{ ...p, slug: page.slug }} activeOptions={exactActive} {...rest}>
      {children}
    </Link>
  )
}
