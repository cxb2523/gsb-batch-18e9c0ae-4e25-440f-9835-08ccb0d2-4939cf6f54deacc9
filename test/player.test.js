'use strict';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Player } from '../src/player.js';
import { backgroundAt } from '../src/background.js';
import { parseSkin } from '../src/skin.js';

const bg = parseSkin(
  JSON.stringify({ background: { colors: ['#FF0000', '#00FF00', '#0000FF'], seconds: 6 } }),
).background;

test('time advances only while playing; pause freezes position', () => {
  const p = new Player();
  p.play({ id: 't1', title: 'One' }, 120);
  p.tick(3);
  assert.equal(p.positionSeconds, 3);
  p.pause();
  p.tick(10); // wall time passes, music does not
  assert.equal(p.positionSeconds, 3);
  assert.equal(p.status, 'paused');
  // A2: while=playing, paused frame shows the first color even though
  // position 3 would otherwise sit mid-fade.
  assert.deepEqual(backgroundAt(bg, p.snapshot()), { r: 255, g: 0, b: 0 });
  p.resume();
  p.tick(3);
  assert.equal(p.positionSeconds, 6);
});

test('A3 new track resets position to zero, so phase restarts at first color', () => {
  const p = new Player();
  p.play({ id: 't1' }, 120);
  p.tick(15);
  assert.equal(p.positionSeconds, 15);
  p.play({ id: 't2' }, 120); // next track
  assert.equal(p.trackId, 't2');
  assert.equal(p.positionSeconds, 0);
  assert.equal(p.status, 'playing');
  assert.deepEqual(backgroundAt(bg, p.snapshot()), { r: 255, g: 0, b: 0 });
});

test('A4 seek changes position immediately and background follows on next read', () => {
  const p = new Player();
  p.play({ id: 't1' }, 200);
  p.tick(2);
  p.seek(16); // drag the scrub bar deep into the track
  assert.equal(p.positionSeconds, 16);
  const expected = backgroundAt(bg, { status: 'playing', positionSeconds: 16 });
  assert.deepEqual(backgroundAt(bg, p.snapshot()), expected);
  // no intermediate "catch up" frame: another natural tick simply continues
  p.tick(0.5);
  assert.deepEqual(
    backgroundAt(bg, p.snapshot()),
    backgroundAt(bg, { status: 'playing', positionSeconds: 16.5 }),
  );
});

test('seek clamps to duration; stop returns to zero', () => {
  const p = new Player();
  p.play({ id: 't1' }, 30);
  p.seek(999);
  assert.equal(p.positionSeconds, 30);
  p.stop();
  assert.equal(p.status, 'stopped');
  assert.equal(p.positionSeconds, 0);
  assert.deepEqual(backgroundAt(bg, p.snapshot()), { r: 255, g: 0, b: 0 });
});

test('end of track holds the final position instead of overflowing', () => {
  const p = new Player();
  p.play({ id: 't1' }, 10);
  p.tick(12);
  assert.equal(p.positionSeconds, 10);
  assert.equal(p.status, 'paused');
});

test('resume without a loaded track is a no-op', () => {
  const p = new Player();
  p.resume();
  assert.equal(p.status, 'stopped');
});
