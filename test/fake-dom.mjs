// A very small DOM shim: just enough surface for movy-subtitle-layer.js to run
// under Node so the track-binding behaviour can be exercised without Electron.
class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  _sync() { this.el._className = [...this.set].join(' '); }
  add(...names) { names.forEach((n) => n && this.set.add(n)); this._sync(); }
  remove(...names) { names.forEach((n) => this.set.delete(n)); this._sync(); }
  toggle(name, force) {
    const want = force === undefined ? !this.set.has(name) : !!force;
    if (want) this.set.add(name); else this.set.delete(name);
    this._sync();
    return want;
  }
  contains(name) { return this.set.has(name); }
  replaceFromString(value) {
    this.set = new Set(String(value || '').split(/\s+/).filter(Boolean));
  }
}

class FakeElement {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = doc;
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.style = { setProperty() {}, removeProperty() {} };
    this._className = '';
    this._text = '';
    this._listeners = new Map();
    this.classList = new ClassList(this);
    this.id = '';
  }
  get className() { return this._className; }
  set className(value) { this._className = String(value || ''); this.classList.replaceFromString(value); }
  get textContent() { return this._text; }
  set textContent(value) { this._text = String(value == null ? '' : value); }
  set innerHTML(html) {
    this.children = [];
    this._text = '';
    const doc = this.ownerDocument;
    const re = /<div([^>]*)>/g;
    let m;
    while ((m = re.exec(String(html)))) {
      const attrs = m[1];
      const cls = (attrs.match(/class="([^"]*)"/) || [])[1] || '';
      const el = new FakeElement('div', doc);
      el.className = cls;
      el.parentElement = this;
      this.children.push(el);
    }
  }
  get innerHTML() { return this._text; }
  appendChild(node) { node.parentElement = this; this.children.push(node); return node; }
  insertBefore(node, ref) {
    node.parentElement = this;
    const at = this.children.indexOf(ref);
    if (at < 0) this.children.push(node); else this.children.splice(at, 0, node);
    return node;
  }
  removeChild(node) {
    const at = this.children.indexOf(node);
    if (at >= 0) this.children.splice(at, 1);
    node.parentElement = null;
    return node;
  }
  remove() { if (this.parentElement) this.parentElement.removeChild(this); }
  contains(node) {
    if (node === this) return true;
    return this.children.some((child) => child.contains && child.contains(node));
  }
  matches(sel) {
    if (sel.startsWith('#')) return this.id === sel.slice(1);
    if (sel.startsWith('.')) return this.classList.contains(sel.slice(1));
    if (sel.startsWith('[data-sub-act')) return this.dataset.subAct !== undefined;
    if (sel.startsWith('[data-sub-track')) return this.dataset.subTrack !== undefined;
    if (sel.startsWith('[data-sub-online')) return this.dataset.subOnline !== undefined;
    if (sel === 'body') return this.tagName === 'BODY';
    return false;
  }
  closest(sel) {
    let node = this;
    while (node) {
      if (node.matches && node.matches(sel)) return node;
      node = node.parentElement;
    }
    return null;
  }
  querySelector(sel) {
    const parts = sel.trim().split(/\s+/);
    return this._query(parts);
  }
  _query(parts) {
    const [head, ...rest] = parts;
    const pool = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (child.matches && child.matches(head)) pool.push(child);
        walk(child);
      }
    };
    walk(this);
    if (!rest.length) return pool[0] || null;
    for (const candidate of pool) {
      const hit = candidate._query(rest);
      if (hit) return hit;
    }
    return null;
  }
  querySelectorAll(sel) {
    const found = [];
    const walk = (node) => { for (const child of node.children) { if (child.matches && child.matches(sel)) found.push(child); walk(child); } };
    walk(this);
    return found;
  }
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const list = this._listeners.get(type) || [];
    const at = list.indexOf(fn);
    if (at >= 0) list.splice(at, 1);
  }
  dispatchEvent(event) {
    event.target = event.target || this;
    event.currentTarget = this;
    if (!event.target.dataset) event.target.dataset = {};
    for (const fn of (this._listeners.get(event.type) || []).slice()) fn(event);
    return true;
  }
  click() { this.dispatchEvent({ type: 'click' }); }
  getBoundingClientRect() { return { left: 100, top: 100, right: 200, bottom: 140, width: 100, height: 40 }; }
  get currentSrc() { return this._currentSrc || ''; }
  get src() { return this._src || ''; }
  set src(value) { this._src = value; }
  addTextTrack() {
    return { mode: 'hidden', cues: [], addCue(cue) { this.cues.push(cue); }, removeCue(cue) { const i = this.cues.indexOf(cue); if (i >= 0) this.cues.splice(i, 1); } };
  }
}

export function createDom() {
  const observers = [];
  class FakeMutationObserver {
    constructor(cb) { this.cb = cb; observers.push(this); }
    observe() { this.observed = true; }
    disconnect() { this.observed = false; const i = observers.indexOf(this); if (i >= 0) observers.splice(i, 1); }
    trigger() { if (this.observed) this.cb([]); }
  }

  const document = new FakeElement('#document', null);
  const body = new FakeElement('body', document);
  body.parentElement = document;
  document.children.push(body);

  const modal = new FakeElement('div', document);
  modal.id = 'playerModal';
  modal.className = 'player-modal is-hidden';
  body.appendChild(modal);

  const stage = new FakeElement('div', document);
  stage.id = 'playerStage';
  modal.appendChild(stage);

  const video = new FakeElement('video', document);
  video.id = 'resourcePlayer';
  video.currentTime = 0;
  video._currentSrc = 'https://media.example/movie-1.m3u8';
  stage.appendChild(video);

  const actions = new FakeElement('div', document);
  actions.className = 'player-actions';
  modal.appendChild(actions);

  document.getElementById = (id) => document.querySelector('#' + id);
  document.body = body;

  const storage = new Map();
  const window = {
    document,
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => { storage.set(key, String(value)); },
      removeItem: (key) => { storage.delete(key); },
    },
    innerWidth: 1280,
    innerHeight: 800,
    fetch: async () => { throw new Error('network disabled in tests'); },
    VTTCue: class VTTCue { constructor(s, e, text) { this.startTime = s; this.endTime = e; this.text = text; } },
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    MutationObserver: FakeMutationObserver,
    AbortSignal: globalThis.AbortSignal,
    AbortController: globalThis.AbortController,
  };
  document.createElement = (tag) => new FakeElement(tag, document);
  document.querySelector = ((orig) => (sel) => {
    if (sel === 'body') return body;
    return orig.call(document, sel);
  })(document.querySelector.bind(document));
  document.querySelectorAll = document.querySelectorAll.bind(document);
  document.fullscreenElement = null;
  document.addEventListener = document.addEventListener.bind(document);

  return {
    window,
    document,
    body,
    modal,
    stage,
    video,
    actions,
    storage,
    observers,
    fireObserver() { observers.forEach((o) => o.trigger()); },
    openModal() { modal.classList.remove('is-hidden', 'is-closing'); modal.classList.add('is-open'); },
    closeModal() { modal.classList.remove('is-open'); modal.classList.add('is-hidden'); },
  };
}
