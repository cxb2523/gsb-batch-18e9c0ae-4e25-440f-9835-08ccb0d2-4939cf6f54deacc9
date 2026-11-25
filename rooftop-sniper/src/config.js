// Central tuning values. 1 world unit = 1 metre.
export const CONFIG = {
  missionTime: 180,          // seconds
  hostilesRequired: 5,
  maxCivilianHits: 2,        // this many civilian hits compromises the mission

  magSize: 5,
  reserveAmmo: 15,           // 20 rounds total
  reloadTime: 2.4,
  boltTime: 0.95,

  // Arcade ballistics: slow-ish bullet so drop is readable but forgiving.
  bulletSpeed: 700,          // m/s
  gravity: 9.81,
  windDriftFactor: 0.35,     // fraction of wind speed applied as lateral drift
  maxWind: 3.2,              // m/s

  roofHeight: 60,
  eyeHeight: 1.62,
  playerStart: { x: 0, z: -2.3 },
  moveBounds: { minX: -3.0, maxX: 3.9, minZ: -2.65, maxZ: -1.3 },
  moveSpeed: 1.8,

  baseFov: 62,
  zoomLevels: [4, 6, 8, 11],
  defaultZoom: 2,            // index into zoomLevels
  mouseSensitivity: 0.0021,
  yawLimit: 1.2,             // radians either side of forward
  pitchMin: -0.55,
  pitchMax: 0.35,

  hipSpread: 0.006,          // radians of random spread when firing unscoped
  swayAmplitude: 0.0017,     // radians of scope sway
  breathMax: 4.5,            // seconds Shift can steady the scope

  score: {
    hostile: 1000,
    headshot: 500,
    perMetre: 2,
    civilian: -1500,
    miss: -50,
    perSecondLeft: 10,
    accuracyBonus: 1500,     // scaled by accuracy on success
  },
};

export const drop = (d) => 0.5 * CONFIG.gravity * (d / CONFIG.bulletSpeed) ** 2;
export const flightTime = (d) => d / CONFIG.bulletSpeed;
export const drift = (d, wind) => wind * flightTime(d) * CONFIG.windDriftFactor;
