'use strict';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SkinLibrary, renderDeckFrame } from '../src/deck.js';
import { Player } from '../src/player.js';
import { backgroundAt } from '../src/background.js';

// In-memory fake SKINS folder: path -> file contents. Lets a test mutate a
// skin.json between selections to prove it is re-read from disk.
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

// Fake directory listing derived from the same in-memory tree.
function fakeList(tree) {
  return async (dir) => {
    const prefix = dir.replace(/\\/g, '/');
    const names = new Set();
    for (const key of Object.keys(tree)) {
      const rest = key.slice(prefix.length + 1);
      if (rest && !rest.includes('/')) names.add(rest);
      else if (rest) names.add(rest.slice(0, rest.indexOf('/')));
    }
    return [...names].map((name) => ({ name, isDirectory: () => true }));
  };
}

function makeLibrary(dir, tree) {
  return new SkinLibrary(dir, fakeFs(tree), fakeList(tree));
}

const multiColor = JSON.stringify({
  name: 'Cycler',
  background: { colors: ['#FF0000', '#00FF00', '#0000FF'], seconds: 6 },
});

test('A5 selecting a skin reads skin.json; switching away and back re-reads it', async () => {
  const dir = '/SKINS';
  const tree = {
    '/SKINS/A/skin.json': multiColor,
    '/SKINS/B/skin.json': JSON.stringify({ background: '#112233' }),
  };
  const lib = makeLibrary(dir, tree);
  await lib.discover();
  assert.deepEqual(lib.names, ['A', 'B']);

  await lib.select('A');
  assert.equal(lib.skin.background.kind, 'cycle');

  await lib.step('next'); // -> B, read from disk
  assert.equal(lib.selectedName, 'B');
  assert.equal(lib.skin.background.kind, 'flat');

  // Edit A's file while B is showing (simulates copying a changed skin.json).
  tree['/SKINS/A/skin.json'] = JSON.stringify({
    background: { colors: ['#000000', '#FFFFFF'], seconds: 2, blend: 'step' },
  });

  await lib.step('prev'); // -> A again: must re-read, picking up the edit
  assert.equal(lib.selectedName, 'A');
  assert.equal(lib.skin.background.blend, 'step');
  assert.equal(lib.skin.background.seconds, 2);
  assert.equal(lib.skin.background.colors.length, 2);
});

test('A5 new skin phase is computed from the current playback position, not zero', async () => {
  const dir = '/SKINS';
  const tree = {
    '/SKINS/A/skin.json': multiColor,
    '/SKINS/B/skin.json': JSON.stringify({
      background: { colors: ['#FFFFFF', '#000000'], seconds: 4 },
    }),
  };
  const lib = makeLibrary(dir, tree);
  await lib.discover();
  await lib.select('A');

  const player = new Player();
  player.play({ id: 't1', title: 'Song' }, 300);
  player.tick(9); // 9 seconds into the track
  const pos = player.snapshot().positionSeconds;
  assert.equal(pos, 9);

  // Switch to B: its first frame must already sit at the phase for 9s,
  // not at color zero.
  await lib.step('next');
  const frameB = renderDeckFrame(lib, player.snapshot());
  const expectedB = backgroundAt(lib.skin.background, player.snapshot());
  assert.deepEqual(frameB.background, expectedB);
  // 9s / 4s = segment 2, t 0.25 -> white/black cycle; definitely not pure white.
  assert.notDeepEqual(frameB.background, { r: 255, g: 255, b: 255 });

  // Switch back to A: same rule, phase continues from 9s.
  await lib.step('prev');
  const frameA = renderDeckFrame(lib, player.snapshot());
  assert.deepEqual(
    frameA.background,
    backgroundAt(lib.skin.background, { status: 'playing', positionSeconds: 9 }),
  );
});

test('A5 reload() re-reads the current skin from disk', async () => {
  const dir = '/SKINS';
  const tree = { '/SKINS/A/skin.json': multiColor };
  const lib = makeLibrary(dir, tree);
  await lib.discover();
  await lib.select('A');
  assert.equal(lib.skin.background.colors.length, 3);

  tree['/SKINS/A/skin.json'] = JSON.stringify({ background: '#ABCDEF' });
  await lib.reload();
  assert.deepEqual(lib.skin.background.color, { r: 0xab, g: 0xcd, b: 0xef });
});

test('broken skin.json still selects the skin with no text and black background', async () => {
  const dir = '/SKINS';
  const tree = { '/SKINS/A/skin.json': '{ not valid json,,,' };
  const lib = makeLibrary(dir, tree);
  await lib.discover();
  const skin = await lib.select('A');
  assert.equal(lib.selectedName, 'A'); // skin itself loads
  assert.equal(skin.validJson, false);
  assert.deepEqual(skin.areas, []);
  assert.deepEqual(skin.background.color, { r: 0, g: 0, b: 0 });

  const frame = renderDeckFrame(lib, {
    status: 'playing',
    positionSeconds: 5,
    track: null,
  });
  assert.deepEqual(frame.background, { r: 0, g: 0, b: 0 });
  assert.deepEqual(frame.areas, []);
});

test('missing skin.json means an empty skin, not a failed selection', async () => {
  const lib = new SkinLibrary('/SKINS', fakeFs({}));
  await lib.discover();
  // Simulate a folder existing on disk even though the fake readdir list is set.
  lib.names = ['PictureOnly'];
  lib.index = 0;
  const skin = await lib.reload();
  assert.equal(skin.validJson, false);
  assert.deepEqual(skin.background.color, { r: 0, g: 0, b: 0 });
});

test('frame rendering carries label areas untouched by background changes', async () => {
  const dir = '/SKINS';
  const tree = {
    '/SKINS/A/skin.json': JSON.stringify({
      background: { colors: ['#FF0000', '#00FF00'], seconds: 6 },
      defaults: { size: 14, align: 'left' },
      areas: [
        {
          rect: [91, 31, 263, 22],
          size: 11,
          align: 'center',
          lines: [['album', ': ', 'artist']],
        },
      ],
    }),
  };
  const lib = makeLibrary(dir, tree);
  await lib.discover();
  await lib.select('A');

  const frame = renderDeckFrame(lib, {
    status: 'playing',
    positionSeconds: 3,
    track: { title: 'T', artist: 'Band', album: 'Record' },
  });
  assert.equal(frame.areas.length, 1);
  assert.equal(frame.areas[0].rendered[0].text, 'Record: Band');
  // background still independently tracks the position
  assert.deepEqual(frame.background, { r: 127.5, g: 127.5, b: 0 });
});
