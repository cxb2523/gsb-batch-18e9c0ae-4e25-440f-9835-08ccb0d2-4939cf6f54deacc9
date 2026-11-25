import { Link } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'

import { localeParam, type Locale } from './i18n'
import { UI } from './ui'

export function NotFound({ locale }: { locale: Locale }) {
  const t = UI[locale].notFound
  return (
    <main className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-32 text-center">
      <h1 className="font-display text-[28px] tracking-[-0.01em] text-foreground">{t.title}</h1>
      <p className="text-body text-muted-foreground">{t.body}</p>
      <Button asChild className="mt-3">
        <Link to="/{-$locale}" params={{ locale: localeParam(locale) }}>
          {t.home}
        </Link>
      </Button>
    </main>
  )
}
