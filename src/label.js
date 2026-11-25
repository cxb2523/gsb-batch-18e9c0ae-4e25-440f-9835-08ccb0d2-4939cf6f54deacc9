'use strict';

import { LIMITS } from './skin.js';

// Label text construction and fitting, per SKINS.html "lines and fields" and
// "How text is fitted". The background work deliberately does not touch any of
// this; it is implemented here so the reference engine covers a whole skin.
//
// Field words are replaced with track metadata; any other piece is literal
// text. Field names are lowercase and must match exactly.

const FIELDS = new Set(['title', 'artist', 'album', 'track', 'playlist']);

const AUTO_DARK = Object.freeze({ r: 0x20, g: 0x20, b: 0x20 }); // #202020
const AUTO_LIGHT = Object.freeze({ r: 0xf0, g: 0xf0, b: 0xf0 }); // #F0F0F0

/**
 * Turn one line's pieces into the string to print.
 *
 * Missing-field rules from the docs:
 *  - a field the track has nothing for is left out, along with any text that
 *    only existed to separate it;
 *  - text BETWEEN two fields is kept only when BOTH fields have something;
 *  - text BEFORE/AFTER all fields is kept only when the field beside it has
 *    something;
 *  - a line that ends up empty is skipped (returns '').
 */
export function buildLineText(pieces, track, queueInfo) {
  if (!Array.isArray(pieces) || pieces.length === 0) return '';

  // Resolve each piece: null = missing field, {field} = present field,
  // {literal} = printed-as-written text.
  const items = pieces.map((piece) => {
    if (FIELDS.has(piece)) {
      const value = resolveField(piece, track, queueInfo);
      if (value === null || value === undefined || value === '') return null;
      return { field: piece, text: String(value) };
    }
    return { literal: piece };
  });
  const isAliveField = (i) => items[i] !== null && items[i].field !== undefined;

  let out = '';
  for (let i = 0; i < pieces.length; i++) {
    const item = items[i];
    if (item === null) continue; // missing field drops out
    if (item.field) {
      out += item.text;
      continue;
    }

    // Literal piece: locate the nearest field on each side.
    let leftField = -1;
    for (let j = i - 1; j >= 0; j--) {
      if (FIELDS.has(pieces[j])) {
        leftField = j;
        break;
      }
    }
    let rightField = -1;
    for (let j = i + 1; j < pieces.length; j++) {
      if (FIELDS.has(pieces[j])) {
        rightField = j;
        break;
      }
    }

    if (leftField >= 0 && rightField >= 0) {
      // Between two fields: kept only when both have values.
      if (isAliveField(leftField) && isAliveField(rightField)) out += item.literal;
    } else if (leftField >= 0) {
      // Text after the last field: kept only if that field has a value.
      if (isAliveField(leftField)) out += item.literal;
    } else if (rightField >= 0) {
      // Text before the first field: kept only if that field has a value.
      if (isAliveField(rightField)) out += item.literal;
    } else {
      // A purely literal line (no fields) prints as-is.
      out += item.literal;
    }
  }
  return out;
}

function resolveField(name, track, queueInfo) {
  switch (name) {
    case 'title':
      return track?.title ?? null;
    case 'artist':
      return track?.artist ?? null;
    case 'album':
      return track?.album ?? null;
    case 'track':
      return queueInfo?.position ?? null; // e.g. "3/12"
    case 'playlist':
      return track?.album ?? track?.folder ?? null;
    default:
      return null;
  }
}

/**
 * Measure and fit all lines of an area into its rectangle.
 *
 * Layout (from the docs):
 *  - lines are stacked as a block in the vertical middle of the area,
 *    each `size + 2` pixels below the previous one;
 *  - a line that does not fit shrinks up to three times, each step 12%
 *    smaller (to about two thirds of size); if it still does not fit it is
 *    cut short with "...".
 *
 * @param {object} area parsed area
 * @param {string[]} lineTexts already-built strings (empty ones are skipped)
 * @param {(text:string, sizePx:number)=>number} measure width in pixels
 */
export function fitArea(area, lineTexts, measure) {
  const visible = lineTexts.filter((t) => t && t.length > 0);
  if (visible.length === 0) return { ...area, rendered: [] };

  const stepHeight = area.size + 2;
  const blockHeight = visible.length * area.size + (visible.length - 1) * 2;
  let y = area.rect.y + (area.rect.height - blockHeight) / 2;

  const rendered = visible.map((text) => {
    const fit = fitOneLine(text, area, measure);
    const line = {
      text: fit.text,
      size: fit.size,
      x: alignX(area.align, area.rect, fit.width),
      y,
      width: fit.width,
    };
    y += stepHeight;
    return line;
  });
  return { ...area, rendered };
}

function fitOneLine(text, area, measure) {
  let size = area.size;
  let width = measure(text, size);
  for (let step = 0; step < 3 && width > area.rect.width; step++) {
    size = size * 0.88; // each step 12% smaller; three times ~= 0.68x
    width = measure(text, size);
  }
  if (width <= area.rect.width) return { text, size, width };

  // Still too wide: cut short with "...". Binary-search the longest prefix
  // that fits at the smallest allowed size.
  const ellipsis = '...';
  if (measure(ellipsis, size) <= area.rect.width) {
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const candidate = text.slice(0, mid) + ellipsis;
      if (measure(candidate, size) <= area.rect.width) lo = mid;
      else hi = mid - 1;
    }
    const finalText = lo === 0 ? ellipsis : text.slice(0, lo) + ellipsis;
    return { text: finalText, size, width: measure(finalText, size) };
  }

  // The area is so narrow even "..." does not fit: keep as many whole
  // characters as fit without an ellipsis (empty if none fit).
  let kept = 0;
  while (kept < text.length && measure(text.slice(0, kept + 1), size) <= area.rect.width) {
    kept++;
  }
  const finalText = text.slice(0, kept);
  return { text: finalText, size, width: measure(finalText, size) };
}

function alignX(align, rect, width) {
  if (align === 'center') return rect.x + (rect.width - width) / 2;
  if (align === 'right') return rect.x + rect.width - width;
  return rect.x;
}

/**
 * Choose the automatic text color for an area whose skin sets none.
 * Looks at the opaque picture pixels inside the rect: light picture -> dark
 * gray text, dark picture -> near-white text.
 *
 * @param {() => {r:number,g:number,b:number}[]} samplePixels
 */
export function autoTextColor(samplePixels) {
  const pixels = samplePixels();
  if (!pixels || pixels.length === 0) return { ...AUTO_DARK };
  let total = 0;
  for (const p of pixels) {
    total += 0.299 * p.r + 0.587 * p.g + 0.114 * p.b; // Rec. 601 luminance
  }
  const mean = total / pixels.length;
  return mean >= 128 ? { ...AUTO_DARK } : { ...AUTO_LIGHT };
}

export { LIMITS };
