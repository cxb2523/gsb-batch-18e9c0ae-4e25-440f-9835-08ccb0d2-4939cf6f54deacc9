'use strict';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSkin, parseColorList, emptySkin, LIMITS } from '../src/skin.js';

test('invalid JSON still loads: no text, black background (A6)', () => {
  const skin = parseSkin('{ "background": { "colors": [');
  assert.equal(skin.validJson, false);
  assert.deepEqual(skin.areas, []);
  assert.deepEqual(skin.background, { kind: 'flat', color: { r: 0, g: 0, b: 0 } });
});

test('missing file content and non-object JSON yield the empty skin', () => {
  assert.deepEqual(parseSkin(null), emptySkin());
  assert.equal(parseSkin('[]').validJson, false);
  assert.equal(parseSkin('"just a string"').validJson, false);
  assert.equal(parseSkin('123').validJson, false);
});

test('flat background: single valid color string', () => {
  const skin = parseSkin(JSON.stringify({ background: '#0B3A5C' }));
  assert.deepEqual(skin.background, { kind: 'flat', color: { r: 11, g: 58, b: 92 } });
});

test('flat background with an illegal color string falls back to black', () => {
  const skin = parseSkin(JSON.stringify({ background: 'white' }));
  assert.deepEqual(skin.background.color, { r: 0, g: 0, b: 0 });
});

test('cycle defaults: seconds 6, blend fade, while playing', () => {
  const skin = parseSkin(
    JSON.stringify({ background: { colors: ['#FF0000', '#00FF00', '#0000FF'] } }),
  );
  assert.equal(skin.background.kind, 'cycle');
  assert.equal(skin.background.seconds, 6);
  assert.equal(skin.background.blend, 'fade');
  assert.equal(skin.background.while, 'playing');
  assert.equal(skin.background.colors.length, 3);
});

test('explicit blend/while values and illegal ones fall back to defaults', () => {
  const skin = parseSkin(
    JSON.stringify({
      background: { colors: ['#FF0000', '#00FF00'], blend: 'step', while: 'always' },
    }),
  );
  assert.equal(skin.background.blend, 'step');
  assert.equal(skin.background.while, 'always');

  const skin2 = parseSkin(
    JSON.stringify({
      background: { colors: ['#FF0000', '#00FF00'], blend: 'crossfade', while: 'forever' },
    }),
  );
  assert.equal(skin2.background.blend, 'fade');
  assert.equal(skin2.background.while, 'playing');
});

test('seconds are clamped to 1..3600, garbage becomes 6', () => {
  const mk = (seconds) =>
    parseSkin(JSON.stringify({ background: { colors: ['#000000', '#FFFFFF'], seconds } }))
      .background.seconds;
  assert.equal(mk(1), 1);
  assert.equal(mk(3600), 3600);
  assert.equal(mk(0), 6);
  assert.equal(mk(3601), 6);
  assert.equal(mk(-3), 6);
  assert.equal(mk('6'), 6);
  assert.equal(mk(NaN), 6);
  assert.equal(mk(Infinity), 6);
});

test('illegal colors are ignored as if absent (A6)', () => {
  assert.deepEqual(parseColorList(['#FFF', 'white', '#12G456', '#00FF00']), [
    { r: 0, g: 255, b: 0 },
  ]);
  // all illegal -> no usable colors -> black flat background
  const skin = parseSkin(
    JSON.stringify({ background: { colors: ['#FFF', 'nope'], seconds: 4 } }),
  );
  assert.equal(skin.background.kind, 'flat');
  assert.deepEqual(skin.background.color, { r: 0, g: 0, b: 0 });
  // one surviving color becomes a flat background
  const one = parseSkin(JSON.stringify({ background: { colors: ['bogus', '#112233'] } }));
  assert.deepEqual(one.background, { kind: 'flat', color: { r: 17, g: 34, b: 51 } });
});

test('at most six background colors, the rest ignored', () => {
  const colors = Array.from({ length: 9 }, (_, i) => `#00000${i}`);
  const skin = parseSkin(JSON.stringify({ background: { colors } }));
  assert.equal(skin.background.colors.length, LIMITS.BACKGROUND_COLORS);
});

test('limits: 8 areas, 4 lines, 6 pieces, 47-byte pieces', () => {
  const areas = Array.from({ length: 10 }, () => ({
    rect: [0, 0, 100, 40],
    lines: Array.from({ length: 6 }, () =>
      Array.from({ length: 8 }, () => 'x'),
    ),
  }));
  const skin = parseSkin(JSON.stringify({ areas }));
  assert.equal(skin.areas.length, LIMITS.AREAS);
  assert.equal(skin.areas[0].lines.length, LIMITS.LINES_PER_AREA);
  assert.equal(skin.areas[0].lines[0].length, LIMITS.PIECES_PER_LINE);

  const longAscii = 'a'.repeat(60);
  const skin2 = parseSkin(
    JSON.stringify({ areas: [{ rect: [0, 0, 200, 40], lines: [[longAscii]] }] }),
  );
  assert.equal(Buffer.byteLength(skin2.areas[0].lines[0][0], 'utf8'), LIMITS.PIECE_BYTES);
});

test('multi-byte piece cap never splits a character', () => {
  // Each kanji is 3 UTF-8 bytes; 47 bytes holds 15 whole characters (45 bytes).
  const piece = '字'.repeat(20);
  const skin = parseSkin(
    JSON.stringify({ areas: [{ rect: [0, 0, 200, 40], lines: [[piece]] }] }),
  );
  assert.equal(skin.areas[0].lines[0][0], '字'.repeat(15));
});

test('areas with no width/height are skipped; unknown keys ignored', () => {
  const skin = parseSkin(
    JSON.stringify({
      mystery: 1,
      areas: [
        { rect: [0, 0, 0, 40], lines: [['title']] },
        { rect: [0, 0, 100, 0] },
        { rect: [5, 6, 100, 40], lines: [['title']], size: 12, align: 'center' },
      ],
    }),
  );
  assert.equal(skin.areas.length, 1);
  assert.deepEqual(skin.areas[0].rect, { x: 5, y: 6, width: 100, height: 40 });
  assert.equal(skin.areas[0].size, 12);
  assert.equal(skin.areas[0].align, 'center');
});

test('defaults propagate to areas; bad align means left', () => {
  const skin = parseSkin(
    JSON.stringify({
      defaults: { size: 18, align: 'right', color: '#202020', rect: [1, 2, 3, 4] },
      areas: [{ rect: [0, 0, 100, 40], align: 'sideways' }],
    }),
  );
  assert.equal(skin.areas[0].size, 18); // inherited
  assert.equal(skin.areas[0].align, 'left'); // illegal explicit value
  assert.deepEqual(skin.areas[0].color, { r: 32, g: 32, b: 32 });
});

test('string line form and area without lines', () => {
  const skin = parseSkin(
    JSON.stringify({ areas: [{ rect: [0, 0, 100, 40], lines: ['title', ['artist']] }] }),
  );
  assert.deepEqual(skin.areas[0].lines[0], ['title']);
  assert.deepEqual(skin.areas[0].lines[1], ['artist']);

  const noLines = parseSkin(JSON.stringify({ areas: [{ rect: [0, 0, 100, 40] }] }));
  assert.deepEqual(noLines.areas[0].lines, []);
});
