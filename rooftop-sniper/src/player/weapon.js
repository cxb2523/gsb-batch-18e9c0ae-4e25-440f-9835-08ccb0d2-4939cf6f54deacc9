import * as THREE from 'three';
import { CONFIG, drop, drift, flightTime } from '../config.js';
import { audio } from '../audio/audio.js';

// Segment lengths used to march the bullet's arc through the world.
const STEPS = (() => {
  const out = [];
  let s = 0;
  while (s < 400) out.push((s += 20));
  while (s < 1600) out.push((s += 100));
  return out;
})();

// Bullet position after travelling `s` metres along aim direction `dir`.
export function bulletPoint(origin, dir, s, wind, out = new THREE.Vector3()) {
  return out.copy(origin).addScaledVector(dir, s).add(new THREE.Vector3(drift(s, wind), -drop(s), 0));
}

export class Weapon {
  constructor(game) {
    this.game = game;
    this.raycaster = new THREE.Raycaster();
    this.reset();
  }

  reset() {
    this.mag = CONFIG.magSize;
    this.reserve = CONFIG.reserveAmmo;
    this.state = 'ready'; // ready | cycling | reloading
    this.timer = 0;
    this.inFlight = [];
    this.reloadQueued = false;
  }

  get totalAmmo() {
    return this.mag + this.reserve;
  }

  get reloadProgress() {
    return this.state === 'reloading' ? 1 - this.timer / CONFIG.reloadTime : -1;
  }

  get cycleProgress() {
    return this.state === 'cycling' ? 1 - this.timer / CONFIG.boltTime : 0;
  }

  startReload() {
    if (this.state === 'reloading') return;
    if (this.mag >= CONFIG.magSize) return this.game.hud.toast('Magazine full');
    if (this.reserve <= 0) return this.game.hud.toast('No reserve ammunition');
    if (this.state === 'cycling') {
      this.reloadQueued = true;
      return;
    }
    this.state = 'reloading';
    this.timer = CONFIG.reloadTime;
    audio.reload(CONFIG.reloadTime);
  }

  tryFire() {
    const g = this.game;
    if (this.state === 'reloading') return;
    if (this.state === 'cycling') return;
    if (this.mag <= 0) {
      audio.dry();
      if (this.reserve > 0) this.startReload();
      else g.hud.toast('Out of ammunition');
      return;
    }
    this.mag--;
    g.mission.shots++;
    audio.shot();
    this.fire();
    g.controls.kick();
    g.viewmodel.kick();
    g.hud.muzzleFlash(g.controls.scoped);
    this.state = 'cycling';
    this.timer = CONFIG.boltTime;
    audio.bolt(0.4);
  }

  // Cast the shot along a dropped, wind-drifted arc. Hit detection is resolved
  // at the moment of firing (forgiving vs. moving targets); impact effects and
  // scoring play out after the bullet's flight time.
  fire() {
    const g = this.game;
    const cam = g.camera;
    const origin = cam.getWorldPosition(new THREE.Vector3());
    const dir = cam.getWorldDirection(new THREE.Vector3());
    if (!g.controls.scoped) {
      // hip fire is noticeably less precise
      const s = CONFIG.hipSpread;
      const right = new THREE.Vector3().crossVectors(dir, cam.up).normalize();
      const up = new THREE.Vector3().crossVectors(right, dir).normalize();
      dir.addScaledVector(right, (Math.random() - 0.5) * 2 * s).addScaledVector(up, (Math.random() - 0.5) * 2 * s).normalize();
    }
    const wind = g.wind.speed;
    const colliders = g.getColliders();
    const rc = this.raycaster;
    let prevS = 0;
    const p0 = origin.clone();
    const p1 = new THREE.Vector3();
    let hit = null;
    let hitS = STEPS[STEPS.length - 1];
    for (const s of STEPS) {
      bulletPoint(origin, dir, s, wind, p1);
      const seg = p1.clone().sub(p0);
      const len = seg.length();
      rc.set(p0, seg.divideScalar(len));
      rc.near = 0;
      rc.far = len;
      const hits = rc.intersectObjects(colliders, false);
      if (hits.length) {
        hit = hits[0];
        hitS = prevS + hit.distance;
        break;
      }
      prevS = s;
      p0.copy(p1);
    }

    const end = hit ? hit.point.clone() : bulletPoint(origin, dir, hitS, wind);
    const t = flightTime(hitS);
    const targetHit = hit?.object?.userData?.target || null;
    const shot = {
      t,
      origin,
      dir: dir.clone(),
      point: end,
      distance: hitS,
      normal: hit?.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : null,
      target: targetHit,
      part: hit?.object?.userData?.part || null,
      hitSolid: !!hit && !targetHit,
      miss: targetHit ? null : this.analyseMiss(origin, dir, wind, hit ? hitS : Infinity),
    };
    // tracer from just below the muzzle line
    const muzzle = origin.clone().addScaledVector(dir, 1.2);
    muzzle.y -= g.controls.scoped ? 0.12 : 0.18;
    g.effects.tracer(muzzle, end, t);
    this.inFlight.push(shot);
  }

  // Explain a miss relative to the nearest living target along the shot line.
  analyseMiss(origin, dir, wind, hitDist) {
    const g = this.game;
    const cam = g.camera;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    let best = null;
    const c = new THREE.Vector3();
    const bp = new THREE.Vector3();
    for (const tg of g.targets.targets) {
      if (!tg.alive) continue;
      tg.chestWorld(c);
      const along = c.clone().sub(origin).dot(dir);
      if (along <= 0) continue;
      bulletPoint(origin, dir, along, wind, bp);
      const rel = bp.clone().sub(c);
      const off = Math.hypot(rel.y, rel.dot(right));
      if (off < 3.5 && (!best || off < best.off)) {
        best = { target: tg, along, off, vertical: rel.y, lateral: rel.dot(right) };
      }
    }
    if (!best) return { text: 'MISS' };
    const d = Math.round(best.along);
    if (hitDist < best.along - 1.5) {
      return { text: `MISS · BLOCKED BY COVER at ${Math.round(hitDist)} m`, target: best.target };
    }
    const v = best.vertical;
    const l = best.lateral;
    const windDrift = drift(best.along, wind);
    if (Math.abs(v) >= Math.abs(l)) {
      if (v < 0) {
        return { text: `MISS · ${(-v).toFixed(1)} m LOW — hold higher at ${d} m (drop ${drop(best.along).toFixed(1)} m)`, target: best.target };
      }
      return { text: `MISS · ${v.toFixed(1)} m HIGH — hold lower at ${d} m`, target: best.target };
    }
    const side = l > 0 ? 'RIGHT' : 'LEFT';
    const windNote = Math.abs(windDrift) > 0.12 && Math.sign(windDrift) === Math.sign(l)
      ? ` — wind pushed ${Math.abs(windDrift).toFixed(1)} m ${side.toLowerCase()}`
      : best.target.moving ? ' — keep the reticle on the moving target' : '';
    return { text: `MISS · ${Math.abs(l).toFixed(1)} m ${side}${windNote}`, target: best.target };
  }

  update(dt) {
    if (this.state !== 'ready') {
      this.timer -= dt;
      if (this.timer <= 0) {
        if (this.state === 'reloading') {
          const take = Math.min(CONFIG.magSize - this.mag, this.reserve);
          this.mag += take;
          this.reserve -= take;
          this.state = 'ready';
        } else if (this.state === 'cycling') {
          this.state = 'ready';
          if ((this.mag === 0 || this.reloadQueued) && this.reserve > 0) {
            this.reloadQueued = false;
            this.startReload();
          }
        }
      }
    }
    for (let i = this.inFlight.length - 1; i >= 0; i--) {
      const s = this.inFlight[i];
      s.t -= dt;
      if (s.t <= 0) {
        this.inFlight.splice(i, 1);
        this.game.resolveShot(s);
      }
    }
  }
}
