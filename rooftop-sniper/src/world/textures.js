import * as THREE from 'three';

// Deterministic PRNG so the city layout is identical every run.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(c, { srgb = true, repeat = true } = {}) {
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// One facade tile = 4 windows wide x 4 floors tall (covers 14 m x 14 m).
// Returns a colour map plus an emissive map holding only the lit windows.
export function createFacadeTexture(seed, litRatio = 0.3) {
  const rng = mulberry32(seed);
  const S = 256;
  const cell = S / 4;
  const color = canvas(S, S);
  const glow = canvas(S, S);
  const cg = color.getContext('2d');
  const gg = glow.getContext('2d');

  cg.fillStyle = '#cfcac2';
  cg.fillRect(0, 0, S, S);
  // subtle weathering streaks
  for (let i = 0; i < 90; i++) {
    cg.fillStyle = `rgba(60,50,45,${0.03 + rng() * 0.05})`;
    cg.fillRect(rng() * S, rng() * S, 1 + rng() * 3, 10 + rng() * 40);
  }
  gg.fillStyle = '#000';
  gg.fillRect(0, 0, S, S);

  for (let fy = 0; fy < 4; fy++) {
    // floor slab line
    cg.fillStyle = 'rgba(70,64,60,0.35)';
    cg.fillRect(0, fy * cell + cell - 5, S, 3);
    for (let fx = 0; fx < 4; fx++) {
      const x = fx * cell + 9;
      const y = fy * cell + 11;
      const w = cell - 18;
      const h = cell - 24;
      const r = rng();
      if (r < litRatio) {
        const warm = rng() < 0.85;
        const base = warm ? [255, 176 + rng() * 40, 90 + rng() * 50] : [170, 200, 255];
        const k = 0.55 + rng() * 0.45;
        const col = `rgb(${base[0] * k | 0},${base[1] * k | 0},${base[2] * k | 0})`;
        cg.fillStyle = col;
        cg.fillRect(x, y, w, h);
        gg.fillStyle = col;
        gg.fillRect(x, y, w, h);
        // curtain / silhouette detail
        if (rng() < 0.5) {
          cg.fillStyle = 'rgba(40,20,10,0.45)';
          gg.fillStyle = 'rgba(0,0,0,0.6)';
          const cw = w * (0.2 + rng() * 0.3);
          const cx = rng() < 0.5 ? x : x + w - cw;
          cg.fillRect(cx, y, cw, h);
          gg.fillRect(cx, y, cw, h);
        }
      } else {
        const grad = cg.createLinearGradient(x, y, x + w, y + h);
        grad.addColorStop(0, '#39404e');
        grad.addColorStop(0.5, '#262b36');
        grad.addColorStop(1, '#4a4550');
        cg.fillStyle = grad;
        cg.fillRect(x, y, w, h);
      }
      // mullion
      cg.fillStyle = 'rgba(30,30,32,0.8)';
      cg.fillRect(x + w / 2 - 1, y, 2, h);
      gg.fillStyle = '#000';
      gg.fillRect(x + w / 2 - 1, y, 2, h);
    }
  }
  return { map: toTexture(color), emissiveMap: toTexture(glow) };
}

export function createConcreteTexture(seed, base = '#8a837b') {
  const rng = mulberry32(seed);
  const S = 256;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const v = rng() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${0.03 + rng() * 0.05})`;
    const s = 1 + rng() * 3;
    g.fillRect(rng() * S, rng() * S, s, s);
  }
  // tar seams
  g.strokeStyle = 'rgba(25,22,20,0.35)';
  g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    g.beginPath();
    g.moveTo(0, i * 64);
    g.lineTo(S, i * 64);
    g.moveTo(i * 64, 0);
    g.lineTo(i * 64, S);
    g.stroke();
  }
  // stains
  for (let i = 0; i < 12; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 10 + rng() * 40;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(40,35,30,0.18)');
    grad.addColorStop(1, 'rgba(40,35,30,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return toTexture(c);
}

export function createSoftTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const S = 64;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  return toTexture(c, { repeat: false });
}

export function createCloudTexture(seed) {
  const rng = mulberry32(seed);
  const W = 256;
  const H = 128;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const x = W * (0.15 + rng() * 0.7);
    const y = H * (0.35 + rng() * 0.35);
    const r = 18 + rng() * 34;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return toTexture(c, { repeat: false });
}
