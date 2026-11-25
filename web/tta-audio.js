/* Sound for the browser build: plays what webaudio.py asks for. Short sounds are decoded into Web Audio buffers; long ones (music)
   are streamed through a few page audio elements so they do not take memory. */
(function () {
  const A = window.ttaAudio = {};
  const log = (m) => { try { if (window.tta && window.tta.plog) window.tta.plog('JS| audio ' + m); } catch (e) {} };
  let ctx = null, master = null, unlocked = false, keep = null;
  const bufs = new Map(), pend = new Map(), voices = new Map(), urls = new Map();
  // decoded sounds are kept (most recently used last) up to this many bytes; low-memory mode keeps fewer, and decodes a sound again when it is needed
  let bufBytes = 0, evicted = 0, decoded = 0;
  const CAP_NORMAL = 90 * 1024 * 1024, CAP_LOWMEM = 40 * 1024 * 1024;
  const cap = () => (window.tta && window.tta.lowmem ? CAP_LOWMEM : CAP_NORMAL);
  A.stats = () => ({ bytes: bufBytes, count: bufs.size, evicted, decoded, cap: cap() });
  const pool = [];
  function silentWav(samples) {
    const v = new DataView(new ArrayBuffer(44 + samples));
    const tag = (at, s) => { for (let i = 0; i < 4; i++) v.setUint8(at + i, s.charCodeAt(i)); };
    tag(0, 'RIFF'); v.setUint32(4, 36 + samples, true); tag(8, 'WAVE'); tag(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 8000, true);
    v.setUint16(32, 1, true); v.setUint16(34, 8, true); tag(36, 'data'); v.setUint32(40, samples, true);
    for (let i = 0; i < samples; i++) v.setUint8(44 + i, 128);
    return URL.createObjectURL(new Blob([v], { type: 'audio/wav' }));
  }
  const SILENT = silentWav(8000);

  // Audio mixing with other apps (iOS 16.4+, ignored elsewhere). "ambient" lets music from other apps keep playing under the game,
  // but the silent switch then mutes the game as well. "auto" (the default) lets the game take over the audio.
  let mixOn = false;
  A.mixOthers = (on) => { mixOn = !!on; try { if (navigator.audioSession) navigator.audioSession.type = on ? 'ambient' : 'auto'; } catch (e) { log('audioSession failed ' + e); } };
  try { if (window.localStorage.getItem('tta_mix') === '1') A.mixOthers(true); } catch (e) {}

  function context() {
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ctx = new C(); master = ctx.createGain(); master.connect(ctx.destination);
      try { ctx.addEventListener('statechange', () => { if (ctx.state !== 'running' && !document.hidden) complain('context is ' + ctx.state); else log('context ' + ctx.state); }); } catch (e) {}
    }
    return ctx;
  }
  function wake() {
    const c = ctx; if (!c) return;
    if (c.state !== 'running') c.resume().then(() => log('context ' + c.state)).catch((e) => log('resume failed ' + e));
    if (keep && keep.paused) keep.play().catch(() => {});
  }
  function unlock() {
    if (unlocked) { wake(); return; }
    const c = context(); if (!c) return;
    c.resume().then(() => log('context ' + c.state)).catch((e) => log('resume failed ' + e));
    try {
      // a silent looping page-audio element keeps iOS playing sound even with the silent switch on, and unlocks the music elements
      keep = new Audio(SILENT); keep.loop = true; keep.play().catch(() => {});
      for (let i = 0; i < 3; i++) {
        const a = new Audio(SILENT); a.loop = false;
        const slot = { el: a, id: 0, gain: null };
        try { const src = c.createMediaElementSource(a); slot.gain = c.createGain(); src.connect(slot.gain); slot.gain.connect(master); } catch (e) { log('media source failed ' + e); }
        a.addEventListener('error', () => complain('music element error code ' + (a.error && a.error.code) + ' ' + (a.error && a.error.message || '') + ' src ' + String(a.src).slice(0, 30)));
        a.play().then(() => a.pause()).catch(() => {});
        pool.push(slot);
      }
    } catch (e) {}
    unlocked = true; log('unlocked');
  }
  ['pointerup', 'touchend', 'click', 'keydown'].forEach((t) => addEventListener(t, unlock, true));
  // switching to another app: stop everything (music included) and pick it up again when the player comes back
  const held = [];
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      held.length = 0;
      pool.forEach((sl) => { if (!sl.el.paused) { held.push(sl.el); sl.el.pause(); } });
      if (keep) keep.pause();
      if (ctx) ctx.suspend();
    } else {
      if (ctx) ctx.resume();
      if (keep) keep.play().catch(() => {});
      held.forEach((el) => el.play().catch(() => {}));
      held.length = 0;
    }
  });

  // iOS can silence everything with no message (seen on iOS 27 after entering a street: sound effects and music both stop, and flipping
  // "Other apps audio" and back brings them back). Either the audio context's clock stops, or the context is "interrupted". The flip makes
  // iOS take the audio session again, so do the same ourselves when the sound has stopped, and say so in the log (live logs keep errors).
  let lastKick = 0, lastT = -1, stalled = 0, nBad = 0;
  function complain(m) { log(m); if (nBad++ < 25) { try { console.error('TTA audio: ' + m); } catch (e) {} } }
  function kick(why) {
    const now = Date.now(); if (now - lastKick < 4000) return; lastKick = now;
    complain('recovering sound (' + why + '); context ' + (ctx && ctx.state) + ', session ' + (navigator.audioSession ? navigator.audioSession.state : 'none'));
    try { if (navigator.audioSession) { navigator.audioSession.type = mixOn ? 'auto' : 'ambient'; navigator.audioSession.type = mixOn ? 'ambient' : 'auto'; } } catch (e) {}
    if (ctx) ctx.resume().catch(() => {});
    if (keep) keep.play().catch(() => {});
    pool.forEach((sl) => { if (sl.id && sl.el.paused && !sl.el.ended && sl.el.src && sl.el.src !== SILENT) sl.el.play().catch(() => {}); });
  }
  try { if (navigator.audioSession && navigator.audioSession.addEventListener) navigator.audioSession.addEventListener('statechange', () => { log('session ' + navigator.audioSession.state); if (navigator.audioSession.state === 'active' && unlocked && !document.hidden) kick('session active again'); }); } catch (e) {}
  setInterval(() => {
    if (!ctx || !unlocked || document.hidden) { lastT = -1; stalled = 0; return; }
    const t = ctx.currentTime, advanced = lastT < 0 || t - lastT > 0.5;
    lastT = t;
    if (ctx.state !== 'running' || !advanced) { if (++stalled >= 2) kick(ctx.state !== 'running' ? 'context ' + ctx.state : 'audio clock stopped'); }
    else stalled = 0;
  }, 2000);

  function bytes(path) { return window.FS.readFile(path); }
  const lazy = (path) => !!(window.tta && window.tta.lazyHas && window.tta.lazyHas(path));     // low-memory mode: this file stays in the saved pack, not in memory
  // the file's bytes as an ArrayBuffer (a promise: a lazy file is read from the saved pack)
  function fileBuffer(path) {
    if (lazy(path)) return window.tta.lazyBlob(path).then((b) => b.arrayBuffer());
    return new Promise((res) => { const u8 = bytes(path); res(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)); });
  }
  function decode(path) {
    if (bufs.has(path)) { const b = bufs.get(path); bufs.delete(path); bufs.set(path, b); return Promise.resolve(b); }
    if (pend.has(path)) return pend.get(path);
    const c = context(); if (!c) return Promise.resolve(null);
    const p = new Promise((res) => {
      fileBuffer(path).then((ab) => start(ab), (e) => { log('read failed ' + path + ' ' + (e && e.message)); pend.delete(path); res(null); });
      function start(ab) {
      const done = (b) => {
        pend.delete(path);
        if (b) { bufs.set(path, b); decoded++; bufBytes += b.length * b.numberOfChannels * 4; while (bufBytes > cap() && bufs.size > 1) { const k = bufs.keys().next().value; const o = bufs.get(k); bufs.delete(k); bufBytes -= o.length * o.numberOfChannels * 4; evicted++; } }
        res(b || null);
      };
      try { const r = c.decodeAudioData(ab, done, (e) => { log('decode failed ' + path + ' ' + (e && e.message)); done(null); }); if (r && r.catch) r.catch(() => {}); }
      catch (e) { log('decode threw ' + path); done(null); }
      }
    });
    pend.set(path, p); return p;
  }
  A.prep = function (path, isLong) { if (!isLong) decode(path); };

  function stopVoice(id) {
    const v = voices.get(id); if (!v) return;
    v.dead = true; voices.delete(id);
    try { if (v.src) { v.src.onended = null; v.src.stop(); } } catch (e) {}
    try { if (v.gain) v.gain.disconnect(); } catch (e) {}
    if (v.el) { try { v.el.pause(); } catch (e) {} v.slot.id = 0; }
  }
  A.stop = function (id) { stopVoice(id); };
  A.vol = function (id, vol) { const v = voices.get(id); if (!v) return; if (v.gain) v.gain.gain.value = vol; if (v.slot && v.slot.gain) v.slot.gain.gain.value = vol; };

  // the page address of a music file (a promise: a lazy file is a slice of the saved pack, read from disk as it plays)
  function blobUrl(path) {
    let u = urls.get(path);
    if (!u) {
      u = (lazy(path) ? window.tta.lazyBlob(path) : Promise.resolve(new Blob([bytes(path)], { type: 'audio/ogg' }))).then((b) => URL.createObjectURL(b));
      urls.set(path, u);
      u.catch(() => urls.delete(path));
      if (urls.size > 4) { const k = urls.keys().next().value; const old = urls.get(k); urls.delete(k); old.then((x) => URL.revokeObjectURL(x), () => {}); }
    }
    return u;
  }
  A.play = function (id, path, vol, loop, offset, isLong) {
    stopVoice(id);
    const v = { dead: false }; voices.set(id, v);
    if (isLong) {
      const slot = pool.find((s) => !s.id) || pool[0];
      if (!slot) { log('no audio element'); return; }
      if (slot.id) stopVoice(slot.id);
      slot.id = id; v.slot = slot; v.el = slot.el;
      const tp = performance.now(), short = path.slice(path.lastIndexOf('/') + 1);
      log('music play ' + short + (lazy(path) ? ' (read from the saved pack)' : ' (from memory)') + ' loop ' + !!loop);
      blobUrl(path).then((url) => {
        if (v.dead || slot.id !== id) return;             // the game stopped or replaced it while the file was being read
        try {
          const el = slot.el; el.src = url; el.loop = !!loop; if (slot.gain) slot.gain.gain.value = vol; else el.volume = Math.max(0, Math.min(1, vol));
          // the music only starts once its header has loaded; if the game stopped (or replaced) it before then, do not start it late,
          // or it plays on with nobody to stop it (Field Office music running on under the elevator music)
          const go = () => { if (v.dead || slot.id !== id) return; try { if (offset > 0) el.currentTime = offset; } catch (e) {} el.play().then(() => log('music started ' + short + ' after ' + Math.round(performance.now() - tp) + ' ms'), (e) => complain('music play blocked: ' + e)); };
          if (el.readyState >= 1) go(); else el.addEventListener('loadedmetadata', go, { once: true });
        } catch (e) { complain('music failed ' + e); }
      }, (e) => complain('music read failed ' + path + ' ' + (e && e.message)));
      return;
    }
    const c = context(); if (!c) return;
    decode(path).then((b) => {
      if (!b || v.dead || voices.get(id) !== v) return;
      const src = c.createBufferSource(); src.buffer = b; src.loop = !!loop;
      const g = c.createGain(); g.gain.value = vol; src.connect(g); g.connect(master);
      v.src = src; v.gain = g;
      src.onended = () => { if (voices.get(id) === v) voices.delete(id); try { g.disconnect(); } catch (e) {} };
      try { src.start(0, Math.min(offset || 0, Math.max(0, b.duration - 0.01))); } catch (e) { log('start failed ' + e); }
    });
  };
  setTimeout(() => log('ready; ogg vorbis: ' + (new Audio().canPlayType('audio/ogg; codecs="vorbis"') || 'no')), 1500);
})();
