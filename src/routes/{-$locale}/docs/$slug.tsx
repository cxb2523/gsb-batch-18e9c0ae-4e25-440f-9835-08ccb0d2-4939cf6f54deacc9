import { createFileRoute, notFound } from '@tanstack/react-router'

import { pageBySlug } from '#/docs/content'
import { DocArticle, docHead } from '#/site/doc-page'

export const Route = createFileRoute('/{-$locale}/docs/$slug')({
  loader: ({ params }) => {
    const page = pageBySlug(params.slug)
    if (!page || page.slug === 'introduction') throw notFound()
    return { slug: page.slug }
  },
  head: ({ params }) => {
    const page = pageBySlug(params.slug)
    return page ? docHead(page, params.locale, `/docs/${page.slug}`) : {}
  },
  component: DocRoute,
})

function DocRoute() {
  const { slug } = Route.useLoaderData()
  const { locale } = Route.useRouteContext()
  return <DocArticle page={pageBySlug(slug)!} locale={locale} />
}
