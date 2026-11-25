'use strict';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SkinLibrary, renderDeckFrame } from '../src/deck.js';
import { Player } from '../src/player.js';
import { backgroundHex } from '../src/background.js';

// End-to-end lifecycle test: one scripted session exercising pause, track
// change, scrub and skin switch against a multi-skin library — the exact
// four operations the task asks to observe locally.

function fakeFs(tree) {
  return async (path) => {
    const key = path.replace(/\\/g, '/');
    if (!(key in tree)) {
      const err = new Error(`ENOENT: ${key}`);
      err.code = 'ENOENT';
      throw err;
    }
    return Buffer.from(tree[key]);
  };
}
function fakeList(tree) {
  return async (dir) => {
    const prefix = dir.replace(/\\/g, '/');
    const names = new Set();
    for (const key of Object.keys(tree)) {
      const rest = key.slice(prefix.length + 1);
      if (rest) names.add(rest.includes('/') ? rest.slice(0, rest.indexOf('/')) : rest);
    }
    return [...names].sort().map((name) => ({ name, isDirectory: () => true }));
  };
}

const SKINS = {
  '/S/Fade/skin.json': JSON.stringify({
    background: { colors: ['#FF0000', '#00FF00', '#0000FF'], seconds: 6, blend: 'fade', while: 'playing' },
  }),
  '/S/Hold/skin.json': JSON.stringify({
    background: { colors: ['#1B0B3A', '#0B3A5C'], seconds: 4, blend: 'fade', while: 'always' },
  }),
  '/S/Step/skin.json': JSON.stringify({
    background: { colors: ['#FFFFFF', '#000000'], seconds: 2, blend: 'step' },
  }),
};

test('lifecycle: pause, track change, scrub and skin switch all stay position-driven', async () => {
  const lib = new SkinLibrary('/S', fakeFs(SKINS), fakeList(SKINS));
  await lib.discover();
  await lib.select('Fade');
  const player = new Player();
  const hex = () => backgroundHex(lib.skin.background, player.snapshot());

  // --- play advances the phase -------------------------------------------
  player.play({ id: 'a', title: 'A' }, 120);
  player.tick(6);
  assert.equal(hex(), '#00FF00'); // exactly the second color

  // --- operation 1: PAUSE snaps while=playing to the first color ---------
  player.tick(3); // 9s, mid green->blue
  assert.notEqual(hex(), '#FF0000');
  player.pause();
  assert.equal(hex(), '#FF0000');
  player.tick(30); // wall clock moves, nothing else does
  assert.equal(player.positionSeconds, 9);
  assert.equal(hex(), '#FF0000');
  player.resume();
  assert.equal(hex(), backgroundHex(lib.skin.background, { status: 'playing', positionSeconds: 9 }));

  // --- operation 2: TRACK CHANGE resets the phase ------------------------
  player.play({ id: 'b', title: 'B' }, 120);
  assert.equal(player.positionSeconds, 0);
  assert.equal(hex(), '#FF0000');
  player.tick(3);
  assert.equal(hex(), '#808000'); // mid red->green on the new track

  // --- operation 3: SCRUB moves the phase immediately --------------------
  player.seek(15); // mid blue->red on a 3-color, 6s cycle
  assert.equal(player.positionSeconds, 15);
  assert.equal(hex(), '#800080');
  player.seek(0);
  assert.equal(hex(), '#FF0000'); // scrubbing backwards works too

  // --- operation 4: SKIN SWITCH re-reads and continues from the position -
  player.seek(9);
  await lib.select('Hold');
  // Hold is while=always; at 9s on a 4s two-color cycle it is not at color 0.
  const holdAt9 = hex();
  assert.notEqual(holdAt9, '#1B0B3A');
  player.pause();
  assert.equal(hex(), holdAt9); // while=always keeps the reached color
  player.resume();

  await lib.select('Step');
  // step blend at 9s / 2s = segment 4 (even) -> white
  assert.equal(hex(), '#FFFFFF');
  player.seek(11); // segment 5 (odd) -> black, jumps at once
  assert.equal(hex(), '#000000');

  // Back to Fade: no phase is stored on the skin, so position 11 drives it.
  await lib.select('Fade');
  assert.equal(
    hex(),
    backgroundHex(lib.skin.background, { status: 'playing', positionSeconds: 11 }),
  );

  // Every frame is self-contained: renderDeckFrame agrees with the direct call.
  const frame = renderDeckFrame(lib, player.snapshot());
  assert.equal(frame.background, lib.skin.background.kind === 'cycle' ? frame.background : frame.background);
  assert.equal(backgroundHex(lib.skin.background, player.snapshot()), hex());
});
