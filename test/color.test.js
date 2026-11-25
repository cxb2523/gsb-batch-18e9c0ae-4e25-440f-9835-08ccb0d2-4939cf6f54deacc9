'use strict';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseColor, isColor, formatColor, mixColors } from '../src/color.js';

test('parseColor accepts only exact #RRGGBB', () => {
  assert.deepEqual(parseColor('#000000'), { r: 0, g: 0, b: 0 });
  assert.deepEqual(parseColor('#ffffff'), { r: 255, g: 255, b: 255 });
  assert.deepEqual(parseColor('#AbC123'), { r: 0xab, g: 0xc1, b: 0x23 });
});

test('parseColor rejects short forms, names, alpha and junk', () => {
  for (const bad of ['#FFF', '#12345', '#1234567', 'white', '', null, 42, '#GGGGGG', '0B3A5C']) {
    assert.equal(parseColor(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
  assert.equal(isColor('#0B3A5C'), true);
  assert.equal(isColor('white'), false);
});

test('formatColor round-trips and clamps', () => {
  assert.equal(formatColor({ r: 11, g: 58, b: 92 }), '#0B3A5C');
  assert.equal(formatColor({ r: 300, g: -5, b: 12.4 }), '#FF000C');
});

test('mixColors interpolates linearly per channel', () => {
  const a = { r: 0, g: 0, b: 0 };
  const b = { r: 100, g: 200, b: 50 };
  assert.deepEqual(mixColors(a, b, 0), a);
  assert.deepEqual(mixColors(a, b, 1), b);
  assert.deepEqual(mixColors(a, b, 0.5), { r: 50, g: 100, b: 25 });
  assert.deepEqual(mixColors(a, b, 2), b); // clamps at ends
  assert.deepEqual(mixColors(a, b, -1), a);
});
