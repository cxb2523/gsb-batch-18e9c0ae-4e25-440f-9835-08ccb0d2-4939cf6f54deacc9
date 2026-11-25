'use strict';

import { mixColors, formatColor, BLACK } from './color.js';

// Background cycle whose phase is derived purely from the playback position.
//
// The old engine advanced the cycle from a wall clock: it kept moving while
// paused, did not reset on a new track, and stayed wrong after a scrub until
// the next natural tick happened to catch up. This engine holds no time state
// of its own. Every render asks "which color corresponds to THIS playback
// position, RIGHT NOW", so pause, track change, scrub and skin switch are all
// correct on the very next frame with no correction step.
//
// Playback state handed in each frame:
//   {
//     status: 'playing' | 'paused' | 'stopped',
//     positionSeconds: number   // current position inside the track, >= 0
//   }
// The player resets positionSeconds to 0 when a new track starts, which is
// what makes "each track starts the cycle again" fall out for free.

/**
 * Resolve the background color for one frame.
 *
 * @param {object} background parsed background (from skin.js)
 * @param {{status:string, positionSeconds:number}} playback
 * @returns {{r:number,g:number,b:number}}
 */
export function backgroundAt(background, playback) {
  if (!background || background.kind === 'flat') {
    return background?.color ? { ...background.color } : { ...BLACK };
  }

  const { colors, seconds, blend, while: hold } = background;
  const status = playback?.status ?? 'stopped';
  const position = Math.max(0, Number(playback?.positionSeconds) || 0);

  if (status !== 'playing') {
    if (hold === 'always') {
      // Freeze on the color the cycle had reached at the last playing
      // position. The position itself does not move while paused/stopped, so
      // evaluating at that same position gives exactly that color.
      return cycleColor(colors, seconds, blend, position);
    }
    // while === 'playing': first color whenever paused or stopped.
    return { ...colors[0] };
  }

  return cycleColor(colors, seconds, blend, position);
}

/**
 * Color at a given playback position inside a cycling background.
 *
 * Phase = positionSeconds / seconds. The integer part selects the segment
 * (color i -> color i+1, wrapping back to color 0 after the last), and the
 * fractional part is how far through that segment we are.
 */
export function cycleColor(colors, seconds, blend, positionSeconds) {
  const n = colors.length;
  const phase = positionSeconds / seconds; // total cycles progress
  const segment = Math.floor(phase);
  const t = phase - segment; // 0..1 within the current segment
  const from = colors[segment % n];
  const to = colors[(segment + 1) % n];

  if (blend === 'step') {
    // Step changes all at once: hold the current color for the whole segment.
    return { ...from };
  }
  return mixColors(from, to, t);
}

/** Convenience wrapper returning the "#RRGGBB" string used by renderers. */
export function backgroundHex(background, playback) {
  return formatColor(backgroundAt(background, playback));
}
