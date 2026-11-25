// Pure run/archive state helpers shared by the game and its tests.
// No Three.js or DOM imports here so this module can be exercised with Node.

export const STORAGE_KEYS = Object.freeze({
  best: 'void-runner-best',
  coins: 'void-runner-coins',
});

export const HIT_RESULT = Object.freeze({
  ABSORBED: 'absorbed',
  GAME_OVER: 'game-over',
});

export const MAX_SHIELDS = 3;

function toSafeCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

// Fresh per-run state. Everything that must be reset on restart lives here;
// the historical archive (best score + total coins) deliberately does not.
export function createRunState() {
  return {
    lane: 1,
    targetX: 0,
    score: 0,
    combo: 1,
    comboTimer: 0,
    shield: 0,
    speed: 17,
    spawnTimer: 0.3,
    coinTimer: 0.6,
    islandTimer: 1,
    elapsed: 0,
    jumpVelocity: 0,
    sliding: false,
    slideTimer: 0,
    landedTimer: 0,
    sessionCoins: 0,
  };
}

// Transition an existing state object into a brand-new run. Used by the
// Restart button, the `R` key, and the Start Run action.
export function resetRun(target = {}) {
  return Object.assign(target, createRunState(), {
    running: true,
    paused: false,
    over: false,
  });
}

function readCount(storage, key) {
  try {
    return toSafeCount(storage?.getItem(key));
  } catch {
    return 0;
  }
}

// Historical archive, loaded on page boot. Survives restarts and refreshes.
export function loadArchive(storage) {
  return {
    best: readCount(storage, STORAGE_KEYS.best),
    coins: readCount(storage, STORAGE_KEYS.coins),
  };
}

export function persistArchive(archive, storage) {
  if (!archive) return archive;
  archive.best = toSafeCount(archive.best);
  archive.coins = toSafeCount(archive.coins);
  if (!storage) return archive;
  try {
    storage.setItem(STORAGE_KEYS.best, String(archive.best));
    storage.setItem(STORAGE_KEYS.coins, String(archive.coins));
  } catch {
    // Storage can be unavailable (private mode, quota); keep in-memory values.
  }
  return archive;
}

// Pickup persistence: bump both layers and write the archive immediately so a
// mid-run restart or refresh can never drop a coin that was already collected.
export function collectCoin(run, archive, storage) {
  run.sessionCoins += 1;
  archive.coins += 1;
  persistArchive(archive, storage);
  return run.sessionCoins;
}

export function collectShield(run) {
  run.shield = Math.min(MAX_SHIELDS, run.shield + 1);
  return run.shield;
}

// Shield is consumed first; only an unshielded collision ends the run.
export function resolveObstacleHit(run) {
  if (run.shield > 0) {
    run.shield -= 1;
    run.combo = 1;
    run.comboTimer = 0;
    return HIT_RESULT.ABSORBED;
  }
  return HIT_RESULT.GAME_OVER;
}

export function recordScore(archive, score, storage) {
  archive.best = Math.max(toSafeCount(archive.best), toSafeCount(score));
  persistArchive(archive, storage);
  return archive.best;
}

// Remove every tracked scene object for a run and empty the tracking arrays.
// `onRemove(item, kind)` is expected to detach/dispose the mesh; the helper
// itself stays renderer-agnostic so the restart path is unit-testable.
export function clearRunCollections(collections, onRemove) {
  const groups = {
    obstacles: collections.obstacles,
    pickups: collections.pickups,
    particles: collections.particles,
    islands: collections.islands,
  };
  for (const [kind, items] of Object.entries(groups)) {
    if (!items) continue;
    for (const item of items) onRemove?.(item, kind);
    items.length = 0;
  }
}
