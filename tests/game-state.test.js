import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HIT_RESULT,
  MAX_SHIELDS,
  STORAGE_KEYS,
  clearRunCollections,
  collectCoin,
  collectShield,
  createRunState,
  loadArchive,
  persistArchive,
  recordScore,
  resetRun,
  resolveObstacleHit,
} from '../game-state.js';

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    dump: () => Object.fromEntries(map),
  };
}

test('coin pickup is persisted immediately, before game over', () => {
  const storage = makeStorage({ [STORAGE_KEYS.coins]: '7', [STORAGE_KEYS.best]: '120' });
  const archive = loadArchive(storage);
  const run = createRunState();

  collectCoin(run, archive, storage);

  assert.equal(run.sessionCoins, 1);
  assert.equal(archive.coins, 8);
  assert.equal(storage.getItem(STORAGE_KEYS.coins), '8');
  // Refresh simulation: a brand-new page load sees the coin that was picked up.
  assert.equal(loadArchive(storage).coins, 8);
});

test('restart clears the run layer but keeps archived coins and best score', () => {
  const storage = makeStorage({ [STORAGE_KEYS.coins]: '5', [STORAGE_KEYS.best]: '900' });
  const archive = loadArchive(storage);
  const run = createRunState();

  run.score = 432;
  run.combo = 6;
  run.shield = 2;
  run.lane = 0;
  run.sliding = true;
  collectCoin(run, archive, storage);
  collectCoin(run, archive, storage);

  resetRun(run);

  assert.equal(run.sessionCoins, 0);
  assert.equal(run.score, 0);
  assert.equal(run.combo, 1);
  assert.equal(run.shield, 0);
  assert.equal(run.lane, 1);
  assert.equal(run.sliding, false);
  assert.equal(run.running, true);
  assert.equal(run.over, false);
  // Archived layer untouched by the restart.
  assert.equal(archive.coins, 7);
  assert.equal(archive.best, 900);
  assert.equal(storage.getItem(STORAGE_KEYS.coins), '7');
});

test('resetRun also clears leftover timers and jump/slide state', () => {
  const run = createRunState();
  Object.assign(run, {
    paused: true,
    over: true,
    targetX: -3.1,
    comboTimer: 2.4,
    speed: 41,
    spawnTimer: 0.1,
    coinTimer: 0.1,
    islandTimer: 0.1,
    elapsed: 99,
    jumpVelocity: -12,
    slideTimer: 0.4,
    landedTimer: 0.1,
  });

  resetRun(run);

  for (const key of ['comboTimer', 'spawnTimer', 'coinTimer', 'islandTimer', 'elapsed', 'jumpVelocity', 'slideTimer', 'landedTimer']) {
    assert.equal(run[key], key === 'spawnTimer' ? 0.3 : key === 'coinTimer' ? 0.6 : key === 'islandTimer' ? 1 : 0, key);
  }
  assert.equal(run.speed, 17);
  assert.equal(run.targetX, 0);
  assert.equal(run.paused, false);
  assert.equal(run.over, false);
});

test('shield absorbs the first hit, resets combo, and the next hit ends the run', () => {
  const run = createRunState();
  run.combo = 5;
  run.comboTimer = 2;
  collectShield(run);
  assert.equal(run.shield, 1);

  assert.equal(resolveObstacleHit(run), HIT_RESULT.ABSORBED);
  assert.equal(run.shield, 0);
  assert.equal(run.combo, 1);
  assert.equal(run.comboTimer, 0);

  assert.equal(resolveObstacleHit(run), HIT_RESULT.GAME_OVER);
  assert.equal(run.shield, 0);
});

test('shields stack but cap at MAX_SHIELDS', () => {
  const run = createRunState();
  for (let i = 0; i < 6; i += 1) collectShield(run);
  assert.equal(run.shield, MAX_SHIELDS);
});

test('multiple shields absorb one hit each', () => {
  const run = createRunState();
  collectShield(run);
  collectShield(run);

  assert.equal(resolveObstacleHit(run), HIT_RESULT.ABSORBED);
  assert.equal(resolveObstacleHit(run), HIT_RESULT.ABSORBED);
  assert.equal(run.shield, 0);
  assert.equal(resolveObstacleHit(run), HIT_RESULT.GAME_OVER);
});

test('best score only moves upward and is persisted on game over', () => {
  const storage = makeStorage({ [STORAGE_KEYS.best]: '500' });
  const archive = loadArchive(storage);

  assert.equal(recordScore(archive, 300, storage), 500);
  assert.equal(storage.getItem(STORAGE_KEYS.best), '500');

  assert.equal(recordScore(archive, 812.7, storage), 812);
  assert.equal(storage.getItem(STORAGE_KEYS.best), '812');
});

test('corrupt or missing storage values fall back to zero', () => {
  const archive = loadArchive(makeStorage({ [STORAGE_KEYS.coins]: 'nope', [STORAGE_KEYS.best]: '' }));
  assert.deepEqual(archive, { best: 0, coins: 0 });
  assert.deepEqual(loadArchive(undefined), { best: 0, coins: 0 });
});

test('storage failures do not lose in-memory progress', () => {
  const broken = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  const archive = loadArchive(broken);
  assert.deepEqual(archive, { best: 0, coins: 0 });
  const run = createRunState();
  collectCoin(run, archive, broken);
  assert.equal(run.sessionCoins, 1);
  assert.equal(archive.coins, 1);
  persistArchive(archive, broken);
});

test('clearRunCollections removes every tracked scene object and empties the arrays', () => {
  const collections = {
    obstacles: [{ mesh: 'o1' }, { mesh: 'o2' }],
    pickups: [{ mesh: 'p1' }],
    particles: [{ mesh: 'x1' }, { mesh: 'x2' }, { mesh: 'x3' }],
    islands: [{ mesh: 'i1' }],
  };
  const removed = [];

  clearRunCollections(collections, (item, kind) => removed.push([kind, item.mesh]));

  assert.deepEqual(removed.sort(), [
    ['islands', 'i1'],
    ['obstacles', 'o1'],
    ['obstacles', 'o2'],
    ['particles', 'x1'],
    ['particles', 'x2'],
    ['particles', 'x3'],
    ['pickups', 'p1'],
  ]);
  assert.equal(collections.obstacles.length, 0);
  assert.equal(collections.pickups.length, 0);
  assert.equal(collections.particles.length, 0);
  assert.equal(collections.islands.length, 0);
});

test('a full loop: pick up, restart, pick up again, refresh', () => {
  const storage = makeStorage();
  let archive = loadArchive(storage);
  const run = createRunState();

  collectCoin(run, archive, storage);
  collectCoin(run, archive, storage);
  assert.equal(storage.getItem(STORAGE_KEYS.coins), '2');

  // Restart mid-run (no game over): coins already banked must stay.
  resetRun(run);
  assert.equal(run.sessionCoins, 0);
  assert.equal(storage.getItem(STORAGE_KEYS.coins), '2');

  collectCoin(run, archive, storage);
  assert.equal(storage.getItem(STORAGE_KEYS.coins), '3');

  // Refresh: archive is rebuilt from storage and keeps all three coins.
  archive = loadArchive(storage);
  assert.equal(archive.coins, 3);
});
