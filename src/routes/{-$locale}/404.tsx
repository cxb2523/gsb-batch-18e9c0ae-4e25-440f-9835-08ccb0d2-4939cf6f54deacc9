import { createFileRoute } from '@tanstack/react-router'

import { NotFound } from '#/site/not-found'

// A real page so the prerenderer writes /404.html and /tr/404.html (Cloudflare Pages serves the nearest one).
export const Route = createFileRoute('/{-$locale}/404')({
  head: ({ params }) => ({
    meta: [{ title: params.locale === 'tr' ? 'Sayfa bulunamadı — Liquid Glass UI' : 'Page not found — Liquid Glass UI' }, { name: 'robots', content: 'noindex' }],
  }),
  component: () => <NotFound locale={Route.useRouteContext().locale} />,
})
