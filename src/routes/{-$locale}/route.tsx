import { Outlet, createFileRoute, notFound } from '@tanstack/react-router'

import { SiteFooter } from '#/site/chrome'
import { GazaBand } from '#/site/gaza-band'
import { SiteHeader } from '#/site/header'
import { localeFromParam } from '#/site/i18n'
import { UI } from '#/site/ui'

// One layout for both languages: "/…" is English, "/tr/…" is Turkish.
export const Route = createFileRoute('/{-$locale}')({
  beforeLoad: ({ params }) => {
    const locale = localeFromParam(params.locale)
    if (!locale) throw notFound()
    return { locale }
  },
  component: LocaleLayout,
})

function LocaleLayout() {
  const { locale } = Route.useRouteContext()
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      {/* First in the tab order, ahead of the band and the header. */}
      <a href="#content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2">
        {UI[locale].nav.skip}
      </a>
      <GazaBand locale={locale} />
      <SiteHeader locale={locale} />
      <div id="content" className="flex-1">
        <Outlet />
      </div>
      <SiteFooter locale={locale} />
    </div>
  )
}
