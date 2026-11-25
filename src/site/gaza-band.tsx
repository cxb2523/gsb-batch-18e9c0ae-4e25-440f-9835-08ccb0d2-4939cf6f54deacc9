import { Rivets, column } from './chrome'
import type { Locale } from './i18n'
import { UI } from './ui'

/** IHH Humanitarian Relief Foundation's Palestine / Gaza donation page. */
const DONATE_URL = 'https://ihh.org.tr/en/donate/palestine-gaza'

/** Messages in one half of the track. The track is two equal halves and rewinds after
 * travelling one, so the loop has no seam; each half is at least as wide as the band. */
const UNITS = 12

/** Progressive blur at the two ends: each layer is twice as blurred as the one before it and
 * masked to its own slice, the most blurred outermost. */
const LAYERS = [0.5, 1, 2, 4, 8]

function EdgeBlur({ side }: { side: 'left' | 'right' }) {
  // The gradient runs towards the edge, so a later (blurrier) layer sits further out.
  const angle = side === 'left' ? 270 : 90
  const slice = 100 / (LAYERS.length + 1)
  return (
    <span aria-hidden className={`band-blur pointer-events-none absolute inset-y-0 w-(--edge) ${side === 'left' ? 'left-0' : 'right-0'}`}>
      {LAYERS.map((px, i) => {
        const stops = [0, 1, 1, 0].map((alpha, j) => `rgb(0 0 0 / ${alpha}) ${(i + j) * slice}%`).join(', ')
        const mask = `linear-gradient(${angle}deg, ${stops})`
        return <span key={px} className="absolute inset-0" style={{ maskImage: mask, WebkitMaskImage: mask, backdropFilter: `blur(${px}px)`, WebkitBackdropFilter: `blur(${px}px)` }} />
      })}
    </span>
  )
}

/** The band above the header: one message running leftwards without end, the whole band a
 * link to the donation page (new tab). At both ends the text blurs progressively and fades
 * into the page. It pauses under the pointer or keyboard focus so it can be read; with
 * reduced motion there is no run and no blur, just the message, centred. It scrolls away
 * with the page (the header below it is the sticky one). Styles: `.band-*` in styles.css. */
export function GazaBand({ locale }: { locale: Locale }) {
  const t = UI[locale].band
  const half = Array.from({ length: UNITS }, (_, i) => (
    <span key={i} className="flex shrink-0 items-center">
      <span className="px-4">{t.text}</span>
      <i className="size-1 shrink-0 rounded-full bg-faint" />
    </span>
  ))
  return (
    // Above the header (z-40), which would otherwise cover the lower half of the band's rivets.
    <div className="relative z-[41] border-b border-rail">
      <div className={column}>
        <Rivets at={['bl', 'br']} />
        <a
          href={DONATE_URL}
          target="_blank"
          rel="noreferrer"
          className="band relative flex h-(--band) items-center overflow-hidden text-caption font-medium whitespace-nowrap text-foreground -outline-offset-2 [--edge:3rem] sm:[--edge:5rem]"
        >
          <span className="sr-only">{t.label}</span>
          <span aria-hidden className="band-window flex w-full overflow-hidden">
            <span className="band-track flex w-max min-w-[200%] shrink-0">
              <span className="flex flex-[1_0_auto] items-center justify-around">{half}</span>
              <span className="flex flex-[1_0_auto] items-center justify-around">{half}</span>
            </span>
          </span>
          <span aria-hidden className="band-still w-full items-center justify-center">
            {t.text}
          </span>
          <EdgeBlur side="left" />
          <EdgeBlur side="right" />
        </a>
      </div>
    </div>
  )
}
