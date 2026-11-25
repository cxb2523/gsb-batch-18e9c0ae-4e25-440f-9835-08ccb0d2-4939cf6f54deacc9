import * as THREE from 'three';
import { createSoftTexture } from '../world/textures.js';

// First-person rifle, rendered in its own pass so it never clips into the parapet.
export class Viewmodel {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight('#9fb0d8', '#3a2a24', 1.4));
    const sun = new THREE.DirectionalLight('#ffb070', 2.2);
    sun.position.set(-2, 1, -2);
    this.scene.add(sun);

    this.anchor = new THREE.Group(); // follows camera
    this.scene.add(this.anchor);
    this.rifle = new THREE.Group();
    this.anchor.add(this.rifle);

    const steel = new THREE.MeshStandardMaterial({ color: '#2b2d30', roughness: 0.35, metalness: 0.85 });
    const poly = new THREE.MeshStandardMaterial({ color: '#4a4636', roughness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: '#141416', roughness: 0.5, metalness: 0.5 });
    const glass = new THREE.MeshStandardMaterial({ color: '#40607a', roughness: 0.1, metalness: 0.9 });
    const add = (geo, mat, x, y, z, rx = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.x = rx;
      this.rifle.add(m);
      return m;
    };
    add(new THREE.BoxGeometry(0.075, 0.1, 0.62), poly, 0, 0, 0.05); // stock + fore-end
    add(new THREE.BoxGeometry(0.07, 0.16, 0.2), poly, 0, -0.06, 0.34); // butt
    add(new THREE.BoxGeometry(0.06, 0.07, 0.3), steel, 0, 0.07, -0.02); // receiver
    add(new THREE.CylinderGeometry(0.014, 0.018, 0.75, 10), steel, 0, 0.07, -0.52, Math.PI / 2); // barrel
    add(new THREE.CylinderGeometry(0.026, 0.026, 0.07, 10), dark, 0, 0.07, -0.9, Math.PI / 2); // muzzle brake
    add(new THREE.BoxGeometry(0.05, 0.09, 0.07), dark, 0, -0.08, 0.02); // magazine
    add(new THREE.CylinderGeometry(0.026, 0.026, 0.3, 12), dark, 0, 0.14, -0.02, Math.PI / 2); // scope tube
    add(new THREE.CylinderGeometry(0.038, 0.03, 0.08, 12), dark, 0, 0.14, -0.19, Math.PI / 2); // objective
    add(new THREE.CylinderGeometry(0.034, 0.028, 0.06, 12), dark, 0, 0.14, 0.15, Math.PI / 2); // eyepiece
    add(new THREE.CircleGeometry(0.033, 16), glass, 0, 0.14, -0.231).rotation.y = Math.PI;
    add(new THREE.CylinderGeometry(0.02, 0.02, 0.04, 8), dark, 0, 0.19, -0.02); // turret
    this.boltHandle = add(new THREE.CylinderGeometry(0.008, 0.008, 0.07, 6), steel, 0.05, 0.06, 0.06);
    this.boltHandle.rotation.z = Math.PI / 2;
    // gloved hands
    const glove = new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 0.9 });
    add(new THREE.BoxGeometry(0.09, 0.08, 0.12), glove, 0.0, -0.06, 0.2);
    add(new THREE.BoxGeometry(0.1, 0.07, 0.14), glove, -0.01, -0.05, -0.28);

    this.flash = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: createSoftTexture('rgba(255,210,140,1)'), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    );
    this.flash.position.set(0, 0.07, -1.0);
    this.flash.scale.setScalar(0.35);
    this.flash.visible = false;
    this.rifle.add(this.flash);

    this.base = new THREE.Vector3(0.19, -0.2, -0.66);
    this.rifle.scale.setScalar(0.85);
    this.kickT = 0;
    this.flashT = 0;
    this.t = 0;
  }

  kick() {
    this.kickT = 1;
    this.flashT = 0.05;
  }

  update(dt, camera, { reloadProgress = -1, cycling = 0, moving = false, bob = 0 }) {
    this.t += dt;
    this.anchor.position.copy(camera.position);
    this.anchor.quaternion.copy(camera.quaternion);
    this.kickT = Math.max(0, this.kickT - dt * 5);
    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
    this.flash.material.rotation = Math.random() * 6;

    const r = this.rifle;
    r.position.copy(this.base);
    r.rotation.set(0, 0, 0);
    // idle breathing + walk bob
    r.position.y += Math.sin(this.t * 1.6) * 0.004 + (moving ? Math.sin(bob * 2) * 0.01 : 0);
    r.position.x += moving ? Math.cos(bob) * 0.008 : 0;
    // recoil
    r.position.z += this.kickT * 0.09;
    r.rotation.x += this.kickT * 0.14;
    // bolt cycle: small roll
    if (cycling > 0) {
      const c = Math.sin(Math.min(1, cycling) * Math.PI);
      r.rotation.z += c * 0.18;
      this.boltHandle.position.z = 0.06 + c * 0.06;
    } else {
      this.boltHandle.position.z = 0.06;
    }
    // reload: dip and tilt
    if (reloadProgress >= 0) {
      const d = Math.sin(Math.min(1, reloadProgress) * Math.PI);
      r.position.y -= d * 0.14;
      r.rotation.z += d * 0.55;
      r.rotation.x -= d * 0.25;
    }
  }
}
