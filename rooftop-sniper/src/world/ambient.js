import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { createCloudTexture, createSoftTexture, mulberry32 } from './textures.js';

// Clouds, birds, drifting dust, flags, aviation beacons and street traffic.
export class Ambient {
  constructor(scene, { flags = [], beacons = [], windowPanels = [] }) {
    this.scene = scene;
    this.flags = flags;
    this.beacons = beacons;
    this.windowPanels = windowPanels;
    this.t = 0;
    const rng = mulberry32(2024);

    // ---- clouds: large soft sprites high over the skyline ----
    this.clouds = [];
    const cloudTex = [createCloudTexture(1), createCloudTexture(2), createCloudTexture(3)];
    for (let i = 0; i < 34; i++) {
      const mat = new THREE.SpriteMaterial({
        map: cloudTex[i % 3],
        color: new THREE.Color().setHSL(0.03 + rng() * 0.05, 0.55, 0.62 + rng() * 0.15),
        transparent: true,
        opacity: 0.35 + rng() * 0.4,
        depthWrite: false,
        fog: false,
      });
      const s = new THREE.Sprite(mat);
      const ang = -Math.PI / 2 + (rng() - 0.5) * Math.PI * 1.5;
      const r = 900 + rng() * 2200;
      s.position.set(Math.cos(ang) * r, 180 + rng() * 520, Math.sin(ang) * r);
      const sc = 350 + rng() * 650;
      s.scale.set(sc, sc * 0.32, 1);
      s.userData.speed = 1.5 + rng() * 3;
      this.clouds.push(s);
      scene.add(s);
    }

    // ---- birds: small flapping silhouettes in flocks ----
    this.flocks = [];
    const birdMat = new THREE.MeshBasicMaterial({ color: '#241b20', side: THREE.DoubleSide });
    const wingGeo = new THREE.BufferGeometry();
    wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.12, 0, 0, 0.14, 0.55, 0, 0.02], 3));
    for (let f = 0; f < 3; f++) {
      const group = new THREE.Group();
      const birds = [];
      const n = 5 + Math.floor(rng() * 5);
      for (let i = 0; i < n; i++) {
        const bird = new THREE.Group();
        const l = new THREE.Mesh(wingGeo, birdMat);
        const r = new THREE.Mesh(wingGeo, birdMat);
        r.scale.x = -1;
        bird.add(l, r);
        bird.position.set((rng() - 0.5) * 14, (rng() - 0.5) * 4, (rng() - 0.5) * 10);
        bird.userData = { l, r, phase: rng() * 10, rate: 9 + rng() * 4 };
        group.add(bird);
        birds.push(bird);
      }
      group.scale.setScalar(1.6);
      group.userData = {
        radius: 160 + rng() * 260,
        height: 75 + rng() * 60,
        speed: (0.025 + rng() * 0.02) * (rng() < 0.5 ? 1 : -1),
        angle: rng() * Math.PI * 2,
        cx: (rng() - 0.5) * 200,
        cz: -200 - rng() * 150,
      };
      this.flocks.push({ group, birds });
      scene.add(group);
    }

    // ---- dust motes drifting past the rooftop ----
    const N = 220;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (rng() - 0.5) * 60;
      pos[i * 3 + 1] = CONFIG.roofHeight + rng() * 12;
      pos[i * 3 + 2] = -rng() * 40;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(
      dustGeo,
      new THREE.PointsMaterial({
        size: 0.05,
        map: createSoftTexture('rgba(255,220,180,1)'),
        color: '#ffd6a8',
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      })
    );
    scene.add(this.dust);

    // ---- traffic: headlight/taillight pairs gliding along streets far below ----
    this.cars = [];
    const headMat = new THREE.MeshBasicMaterial({ color: '#ffe2b0', toneMapped: false });
    const tailMat = new THREE.MeshBasicMaterial({ color: '#ff5533', toneMapped: false });
    const carGeo = new THREE.BoxGeometry(1.8, 0.5, 4);
    for (let i = 0; i < 40; i++) {
      const street = -46 * (1 + Math.floor(rng() * 9)) + 23; // between block rows
      const dir = rng() < 0.5 ? 1 : -1;
      const car = new THREE.Mesh(carGeo, dir > 0 ? headMat : tailMat);
      car.rotation.y = Math.PI / 2;
      car.position.set((rng() - 0.5) * 1600, 0.6, street + dir * 2.5);
      car.userData = { dir, speed: 9 + rng() * 8 };
      scene.add(car);
      this.cars.push(car);
    }
  }

  update(dt, wind, camera) {
    this.t += dt;
    const t = this.t;

    for (const c of this.clouds) {
      c.position.x += (c.userData.speed + wind * 2) * dt;
      if (c.position.x > 3000) c.position.x = -3000;
      if (c.position.x < -3000) c.position.x = 3000;
    }

    for (const { group, birds } of this.flocks) {
      const u = group.userData;
      u.angle += u.speed * dt;
      const x = u.cx + Math.cos(u.angle) * u.radius;
      const z = u.cz + Math.sin(u.angle) * u.radius * 0.6;
      const y = u.height + Math.sin(u.angle * 3) * 6;
      const nx = u.cx + Math.cos(u.angle + u.speed * 0.5) * u.radius;
      const nz = u.cz + Math.sin(u.angle + u.speed * 0.5) * u.radius * 0.6;
      group.position.set(x, y, z);
      group.lookAt(nx, y, nz);
      for (const b of birds) {
        const d = b.userData;
        const flap = Math.sin(t * d.rate + d.phase);
        const glide = Math.sin(t * 0.7 + d.phase) > 0.4 ? 0.15 : 1;
        d.l.rotation.z = flap * 0.7 * glide;
        d.r.rotation.z = -flap * 0.7 * glide;
      }
    }

    // dust drifts with wind, wraps around the camera
    const p = this.dust.geometry.attributes.position;
    const cx = camera.position.x;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i) + (wind * 0.8 + 0.2) * dt;
      let y = p.getY(i) + Math.sin(t * 0.5 + i) * 0.05 * dt;
      if (x > cx + 30) x -= 60;
      if (x < cx - 30) x += 60;
      p.setXY(i, x, y);
    }
    p.needsUpdate = true;

    for (const car of this.cars) {
      car.position.x += car.userData.dir * car.userData.speed * dt;
      if (car.position.x > 800) car.position.x = -800;
      if (car.position.x < -800) car.position.x = 800;
    }

    for (const b of this.beacons) {
      b.visible = Math.sin(t * 2.2 + b.userData.phase) > 0.55;
    }
    for (let i = 0; i < this.windowPanels.length; i++) {
      const w = this.windowPanels[i];
      const f = 0.9 + 0.1 * Math.sin(t * 3.1 + i * 1.7) * Math.sin(t * 7.3 + i);
      w.material.color.setRGB(1.0 * f, 0.72 * f, 0.4 * f);
    }

    // flags ripple with the wind; flip to face downwind
    for (const flag of this.flags) {
      const base = flag.userData.base;
      const pos = flag.geometry.attributes.position;
      const strength = 0.35 + Math.min(Math.abs(wind), 4) * 0.3;
      for (let i = 0; i < pos.count; i++) {
        const bx = base[i * 3];
        const by = base[i * 3 + 1];
        const k = bx / (flag.userData.width || 1.3);
        pos.setZ(i, Math.sin(bx * 4 - t * (4 + strength * 3)) * 0.12 * k * strength);
        pos.setY(i, by - k * k * (0.35 - Math.min(strength, 1.2) * 0.25));
      }
      pos.needsUpdate = true;
      flag.geometry.computeVertexNormals();
      const targetRot = wind >= 0 ? 0 : Math.PI;
      flag.rotation.y += (targetRot - flag.rotation.y) * Math.min(1, dt * 1.5);
    }
  }
}
