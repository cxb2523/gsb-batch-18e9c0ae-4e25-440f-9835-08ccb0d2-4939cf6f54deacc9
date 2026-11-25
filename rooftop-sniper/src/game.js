import * as THREE from 'three';
import { CONFIG, drop, drift } from './config.js';
import { createSky, SUN_DIR, FOG_COLOR } from './world/sky.js';
import { buildCity } from './world/city.js';
import { buildPlayerRoof, createFlag } from './world/rooftop.js';
import { Ambient } from './world/ambient.js';
import { mulberry32 } from './world/textures.js';
import { TargetManager } from './entities/targets.js';
import { SCOPE_LAYER } from './entities/models.js';
import { Effects } from './fx/effects.js';
import { Controls } from './player/controls.js';
import { Weapon } from './player/weapon.js';
import { Viewmodel } from './player/viewmodel.js';
import { audio } from './audio/audio.js';
import { Hud } from './ui/hud.js';
import { Screens } from './ui/screens.js';

const SETTINGS_KEY = 'rooftop-sniper-settings';

// Owns the renderer, world, mission state and the state machine:
// title -> briefing -> playing <-> paused -> ending -> results
export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = 'loading';
    this.time = 0;
    this.settings = this.loadSettings();

    // ---------- renderer / scene ----------
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.autoClear = false;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(FOG_COLOR, 150, 1900);
    this.camera = new THREE.PerspectiveCamera(CONFIG.baseFov, window.innerWidth / window.innerHeight, 0.1, 5000);
    this.camera.rotation.order = 'YXZ';

    this.sky = createSky();
    this.scene.add(this.sky);
    this.scene.add(new THREE.HemisphereLight('#8d9cc8', '#3b2a26', 1.15));
    const sun = new THREE.DirectionalLight('#ffab66', 2.7);
    sun.position.copy(SUN_DIR).multiplyScalar(500);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight('#7085b8', 0.55);
    fill.position.set(0.3, 0.5, 1);
    this.scene.add(fill);

    // ---------- world ----------
    const city = buildCity(this.scene);
    const roof = buildPlayerRoof(this.scene);
    this.solids = [...city.solids, ...roof.solids];
    const flags = [roof.flag];
    for (const spot of city.flagSpots) {
      const f = createFlag(new THREE.Vector3(spot.x, spot.y - 0.5, spot.z), '#6f7f95', 1.6, 0.9);
      this.scene.add(f);
      flags.push(f);
    }
    this.ambient = new Ambient(this.scene, { flags, beacons: city.animated.beacons, windowPanels: city.animated.windowPanels });

    this.rng = mulberry32(Date.now() & 0xffff);
    this.targets = new TargetManager(this.scene, this.rng);
    this.effects = new Effects(this.scene);
    this.viewmodel = new Viewmodel();

    // ---------- systems ----------
    this.hud = new Hud();
    this.controls = new Controls(this);
    this.weapon = new Weapon(this);
    this.screens = new Screens(this);
    this.raycaster = new THREE.Raycaster();
    this.wind = { speed: 1.2, target: 1.2, timer: 10 };
    this.resetMission();

    window.addEventListener('resize', () => this.onResize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });

    this.timer = new THREE.Timer();
    this.showTitle();
    this.renderer.setAnimationLoop(() => this.frame());
    if (import.meta.env.DEV) window.__game = this; // handy for debugging in the console
  }

  loadSettings() {
    try {
      return { sensitivity: 1, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
    } catch {
      return { sensitivity: 1 };
    }
  }

  saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      /* ignore */
    }
  }

  resetMission() {
    this.mission = {
      timeLeft: CONFIG.missionTime,
      score: 0,
      kills: 0,
      civHits: 0,
      shots: 0,
      hostileHits: 0,
    };
    this.pendingEnd = null;
  }

  getColliders() {
    return this.solids.concat(this.targets.aliveHitboxes());
  }

  // ---------------- state transitions ----------------
  showTitle() {
    this.controls.releaseLock();
    this.state = 'title';
    this.hud.show(false);
    this.hud.clearTransient();
    this.controls.reset();
    this.targets.reset();
    this.effects.clear();
    this.camera.fov = CONFIG.baseFov - 6;
    this.camera.updateProjectionMatrix();
    this.screens.show('title');
  }

  showBriefing() {
    this.state = 'briefing';
    this.screens.show('briefing');
  }

  startMission() {
    audio.init();
    this.resetMission();
    this.targets.reset();
    this.weapon.reset();
    this.controls.reset();
    this.controls.apply();
    this.effects.clear();
    this.wind = { speed: (this.rng() - 0.5) * 2.4, target: 0, timer: 0 };
    this.hud.clearTransient();
    this.hud.show(true);
    this.hud.setDragMode(this.controls.mode === 'drag');
    this.camera.fov = CONFIG.baseFov;
    this.camera.updateProjectionMatrix();
    this.screens.hideAll();
    this.state = 'playing';
    this.controls.requestLock();
    this.hud.setLockPrompt(!this.controls.inputActive());
    this.hud.toast('Scope in (right-click) to identify targets', 3500);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.pausedAt = performance.now();
    this.controls.keys.clear();
    this.controls.releaseLock();
    this.hud.setLockPrompt(false);
    this.screens.show('pause');
  }

  resume(fromButton = false) {
    if (this.state !== 'paused') return;
    // ignore the Escape keypress that may arrive right after the browser released the pointer
    if (!fromButton && performance.now() - this.pausedAt < 400) return;
    this.state = 'playing';
    this.screens.hideAll();
    this.controls.requestLock();
    this.hud.setLockPrompt(!this.controls.inputActive());
  }

  toggleAudio() {
    audio.init();
    const on = audio.toggle();
    this.screens.syncAudio();
    if (this.state === 'playing') this.hud.toast(on ? 'Audio on' : 'Audio muted');
  }

  onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------- combat ----------------
  resolveShot(shot) {
    const m = this.mission;
    const S = CONFIG.score;
    const tg = shot.target;
    if (tg && tg.alive) {
      tg.kill(shot.dir);
      this.effects.bodyHit(shot.point);
      const dist = Math.round(shot.distance);
      if (tg.hostile) {
        m.kills++;
        m.hostileHits++;
        const head = shot.part === 'head';
        const pts = S.hostile + (head ? S.headshot : 0) + dist * S.perMetre;
        m.score += pts;
        this.hud.hitmarker(head ? 'head' : 'hostile');
        this.hud.feed(`${tg.model === 'drone' ? 'DRONE DOWN' : 'HOSTILE DOWN'} +${pts}`, `${dist} m${head ? ' · HEADSHOT' : ''}`);
        audio.hit();
        this.targets.startleNear(shot.point, 70, 1);
      } else {
        m.civHits++;
        m.score += S.civilian;
        this.hud.hitmarker('civilian');
        this.hud.civilianWarning();
        this.hud.feed('CIVILIAN HIT', `${S.civilian} · ${dist} m`, 'civ');
        audio.civilian();
        this.targets.startleNear(shot.point, 70, 1.5);
      }
    } else {
      if (shot.hitSolid || tg) {
        this.effects.impact(shot.point, shot.normal);
        audio.impact();
      }
      m.score += S.miss;
      this.hud.missInfo(shot.miss?.text || 'MISS');
      this.hud.feed('MISS', `${S.miss}`, 'miss');
      this.targets.startleNear(shot.point, 14, 1);
    }
  }

  checkEnd() {
    if (this.pendingEnd) return;
    const m = this.mission;
    const remaining = this.targets.hostilesRemaining();
    if (m.civHits >= CONFIG.maxCivilianHits) {
      this.endMission(false, `${m.civHits} civilians hit. The operation is compromised.`);
    } else if (remaining === 0) {
      this.endMission(true, 'All hostiles eliminated before last light.');
    } else if (m.timeLeft <= 0) {
      m.timeLeft = 0;
      this.endMission(false, `The sun has set — ${remaining} hostile${remaining > 1 ? 's' : ''} slipped away in the dark.`);
    } else if (this.weapon.totalAmmo === 0 && this.weapon.inFlight.length === 0) {
      this.endMission(false, `Out of ammunition with ${remaining} hostile${remaining > 1 ? 's' : ''} remaining.`);
    }
  }

  endMission(success, reason) {
    this.pendingEnd = { success, reason, t: success ? 1.6 : 1.2 };
    this.state = 'ending';
    this.controls.toggleScope(false);
    this.hud.setIdPanel(null);
    this.hud.setHoldMark(null);
  }

  finishMission() {
    const { success, reason } = this.pendingEnd;
    const m = this.mission;
    const accuracy = m.shots ? m.hostileHits / m.shots : 0;
    if (success) {
      m.score += Math.round(m.timeLeft) * CONFIG.score.perSecondLeft + Math.round(accuracy * CONFIG.score.accuracyBonus);
    }
    this.state = 'results';
    this.controls.releaseLock();
    this.hud.show(false);
    audio.result(success);
    this.screens.results({
      success, reason, score: m.score, kills: m.kills, required: CONFIG.hostilesRequired,
      civHits: m.civHits, accuracy, timeLeft: m.timeLeft,
    });
  }

  // ---------------- per-frame ----------------
  updateWind(dt) {
    const w = this.wind;
    w.timer -= dt;
    if (w.timer <= 0) {
      w.target = (this.rng() * 2 - 1) * CONFIG.maxWind;
      w.timer = 14 + this.rng() * 12;
    }
    w.speed += (w.target - w.speed) * Math.min(1, dt * 0.2);
    audio.setWind(w.speed);
  }

  // Rangefinder, target identification panel and holdover mark.
  updateAim() {
    const cam = this.camera;
    const rc = this.raycaster;
    const origin = cam.position;
    const dir = cam.getWorldDirection(new THREE.Vector3());
    rc.set(origin, dir);
    rc.near = 0;
    rc.far = 2500;
    const hits = rc.intersectObjects(this.getColliders(), false);
    this.hud.setRange(hits.length ? hits[0].distance : null);

    const w = window.innerWidth;
    const h = window.innerHeight;
    const scoped = this.controls.scoped;
    const radius = scoped ? Math.min(w, h) * 0.12 : Math.min(w, h) * 0.035;
    const tg = this.targets.findNearCrosshair(cam, w, h, radius);
    if (!tg) {
      this.hud.setIdPanel(null);
      this.hud.setHoldMark(null);
      return;
    }
    const chest = tg.chestWorld(new THREE.Vector3());
    const range = chest.distanceTo(origin);
    // cover check: is anything solid between us and the target's chest?
    const toT = chest.clone().sub(origin).normalize();
    rc.set(origin, toT);
    rc.far = range - 0.6;
    const blocked = rc.intersectObjects(this.solids, false).length > 0;
    const status = blocked || (tg.pose === 'crouch' && !tg.moving) ? 'IN COVER' : tg.moving ? 'MOVING' : 'EXPOSED';
    const kind = scoped ? (tg.hostile ? 'hostile' : 'civilian') : 'unknown';
    const label = scoped ? (tg.hostile ? (tg.model === 'drone' ? 'HOSTILE · DRONE' : 'HOSTILE') : 'CIVILIAN') : 'UNIDENTIFIED';
    this.hud.setIdPanel({ kind, label, range, status });

    if (scoped && range > 60) {
      // where to put the reticle so drop + wind land the round on the chest
      const aim = chest.clone();
      aim.y += drop(range);
      aim.x -= drift(range, this.wind.speed);
      aim.project(cam);
      this.hud.setHoldMark((aim.x * 0.5 + 0.5) * w, (-aim.y * 0.5 + 0.5) * h);
    } else {
      this.hud.setHoldMark(null);
    }
  }

  titleCamera(dt) {
    const t = this.time;
    const cam = this.camera;
    cam.position.set(Math.sin(t * 0.05) * 2.2, CONFIG.roofHeight + 2.3, -1.6);
    cam.rotation.set(-0.06 + Math.sin(t * 0.07) * 0.02, -0.12 + Math.sin(t * 0.045) * 0.5, 0, 'YXZ');
    cam.layers.disable(SCOPE_LAYER);
    cam.updateMatrixWorld();
  }

  frame() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.05);
    const st = this.state;
    const active = st === 'playing' && this.controls.inputActive();
    const simulate = st === 'title' || st === 'briefing' || st === 'ending' || active;

    if (st === 'playing') this.hud.setLockPrompt(!active);

    if (simulate) {
      this.time += dt;
      this.updateWind(dt);
      this.ambient.update(dt, this.wind.speed, this.camera);
      this.targets.update(dt, this.time, this.effects);
      this.effects.update(dt);
      if (st === 'playing' || st === 'ending') {
        this.controls.update(dt);
        this.weapon.update(dt);
      }
      if (st === 'playing') {
        this.mission.timeLeft -= dt;
        this.updateAim();
        this.hud.update(this);
        this.checkEnd();
      } else if (st === 'ending') {
        this.hud.update(this);
        this.pendingEnd.t -= dt;
        if (this.pendingEnd.t <= 0) this.finishMission();
      } else {
        this.titleCamera(dt);
      }
    }

    // ---------- render ----------
    const r = this.renderer;
    this.sky.position.copy(this.camera.position);
    r.clear();
    r.render(this.scene, this.camera);
    const inMission = st === 'playing' || st === 'paused' || st === 'ending';
    if (inMission && !this.controls.scoped) {
      if (simulate) {
        this.viewmodel.update(dt, this.camera, {
          reloadProgress: this.weapon.reloadProgress,
          cycling: this.weapon.cycleProgress,
          moving: this.controls.moving,
          bob: this.controls.bob,
        });
      }
      r.clearDepth();
      r.render(this.viewmodel.scene, this.camera);
    }
  }
}
