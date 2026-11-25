import { Outlet, createFileRoute } from '@tanstack/react-router'

import { DocsShell } from '#/site/doc-page'

export const Route = createFileRoute('/{-$locale}/docs')({
  component: DocsLayout,
})

function DocsLayout() {
  const { locale } = Route.useRouteContext()
  return (
    <DocsShell locale={locale}>
      <Outlet />
    </DocsShell>
  )
}
