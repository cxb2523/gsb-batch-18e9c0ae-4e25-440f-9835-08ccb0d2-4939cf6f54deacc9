'use strict';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../src/index.js';

test('public API surface exports every engine piece', () => {
  for (const name of [
    'parseColor', 'isColor', 'formatColor', 'mixColors',
    'parseSkin', 'parseColorList', 'emptySkin', 'LIMITS',
    'backgroundAt', 'cycleColor', 'backgroundHex',
    'Player',
    'buildLineText', 'fitArea', 'autoTextColor',
    'SkinLibrary', 'renderDeckFrame',
  ]) {
    assert.ok(name in api, `missing export: ${name}`);
  }
});
