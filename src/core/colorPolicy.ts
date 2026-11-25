import type { CadDocument } from './types.js';

export type CadColorMode = 'source' | 'monochrome';

export interface CadColorPolicy {
  /** Preserve authored colors or replace renderable CAD colors with one fixed color. */
  mode?: CadColorMode;
  /** CSS color used when mode is `monochrome`. Defaults to the active renderer foreground. */
  monochromeColor?: string;
}

/**
 * Renderer-facing spelling of the same policy. Renderer options use `colorMode`
 * so they never collide with the `metadata`-attached `CadColorPolicy` keys.
 */
export interface CadColorPolicyOptions {
  colorMode?: CadColorMode;
  monochromeColor?: string;
}

export type CadResolvedColorPolicy = Required<Pick<CadColorPolicy, 'mode'>> & Pick<CadColorPolicy, 'monochromeColor'>;

const COLOR_MODE_KEY = 'cadColorMode';
const MONOCHROME_COLOR_KEY = 'cadMonochromeColor';

/**
 * Creates a shallow render-only document view carrying a color policy in
 * metadata. Geometry, layers, entities, parser data and the caller-owned
 * document remain untouched.
 */
export function createCadRenderDocument(
  document: CadDocument,
  policy: CadColorPolicy = {}
): CadDocument {
  const mode = policy.mode ?? 'source';
  const current = readCadColorPolicy(document);
  const nextColor = normalizeOptionalColor(policy.monochromeColor);

  if (
    current.mode === mode &&
    current.monochromeColor === nextColor
  ) {
    return document;
  }

  const metadata = { ...document.metadata };
  if (mode === 'monochrome') {
    metadata[COLOR_MODE_KEY] = mode;
    if (nextColor) metadata[MONOCHROME_COLOR_KEY] = nextColor;
    else delete metadata[MONOCHROME_COLOR_KEY];
  } else {
    delete metadata[COLOR_MODE_KEY];
    delete metadata[MONOCHROME_COLOR_KEY];
  }

  return { ...document, metadata };
}

/** Reads the render-only color policy attached by createCadRenderDocument(). */
export function readCadColorPolicy(document?: CadDocument): CadResolvedColorPolicy {
  return readCadColorPolicyFromDocument(document);
}

/**
 * Resolves the effective policy for a render pass. Renderer options
 * (`colorMode` / `monochromeColor`) win over the render document's metadata, so
 * a renderer can carry its own policy without rebuilding the document.
 */
export function resolveCadColorPolicy(
  document?: CadDocument,
  options: CadColorPolicyOptions = {}
): CadResolvedColorPolicy {
  return mergeCadColorPolicy(readCadColorPolicyFromDocument(document), options);
}

/** Stable, comparable signature of the effective color policy. */
export function cadColorPolicySignature(policy: CadResolvedColorPolicy): string {
  return policy.mode === 'monochrome'
    ? `monochrome:${policy.monochromeColor ?? ''}`
    : 'source';
}

/**
 * Overlays renderer options on a base policy.
 *
 * - `colorMode: 'source'` clears the fixed color (source mode has none).
 * - `colorMode: 'monochrome'` without a color keeps the configured color, so a
 *   mode switch does not silently revert to the foreground.
 * - An explicit `monochromeColor` always wins.
 */
export function mergeCadColorPolicy(
  base: CadResolvedColorPolicy,
  options: CadColorPolicyOptions = {}
): CadResolvedColorPolicy {
  const hasModeOption = options.colorMode === 'monochrome' || options.colorMode === 'source';
  const mode: CadColorMode = hasModeOption ? options.colorMode as CadColorMode : base.mode;
  const explicitColor = normalizeOptionalColor(options.monochromeColor);
  const monochromeColor = explicitColor ?? (hasModeOption && mode === 'source' ? undefined : base.monochromeColor);
  return monochromeColor ? { mode, monochromeColor } : { mode };
}

/**
 * Resolves the initial policy for a newly attached render document. A policy
 * already carried in the document's metadata is the base; explicit renderer
 * options win over it.
 */
export function resolveCadDocumentColorPolicy(
  document: CadDocument,
  options: CadColorPolicyOptions = {}
): CadResolvedColorPolicy {
  return mergeCadColorPolicy(readCadColorPolicyFromDocument(document), options);
}

function readCadColorPolicyFromDocument(document?: CadDocument): CadResolvedColorPolicy {
  const metadata = document?.metadata;
  const mode = metadata?.[COLOR_MODE_KEY] === 'monochrome' ? 'monochrome' : 'source';
  const monochromeColor = normalizeOptionalColor(metadata?.[MONOCHROME_COLOR_KEY]);
  return monochromeColor ? { mode, monochromeColor } : { mode };
}

function normalizeOptionalColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}
