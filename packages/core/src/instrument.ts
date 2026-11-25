import MagicString from 'magic-string';
import type { SourceMap } from 'magic-string';
import { readScene } from './read';

/** The fixed specifier the overlay is imported from. A Vite virtual module locally, a module-map entry in the Playground. */
export const OVERLAY_SPECIFIER = 'virtual:prism-overlay';

/** The prop added to tagged elements. R3F pierces `userData-prism` into `obj.userData.prism`. */
export const TAG_PROP = 'userData-prism';

const OBJECT3D: ReadonlySet<string> = new Set([
  'mesh', 'group', 'points', 'line', 'lineSegments', 'lineLoop', 'instancedMesh', 'skinnedMesh', 'sprite', 'lod',
  'object3D', 'bone', 'perspectiveCamera', 'orthographicCamera', 'scene',
]);

/**
 * Can this R3F host element take the pierced `userData-prism` prop? Only instances that have `.userData`
 * can: Object3D (meshes, groups, lights, cameras), Material and BufferGeometry. `<color>`, `<fog>`,
 * `<primitive>`, attributes and other attach-only types would throw, so they are never tagged.
 */
export function taggable(tag: string): boolean {
  return OBJECT3D.has(tag) || /Light$/.test(tag) || /(Geometry|Material)$/.test(tag);
}

export interface InstrumentOptions {
  /** Inject `<__PrismOverlay />` into the first `<Canvas>` (default true). */
  overlay?: boolean;
  /** Override the overlay import specifier (default `virtual:prism-overlay`). */
  overlaySpecifier?: string;
}

export interface InstrumentResult {
  code: string;
  map: SourceMap;
  /** Number of elements that received a `userData-prism` tag. */
  tagged: number;
  /** Whether `<__PrismOverlay />` was injected. */
  overlay: boolean;
}

const DIRECTIVES = /^(?:\s*(['"])use [a-z ]+\1;?[ \t]*\r?\n)+/;

/**
 * The single dev-time transform behind the real-page plugin, the harness fallback and the Playground.
 *
 * - Adds `userData-prism="<path>:<line>:<col>"` (the position of the element's `<` in the ORIGINAL
 *   source) to every taggable R3F host element. It is appended after the element's last attribute so a
 *   literal `userData={{...}}` is applied first and the pierced key lands on top of it.
 * - Injects `<__PrismOverlay />` as the last child of the first `<Canvas>` (a self-closing Canvas is
 *   expanded) plus one import of the overlay.
 *
 * Returns `null` when there is nothing to do (nothing taggable, no Canvas, or the file is already
 * instrumented) and throws `PrismError('PARSE_ERROR')` on invalid source. Output is source-mapped
 * and deterministic. The input is never modified on disk; the result only ever runs in a dev server
 * or sandbox.
 */
export function instrument(source: string, path: string, options: InstrumentOptions = {}): InstrumentResult | null {
  if (source.includes('__PrismOverlay') || source.includes(`"${TAG_PROP}"`)) return null;
  const specifier = options.overlaySpecifier ?? OVERLAY_SPECIFIER;
  const scene = readScene(source, path);
  const s = new MagicString(source);

  let tagged = 0;
  for (const n of scene.nodes) {
    if (n.kind !== 'host' || !taggable(n.tag)) continue;
    const last = n.props.length ? n.props[n.props.length - 1] : undefined;
    const at = last ? last.attrEnd : n.start + 1 + n.tag.length;
    s.appendLeft(at, ` ${TAG_PROP}=${JSON.stringify(`${path}:${n.line}:${n.col}`)}`);
    tagged++;
  }

  let overlay = false;
  const canvas = options.overlay === false ? undefined : scene.nodes.find((n) => n.kind === 'canvas');
  if (canvas) {
    if (source.slice(canvas.start, canvas.end).endsWith('/>')) {
      s.overwrite(canvas.end - 2, canvas.end, `><__PrismOverlay /></${canvas.tag}>`);
    } else {
      s.appendLeft(canvas.end - `</${canvas.tag}>`.length, '<__PrismOverlay />');
    }
    overlay = true;
  }
  if (!tagged && !overlay) return null;

  if (overlay) {
    const at = DIRECTIVES.exec(source)?.[0].length ?? 0;
    s.appendLeft(at, `import { __PrismOverlay } from ${JSON.stringify(specifier)};\n`);
  }
  return { code: s.toString(), map: s.generateMap({ hires: true, source: path, includeContent: true }), tagged, overlay };
}
