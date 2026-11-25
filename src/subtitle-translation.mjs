// Track-scoped subtitle translation engine.
//
// Translations are stored per subtitle track (track key + language) instead of
// per raw cue text. Every track switch / play-context reopen / "AI bilingual"
// shutdown bumps an epoch, drops everything still queued and aborts requests
// that are already in flight, so a late result can never be written into the
// currently displayed track. Completed entries stay in the per-track cache and
// are reused the next time that same track is opened.
//
// The module is intentionally DOM-free so it can be unit tested with a
// controllable translation stub.

export const TRANSLATION_STORE_VERSION = 2;

const LANG_ALIASES = {
  eng: 'en', en: 'en', zho: 'zh', chi: 'zh', zh: 'zh', chs: 'zh', cht: 'zh', cmn: 'zh',
  jpn: 'ja', ja: 'ja', kor: 'ko', ko: 'ko', spa: 'es', es: 'es', fra: 'fr', fre: 'fr', fr: 'fr',
  deu: 'de', ger: 'de', de: 'de', rus: 'ru', ru: 'ru', ita: 'it', it: 'it', por: 'pt', pt: 'pt',
  nld: 'nl', dut: 'nl', nl: 'nl', swe: 'sv', sv: 'sv', dan: 'da', da: 'da', nor: 'no', no: 'no',
  fin: 'fi', fi: 'fi', ces: 'cs', cze: 'cs', cs: 'cs', hun: 'hu', hu: 'hu', ron: 'ro', rum: 'ro',
  ro: 'ro', ukr: 'uk', uk: 'uk', ell: 'el', gre: 'el', el: 'el', heb: 'he', he: 'he',
  ind: 'id', id: 'id', msa: 'ms', may: 'ms', ms: 'ms', pol: 'pl', pl: 'pl', tur: 'tr', tr: 'tr',
  tha: 'th', th: 'th', vie: 'vi', vi: 'vi', ara: 'ar', ar: 'ar', hin: 'hi', hi: 'hi',
  bul: 'bg', bg: 'bg', srp: 'sr', sr: 'sr', hrv: 'hr', hr: 'hr', slk: 'sk', slo: 'sk', sk: 'sk',
  slv: 'sl', sl: 'sl', lit: 'lt', lt: 'lt', lav: 'lv', lv: 'lv', est: 'et', et: 'et',
  cat: 'ca', ca: 'ca', fas: 'fa', per: 'fa', fa: 'fa', urd: 'ur', ur: 'ur', ben: 'bn', bn: 'bn',
  tam: 'ta', ta: 'ta', tel: 'te', te: 'te', mal: 'ml', ml: 'ml', kan: 'kn', kn: 'kn',
  mar: 'mr', mr: 'mr', guj: 'gu', gu: 'gu', pan: 'pa', pa: 'pa', nep: 'ne', ne: 'ne',
  sin: 'si', si: 'si', khm: 'km', km: 'km', lao: 'lo', lo: 'lo', mya: 'my', my: 'my',
  geo: 'ka', kat: 'ka', ka: 'ka', hye: 'hy', arm: 'hy', hy: 'hy', kaz: 'kk', kk: 'kk',
  uzb: 'uz', uz: 'uz', aze: 'az', az: 'az', bel: 'be', be: 'be', bos: 'bs', bs: 'bs',
  mkd: 'mk', mk: 'mk', alb: 'sq', sqi: 'sq', sq: 'sq', isl: 'is', ice: 'is', is: 'is',
  gle: 'ga', ga: 'ga', cym: 'cy', cy: 'cy', afr: 'af', af: 'af', swa: 'sw', sw: 'sw',
  amh: 'am', am: 'am', ceb: 'ceb', fil: 'tl', tgl: 'tl', tl: 'tl',
};

const CHINESE = ['zh', 'zho', 'chi', 'chs', 'cht', 'cmn'];

export function normalizeLang(code) {
  const base = String(code || '').toLowerCase().replace(/\(.*$/, '').trim();
  return LANG_ALIASES[base] || base;
}

export function isChineseLang(code, label) {
  if (/中文|chinese/i.test(String(code || '') + ' ' + String(label || ''))) return true;
  return CHINESE.includes(normalizeLang(code)) || CHINESE.includes(String(code || '').toLowerCase().trim());
}

// A stable identity for a subtitle track. Language is part of the key so the
// same line of dialogue on an English and a Japanese track never collides.
export function createTrackKey(track) {
  if (!track) return '';
  const lang = normalizeLang(track.language || track.lang || '') || 'und';
  const url = String(track.url || '');
  if (url.startsWith('local:')) return url + '|' + lang;
  if (track.online && track.payload && typeof track.payload === 'object') {
    const p = track.payload;
    const id = [p.source || '', p.slug || p.bvid || '', p.path || p.url || '', p.cid || ''].join(':');
    return 'online:' + id + '|' + lang;
  }
  return (url || 'unknown') + '|' + lang;
}

export function createTranslationEngine(options = {}) {
  const {
    translate,
    fallback = null,
    concurrency = 5,
    windowSize = 40,
    maxQueue = 200,
    maxPerTrack = 1500,
    maxTracks = 16,
    persistDelay = 4000,
    onUpdate = () => {},
    onCancel = () => {},
    now = () => Date.now(),
    writeStore = null,
    schedule = (fn, ms) => setTimeout(fn, ms),
    clearSchedule = (id) => clearTimeout(id),
  } = options;

  if (typeof translate !== 'function') throw new TypeError('createTranslationEngine: translate() is required');

  let epoch = 0;
  let trackKey = '';
  let lang = '';
  let enabled = true;
  let active = 0;
  let saveTimer = 0;
  let disposed = false;

  const caches = new Map();   // trackKey -> Map<text, translation>
  const meta = new Map();     // trackKey -> { at, lang }
  const pending = new Set();  // texts currently queued or in flight for the current track
  const queue = [];
  const controllers = new Set();

  const stats = { requests: 0, applied: 0, discarded: 0, cancelled: 0, fallbacks: 0, dropped: 0 };

  function ensure(key) {
    let map = caches.get(key);
    if (!map) { map = new Map(); caches.set(key, map); }
    return map;
  }

  function currentMap() {
    return trackKey ? ensure(trackKey) : null;
  }

  function invalidate(reason = 'switch') {
    epoch += 1;
    const info = { trackKey, lang, dropped: 0, pending: 0, inFlight: controllers.size };
    while (queue.length) {
      const job = queue.pop();
      job.cancelled = true;
      pending.delete(job.text);
      info.dropped += 1;
    }
    for (const controller of controllers) {
      try { controller.abort('stale'); } catch { /* ignore */ }
    }
    controllers.clear();
    info.pending = pending.size;
    pending.clear();
    // Freed concurrency slots immediately. Late settles from the old epoch must
    // not decrement the new epoch's counter (guarded in pump's finally).
    active = 0;
    stats.cancelled += info.dropped + info.pending;
    stats.dropped += info.dropped;
    if (info.dropped || info.pending || info.inFlight) {
      try { onCancel(reason, info); } catch { /* ignore */ }
    }
    return epoch;
  }

  function setTrack(key, langCode) {
    if (disposed) return null;
    const nextKey = String(key || '');
    const nextLang = normalizeLang(langCode || '');
    if (nextKey && nextKey === trackKey && nextLang === lang) {
      meta.set(trackKey, { at: now(), lang });
      return ensure(trackKey);
    }
    invalidate('track');
    trackKey = nextKey;
    lang = nextLang;
    if (!trackKey) return null;
    const map = ensure(trackKey);
    meta.set(trackKey, { at: now(), lang });
    return map;
  }

  function clearTrack() {
    return setTrack('', '');
  }

  function setEnabled(value) {
    const next = !!value;
    if (next === enabled || disposed) return enabled;
    enabled = next;
    if (!enabled) invalidate('ai-off');
    return enabled;
  }

  function isEnabled() { return enabled; }

  function get(text) {
    const map = currentMap();
    if (!map) return '';
    const value = map.get(text);
    return typeof value === 'string' ? value : '';
  }

  function has(text) {
    const map = currentMap();
    return !!map && map.has(text);
  }

  function isPending(text) { return pending.has(text); }

  function size() {
    const map = currentMap();
    return map ? map.size : 0;
  }

  // Queue the window of cues around `center` for translation. Only the current
  // track is filled; stale queue entries are dropped by pump().
  function queueCues(list, center = 0, opts = {}) {
    if (disposed || !enabled || !trackKey) return 0;
    if (isChineseLang(lang)) return 0;
    if (!Array.isArray(list) || !list.length) return 0;
    const map = ensure(trackKey);
    const window = Math.max(1, Number(opts.window) || windowSize);
    const at = Number.isFinite(Number(center)) ? Number(center) : 0;
    const from = Math.max(0, at - 2);
    const to = Math.min(list.length, Math.max(from, at) + window);
    let queued = 0;
    for (let i = from; i < to; i += 1) {
      const text = list[i] && list[i].t;
      if (!text) continue;
      if (map.has(text) || pending.has(text)) continue;
      if (queue.length >= maxQueue) { stats.dropped += 1; break; }
      pending.add(text);
      queue.push({ text, epoch, trackKey, lang });
      queued += 1;
    }
    if (queued) { stats.requests += 1; pump(); }
    return queued;
  }

  function apply(job, value) {
    if (!value || typeof value !== 'string') return false;
    if (job.epoch !== epoch || job.trackKey !== trackKey) {
      stats.discarded += 1;
      return false;
    }
    const map = ensure(job.trackKey);
    map.set(job.text, value);
    meta.set(job.trackKey, { at: now(), lang: job.lang });
    stats.applied += 1;
    prune(job.trackKey);
    scheduleSave();
    try { onUpdate(job.text, value); } catch { /* ignore */ }
    return true;
  }

  function pump() {
    while (!disposed && active < concurrency && queue.length) {
      const job = queue.shift();
      if (job.cancelled || job.epoch !== epoch) {
        stats.discarded += 1;
        if (job.epoch === epoch) pending.delete(job.text);
        continue;
      }
      active += 1;
      const jobEpoch = job.epoch;
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      if (controller) controllers.add(controller);
      const signal = controller ? controller.signal : undefined;
      Promise.resolve()
        .then(() => translate(job.text, job.lang, signal))
        .then((value) => { apply(job, value); })
        .catch(async () => {
          if (!fallback || job.epoch !== epoch || job.cancelled) { stats.discarded += 1; return; }
          try {
            const map = await fallback([job.text], job.lang, signal);
            if (map && typeof map === 'object') {
              stats.fallbacks += 1;
              apply(job, map[job.text]);
            }
          } catch { stats.discarded += 1; }
        })
        .finally(() => {
          if (jobEpoch === epoch) active = Math.max(0, active - 1);
          if (controller) controllers.delete(controller);
          if (job.epoch === epoch) pending.delete(job.text);
          pump();
        });
    }
  }

  function prune(keepKey) {
    const map = caches.get(keepKey);
    if (map) {
      while (map.size > maxPerTrack) {
        const first = map.keys().next().value;
        map.delete(first);
      }
    }
    while (caches.size > maxTracks) {
      let victim = '';
      let oldest = Infinity;
      for (const key of caches.keys()) {
        if (key === keepKey || key === trackKey) continue;
        const at = Number((meta.get(key) || {}).at) || 0;
        if (at < oldest) { oldest = at; victim = key; }
      }
      if (!victim) break;
      caches.delete(victim);
      meta.delete(victim);
    }
  }

  function pruneAll() {
    for (const key of [...caches.keys()]) prune(key);
  }

  function snapshot() {
    const tracks = {};
    for (const [key, map] of caches) {
      if (!map || !map.size) continue;
      const info = meta.get(key) || { at: 0, lang: '' };
      const items = {};
      for (const [text, value] of map) items[text] = value;
      tracks[key] = { at: Number(info.at) || 0, lang: info.lang || '', items };
    }
    return { v: TRANSLATION_STORE_VERSION, tracks };
  }

  function restore(store) {
    if (!store || store.v !== TRANSLATION_STORE_VERSION || !store.tracks || typeof store.tracks !== 'object') return 0;
    let restored = 0;
    for (const [key, entry] of Object.entries(store.tracks)) {
      if (!key || !entry || !entry.items || typeof entry.items !== 'object') continue;
      const map = ensure(key);
      for (const [text, value] of Object.entries(entry.items)) {
        if (typeof value !== 'string' || !value || map.has(text)) continue;
        map.set(text, value);
        restored += 1;
      }
      meta.set(key, { at: Number(entry.at) || 0, lang: normalizeLang(entry.lang || '') });
    }
    pruneAll();
    if (restored) dirty = true;
    return restored;
  }

  let dirty = false;

  function writeSnapshot() {
    if (!writeStore || !dirty) return;
    try { writeStore(snapshot()); dirty = false; } catch { /* ignore quota errors */ }
  }

  function scheduleSave() {
    dirty = true;
    if (!writeStore || saveTimer) return;
    saveTimer = schedule(() => {
      saveTimer = 0;
      writeSnapshot();
    }, persistDelay);
    if (saveTimer && typeof saveTimer.unref === 'function') saveTimer.unref();
  }

  function flush() {
    if (saveTimer) { clearSchedule(saveTimer); saveTimer = 0; }
    writeSnapshot();
  }

  function dispose() {
    if (disposed) return;
    invalidate('dispose');
    flush();
    disposed = true;
    caches.clear();
    meta.clear();
    queue.length = 0;
    pending.clear();
    controllers.clear();
  }

  return {
    setTrack,
    clearTrack,
    setEnabled,
    isEnabled,
    queueCues,
    get,
    has,
    isPending,
    size,
    invalidate,
    restore,
    snapshot,
    flush,
    dispose,
    currentTrackKey: () => trackKey,
    currentLang: () => lang,
    queueLength: () => queue.length,
    pendingCount: () => pending.size,
    activeCount: () => active,
    stats: () => ({ ...stats, queue: queue.length, pending: pending.size, active }),
  };
}
