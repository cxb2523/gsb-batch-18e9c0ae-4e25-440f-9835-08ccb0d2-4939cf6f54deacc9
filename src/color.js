'use strict';

// Colors in TRAX skin.json are exactly "#RRGGBB": a hash and six hex digits,
// upper or lower case. Nothing else is a color (no #RGB, no names, no alpha).
// Anything that does not match is ignored by callers, as if it were not there.

const HEX_COLOR = /^#([0-9a-fA-F]{6})$/;

/**
 * Parse a "#RRGGBB" string into an {r, g, b} triple.
 * Returns null for anything that is not an exact six-digit hex color.
 * @param {unknown} value
 * @returns {{r:number,g:number,b:number}|null}
 */
export function parseColor(value) {
  if (typeof value !== 'string') return null;
  const m = HEX_COLOR.exec(value);
  if (!m) return null;
  const hex = m[1];
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

/** True only for an exact "#RRGGBB" string. */
export function isColor(value) {
  return parseColor(value) !== null;
}

/** Format an RGB triple back as an uppercase "#RRGGBB" string. */
export function formatColor({ r, g, b }) {
  const h = (n) => Math.round(clampByte(n)).toString(16).padStart(2, '0').toUpperCase();
  return `#${h(r)}${h(g)}${h(b)}`;
}

function clampByte(n) {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 255 ? 255 : n;
}

function mixChannel(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Linear interpolation between two parsed colors.
 * t === 0 gives a, t === 1 gives b.
 */
export function mixColors(a, b, t) {
  if (t <= 0) return { r: a.r, g: a.g, b: a.b };
  if (t >= 1) return { r: b.r, g: b.g, b: b.b };
  return {
    r: mixChannel(a.r, b.r, t),
    g: mixChannel(a.g, b.g, t),
    b: mixChannel(a.b, b.b, t),
  };
}

export const BLACK = Object.freeze({ r: 0, g: 0, b: 0 });
