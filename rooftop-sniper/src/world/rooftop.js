import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { createConcreteTexture, createFacadeTexture } from './textures.js';

// Cloth flag that ripples with the wind (animated in Ambient). Hoist edge at `pos`.
export function createFlag(pos, color = '#b8ab92', w = 1.3, h = 0.75) {
  const geo = new THREE.PlaneGeometry(w, h, 14, 6);
  geo.translate(w / 2, 0, 0);
  const flag = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.9 }));
  flag.position.copy(pos);
  flag.userData.base = geo.attributes.position.array.slice();
  flag.userData.width = w;
  return flag;
}

// The player's own rooftop: parapet, antenna with flag, vents, pipes, clutter.
export function buildPlayerRoof(scene) {
  const H = CONFIG.roofHeight;
  const solids = [];
  const add = (mesh, solid = true) => {
    scene.add(mesh);
    if (solid) solids.push(mesh);
    return mesh;
  };

  const concrete = createConcreteTexture(7, '#8b8279');
  concrete.repeat.set(6, 6);
  const floorMat = new THREE.MeshStandardMaterial({ color: '#a39a90', map: concrete, roughness: 0.95 });
  const parapetTex = createConcreteTexture(8, '#8f877e');
  parapetTex.repeat.set(8, 0.5);
  const parapetMat = new THREE.MeshStandardMaterial({ color: '#a8a095', map: parapetTex, roughness: 0.9 });
  const capMat = new THREE.MeshStandardMaterial({ color: '#6e6861', roughness: 0.7 });
  const metal = new THREE.MeshStandardMaterial({ color: '#44464a', roughness: 0.45, metalness: 0.75 });
  const rust = new THREE.MeshStandardMaterial({ color: '#6b4a36', roughness: 0.8, metalness: 0.4 });
  const pale = new THREE.MeshStandardMaterial({ color: '#b9b3a8', roughness: 0.6, metalness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: '#232326', roughness: 0.8 });
  const wood = new THREE.MeshStandardMaterial({ color: '#6d5238', roughness: 0.9 });

  // building body below the roof
  const fac = createFacadeTexture(51, 0.3);
  fac.map.repeat.set(26 / 14, 60 / 14);
  fac.emissiveMap.repeat.copy(fac.map.repeat);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(26, H, 26),
    new THREE.MeshStandardMaterial({
      color: '#7e776f', map: fac.map, emissiveMap: fac.emissiveMap, emissive: '#ffb36b', emissiveIntensity: 1.1, roughness: 0.9,
    })
  );
  body.position.set(0, H / 2 - 0.01, 9.4);
  add(body);

  // roof slab
  const floor = new THREE.Mesh(new THREE.BoxGeometry(26, 0.3, 26), floorMat);
  floor.position.set(0, H + 0.15 - 0.3, 9.4);
  floor.position.y = H - 0.15 + 0.001;
  add(floor);

  // front parapet (the one we lean on) + side parapets
  const pz = -3.45;
  const parapet = new THREE.Mesh(new THREE.BoxGeometry(26, 1.05, 0.35), parapetMat);
  parapet.position.set(0, H + 0.525, pz);
  add(parapet);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(26.2, 0.08, 0.5), capMat);
  cap.position.set(0, H + 1.09, pz);
  add(cap);
  for (const sx of [-13, 13]) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.05, 26), parapetMat);
    sp.position.set(sx, H + 0.525, 9.4);
    add(sp);
  }

  // pipes running along the parapet base
  for (const [y, z, r] of [[0.18, -3.05, 0.09], [0.38, -3.1, 0.06]]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 24, 10), rust);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(0, H + y, z);
    add(pipe, false);
    for (let x = -11; x <= 11; x += 4) {
      const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.2), metal);
      clamp.position.set(x, H + y, z);
      add(clamp, false);
    }
  }

  // antenna mast with flag (right side) — the flag doubles as an in-world wind indicator
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 7, 8), metal);
  mast.position.set(4.6, H + 3.5, -2.9);
  add(mast);
  for (let i = 0; i < 4; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.1 - i * 0.2, 0.04, 0.04), metal);
    bar.position.set(4.6, H + 4.4 + i * 0.6, -2.9);
    add(bar, false);
  }
  const guy = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 7.4, 4), dark);
  guy.position.set(3.1, H + 3.4, -2.2);
  guy.rotation.z = 0.44;
  add(guy, false);
  const flag = add(createFlag(new THREE.Vector3(4.6, H + 6.55, -2.9)), false);

  // vent stacks (left)
  for (const [x, z, h] of [[-4.2, -2.7, 1.5], [-4.9, -2.3, 1.1], [-3.6, -2.2, 0.8]]) {
    const v = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, h, 12), pale);
    v.position.set(x, H + h / 2, z);
    add(v);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.25, 0.18, 12), dark);
    c.position.set(x, H + h + 0.09, z);
    add(c, false);
  }

  // AC unit and duct (far left)
  const acu = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.3, 1.5), pale);
  acu.position.set(-8.2, H + 0.65, -2.2);
  add(acu);
  const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 18), dark);
  fan.position.set(-8.2, H + 1.33, -2.2);
  add(fan, false);
  const duct = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 5), metal);
  duct.position.set(-8.2, H + 0.25, 0.9);
  add(duct, false);

  // crates, bricks, bucket, cable spool, rifle case
  const crate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.7), wood);
  crate.position.set(-6.3, H + 0.3, -1.4);
  crate.rotation.y = 0.3;
  add(crate);
  const crate2 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 0.6), wood);
  crate2.position.set(-6.1, H + 0.825, -1.35);
  crate2.rotation.y = -0.2;
  add(crate2);
  const brickMat = new THREE.MeshStandardMaterial({ color: '#7b4636', roughness: 0.95 });
  for (let i = 0; i < 7; i++) {
    const br = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.07, 0.1), brickMat);
    br.position.set(2.4 + (i % 4) * 0.24, H + 0.035 + Math.floor(i / 4) * 0.07, -2.75);
    br.rotation.y = (i * 0.37) % 0.3;
    add(br, false);
  }
  const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.35, 12), new THREE.MeshStandardMaterial({ color: '#5b6b72', roughness: 0.6 }));
  bucket.position.set(3.4, H + 0.175, -2.3);
  add(bucket, false);
  const spool = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.4, 16), wood);
  spool.rotation.x = Math.PI / 2;
  spool.position.set(7.2, H + 0.45, -2.2);
  add(spool);
  const caseMesh = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.14, 0.35), dark);
  caseMesh.position.set(1.4, H + 0.07, -2.0);
  caseMesh.rotation.y = -0.15;
  add(caseMesh, false);

  // water tank on stilts (far right)
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 2.2, 18), rust);
  tank.position.set(10, H + 2.6, -1.2);
  add(tank);
  for (const [ox, oz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.5, 6), metal);
    leg.position.set(10 + ox, H + 0.75, -1.2 + oz);
    add(leg, false);
  }

  // rooftop door hut behind the player
  const hut = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 3.5), parapetMat);
  hut.position.set(-3, H + 1.5, 8);
  add(hut);

  return { solids, flag };
}
