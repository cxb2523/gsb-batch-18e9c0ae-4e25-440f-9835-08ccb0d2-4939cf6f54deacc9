import { CONFIG, drop } from '../config.js';

const $ = (id) => document.getElementById(id);
const fmtTime = (s) => {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

// In-game HUD. Values are cached so the DOM is only touched when something changes.
export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'), time: $('hud-time'), hostiles: $('hud-hostiles'), civ: $('hud-civ'), score: $('hud-score'),
      windArrow: $('wind-arrow'), windSpeed: $('wind-speed'),
      rounds: $('ammo-rounds'), mag: $('ammo-mag'), reserve: $('ammo-reserve'), ammoStatus: $('ammo-status'),
      reloadBar: $('reload-bar'), reloadFill: document.querySelector('#reload-bar i'),
      scope: $('scope'), crosshair: $('crosshair'), zoom: $('scope-zoom'),
      breath: $('breath'), breathFill: document.querySelector('#breath .bar i'),
      range: $('range-readout'), idPanel: $('id-panel'), idType: $('id-type'), idRange: $('id-range'), idStatus: $('id-status'),
      holdMark: $('hold-mark'), hitmarker: $('hitmarker'), feed: $('feed'), miss: $('miss-info'),
      warning: $('warning'), lockPrompt: $('lock-prompt'), toast: $('toast'), help: $('help'),
      aim: $('btn-aim'), scopeFlash: $('scope-flash'), marks: $('holdover-marks'), app: $('app'),
      dragHint: document.querySelector('.drag-hint'),
    };
    this.cache = {};
    this.buildRounds();
    this.buildMarks();
  }

  set(key, el, value, prop = 'textContent') {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    el[prop] = value;
  }

  buildRounds() {
    this.el.rounds.innerHTML = '';
    this.roundEls = [];
    for (let i = 0; i < CONFIG.magSize; i++) {
      const r = document.createElement('i');
      this.el.rounds.appendChild(r);
      this.roundEls.push(r);
    }
  }

  buildMarks() {
    const ns = 'http://www.w3.org/2000/svg';
    this.markEls = [100, 200, 300].map((d, i) => {
      const g = document.createElementNS(ns, 'g');
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', '-3.5');
      line.setAttribute('x2', '3.5');
      line.setAttribute('stroke', '#050505');
      line.setAttribute('stroke-width', '0.5');
      const text = document.createElementNS(ns, 'text');
      text.setAttribute('x', '4.5');
      text.setAttribute('y', '1.2');
      text.textContent = String(i + 1);
      g.append(line, text);
      this.el.marks.appendChild(g);
      return { g, d };
    });
  }

  show(on) {
    this.el.hud.classList.toggle('hidden', !on);
    if (!on) {
      this.el.scope.classList.add('hidden');
      this.el.crosshair.classList.add('hidden');
      this.el.range.classList.add('hidden');
      this.el.idPanel.classList.add('hidden');
      this.el.holdMark.classList.add('hidden');
      this.el.lockPrompt.classList.add('hidden');
      this.el.warning.classList.add('hidden');
    } else {
      this.setScoped(false);
      this.el.range.classList.remove('hidden');
    }
    this.cache = {};
  }

  setScoped(on) {
    this.el.scope.classList.toggle('hidden', !on);
    this.el.crosshair.classList.toggle('hidden', on);
    this.el.range.classList.toggle('scoped', on);
    this.el.idPanel.classList.toggle('scoped', on);
    this.el.aim.classList.toggle('active', on);
    this.el.aim.textContent = on ? 'LEAVE SCOPE' : 'AIM';
    this.cache.idKind = null;
  }

  setDragMode(on) {
    this.el.dragHint.classList.toggle('hidden', !on);
  }

  setLockPrompt(on) {
    this.el.lockPrompt.classList.toggle('hidden', !on);
  }

  toggleHelp() {
    this.el.help.classList.toggle('hidden');
  }

  update(game) {
    const m = game.mission;
    const e = this.el;
    this.set('time', e.time, fmtTime(m.timeLeft));
    const low = m.timeLeft <= 30;
    if (this.cache.low !== low) {
      this.cache.low = low;
      e.time.classList.toggle('low', low);
    }
    this.set('hostiles', e.hostiles, `${game.targets.hostilesRemaining()} / ${CONFIG.hostilesRequired}`);
    this.set('civ', e.civ, `${m.civHits} / ${CONFIG.maxCivilianHits}`);
    this.set('score', e.score, m.score.toLocaleString('en-US'));

    // wind
    const w = game.wind.speed;
    this.set('windSpeed', e.windSpeed, `${Math.abs(w).toFixed(1)} m/s`);
    const arrow = Math.abs(w) < 0.3 ? '•' : w > 0 ? '→' : '←';
    this.set('windArrow', e.windArrow, arrow);

    // ammo
    const wp = game.weapon;
    const ammoKey = `${wp.mag}|${wp.reserve}|${wp.state}`;
    if (this.cache.ammo !== ammoKey) {
      this.cache.ammo = ammoKey;
      e.mag.textContent = wp.mag;
      e.reserve.textContent = wp.reserve;
      this.roundEls.forEach((r, i) => r.classList.toggle('spent', i >= wp.mag));
      let status = 'READY';
      let cls = '';
      if (wp.state === 'reloading') { status = 'RELOADING'; cls = 'reloading'; }
      else if (wp.state === 'cycling') { status = 'CHAMBERING'; cls = 'reloading'; }
      else if (wp.mag === 0 && wp.reserve === 0) { status = 'OUT OF AMMO'; cls = 'empty'; }
      else if (wp.mag === 0) { status = 'EMPTY — PRESS R'; cls = 'empty'; }
      e.ammoStatus.textContent = status;
      e.ammoStatus.className = cls;
      e.reloadBar.classList.toggle('on', wp.state === 'reloading');
    }
    if (wp.state === 'reloading') e.reloadFill.style.width = `${(wp.reloadProgress * 100).toFixed(1)}%`;

    // scope extras
    const c = game.controls;
    if (c.scoped) {
      this.set('zoom', e.zoom, `${CONFIG.zoomLevels[c.zoomIndex]}×`);
      e.breathFill.style.width = `${(c.breath / CONFIG.breathMax) * 100}%`;
      const bs = c.exhausted > 0 ? 'exhausted' : c.holding ? 'holding' : '';
      if (this.cache.breath !== bs) {
        this.cache.breath = bs;
        e.breath.className = bs;
      }
      this.updateMarks(game);
    }
  }

  // Place the 100/200/300 m drop ticks under the reticle centre for the current zoom.
  updateMarks(game) {
    const h = window.innerHeight;
    const w = window.innerWidth;
    const fov = (game.camera.fov * Math.PI) / 180;
    const pxPerRad = h / 2 / Math.tan(fov / 2);
    const scopeR = 0.42 * Math.min(w, h);
    const unitsPerPx = 100 / scopeR;
    for (const m of this.markEls) {
      const px = (drop(m.d) / m.d) * pxPerRad;
      const y = px * unitsPerPx;
      m.g.setAttribute('transform', `translate(0 ${y.toFixed(2)})`);
      m.g.style.display = y > 2 && y < 95 ? '' : 'none';
    }
  }

  setRange(dist) {
    const txt = dist == null ? 'DISTANCE — m' : `DISTANCE ${Math.round(dist)} m`;
    this.set('range', this.el.range, txt);
  }

  setIdPanel(info) {
    const e = this.el;
    if (!info) {
      if (this.cache.idVisible !== false) {
        this.cache.idVisible = false;
        e.idPanel.classList.add('hidden');
      }
      return;
    }
    if (this.cache.idVisible !== true) {
      this.cache.idVisible = true;
      e.idPanel.classList.remove('hidden');
    }
    if (this.cache.idKind !== info.kind) {
      this.cache.idKind = info.kind;
      e.idPanel.classList.remove('hostile', 'civilian', 'unknown');
      e.idPanel.classList.add(info.kind);
    }
    this.set('idType', e.idType, info.label);
    this.set('idRange', e.idRange, `${Math.round(info.range)} m`);
    this.set('idStatus', e.idStatus, info.status);
  }

  setHoldMark(x, y) {
    const e = this.el.holdMark;
    if (x == null) {
      if (!this.cache.holdHidden) {
        this.cache.holdHidden = true;
        e.classList.add('hidden');
      }
      return;
    }
    if (this.cache.holdHidden !== false) {
      this.cache.holdHidden = false;
      e.classList.remove('hidden');
    }
    e.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
  }

  restart(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth; // restart CSS animation
    el.classList.add(cls);
  }

  hitmarker(kind) {
    const h = this.el.hitmarker;
    h.classList.remove('civilian', 'head');
    if (kind === 'civilian') h.classList.add('civilian');
    if (kind === 'head') h.classList.add('head');
    this.restart(h, 'show');
  }

  muzzleFlash(scoped) {
    if (scoped) this.restart(this.el.scopeFlash, 'on');
  }

  feed(text, sub = '', cls = '') {
    const d = document.createElement('div');
    d.className = cls;
    d.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
    this.el.feed.prepend(d);
    while (this.el.feed.children.length > 5) this.el.feed.lastChild.remove();
    setTimeout(() => d.remove(), 4500);
  }

  missInfo(text) {
    const m = this.el.miss;
    m.textContent = text;
    this.restart(m, 'show');
    clearTimeout(this.missTimer);
    this.missTimer = setTimeout(() => m.classList.remove('show'), 3200);
  }

  civilianWarning() {
    const w = this.el.warning;
    w.classList.remove('hidden');
    this.restart(w, 'x');
    this.restart(this.el.app, 'civ-flash');
    clearTimeout(this.warnTimer);
    this.warnTimer = setTimeout(() => {
      w.classList.add('hidden');
      this.el.app.classList.remove('civ-flash');
    }, 2800);
  }

  toast(text, ms = 2200) {
    const t = this.el.toast;
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  clearTransient() {
    this.el.feed.innerHTML = '';
    this.el.miss.classList.remove('show');
    this.el.warning.classList.add('hidden');
    this.el.app.classList.remove('civ-flash');
    this.el.toast.classList.remove('show');
  }
}
