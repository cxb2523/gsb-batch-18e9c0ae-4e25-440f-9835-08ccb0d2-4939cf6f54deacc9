'use strict';

import { parseColor, BLACK } from './color.js';

// Limits straight from SKINS.html ("Limits"): TRAX stops reading at each
// limit and ignores the rest, rather than rejecting the file.
export const LIMITS = Object.freeze({
  FILE_BYTES: 32 * 1024,
  AREAS: 8,
  LINES_PER_AREA: 4,
  PIECES_PER_LINE: 6,
  PIECE_BYTES: 47,
  BACKGROUND_COLORS: 6,
});

const DEFAULT_SECONDS = 6;
const MIN_SECONDS = 1;
const MAX_SECONDS = 3600;

// The skin produced when skin.json is missing or not valid JSON: the skin
// itself still loads (the picture is shown), but it prints no text and the
// background is black.
export function emptySkin() {
  return {
    validJson: false,
    name: null,
    background: { kind: 'flat', color: { ...BLACK } },
    defaults: { size: 14, align: 'left', color: null },
    areas: [],
  };
}

/**
 * Parse the bytes of a skin.json file.
 *
 * Never throws for bad content: invalid JSON yields the same empty skin as a
 * missing file (still loadable, no text, black background). Unknown keys are
 * ignored, unreadable colors are ignored as if they were not there, and every
 * documented limit is applied by truncation.
 *
 * @param {string|Buffer} text raw file contents (already size-checked upstream)
 * @returns {ReturnType<typeof emptySkin>}
 */
export function parseSkin(text) {
  let root;
  if (text == null) return emptySkin();
  try {
    root = JSON.parse(typeof text === 'string' ? text : text.toString('utf8'));
  } catch {
    return emptySkin();
  }
  if (root === null || typeof root !== 'object' || Array.isArray(root)) {
    // Valid JSON, but not the object the format describes. Treat it the same
    // way as invalid JSON: no text, black background, picture still loads.
    return emptySkin();
  }

  const skin = emptySkin();
  skin.validJson = true;

  if (typeof root.name === 'string') skin.name = root.name;
  skin.background = parseBackground(root.background);
  skin.defaults = parseDefaults(root.defaults);
  skin.areas = parseAreas(root.areas, skin.defaults);
  return skin;
}

function parseBackground(raw) {
  // A single color string is a flat, never-animated background.
  if (typeof raw === 'string') {
    const color = parseColor(raw);
    return { kind: 'flat', color: color ?? { ...BLACK } };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { kind: 'flat', color: { ...BLACK } };
  }

  const colors = parseColorList(raw.colors);
  if (colors.length === 0) {
    // No usable colors: behave as if there were no background at all.
    return { kind: 'flat', color: { ...BLACK } };
  }
  if (colors.length === 1) {
    return { kind: 'flat', color: colors[0] };
  }

  return {
    kind: 'cycle',
    colors,
    seconds: parseSeconds(raw.seconds),
    blend: raw.blend === 'step' ? 'step' : 'fade',
    while: raw.while === 'always' ? 'always' : 'playing',
  };
}

/** Keep only exact #RRGGBB entries, at most BACKGROUND_COLORS of them. */
export function parseColorList(rawList) {
  if (!Array.isArray(rawList)) return [];
  const out = [];
  for (const entry of rawList) {
    if (out.length >= LIMITS.BACKGROUND_COLORS) break;
    const color = parseColor(entry);
    if (color) out.push(color);
  }
  return out;
}

function parseSeconds(value) {
  // Only finite numbers in [1, 3600] count; anything else falls back to 6.
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= MIN_SECONDS && value <= MAX_SECONDS) return value;
  }
  return DEFAULT_SECONDS;
}

function parseDefaults(raw) {
  const defaults = { size: 14, align: 'left', color: null };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return defaults;
  if (typeof raw.size === 'number' && Number.isFinite(raw.size) && raw.size > 0) {
    defaults.size = raw.size;
  }
  defaults.align = normalizeAlign(raw.align);
  if (typeof raw.color === 'string') {
    const color = parseColor(raw.color);
    if (color) defaults.color = color;
  }
  return defaults;
}

function normalizeAlign(value) {
  return value === 'center' || value === 'right' ? value : 'left';
}

function parseAreas(rawAreas, defaults) {
  if (!Array.isArray(rawAreas)) return [];
  const areas = [];
  for (const entry of rawAreas) {
    if (areas.length >= LIMITS.AREAS) break;
    const area = parseArea(entry, defaults);
    if (area) areas.push(area);
  }
  return areas;
}

function parseArea(raw, defaults) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!Array.isArray(raw.rect) || raw.rect.length < 4) return null;
  const rect = raw.rect.slice(0, 4).map((n) =>
    typeof n === 'number' && Number.isFinite(n) ? n : 0,
  );
  const [x, y, width, height] = rect;
  // An area with no width or height is skipped.
  if (width <= 0 || height <= 0) return null;

  const lines = parseLines(raw.lines);
  // An area that ends up with no lines still occupies its rect; the renderer
  // simply has nothing to draw in it.
  return {
    rect: { x, y, width, height },
    lines,
    size:
      typeof raw.size === 'number' && Number.isFinite(raw.size) && raw.size > 0
        ? raw.size
        : defaults.size,
    align: raw.align !== undefined ? normalizeAlign(raw.align) : defaults.align,
    color: resolveAreaColor(raw.color, defaults.color),
  };
}

function resolveAreaColor(raw, inherited) {
  if (typeof raw === 'string') {
    const color = parseColor(raw);
    if (color) return color;
  }
  // Leave it out and the renderer picks dark/light from the picture.
  return inherited ?? null;
}

function parseLines(rawLines) {
  if (!Array.isArray(rawLines)) return [];
  const lines = [];
  for (const entry of rawLines) {
    if (lines.length >= LIMITS.LINES_PER_AREA) break;
    const pieces = parseLine(entry);
    lines.push(pieces); // may be empty; an empty line is skipped at render
  }
  return lines;
}

function parseLine(entry) {
  // A line with a single piece can be written as a plain string.
  const rawPieces = typeof entry === 'string' ? [entry] : Array.isArray(entry) ? entry : [];
  const pieces = [];
  for (const piece of rawPieces) {
    if (pieces.length >= LIMITS.PIECES_PER_LINE) break;
    if (typeof piece !== 'string') continue;
    // Text in one piece is capped at 47 bytes (UTF-8), the rest is dropped.
    const capped = capUtf8Bytes(piece, LIMITS.PIECE_BYTES);
    if (capped.length > 0) pieces.push(capped);
  }
  return pieces;
}

function capUtf8Bytes(str, maxBytes) {
  const buf = Buffer.from(str, 'utf8');
  if (buf.length <= maxBytes) return str;
  // Never split a multi-byte character: walk whole characters.
  let used = 0;
  let out = '';
  for (const ch of str) {
    const bytes = Buffer.byteLength(ch, 'utf8');
    if (used + bytes > maxBytes) break;
    used += bytes;
    out += ch;
  }
  return out;
}
