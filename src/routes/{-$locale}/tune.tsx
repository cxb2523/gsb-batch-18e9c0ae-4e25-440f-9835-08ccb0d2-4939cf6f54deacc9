import { createFileRoute, notFound } from '@tanstack/react-router'

import { GlassTuner } from '#/site/glass-tuner'

// Development only: GlassCard's glass on sliders. Not linked, not prerendered, and a 404 in
// production builds. Remove it once the tuned values are the card's defaults.
export const Route = createFileRoute('/{-$locale}/tune')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound()
  },
  head: () => ({ meta: [{ title: 'GlassCard tuner — Liquid Glass UI' }, { name: 'robots', content: 'noindex' }] }),
  component: TunePage,
})

function TunePage() {
  const { locale } = Route.useRouteContext()
  return <GlassTuner locale={locale} />
}
