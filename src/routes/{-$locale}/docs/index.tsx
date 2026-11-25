import { createFileRoute } from '@tanstack/react-router'

import { pageBySlug } from '#/docs/content'
import { DocArticle, docHead } from '#/site/doc-page'

const page = pageBySlug('introduction')!

export const Route = createFileRoute('/{-$locale}/docs/')({
  head: ({ params }) => docHead(page, params.locale, '/docs'),
  component: () => <DocArticle page={page} locale={Route.useRouteContext().locale} />,
})
