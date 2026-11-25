import type { Emoji } from '../core/types'

/**
 * The sizes, in logical pixels, at which glyphs are actually rasterised.
 * The renderer asks for the nearest step and scales the result with
 * drawImage, so a smooth pinch never re-rasterises the glyph set — which it
 * would have to do on every frame if the atlas honoured arbitrary sizes.
 */
export const ATLAS_STEPS: readonly number[] = [16, 32, 64, 128]

/** Fraction of the cell kept clear on each side, so glyphs never touch. */
const PADDING_RATIO = 0.06

/** The step used when an average colour is wanted before any glyph is drawn. */
const DEFAULT_COLOR_STEP = 32

/**
 * The parameters an atlas is rasterised for. They are part of the atlas's
 * identity: the same pair always describes the same glyphs at the same
 * resolution, so a holder can compare pairs to decide whether its atlas is
 * still valid.
 */
export type AtlasKey = {
  dpr: number
  fontStack: string
}

type Rgb = readonly [number, number, number]

/**
 * Holds one {@link GlyphAtlas} and replaces it once its device pixel ratio
 * or font stack changes. The render layer talks to this rather than to an
 * atlas directly, so a window moved to another display, a browser zoom or a
 * system font fallback all lead to a fresh rasterisation instead of glyphs
 * drawn from a stale, blurry atlas.
 *
 * The old atlas is {@link GlyphAtlas.clear | cleared} before it is dropped,
 * so its canvas buffers and average-colour tuples are released rather than
 * accumulating once per parameter change.
 *
 * Rebuilds are keyed on the parameters, not on request count: asking twice
 * with the same pair — twice in one frame, or for the rest of the session —
 * returns the very same instance without rebuilding.
 */
export class AtlasProvider {
  private current: GlyphAtlas
  private readonly key: AtlasKey

  constructor(dpr: number, fontStack: string) {
    this.key = { dpr, fontStack }
    this.current = new GlyphAtlas(dpr, fontStack)
  }

  /**
   * The atlas matching these parameters, rebuilding it first when either one
   * has changed since the last request. Repeated calls with unchanged
   * parameters return the same instance.
   */
  get(dpr: number, fontStack: string): GlyphAtlas {
    if (this.key.dpr === dpr && this.key.fontStack === fontStack) {
      return this.current
    }

    // Drop every canvas and cached colour the stale atlas owns before the
    // reference is overwritten, or they live until garbage collection.
    this.current.clear()
    this.key.dpr = dpr
    this.key.fontStack = fontStack
    this.current = new GlyphAtlas(dpr, fontStack)

    return this.current
  }
}

/**
 * Rasterises each emoji once per size step and hands out the buffer, so the
 * draw loop calls drawImage instead of fillText — no font matching and no
 * colour-glyph rasterisation per frame.
 *
 * The atlas belongs to one device pixel ratio and one font stack. When
 * either changes, the owner clears this instance and builds a new one rather
 * than mutating it; {@link AtlasProvider} automates that.
 */
export class GlyphAtlas {
  private readonly averages = new Map<Emoji, Rgb>()
  private readonly buffers = new Map<string, HTMLCanvasElement>()
  private readonly dpr: number
  private readonly fontStack: string

  constructor(dpr: number, fontStack: string) {
    this.dpr = dpr
    this.fontStack = fontStack
  }

  /** The glyph's mean colour as a CSS colour, for the colour level of detail. */
  averageColor(emoji: Emoji): string {
    const [r, g, b] = this.averageColorRgb(emoji)

    return `rgb(${r}, ${g}, ${b})`
  }

  /**
   * The glyph's mean colour as a cached tuple. The same instance comes back
   * every time, because the renderer reads this inside the draw loop and
   * must not allocate there.
   */
  averageColorRgb(emoji: Emoji): Rgb {
    const cached = this.averages.get(emoji)

    if (cached) return cached

    this.rasterise(emoji, DEFAULT_COLOR_STEP)

    return this.averages.get(emoji)!
  }

  /**
   * Drops every rasterised buffer and every average-colour tuple. The
   * canvases are released as soon as no other reference remains, which is
   * what keeps an atlas rebuild from leaking the old caches. The next
   * {@link get} or {@link averageColorRgb} rasterises into a fresh canvas,
   * never into a buffer sized for an earlier device pixel ratio.
   */
  clear(): void {
    this.averages.clear()
    this.buffers.clear()
  }

  /**
   * The buffer for this emoji at the step nearest the requested cell size.
   * The caller scales it to the exact size it needs.
   */
  get(emoji: Emoji, cellSizePx: number): CanvasImageSource {
    const step = nearestAtlasStep(cellSizePx)
    const cached = this.buffers.get(`${step}:${emoji}`)

    if (cached) return cached

    return this.rasterise(emoji, step)
  }

  private rasterise(emoji: Emoji, step: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(step * this.dpr)
    canvas.height = Math.round(step * this.dpr)

    const ctx = canvas.getContext('2d')!
    ctx.scale(this.dpr, this.dpr)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'

    const padding = step * PADDING_RATIO * 2

    ctx.font = `${step}px ${this.fontStack}`

    let metrics = ctx.measureText(emoji)

    const width = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight
    const height =
      metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent

    if (!(width > 0) || !(height > 0)) {
      // The browser reported no glyph box. Fall back to centring on the
      // baseline, which is what the old engine did for every glyph.
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(emoji, step / 2, step / 2)
    } else {
      const fit = Math.min(1, (step - padding) / Math.max(width, height))

      // Shrink until the glyph fits the cell, then re-measure: the centring
      // below reads the metrics of the size actually drawn, not of the
      // size first tried.
      if (fit < 1) {
        ctx.font = `${step * fit}px ${this.fontStack}`
        metrics = ctx.measureText(emoji)
      }

      // Centred on the glyph's own ink, not on a shared constant: this is
      // what makes a variation-selector emoji and a native one line up.
      ctx.fillText(
        emoji,
        step / 2 -
          (metrics.actualBoundingBoxRight - metrics.actualBoundingBoxLeft) / 2,
        step / 2 +
          (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) /
            2,
      )
    }

    this.buffers.set(`${step}:${emoji}`, canvas)

    if (!this.averages.has(emoji)) {
      this.averages.set(emoji, meanColor(ctx, canvas.width, canvas.height))
    }

    return canvas
  }
}

/**
 * The rasterisation step nearest the requested size, clamped to the ends of
 * the list.
 */
export function nearestAtlasStep(cellSizePx: number): number {
  let best = ATLAS_STEPS[0]

  for (const step of ATLAS_STEPS) {
    if (Math.abs(step - cellSizePx) < Math.abs(best - cellSizePx)) {
      best = step
    }
  }

  return best
}

/**
 * Alpha-weighted mean colour of everything drawn in the buffer. Weighting by
 * alpha keeps a glyph's anti-aliased fringe from washing the colour towards
 * the transparent background.
 */
function meanColor(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): Rgb {
  const { data } = ctx.getImageData(0, 0, width, height)

  let alpha = 0
  let b = 0
  let g = 0
  let r = 0

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]

    if (a === 0) continue

    alpha += a
    r += data[i] * a
    g += data[i + 1] * a
    b += data[i + 2] * a
  }

  if (alpha === 0) return [0, 0, 0]

  return [Math.round(r / alpha), Math.round(g / alpha), Math.round(b / alpha)]
}
