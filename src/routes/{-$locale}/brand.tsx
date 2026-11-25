import { createFileRoute } from '@tanstack/react-router'

import { BrandPage } from '#/site/brand'
import { DocsShell } from '#/site/doc-page'
import { alternateLinks, localeFromParam } from '#/site/i18n'
import { UI } from '#/site/ui'

export const Route = createFileRoute('/{-$locale}/brand')({
  head: ({ params }) => {
    const locale = localeFromParam(params.locale) ?? 'en'
    const t = UI[locale].brand
    const title = `${t.title} — Liquid Glass UI`
    return {
      meta: [{ title }, { name: 'description', content: t.description }, { property: 'og:title', content: title }, { property: 'og:description', content: t.description }],
      links: alternateLinks('/brand', locale),
    }
  },
  component: Brand,
})

function Brand() {
  const { locale } = Route.useRouteContext()
  return (
    <DocsShell locale={locale}>
      <BrandPage locale={locale} />
    </DocsShell>
  )
}
