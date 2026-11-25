'use strict';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLineText, fitArea, autoTextColor } from '../src/label.js';

const track = { title: 'T', artist: 'A', album: 'L', folder: 'Folder' };
const queue = { position: '3/12' };

test('A7 fields resolve and literal pieces print as written', () => {
  assert.equal(buildLineText(['title'], track, queue), 'T');
  assert.equal(buildLineText([['Side A · ', 'title']].flat(), track, queue), 'Side A · T');
  assert.equal(buildLineText(['track'], track, queue), '3/12');
  assert.equal(buildLineText(['playlist'], { folder: 'Folder' }, queue), 'Folder');
  assert.equal(buildLineText(['playlist'], { album: 'L' }, queue), 'L');
});

test('field names are case-sensitive: "Title" is literal text', () => {
  assert.equal(buildLineText(['Title'], track, queue), 'Title');
});

test('A7 separator between two fields kept only when both have values', () => {
  // album + ": " + artist, no artist -> just the album
  assert.equal(buildLineText(['album', ': ', 'artist'], { album: 'L' }, queue), 'L');
  // no album, artist present -> just the artist, colon dropped
  assert.equal(buildLineText(['album', ': ', 'artist'], { artist: 'A' }, queue), 'A');
  // both present
  assert.equal(buildLineText(['album', ': ', 'artist'], track, queue), 'L: A');
  // neither -> empty line (skipped by the renderer)
  assert.equal(buildLineText(['album', ': ', 'artist'], {}, queue), '');
});

test('A7 text before/after a field kept only when that field has a value', () => {
  assert.equal(buildLineText(['Side A · ', 'title'], { title: 'T' }, queue), 'Side A · T');
  assert.equal(buildLineText(['Side A · ', 'title'], {}, queue), '');
  assert.equal(buildLineText(['title', ' (end)'], { title: 'T' }, queue), 'T (end)');
  assert.equal(buildLineText(['title', ' (end)'], {}, queue), '');
});

test('purely literal lines print verbatim', () => {
  assert.equal(buildLineText(['SIDE A'], {}, queue), 'SIDE A');
});

test('A7 empty line is produced for missing-only field lines', () => {
  assert.equal(buildLineText(['artist', 'album'], {}, queue), '');
});

// A fixed-width fake font: each character is `sizePx * 0.6` px wide.
const measure = (text, size) => text.length * size * 0.6;

test('A7 lines are vertically centered and spaced size+2', () => {
  const area = {
    rect: { x: 0, y: 0, width: 500, height: 100 },
    size: 20,
    align: 'left',
    color: null,
  };
  const fitted = fitArea(area, ['one', 'two', ''], measure);
  assert.equal(fitted.rendered.length, 2); // empty line skipped
  const blockHeight = 2 * 20 + 2; // 42
  const top = (100 - blockHeight) / 2; // 29
  assert.equal(fitted.rendered[0].y, top);
  assert.equal(fitted.rendered[1].y, top + 22);
  assert.equal(fitted.rendered[0].x, 0);
});

test('A7 alignment positions lines across the area', () => {
  const area = {
    rect: { x: 10, y: 0, width: 100, height: 40 },
    size: 10,
    align: 'center',
    color: null,
  };
  // "abc" -> width 3 * 10 * .6 = 18
  const fitted = fitArea(area, ['abc'], measure);
  assert.equal(fitted.rendered[0].x, 10 + (100 - 18) / 2);

  const right = fitArea({ ...area, align: 'right' }, ['abc'], measure);
  assert.equal(right.rendered[0].x, 10 + 100 - 18);
});

test('A7 oversized text shrinks up to three 12% steps', () => {
  const area = {
    rect: { x: 0, y: 0, width: 30, height: 40 },
    size: 10, // 10 chars need 10*10*.6 = 60px at full size
    align: 'left',
    color: null,
  };
  const fitted = fitArea(area, ['0123456789'], measure);
  // After 3 shrinks size ~= 10 * .88^3 = 6.815; width ~= 40.9 still too wide...
  // check it either shrank or truncated, never overflowed.
  const line = fitted.rendered[0];
  assert.ok(line.size <= 10 * 0.88 ** 3 + 1e-9);
  assert.ok(line.width <= 30 + 1e-9);
});

test('A7 text that never fits is truncated with "..."', () => {
  const area = {
    rect: { x: 0, y: 0, width: 12, height: 40 }, // very narrow
    size: 10,
    align: 'left',
    color: null,
  };
  const fitted = fitArea(area, ['abcdefghij'], measure);
  const line = fitted.rendered[0];
  // Never overflows the area; truncated (ellipsis when it fits, otherwise a
  // bare prefix) and shorter than the original.
  assert.ok(line.width <= 12 + 1e-9);
  assert.ok(line.text.length < 'abcdefghij'.length);
  if (measure('...', line.size) <= 12) assert.ok(line.text.endsWith('...'));
});

test('truncation keeps the whole prefix that fits', () => {
  const area = {
    rect: { x: 0, y: 0, width: 100, height: 40 },
    size: 10,
    align: 'left',
    color: null,
  };
  // 30 chars at full size = 180px wide; no shrink needed beyond fitting.
  const fitted = fitArea(area, ['a'.repeat(30)], measure);
  const line = fitted.rendered[0];
  assert.ok(line.text.endsWith('...'));
  // The chosen prefix must fit and adding one more char would not.
  const prefixLen = line.text.length - 3;
  const size = line.size;
  assert.ok(measure('a'.repeat(prefixLen) + '...', size) <= 100 + 1e-9);
  assert.ok(measure('a'.repeat(prefixLen + 1) + '...', size) > 100 - 1e-9);
});

test('auto text color picks dark text on light picture and vice versa', () => {
  const light = () => [{ r: 240, g: 240, b: 240 }];
  const dark = () => [{ r: 10, g: 10, b: 10 }];
  assert.deepEqual(autoTextColor(light), { r: 0x20, g: 0x20, b: 0x20 });
  assert.deepEqual(autoTextColor(dark), { r: 0xf0, g: 0xf0, b: 0xf0 });
  assert.deepEqual(autoTextColor(() => []), { r: 0x20, g: 0x20, b: 0x20 });
});
