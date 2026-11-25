import * as THREE from 'three';
import { createSoftTexture } from '../world/textures.js';

// Pooled, short-lived world effects: impact sparks, dust puffs, smoke, tracers.
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.soft = createSoftTexture();
    this.sparkMat = new THREE.PointsMaterial({
      size: 0.22,
      map: this.soft,
      color: '#ffcf8a',
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.tracerMat = new THREE.LineBasicMaterial({ color: '#ffd9a0', transparent: true, opacity: 0.8, toneMapped: false });
  }

  add(obj, life, update) {
    this.scene.add(obj);
    this.items.push({ obj, life, max: life, update });
  }

  // Bright spark burst + dust puff where a bullet hits a surface.
  impact(point, normal) {
    const n = normal ? normal.clone() : new THREE.Vector3(0, 1, 0);
    const count = 14;
    const pos = new Float32Array(count * 3);
    const vel = [];
    for (let i = 0; i < count; i++) {
      pos.set([point.x, point.y, point.z], i * 3);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
        .multiplyScalar(2)
        .addScaledVector(n, 1.4)
        .normalize()
        .multiplyScalar(3 + Math.random() * 5);
      vel.push(v);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, this.sparkMat.clone());
    this.add(pts, 0.45, (it, dt, k) => {
      const a = geo.attributes.position;
      for (let i = 0; i < count; i++) {
        vel[i].y -= 9.8 * dt;
        a.setXYZ(i, a.getX(i) + vel[i].x * dt, a.getY(i) + vel[i].y * dt, a.getZ(i) + vel[i].z * dt);
      }
      a.needsUpdate = true;
      pts.material.opacity = k;
    });
    this.puff(point.clone().addScaledVector(n, 0.2), '#b9a896', 0.5, 2.6, 1.3);
    // tiny flash light-point
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.soft, color: '#ffe0a8', blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    flash.position.copy(point).addScaledVector(n, 0.1);
    flash.scale.setScalar(1.3);
    this.add(flash, 0.12, (it, dt, k) => {
      flash.material.opacity = k;
    });
  }

  puff(point, color = '#9d9285', startSize = 0.4, endSize = 2, life = 1.2, rise = 0.6) {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.soft, color, transparent: true, opacity: 0.7, depthWrite: false })
    );
    s.position.copy(point);
    s.scale.setScalar(startSize);
    this.add(s, life, (it, dt, k) => {
      const u = 1 - k;
      s.scale.setScalar(startSize + (endSize - startSize) * Math.sqrt(u));
      s.position.y += rise * dt;
      s.material.opacity = 0.7 * k;
    });
  }

  smoke(point) {
    this.puff(point.clone(), '#3b3634', 0.6, 3.2, 2.2, 1.2);
  }

  // Dark non-graphic dust puff when a target is struck.
  bodyHit(point) {
    this.puff(point, '#5c534c', 0.3, 1.4, 0.8, 0.3);
  }

  tracer(from, to, duration) {
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), from.clone()]);
    const line = new THREE.Line(geo, this.tracerMat.clone());
    const dir = to.clone().sub(from);
    const len = dir.length();
    dir.normalize();
    const seg = Math.min(18, len * 0.3);
    const total = Math.max(duration, 0.05);
    let t = 0;
    this.add(line, total + 0.05, (it, dt) => {
      t += dt;
      const head = Math.min(len, (t / total) * len);
      const tail = Math.max(0, head - seg);
      const a = geo.attributes.position;
      a.setXYZ(0, from.x + dir.x * tail, from.y + dir.y * tail, from.z + dir.z * tail);
      a.setXYZ(1, from.x + dir.x * head, from.y + dir.y * head, from.z + dir.z * head);
      a.needsUpdate = true;
      geo.computeBoundingSphere();
      line.material.opacity = 0.55 * (head >= len ? 0.3 : 1);
    });
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life -= dt;
      const k = Math.max(0, it.life / it.max);
      it.update?.(it, dt, k);
      if (it.life <= 0) {
        this.scene.remove(it.obj);
        if (!it.obj.isSprite) it.obj.geometry?.dispose?.(); // sprites share one geometry
        it.obj.material?.dispose?.();
        this.items.splice(i, 1);
      }
    }
  }

  clear() {
    for (const it of this.items) this.scene.remove(it.obj);
    this.items.length = 0;
  }
}
