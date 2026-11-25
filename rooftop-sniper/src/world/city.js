import * as THREE from 'three';
import { createFacadeTexture, createConcreteTexture, mulberry32 } from './textures.js';

// Mission rooftops the targets patrol. Front edge (+z) faces the player.
export const MISSION_ROOFS = {
  A: { x: -72, z: -118, w: 30, d: 22, h: 44 },
  B: { x: -24, z: -168, w: 30, d: 24, h: 50 },
  C: { x: 22, z: -170, w: 26, d: 24, h: 50 },
  D: { x: 86, z: -132, w: 28, d: 22, h: 40 },
  E: { x: -118, z: -236, w: 34, d: 28, h: 56 },
  F: { x: 66, z: -248, w: 38, d: 28, h: 48 },
};

// Balcony gallery on the front face of building E (targets pause at its windows).
export const BALCONY = { x0: -132, x1: -104, z: -222, depth: 2.2, y: 44 };
// Catwalk bridging roofs B and C.
export const CATWALK = { x0: -9, x1: 9, z: -170, width: 1.6, y: 50 };

const TILE = 14;

// Accumulates quads into one BufferGeometry so hundreds of buildings cost one draw call.
class GeoBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.idx = [];
  }
  quad(a, b, c, d, n, u0, v0, u1, v1) {
    const i = this.pos.length / 3;
    this.pos.push(...a, ...b, ...c, ...d);
    for (let k = 0; k < 4; k++) this.nor.push(...n);
    this.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  // sides: facade UVs in world metres / TILE; top: roof UVs in metres / 8
  box(cx, y0, cz, w, h, d, { sides = true, top = true, uOff = 0, topScale = 8 } = {}) {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, y1 = y0 + h;
    if (sides) {
      const v1 = h / TILE;
      this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], uOff, 0, uOff + w / TILE, v1);
      this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], uOff, 0, uOff + w / TILE, v1);
      this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], uOff, 0, uOff + d / TILE, v1);
      this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], uOff, 0, uOff + d / TILE, v1);
    }
    if (top) {
      this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], 0, 0, w / topScale, d / topScale);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
  get empty() {
    return this.pos.length === 0;
  }
}

export function buildCity(scene) {
  const rng = mulberry32(4815);
  const solids = [];
  const animated = { beacons: [], windowPanels: [] };

  // ---------- materials ----------
  const tints = ['#77737a', '#86786c', '#5f6676', '#8f8475', '#6c6462'];
  const facadeTex = [createFacadeTexture(11, 0.14), createFacadeTexture(23, 0.22), createFacadeTexture(37, 0.08)];
  const facadeMats = [];
  for (let i = 0; i < 6; i++) {
    const t = facadeTex[i % facadeTex.length];
    facadeMats.push(
      new THREE.MeshStandardMaterial({
        color: tints[i % tints.length],
        map: t.map,
        emissiveMap: t.emissiveMap,
        emissive: new THREE.Color('#ffb36b'),
        emissiveIntensity: 0.95,
        roughness: 0.85,
        metalness: 0.05,
      })
    );
  }
  const roofTex = createConcreteTexture(99, '#7a716a');
  const roofMat = new THREE.MeshStandardMaterial({ color: '#b5aca2', map: roofTex, roughness: 0.95 });
  const propMat = new THREE.MeshStandardMaterial({ color: '#77716c', roughness: 0.8, metalness: 0.2 });
  const darkMat = new THREE.MeshStandardMaterial({ color: '#2d2c2e', roughness: 0.7, metalness: 0.3 });
  const farMat = new THREE.MeshStandardMaterial({ color: '#4a3a45', roughness: 1 });

  // ---------- ground ----------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(8000, 8000),
    new THREE.MeshStandardMaterial({ color: '#221d22', roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  solids.push(ground);

  // ---------- generic buildings ----------
  const facadeBuilders = facadeMats.map(() => new GeoBuilder());
  const roofBuilder = new GeoBuilder();
  const propBuilder = new GeoBuilder();

  const exclusions = Object.values(MISSION_ROOFS).map((r) => ({
    x0: r.x - r.w / 2 - 7, x1: r.x + r.w / 2 + 7, z0: r.z - r.d / 2 - 7, z1: r.z + r.d / 2 + 7,
  }));
  exclusions.push({ x0: -30, x1: 30, z0: -22, z1: 40 }); // player's own block
  exclusions.push({ x0: -12, x1: 12, z0: -175, z1: -165 }); // catwalk gap
  const blocked = (x0, x1, z0, z1) => exclusions.some((e) => x1 > e.x0 && x0 < e.x1 && z1 > e.z0 && z0 < e.z1);

  const STEP = 46;
  for (let gx = -1150; gx <= 1150; gx += STEP) {
    for (let gz = -1900; gz <= 70; gz += STEP) {
      const lots = rng() < 0.45 ? 2 : 1;
      for (let l = 0; l < lots; l++) {
        const w = lots === 2 ? 12 + rng() * 10 : 16 + rng() * 18;
        const d = 14 + rng() * 18;
        const x = gx + (lots === 2 ? (l === 0 ? -9 : 9) : (rng() - 0.5) * 6);
        const z = gz + (rng() - 0.5) * 6;
        const dist = Math.hypot(x, z);
        if (dist > 2000) continue;
        if (z > 40 && dist > 200) continue;
        if (blocked(x - w / 2, x + w / 2, z - d / 2, z + d / 2)) continue;
        let h;
        if (dist < 360 && rng() < 0.3) continue; // courtyards / low lots keep the near field readable
        if (dist < 360) h = 6 + rng() * 18;
        else if (dist < 750) h = 22 + rng() * 60 + (rng() < 0.15 ? 60 : 0);
        else h = 35 + rng() * 90 + (rng() < 0.2 ? 110 * rng() : 0);
        const m = Math.floor(rng() * facadeMats.length);
        facadeBuilders[m].box(x, 0, z, w, h, d, { top: false, uOff: Math.floor(rng() * 4) * 0.25 });
        roofBuilder.box(x, 0, z, w, h, d, { sides: false });
        if (dist < 520) {
          // rooftop clutter on nearby buildings: stair huts, AC units, water towers
          const n = 1 + Math.floor(rng() * 3);
          for (let k = 0; k < n; k++) {
            const pw = 2 + rng() * 3.5, pd = 2 + rng() * 3.5, ph = 1.2 + rng() * 2.4;
            const px = x + (rng() - 0.5) * (w - pw - 1);
            const pz = z + (rng() - 0.5) * (d - pd - 1);
            propBuilder.box(px, h, pz, pw, ph, pd, { topScale: 4 });
          }
          if (rng() < 0.25) {
            // parapet lip
            propBuilder.box(x, h, z + d / 2 - 0.2, w, 0.7, 0.4);
            propBuilder.box(x, h, z - d / 2 + 0.2, w, 0.7, 0.4);
          }
        }
        if (h > 110 && rng() < 0.7) {
          const beacon = new THREE.Mesh(
            new THREE.SphereGeometry(1.2, 8, 6),
            new THREE.MeshBasicMaterial({ color: '#ff5a3c', fog: false, toneMapped: false })
          );
          beacon.position.set(x, h + 1.5, z);
          beacon.userData.phase = rng() * Math.PI * 2;
          scene.add(beacon);
          animated.beacons.push(beacon);
        }
      }
    }
  }

  facadeBuilders.forEach((b, i) => {
    if (b.empty) return;
    const mesh = new THREE.Mesh(b.build(), facadeMats[i]);
    scene.add(mesh);
    solids.push(mesh);
  });
  const roofs = new THREE.Mesh(roofBuilder.build(), roofMat);
  scene.add(roofs);
  solids.push(roofs);
  const props = new THREE.Mesh(propBuilder.build(), propMat);
  scene.add(props);
  solids.push(props);

  // ---------- far skyline silhouettes (hazy layer) ----------
  const farGeo = new THREE.BoxGeometry(1, 1, 1);
  farGeo.translate(0, 0.5, 0);
  const farCount = 260;
  const far = new THREE.InstancedMesh(farGeo, farMat, farCount);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < farCount; i++) {
    const ang = -Math.PI / 2 + (rng() - 0.5) * Math.PI * 1.6;
    const r = 1450 + rng() * 700;
    const w = 30 + rng() * 70;
    const h = 60 + rng() * 260;
    m4.compose(
      new THREE.Vector3(Math.cos(ang) * r, 0, Math.sin(ang) * r),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI),
      new THREE.Vector3(w, h, 30 + rng() * 60)
    );
    far.setMatrixAt(i, m4);
  }
  scene.add(far);

  // ---------- mission buildings ----------
  const missionFacade = facadeMats[1];
  const parapetMat = new THREE.MeshStandardMaterial({ color: '#8d857c', roughness: 0.9 });
  const acMat = new THREE.MeshStandardMaterial({ color: '#a8a39a', roughness: 0.6, metalness: 0.35 });
  const hutMat = new THREE.MeshStandardMaterial({ color: '#8a7a6c', roughness: 0.9 });
  const tankMat = new THREE.MeshStandardMaterial({ color: '#5d4a3c', roughness: 0.85 });
  const metalMat = new THREE.MeshStandardMaterial({ color: '#3a3b3e', roughness: 0.5, metalness: 0.7 });

  const addSolid = (mesh) => {
    scene.add(mesh);
    solids.push(mesh);
    return mesh;
  };
  const box = (w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return addSolid(m);
  };

  for (const [id, r] of Object.entries(MISSION_ROOFS)) {
    const b = new GeoBuilder();
    b.box(r.x, 0, r.z, r.w, r.h, r.d, { top: false, uOff: 0.25 });
    addSolid(new THREE.Mesh(b.build(), missionFacade));
    const rb = new GeoBuilder();
    rb.box(r.x, 0, r.z, r.w, r.h, r.d, { sides: false });
    addSolid(new THREE.Mesh(rb.build(), roofMat));

    // parapet walls; gaps where the catwalk joins roofs B and C
    const ph = 0.55, pt = 0.3, y = r.h + ph / 2;
    box(r.w, ph, pt, parapetMat, r.x, y, r.z + r.d / 2 - pt / 2);
    box(r.w, ph, pt, parapetMat, r.x, y, r.z - r.d / 2 + pt / 2);
    const side = (sx, gap) => {
      const zc = r.z;
      if (!gap) return box(pt, ph, r.d, parapetMat, sx, y, zc);
      const g0 = gap[0], g1 = gap[1]; // world z range of gap
      const za = r.z - r.d / 2, zb = r.z + r.d / 2;
      box(pt, ph, g0 - za, parapetMat, sx, y, (za + g0) / 2);
      box(pt, ph, zb - g1, parapetMat, sx, y, (g1 + zb) / 2);
    };
    const gap = [CATWALK.z - 1.4, CATWALK.z + 1.4];
    side(r.x - r.w / 2 + pt / 2, id === 'C' ? gap : null);
    side(r.x + r.w / 2 - pt / 2, id === 'B' ? gap : null);
  }

  // Props per roof, in roof-local coords (lx, lz). These double as bullet-blocking cover.
  const L = (id, lx, lz) => {
    const r = MISSION_ROOFS[id];
    return { x: r.x + lx, y: r.h, z: r.z + lz };
  };
  const ac = (id, lx, lz) => {
    const p = L(id, lx, lz);
    box(2.4, 1.45, 1.6, acMat, p.x, p.y + 0.725, p.z);
    const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 16), darkMat);
    fan.position.set(p.x + 0.45, p.y + 1.49, p.z);
    scene.add(fan);
  };
  const hut = (id, lx, lz, w = 3.6, d = 3.2, h = 2.9) => {
    const p = L(id, lx, lz);
    box(w, h, d, hutMat, p.x, p.y + h / 2, p.z);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 2.0), darkMat);
    door.position.set(p.x, p.y + 1.0, p.z + d / 2 + 0.01);
    scene.add(door);
  };
  const tank = (id, lx, lz) => {
    const p = L(id, lx, lz);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 2.3, 16), tankMat);
    t.position.set(p.x, p.y + 1.5 + 1.15, p.z);
    addSolid(t);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.4, 0.7, 16), tankMat);
    cone.position.set(p.x, p.y + 4.15, p.z);
    scene.add(cone);
    for (const [ox, oz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.5, 6), metalMat);
      leg.position.set(p.x + ox, p.y + 0.75, p.z + oz);
      scene.add(leg);
    }
  };
  const antenna = (id, lx, lz, h = 8) => {
    const p = L(id, lx, lz);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, h, 8), metalMat);
    mast.position.set(p.x, p.y + h / 2, p.z);
    addSolid(mast);
    for (let i = 1; i <= 3; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(1.8 - i * 0.35, 0.06, 0.06), metalMat);
      bar.position.set(p.x, p.y + h * (0.55 + i * 0.13), p.z);
      scene.add(bar);
    }
    return { x: p.x, y: p.y + h, z: p.z };
  };
  const vent = (id, lx, lz) => {
    const p = L(id, lx, lz);
    const v = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 1.1, 10), propMat);
    v.position.set(p.x, p.y + 0.55, p.z);
    addSolid(v);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.3, 0.2, 10), darkMat);
    cap.position.set(p.x, p.y + 1.2, p.z);
    scene.add(cap);
  };
  const dish = (id, lx, lz) => {
    const p = L(id, lx, lz);
    const dsh = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.2, 0.25, 16), acMat);
    dsh.position.set(p.x, p.y + 1.3, p.z);
    dsh.rotation.x = 1.0;
    scene.add(dsh);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 6), metalMat);
    post.position.set(p.x, p.y + 0.6, p.z);
    scene.add(post);
  };

  const flagSpots = [];
  // Roof A
  ac('A', 8, 3); ac('A', 5.3, 3); hut('A', -9, -5, 4, 3.4, 3); tank('A', 10, -6); antenna('A', -3, 1, 7); vent('A', -12, 7); vent('A', 0, -8);
  // Roof B
  hut('B', -8, -6); ac('B', -2, 5); flagSpots.push(antenna('B', 4, 6, 9)); tank('B', -11, 4); vent('B', 9, -8);
  // Roof C
  hut('C', 6, -1); ac('C', -7, 1.5); dish('C', -3, 8); tank('C', -5, -8.5); antenna('C', 9, 6, 6);
  // Roof D
  ac('D', 7, 3); ac('D', 4.4, 3); hut('D', -8, -6); antenna('D', -4, -3, 10); vent('D', 10, -7);
  // Roof E
  hut('E', 0, -6); ac('E', -9, 4); ac('E', 8, 4); antenna('E', 12, -8, 12); tank('E', -12, -8);
  // Roof F
  hut('F', -10, -4); ac('F', 4, 5); ac('F', 6.6, 5); tank('F', 12, -6); antenna('F', -2, -9, 8); dish('F', 14, 6);

  // ---------- catwalk B <-> C ----------
  {
    const c = CATWALK;
    const len = c.x1 - c.x0 + 1;
    box(len, 0.25, c.width, metalMat, (c.x0 + c.x1) / 2, c.y - 0.125, c.z);
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.05), metalMat);
      rail.position.set((c.x0 + c.x1) / 2, c.y + 1.0, c.z + s * c.width / 2);
      scene.add(rail);
      for (let px = c.x0; px <= c.x1; px += 3) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.0, 0.05), metalMat);
        post.position.set(px, c.y + 0.5, c.z + s * c.width / 2);
        scene.add(post);
      }
    }
  }

  // ---------- balcony gallery on E ----------
  {
    const bl = BALCONY;
    const len = bl.x1 - bl.x0;
    const zc = bl.z + bl.depth / 2;
    box(len, 0.3, bl.depth, parapetMat, (bl.x0 + bl.x1) / 2, bl.y - 0.15, zc);
    // solid lower balustrade (hides legs), thin top rail
    box(len, 0.55, 0.12, parapetMat, (bl.x0 + bl.x1) / 2, bl.y + 0.275, bl.z + bl.depth);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 0.06), metalMat);
    rail.position.set((bl.x0 + bl.x1) / 2, bl.y + 1.05, bl.z + bl.depth);
    scene.add(rail);
    // warm lit windows behind the walkway
    const winMat = new THREE.MeshBasicMaterial({ color: '#ffb866', toneMapped: false });
    for (const wx of [-128.5, -121, -113.5, -107]) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.3), winMat.clone());
      win.position.set(wx, bl.y + 1.35, bl.z + 0.02);
      scene.add(win);
      animated.windowPanels.push(win);
    }
  }

  return { solids, animated, flagSpots };
}
