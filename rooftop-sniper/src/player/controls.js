import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { SCOPE_LAYER } from '../entities/models.js';
import { audio } from '../audio/audio.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Mouse aim, scope, sway, breath hold and small rooftop movement.
// Two input modes:
//  - 'lock': pointer lock (default). The click that grabs the pointer never fires.
//  - 'drag': fallback when pointer lock is unavailable. Drag to aim; a short
//            click without movement fires, so adjusting the view never shoots.
export class Controls {
  constructor(game) {
    this.game = game;
    this.dom = game.canvas;
    this.camera = game.camera;
    this.mode = 'lock';
    this.locked = false;
    this.lockTime = 0;
    this.lockFailures = 0;
    this.expectUnlock = false;
    this.keys = new Set();
    this.drag = null;
    this.reset();
    this.bind();
  }

  reset() {
    this.yaw = 0;
    this.pitch = -0.07;
    this.pos = new THREE.Vector3(CONFIG.playerStart.x, CONFIG.roofHeight + CONFIG.eyeHeight, CONFIG.playerStart.z);
    this.scoped = false;
    this.zoomIndex = CONFIG.defaultZoom;
    this.fov = CONFIG.baseFov;
    this.breath = CONFIG.breathMax;
    this.exhausted = 0;
    this.holding = false;
    this.swayAmp = 0;
    this.sway = new THREE.Vector2();
    this.recoil = 0;
    this.recoilYaw = 0;
    this.bob = 0;
    this.moving = false;
    this.t = 0;
    this.camera.layers.disable(SCOPE_LAYER);
  }

  get zoom() {
    return this.scoped ? CONFIG.zoomLevels[this.zoomIndex] : 1;
  }

  targetFov() {
    const half = THREE.MathUtils.degToRad(CONFIG.baseFov / 2);
    return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(half) / this.zoom));
  }

  // True when the player can currently aim/shoot (pointer captured or drag mode).
  inputActive() {
    return this.mode === 'drag' || this.locked;
  }

  requestLock() {
    if (this.mode !== 'lock' || this.locked) return;
    try {
      const p = this.dom.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => {}); // handled by pointerlockerror
    } catch {
      this.onLockError();
    }
  }

  releaseLock() {
    if (document.pointerLockElement) {
      this.expectUnlock = true;
      document.exitPointerLock();
    }
  }

  onLockError() {
    this.lockFailures++;
    if (this.lockFailures >= 2) {
      this.mode = 'drag';
      this.game.hud.toast('Pointer lock unavailable: drag to aim, click to fire');
      this.game.hud.setLockPrompt(false);
      this.game.hud.setDragMode(true);
    } else {
      this.game.hud.toast('Click again to take aim');
    }
  }

  toggleScope(force) {
    const next = typeof force === 'boolean' ? force : !this.scoped;
    if (next === this.scoped) return;
    this.scoped = next;
    if (next) this.camera.layers.enable(SCOPE_LAYER);
    else this.camera.layers.disable(SCOPE_LAYER);
    audio.zoom();
    this.game.hud.setScoped(next);
  }

  changeZoom(dir) {
    if (!this.scoped) return;
    const n = clamp(this.zoomIndex + dir, 0, CONFIG.zoomLevels.length - 1);
    if (n !== this.zoomIndex) {
      this.zoomIndex = n;
      audio.zoom();
    }
  }

  kick() {
    this.recoil += this.scoped ? 0.022 : 0.035;
    this.recoilYaw += (Math.random() - 0.5) * 0.01;
  }

  rotate(dx, dy) {
    const sens = CONFIG.mouseSensitivity * (this.fov / CONFIG.baseFov) * (this.game.settings.sensitivity || 1);
    this.yaw = clamp(this.yaw - dx * sens, -CONFIG.yawLimit, CONFIG.yawLimit);
    this.pitch = clamp(this.pitch - dy * sens, CONFIG.pitchMin, CONFIG.pitchMax);
  }

  playing() {
    return this.game.state === 'playing';
  }

  bind() {
    const dom = this.dom;
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === dom;
      if (this.locked) {
        this.lockTime = performance.now();
        this.lockFailures = 0;
        this.game.hud.setLockPrompt(false);
      } else if (was) {
        if (!this.expectUnlock && this.playing()) this.game.pause();
        this.expectUnlock = false;
      }
    });
    document.addEventListener('pointerlockerror', () => this.onLockError());

    dom.addEventListener('mousedown', (e) => {
      if (!this.playing()) return;
      if (e.button === 2) {
        e.preventDefault();
        if (this.inputActive()) this.toggleScope();
        return;
      }
      if (e.button !== 0) return;
      if (this.mode === 'lock') {
        if (!this.locked) {
          this.requestLock(); // this click only captures the mouse
          return;
        }
        if (performance.now() - this.lockTime > 180) this.game.weapon.tryFire();
      } else {
        this.drag = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.playing()) return;
      if (this.locked) {
        this.rotate(e.movementX, e.movementY);
      } else if (this.mode === 'drag' && this.drag && e.buttons & 1) {
        if (Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y) > 5) this.drag.moved = true;
        if (this.drag.moved) this.rotate(e.movementX, e.movementY);
      }
    });

    document.addEventListener('mouseup', (e) => {
      if (e.button !== 0 || !this.drag) return;
      const d = this.drag;
      this.drag = null;
      if (this.playing() && this.mode === 'drag' && !d.moved && performance.now() - d.t < 400) {
        this.game.weapon.tryFire();
      }
    });

    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener(
      'wheel',
      (e) => {
        if (!this.playing()) return;
        e.preventDefault();
        this.changeZoom(e.deltaY < 0 ? 1 : -1);
      },
      { passive: false }
    );

    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      const g = this.game;
      if (e.code === 'Escape') {
        // With pointer lock, the browser consumes Escape and pointerlockchange pauses us.
        if (g.state === 'playing' && !this.locked) g.pause();
        else if (g.state === 'paused') g.resume();
        return;
      }
      if (e.repeat) return;
      if (g.state !== 'playing') return;
      if (e.code === 'KeyR') g.weapon.startReload();
      if (e.code === 'KeyH') g.hud.toggleHelp();
      if (e.code === 'KeyM') g.toggleAudio();
      if (e.code === 'KeyE' || e.code === 'KeyQ') this.changeZoom(e.code === 'KeyE' ? 1 : -1);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.drag = null;
      if (this.game.state === 'playing' && this.mode === 'drag') this.game.pause();
    });
  }

  update(dt) {
    this.t += dt;
    const k = this.keys;
    // --- small shuffle along the parapet ---
    let mx = 0, mz = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) mz -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) mz += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    this.moving = mx !== 0 || mz !== 0;
    if (this.moving) {
      const sp = CONFIG.moveSpeed * (this.scoped ? 0.4 : 1) * dt / Math.hypot(mx, mz);
      const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw);
      this.pos.x += (mx * cos + mz * sin) * sp;
      this.pos.z += (-mx * sin + mz * cos) * sp;
      const b = CONFIG.moveBounds;
      this.pos.x = clamp(this.pos.x, b.minX, b.maxX);
      this.pos.z = clamp(this.pos.z, b.minZ, b.maxZ);
      this.bob += dt * 8;
    }

    // --- breath hold (Shift) ---
    this.holding = (k.has('ShiftLeft') || k.has('ShiftRight')) && this.scoped && this.exhausted <= 0 && this.breath > 0;
    if (this.holding) {
      this.breath -= dt;
      if (this.breath <= 0) {
        this.breath = 0;
        this.exhausted = 2.2;
      }
    } else {
      this.exhausted = Math.max(0, this.exhausted - dt);
      this.breath = Math.min(CONFIG.breathMax, this.breath + dt * 0.9);
    }

    // --- sway ---
    let amp = CONFIG.swayAmplitude * (this.scoped ? 1 : 0.25);
    if (this.holding) amp *= 0.15;
    if (this.exhausted > 0) amp *= 2.2;
    if (this.moving) amp *= 2.5;
    this.swayAmp += (amp - this.swayAmp) * Math.min(1, dt * 4);
    const t = this.t;
    this.sway.set(
      this.swayAmp * (Math.sin(t * 0.83) * 0.7 + Math.sin(t * 1.91 + 1.3) * 0.3),
      this.swayAmp * (Math.sin(t * 1.17 + 0.5) * 0.55 + Math.sin(t * 0.47) * 0.45)
    );

    // --- recoil recovery ---
    this.recoil *= Math.exp(-dt * 7);
    this.recoilYaw *= Math.exp(-dt * 7);

    // --- zoom ---
    const tf = this.targetFov();
    this.fov += (tf - this.fov) * Math.min(1, dt * 14);
    if (Math.abs(this.fov - this.camera.fov) > 0.001) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
    this.apply();
  }

  apply() {
    const cam = this.camera;
    cam.position.copy(this.pos);
    cam.position.y += Math.sin(this.bob * 2) * 0.015 * (this.moving ? 1 : 0);
    cam.rotation.set(this.pitch + this.sway.y + this.recoil, this.yaw + this.sway.x + this.recoilYaw, 0, 'YXZ');
    cam.updateMatrixWorld();
  }
}
