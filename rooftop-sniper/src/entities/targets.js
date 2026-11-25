import * as THREE from 'three';
import { MISSION_ROOFS, BALCONY, CATWALK } from '../world/city.js';
import { createHumanoid, createDrone } from './models.js';

// Waypoint helpers ----------------------------------------------------------
// R(roof, lx, lz, pause, pose): roof-local point. Front edge (+z) faces the player.
function R(id, lx, lz, pause = 0, pose = 'stand') {
  const r = MISSION_ROOFS[id];
  return { p: new THREE.Vector3(r.x + lx, r.h, r.z + lz), pause, pose };
}
function W(x, y, z, pause = 0, pose = 'stand') {
  return { p: new THREE.Vector3(x, y, z), pause, pose };
}

// Poses: stand, crouch (behind cover), lookout (faces the player's side of the city),
// window (faces the building), phone (civilian on a call), hover (drones)
function roster() {
  const cw = CATWALK;
  const bz = BALCONY.z + 1.1;
  return [
    {
      name: 'H1', kind: 'hostile', model: 'human', speed: 1.45, loop: true,
      path: [
        R('A', -8, 9.9, 2.8, 'lookout'), R('A', 2, 9.6), R('A', 3.2, 1.0), R('A', 6.6, 1.4, 3.2, 'crouch'),
        R('A', -2, -3, 1.0), R('A', -9, -9, 2.2, 'stand'), R('A', -12.4, -8), R('A', -12.5, 4, 1.2),
      ],
    },
    {
      name: 'H2', kind: 'hostile', model: 'human', speed: 1.6, loop: true,
      path: [
        R('B', -6, 11, 2.5, 'lookout'), R('B', -4.3, 3.6), R('B', -2, 3.3, 2.0, 'crouch'), R('B', 9, -2),
        W(cw.x0 + 0.2, cw.y, cw.z), W(cw.x1 - 0.2, cw.y, cw.z), R('C', -5, -0.5),
        R('C', 0, 11, 2.6, 'lookout'), R('C', 2.8, -3.6), R('C', 6, -4.2, 2.2, 'stand'), R('C', -6, -3),
        W(cw.x1 - 0.2, cw.y, cw.z), W(cw.x0 + 0.2, cw.y, cw.z), R('B', 4, -7, 1.4), R('B', -5.5, -1),
      ],
    },
    {
      name: 'H3', kind: 'hostile', model: 'human', speed: 1.35, loop: true,
      path: [
        R('D', -9, 10, 2.4, 'lookout'), R('D', -1, 4), R('D', 2.4, 1.2), R('D', 5.7, 1.3, 3.0, 'crouch'),
        R('D', 9.2, 1.4), R('D', 11, 10, 2.0, 'lookout'), R('D', 8, -6), R('D', -11.5, -2.6, 1.2),
      ],
    },
    {
      name: 'H4', kind: 'hostile', model: 'human', speed: 1.25, loop: false,
      path: [
        W(-129.5, BALCONY.y, bz, 2.5, 'window'), W(-121, BALCONY.y, bz, 2.2, 'lookout'),
        W(-113.5, BALCONY.y, bz, 2.6, 'window'), W(-106.5, BALCONY.y, bz, 1.8, 'lookout'),
      ],
    },
    {
      name: 'D1', kind: 'hostile', model: 'drone', speed: 7.5, loop: true,
      path: [
        W(22, 59, -176, 3.0, 'hover'), W(86, 51, -128, 2.6, 'hover'), W(62, 58, -242, 3.2, 'hover'),
        W(-20, 61, -160, 2.2, 'hover'), W(-72, 54, -112, 3.0, 'hover'),
      ],
    },
    {
      name: 'C1', kind: 'civilian', model: 'human', variant: 0, speed: 1.1, loop: true,
      path: [
        R('C', -6, 4.2, 4, 'phone'), R('C', 3, 10.8, 3, 'lookout'), R('C', 9, 4, 1.5), R('C', 9, -4),
        R('C', -3, -7, 3), R('C', -9, -3, 2, 'phone'), R('C', -9.8, 1.8),
      ],
    },
    {
      name: 'C2', kind: 'civilian', model: 'human', variant: 1, speed: 1.0, loop: true,
      path: [
        R('F', -4, 12.9, 4, 'lookout'), R('F', 9, 8), R('F', 10, 1, 3, 'stand'),
        R('F', -6, -1, 2), R('F', -14, 3, 2.5, 'lookout'),
      ],
    },
  ];
}

const tmp = new THREE.Vector3();
const lerpAngle = (a, b, t) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

export class Target {
  constructor(def, scene, rng) {
    this.def = def;
    this.name = def.name;
    this.kind = def.kind;
    this.model = def.model;
    this.rng = rng;
    this.parts = def.model === 'drone' ? createDrone() : createHumanoid(def.kind, def.variant || 0);
    this.root = this.parts.root;
    for (const h of this.parts.hitboxes) h.userData.target = this;
    scene.add(this.root);
    this.reset();
  }

  reset() {
    const d = this.def;
    const rng = this.rng;
    this.alive = true;
    this.dying = false;
    this.deathT = 0;
    this.idx = Math.floor(rng() * d.path.length);
    this.dir = 1;
    this.pos = d.path[this.idx].p.clone();
    this.moving = false;
    this.pauseT = 0.5 + rng() * 2;
    this.pose = d.path[this.idx].pose;
    this.crouch = this.pose === 'crouch' ? 1 : 0;
    this.heading = Math.atan2(-this.pos.x, -this.pos.z);
    this.walkPhase = rng() * 10;
    this.speedMul = 1;
    this.alert = 0;
    this.panic = 0;
    this.vy = 0;
    this.spin = 0;
    this.smokeT = 0;
    this.root.visible = true;
    this.root.position.copy(this.pos);
    this.parts.body.rotation.set(0, 0, 0);
    this.parts.body.position.set(0, 0, 0);
    if (this.parts.marker) this.parts.marker.visible = true;
    this.pickSegmentSpeed();
    this.applyPose(0, 0);
  }

  pickSegmentSpeed() {
    const base = this.def.speed * (0.8 + this.rng() * 0.45);
    // hostiles occasionally hustle between cover
    const jog = this.kind === 'hostile' && this.model === 'human' && this.rng() < 0.22 ? 1.9 : 1;
    this.segSpeed = base * jog;
  }

  get hostile() {
    return this.kind === 'hostile';
  }

  chestWorld(out = new THREE.Vector3()) {
    return this.parts.chest.getWorldPosition(out);
  }

  nextIndex() {
    const n = this.def.path.length;
    if (this.def.loop) {
      if (this.rng() < 0.12) this.dir *= -1; // occasionally double back
      return (this.idx + this.dir + n) % n;
    }
    let ni = this.idx + this.dir;
    if (ni < 0 || ni >= n) {
      this.dir *= -1;
      ni = this.idx + this.dir;
    }
    return ni;
  }

  // Called when a shot lands nearby or a nearby hostile drops.
  startle(strength = 1) {
    if (!this.alive) return;
    if (this.hostile) {
      this.alert = 6 * strength;
      if (!this.moving) this.pauseT = Math.min(this.pauseT, 0.35);
    } else {
      this.panic = 3.5 * strength;
      this.moving = false;
      this.pauseT = 2.2;
      this.pose = 'crouch';
    }
  }

  kill(dir) {
    if (!this.alive) return;
    this.alive = false;
    this.dying = true;
    this.deathT = 0;
    this.fallDir = dir ? Math.sign(dir.z || 1) : 1;
    if (this.parts.marker) this.parts.marker.visible = false;
    if (this.model === 'drone') {
      this.vy = 0;
      this.spin = 6 + this.rng() * 5;
      this.vx = dir ? dir.x * 4 : 0;
      this.vz = dir ? dir.z * 4 : 0;
    }
  }

  update(dt, t, effects) {
    if (this.dying) return this.updateDeath(dt, effects);
    if (!this.alive) return;
    const path = this.def.path;
    this.alert = Math.max(0, this.alert - dt);
    this.panic = Math.max(0, this.panic - dt);
    const hurry = this.alert > 0 ? 1.9 : this.panic > 0 ? 1.7 : 1;

    if (this.moving) {
      const target = path[this.idx].p;
      tmp.subVectors(target, this.pos);
      const dist = tmp.length();
      const step = this.segSpeed * hurry * dt;
      if (step >= dist) {
        this.pos.copy(target);
        this.moving = false;
        const wp = path[this.idx];
        this.pose = wp.pose;
        let pause = wp.pause * (0.7 + this.rng() * 0.6);
        if (this.alert > 0) pause *= 0.3;
        this.pauseT = pause;
      } else {
        this.pos.addScaledVector(tmp, step / dist);
        if (this.model === 'drone') this.heading = lerpAngle(this.heading, Math.atan2(tmp.x, tmp.z), dt * 2);
        else this.heading = lerpAngle(this.heading, Math.atan2(tmp.x, tmp.z), Math.min(1, dt * 8));
      }
    } else {
      this.pauseT -= dt;
      // facing while paused
      let face = null;
      if (this.pose === 'lookout' || this.pose === 'crouch') face = Math.atan2(-this.pos.x, -this.pos.z);
      else if (this.pose === 'window') face = Math.PI;
      if (face !== null) {
        // hostiles scan slowly left-right
        const scan = this.hostile ? Math.sin(t * 0.8 + this.walkPhase) * 0.5 : 0;
        this.heading = lerpAngle(this.heading, face + scan, Math.min(1, dt * 3));
      }
      if (this.pauseT <= 0) {
        this.idx = this.nextIndex();
        this.moving = true;
        this.pose = 'walk';
        this.pickSegmentSpeed();
      }
    }

    this.root.position.copy(this.pos);
    this.root.rotation.y = this.heading;
    this.applyPose(dt, t, hurry);
  }

  applyPose(dt, t = 0, hurry = 1) {
    const P = this.parts;
    if (this.model === 'drone') {
      for (const r of P.rotors) r.rotation.y += 60 * Math.max(dt, 0.016);
      P.body.position.y = Math.sin(t * 2.1 + this.walkPhase) * 0.12;
      const tilt = this.moving ? 0.22 : 0.02 * Math.sin(t * 1.3);
      P.body.rotation.x += (tilt - P.body.rotation.x) * Math.min(1, dt * 3);
      if (P.marker) P.marker.visible = Math.sin(t * 9) > 0.2;
      return;
    }
    const wantCrouch = this.pose === 'crouch' ? 1 : 0;
    this.crouch += (wantCrouch - this.crouch) * Math.min(1, dt * 5);
    const c = this.crouch;
    let legSwing = 0;
    if (this.moving) {
      this.walkPhase += dt * this.segSpeed * hurry * 3.6;
      legSwing = Math.sin(this.walkPhase) * (0.45 + 0.1 * hurry);
    }
    P.legL.rotation.x = legSwing - 1.35 * c;
    P.legR.rotation.x = -legSwing - 1.1 * c;
    P.hips.position.y = 0.92 - 0.42 * c + (this.moving ? Math.abs(Math.cos(this.walkPhase)) * 0.03 : 0);
    const hostile = this.hostile;
    const lean = hostile ? 0.14 + 0.2 * c : 0.02 + 0.25 * c;
    P.torso.rotation.x = lean;

    if (hostile) {
      // rifle held at the ready; raised when on lookout
      const raise = this.pose === 'lookout' ? 1 : 0;
      P.armR.rotation.x = -0.9 - raise * 0.45;
      P.armL.rotation.x = -1.2 - raise * 0.35;
      P.armL.rotation.z = 0.5;
      P.armR.rotation.z = -0.15;
      if (P.rifle) {
        P.rifle.rotation.x = -0.15 - raise * 0.25 + (this.moving ? Math.sin(this.walkPhase * 2) * 0.03 : 0);
        P.rifle.position.y = 0.3 + raise * 0.12;
      }
      P.head.rotation.y = Math.sin(t * 0.9 + this.walkPhase) * 0.35;
      if (P.marker) P.marker.visible = Math.sin(t * 7 + this.walkPhase) > 0.3;
    } else {
      const armSwing = this.moving ? legSwing * 0.8 : Math.sin(t * 1.2) * 0.04;
      if (this.panic > 0 && !this.moving) {
        P.armL.rotation.x = -2.7; // hands over head
        P.armR.rotation.x = -2.7;
      } else if (this.pose === 'phone' || (P.prop === 'phone' && !this.moving && this.pose !== 'lookout')) {
        P.armR.rotation.x = -2.2;
        P.armR.rotation.z = -0.5;
        P.armL.rotation.x = -armSwing;
      } else {
        P.armL.rotation.x = -armSwing;
        P.armR.rotation.x = armSwing;
        P.armR.rotation.z = 0;
      }
      P.armL.rotation.z = 0.08;
      P.head.rotation.y = Math.sin(t * 0.4 + this.walkPhase) * 0.25;
    }
  }

  updateDeath(dt, effects) {
    this.deathT += dt;
    const P = this.parts;
    if (this.model === 'drone') {
      this.vy -= 9.8 * dt;
      this.pos.y += this.vy * dt;
      this.pos.x += this.vx * dt;
      this.pos.z += this.vz * dt;
      this.heading += this.spin * dt;
      P.body.rotation.z += dt * 2.5;
      this.root.position.copy(this.pos);
      this.root.rotation.y = this.heading;
      this.smokeT -= dt;
      if (this.smokeT <= 0 && effects) {
        this.smokeT = 0.06;
        effects.smoke(this.pos);
      }
      if (this.pos.y < 2 || this.deathT > 8) {
        this.dying = false;
        this.root.visible = false;
      }
      return;
    }
    const k = Math.min(1, this.deathT / 0.65);
    const e = k * k * (3 - 2 * k);
    P.body.rotation.x = -e * Math.PI / 2 * this.fallDir;
    P.body.position.y = -e * 0.05;
    P.legL.rotation.x *= 0.9;
    P.legR.rotation.x *= 0.9;
    if (k >= 1) this.dying = false;
  }
}

export class TargetManager {
  constructor(scene, rng) {
    this.targets = roster().map((d) => new Target(d, scene, rng));
  }
  reset() {
    for (const t of this.targets) t.reset();
  }
  update(dt, t, effects) {
    for (const tg of this.targets) tg.update(dt, t, effects);
  }
  get hostiles() {
    return this.targets.filter((t) => t.hostile);
  }
  hostilesRemaining() {
    return this.targets.filter((t) => t.hostile && t.alive).length;
  }
  aliveHitboxes() {
    const out = [];
    for (const t of this.targets) if (t.alive) out.push(...t.parts.hitboxes);
    return out;
  }

  // Nearest living target to the screen centre within radiusPx.
  findNearCrosshair(camera, width, height, radiusPx) {
    let best = null;
    let bestD = radiusPx;
    const v = new THREE.Vector3();
    for (const t of this.targets) {
      if (!t.alive) continue;
      t.chestWorld(v);
      v.project(camera);
      if (v.z > 1 || v.z < -1) continue;
      const sx = v.x * width * 0.5;
      const sy = v.y * height * 0.5;
      const d = Math.hypot(sx, sy);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  startleNear(point, radius, strength = 1) {
    if (!point) return;
    const v = new THREE.Vector3();
    for (const t of this.targets) {
      if (!t.alive) continue;
      if (t.chestWorld(v).distanceTo(point) < radius) t.startle(strength);
    }
  }
}
