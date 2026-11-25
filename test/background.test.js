'use strict';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backgroundAt, cycleColor, backgroundHex } from '../src/background.js';
import { parseSkin } from '../src/skin.js';

const RED = { r: 255, g: 0, b: 0 };
const GREEN = { r: 0, g: 255, b: 0 };
const BLUE = { r: 0, g: 0, b: 255 };

function cycle(overrides = {}) {
  return parseSkin(
    JSON.stringify({
      background: {
        colors: ['#FF0000', '#00FF00', '#0000FF'],
        seconds: 6,
        ...overrides,
      },
    }),
  ).background;
}

const playing = (positionSeconds) => ({ status: 'playing', positionSeconds });

test('A1 fade: phase is playback position divided by seconds, interpolated between neighbors', () => {
  const bg = cycle(); // 3 colors, 6s each, fade
  // position 0 -> first color exactly
  assert.deepEqual(backgroundAt(bg, playing(0)), RED);
  // halfway through the first 6s segment -> 50% red->green
  assert.deepEqual(backgroundAt(bg, playing(3)), { r: 127.5, g: 127.5, b: 0 });
  // segment boundary -> exactly green
  assert.deepEqual(backgroundAt(bg, playing(6)), GREEN);
  // 25% into green->blue
  assert.deepEqual(backgroundAt(bg, playing(7.5)), { r: 0, g: 191.25, b: 63.75 });
  // second boundary -> blue
  assert.deepEqual(backgroundAt(bg, playing(12)), BLUE);
});

test('A1 fade wraps round again after the last color', () => {
  const bg = cycle();
  // at 18s the last segment (blue->red) completes -> back to red
  assert.deepEqual(backgroundAt(bg, playing(18)), RED);
  // one full cycle later is identical to the start
  assert.deepEqual(backgroundAt(bg, playing(18 + 3)), backgroundAt(bg, playing(3)));
  // mid wrap segment blue->red
  assert.deepEqual(backgroundAt(bg, playing(15)), { r: 127.5, g: 0, b: 127.5 });
});

test('cycleColor is a pure function of position: no wall-clock state', () => {
  const bg = cycle();
  // Asking twice at the same position must give the same answer regardless of
  // anything that happened in between (pause, delay, seek).
  const first = backgroundAt(bg, playing(4.2));
  const firstHex = backgroundHex(bg, playing(4.2));
  assert.deepEqual(backgroundAt(bg, playing(4.2)), first);
  assert.equal(backgroundHex(bg, playing(4.2)), firstHex);
});

test('step blend holds the current color for the whole segment', () => {
  const bg = cycle({ blend: 'step' });
  assert.deepEqual(backgroundAt(bg, playing(0)), RED);
  assert.deepEqual(backgroundAt(bg, playing(5.999)), RED);
  assert.deepEqual(backgroundAt(bg, playing(6)), GREEN); // changes all at once
  assert.deepEqual(backgroundAt(bg, playing(11.999)), GREEN);
  assert.deepEqual(backgroundAt(bg, playing(12)), BLUE);
  assert.deepEqual(backgroundAt(bg, playing(17.999)), BLUE);
  assert.deepEqual(backgroundAt(bg, playing(18)), RED); // wraps
});

test('A2 while=playing (default): pause or stop shows the first color immediately', () => {
  const bg = cycle();
  // Reached deep into the cycle while playing...
  const mid = playing(10); // between green and blue
  assert.notDeepEqual(backgroundAt(bg, mid), RED);
  // ...pausing snaps to the first color on the next frame, no delay.
  assert.deepEqual(backgroundAt(bg, { status: 'paused', positionSeconds: 10 }), RED);
  assert.deepEqual(backgroundAt(bg, { status: 'stopped', positionSeconds: 10 }), RED);
  // Resume from the same position continues from the color that position maps to.
  assert.deepEqual(backgroundAt(bg, playing(10)), cycleColor(bg.colors, 6, 'fade', 10));
});

test('A2 while=always: pause or stop keeps the color reached at that position', () => {
  const bg = cycle({ while: 'always' });
  const pos = 9; // 50% through green->blue
  const reached = backgroundAt(bg, playing(pos));
  assert.deepEqual(backgroundAt(bg, { status: 'paused', positionSeconds: pos }), reached);
  assert.deepEqual(backgroundAt(bg, { status: 'stopped', positionSeconds: pos }), reached);
  // And it stays there: position doesn't move while paused, so a later frame
  // resolves to the identical color rather than advancing on a clock.
  assert.deepEqual(backgroundAt(bg, { status: 'paused', positionSeconds: pos }), reached);
});

test('A3 track change restarts the cycle at the first color', () => {
  const bg = cycle();
  // Old track deep in its cycle.
  const oldTrack = { status: 'playing', positionSeconds: 14.5, trackId: 'A' };
  assert.notDeepEqual(backgroundAt(bg, oldTrack), RED);
  // The player starts every new track at position 0 -> first color, both modes.
  const newTrack = { status: 'playing', positionSeconds: 0, trackId: 'B' };
  assert.deepEqual(backgroundAt(bg, newTrack), RED);
  const always = cycle({ while: 'always' });
  assert.deepEqual(backgroundAt(always, newTrack), RED);
});

test('A4 scrub: the phase jumps to the new position immediately', () => {
  const bg = cycle();
  // Drag the bar from 2s straight to 16s: the very next frame must already
  // show the color for 16s (2/3 through blue->red), not wait for a tick.
  const before = backgroundAt(bg, playing(2));
  const afterSeek = backgroundAt(bg, playing(16));
  assert.ok(Math.abs(afterSeek.r - 170) < 1e-9);
  assert.equal(afterSeek.g, 0);
  assert.ok(Math.abs(afterSeek.b - 85) < 1e-9);
  assert.notDeepEqual(afterSeek, before);
  // Scrubbing backwards works too, with exact values at the 50% point.
  assert.deepEqual(backgroundAt(bg, playing(1)), backgroundAt(bg, playing(1)));
  assert.deepEqual(backgroundAt(bg, playing(0.5)), { r: 233.75, g: 21.25, b: 0 });
});

test('A4 scrub while paused with while=playing still shows first color', () => {
  const bg = cycle();
  // Seeking while paused does not animate: playing-mode always shows first.
  assert.deepEqual(backgroundAt(bg, { status: 'paused', positionSeconds: 16 }), RED);
});

test('flat backgrounds ignore playback entirely', () => {
  const flat = parseSkin(JSON.stringify({ background: '#0B3A5C' })).background;
  const expected = { r: 11, g: 58, b: 92 };
  assert.deepEqual(backgroundAt(flat, playing(99)), expected);
  assert.deepEqual(backgroundAt(flat, { status: 'paused', positionSeconds: 99 }), expected);
  assert.deepEqual(backgroundAt(flat, { status: 'stopped', positionSeconds: 0 }), expected);
});

test('missing/black background renders black in every state', () => {
  const none = parseSkin(JSON.stringify({})).background;
  for (const pb of [playing(5), { status: 'paused', positionSeconds: 5 }, { status: 'stopped' }]) {
    assert.deepEqual(backgroundAt(none, pb), { r: 0, g: 0, b: 0 });
  }
});

test('seconds other than 6 change phase scaling', () => {
  const bg = cycle({ seconds: 2 });
  // 1s into a 2s segment -> halfway red->green
  assert.deepEqual(backgroundAt(bg, playing(1)), { r: 127.5, g: 127.5, b: 0 });
  assert.deepEqual(backgroundAt(bg, playing(2)), GREEN);
});

test('negative or non-finite positions are treated as zero', () => {
  const bg = cycle();
  assert.deepEqual(backgroundAt(bg, playing(-5)), RED);
  assert.deepEqual(backgroundAt(bg, { status: 'playing', positionSeconds: NaN }), RED);
});
