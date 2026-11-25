import './movy-subtitle.css';
import { createTranslationEngine, createTrackKey, isChineseLang, normalizeLang } from './subtitle-translation.mjs';

const SETTINGS_KEY = 'cineflow:movy-sub:v1';
const PLAYCTX_KEY = 'cineflow:movy-playctx:v1';
const TRANS_KEY = 'cineflow:movy-sub-trans:v2';
const TRANS_KEY_LEGACY = 'cineflow:movy-sub-trans:v1';
const CUE_WINDOW = 40;
const TICK_MS = 220;

const LANG_NAMES = {
  zho: '中文', chi: '中文', zh: '中文', chs: '简体中文', cht: '繁體中文',
  eng: 'English', en: 'English', jpn: '日本語', ja: '日本語', kor: '한국어', ko: '한국어',
  spa: 'Español', es: 'Español', fra: 'Français', fre: 'Français', fr: 'Français',
  deu: 'Deutsch', ger: 'Deutsch', de: 'Deutsch', rus: 'Русский', ru: 'Русский',
  ita: 'Italiano', it: 'Italiano', por: 'Português', pt: 'Português', ara: 'العربية', ar: 'العربية',
  hin: 'हिन्दी', hi: 'हिन्दी', tha: 'ไทย', th: 'ไทย', vie: 'Tiếng Việt', vi: 'Tiếng Việt',
  tur: 'Türkçe', tr: 'Türkçe', pol: 'Polski', pl: 'Polski', nld: 'Nederlands', dut: 'Nederlands',
  nl: 'Nederlands', swe: 'Svenska', sv: 'Svenska', dan: 'Dansk', da: 'Dansk', nor: 'Norsk', no: 'Norsk',
  fin: 'Suomi', fi: 'Suomi', ces: 'Čeština', cze: 'Čeština', cs: 'Čeština', hun: 'Magyar', hu: 'Magyar',
  ron: 'Română', rum: 'Română', ro: 'Română', ukr: 'Українська', uk: 'Українська',
  ell: 'Ελληνικά', gre: 'Ελληνικά', el: 'Ελληνικά', heb: 'עברית', he: 'עברית',
  ind: 'Bahasa Indonesia', id: 'Bahasa Indonesia', msa: 'Bahasa Melayu', may: 'Bahasa Melayu',
  bul: 'Български', bg: 'Български', srp: 'Српски', hrv: 'Hrvatski', slk: 'Slovenčina',
  slv: 'Slovenščina', lit: 'Lietuvių', lav: 'Latviešu', est: 'Eesti', cat: 'Català',
  fas: 'فارسی', per: 'فارسی', fa: 'فارسی', urd: 'اردو', ben: 'বাংলা', tam: 'தமிழ்',
  tel: 'తెలుగు', mal: 'മലയാളം', kan: 'ಕನ್ನಡ', mar: 'मराठी', guj: 'ગુજરાતી', pan: 'ਪੰਜਾਬੀ',
  nep: 'नेपाली', sin: 'සිංහල', khm: 'ខ្មែរ', lao: 'ລາວ', mya: 'မြန်မာ', geo: 'ქართული',
  kat: 'ქართული', hye: 'Հայերեն', arm: 'Հայերեն', kaz: 'Қазақша', uzb: 'Oʻzbekcha',
  aze: 'Azərbaycan', bel: 'Беларуская', bos: 'Bosanski', mkd: 'Македонски', alb: 'Shqip',
  sqi: 'Shqip', isl: 'Íslenska', gle: 'Gaeilge', cym: 'Cymraeg', afr: 'Afrikaans',
  swa: 'Kiswahili', amh: 'አማርኛ', ceb: 'Cebuano', fil: 'Filipino', tgl: 'Filipino',
};

function baseLang(code) {
  return String(code || '').toLowerCase().replace(/\(.*$/, '').trim();
}

function langLabel(code, label) {
  if (label) return String(label);
  const raw = String(code || '');
  const base = baseLang(raw);
  const name = LANG_NAMES[base];
  const suffix = /\(sdh\)|sdh|cc/i.test(raw) ? ' · SDH' : '';
  if (name) return name + suffix;
  return (base || raw || '未知') + suffix;
}

function isChinese(code, label) {
  return isChineseLang(code, label);
}

function readJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : fallback;
  } catch { return fallback; }
}

function writeJson(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch {  }
}

export function initMovySubtitle(deps = {}) {
  const doc = deps.document || (typeof document !== 'undefined' ? document : null);
  if (!doc || window.__cfSubReady) return () => {};
  window.__cfSubReady = true;

  const diag = window.__cfSub = { opens: 0, fetches: 0, cues: 0, translates: 0, renders: 0, discover: 0, discovered: 0, online: 0, errors: [] };
  const bridge = () => (window.cineflowMovy && typeof window.cineflowMovy.subCues === 'function' ? window.cineflowMovy : null);
  let overlay = null; let primary = null; let secondary = null;
  let panel = null; let button = null;
  let video = null;
  let tracks = []; let activeTrack = null;
  let onlineTracks = []; let onlineBusy = false; let onlineTried = false;
  let cues = []; let cueIndex = -1; let shownKey = '';
  let tickTimer = 0; let loadToken = 0;
  let currentKey = ''; let currentSrc = '';

  const settings = { ...readJson(SETTINGS_KEY, {}), size: 1, offset: 0, bottom: 9, ai: false, aiTouched: false, trackUrl: '' };

  const engine = createTranslationEngine({
    translate: directTranslate,
    fallback: mainTranslate,
    windowSize: CUE_WINDOW,
    concurrency: 5,
    maxQueue: 160,
    maxPerTrack: 1200,
    maxTracks: 6,
    persistDelay: 4000,
    writeStore: (snapshot) => writeJson(TRANS_KEY, snapshot),
    onUpdate: () => { tick(true); },
    onCancel: () => { shownKey = ''; },
  });
  migrateLegacyTranslations();
  engine.restore(readJson(TRANS_KEY, null));
  engine.setEnabled(!!settings.ai);

  function persist() { writeJson(SETTINGS_KEY, settings); }

  function modalOpen() {
    const modal = doc.querySelector('#playerModal');
    return !!modal && modal.classList.contains('is-open');
  }

  function playContext() {
    const data = readJson(PLAYCTX_KEY, null);
    if (!data || !data.title) return null;
    if (Date.now() - Number(data.at || 0) > 6 * 60 * 60 * 1000) return null;
    if (!Array.isArray(data.subtitles)) data.subtitles = [];
    return data;
  }

  function buildOverlay() {
    if (overlay && doc.body.contains(overlay)) return overlay;
    const stage = doc.querySelector('#playerStage');
    if (!stage) return null;
    overlay = doc.createElement('div');
    overlay.className = 'cf-sub-overlay';
    overlay.innerHTML = '<div class="cf-sub-grip"></div><div class="cf-sub-line cf-sub-primary"></div><div class="cf-sub-line cf-sub-secondary"></div>';
    primary = overlay.querySelector('.cf-sub-primary');
    secondary = overlay.querySelector('.cf-sub-secondary');
    stage.appendChild(overlay);
    applyGeometry();
    return overlay;
  }

  function applyGeometry() {
    if (!overlay) return;
    overlay.style.setProperty('--cf-sub-size', String(settings.size));
    overlay.style.setProperty('--cf-sub-bottom', String(settings.bottom) + '%');
  }

  function buildButton() {
    const actions = doc.querySelector('#playerModal .player-actions');
    if (!actions) return false;
    if (button && actions.contains(button)) return true;
    button = doc.createElement('button');
    button.type = 'button';
    button.id = 'cfSubBtn';
    button.className = 'secondary-button cf-sub-btn';
    button.textContent = '字幕';
    actions.insertBefore(button, actions.firstChild);
    button.addEventListener('click', () => togglePanel());
    return true;
  }

  function buildPanel() {
    if (panel) return panel;
    panel = doc.createElement('div');
    panel.id = 'cfSubPanel';
    panel.className = 'cf-sub-panel is-hidden';
    doc.body.appendChild(panel);
    panel.addEventListener('click', (event) => {
      const row = event.target && event.target.closest ? event.target.closest('[data-sub-track]') : null;
      if (row) { chooseTrack(row.dataset.subTrack); return; }
      const onlineRow = event.target && event.target.closest ? event.target.closest('[data-sub-online]') : null;
      if (onlineRow) { chooseOnline(Number(onlineRow.dataset.subOnline)); return; }
      const act = event.target && event.target.closest ? event.target.closest('[data-sub-act]') : null;
      if (!act) return;
      const kind = act.dataset.subAct;
      if (kind === 'ai') {
        settings.ai = !settings.ai; settings.aiTouched = true; persist(); renderPanel();
        engine.setEnabled(!!settings.ai);
        if (settings.ai) primeTranslate();
        else { shownKey = ''; tick(true); }
      }
      if (kind === 'size+') { settings.size = Math.min(1.7, Number((settings.size + 0.1).toFixed(2))); persist(); applyGeometry(); renderPanel(); }
      if (kind === 'size-') { settings.size = Math.max(0.6, Number((settings.size - 0.1).toFixed(2))); persist(); applyGeometry(); renderPanel(); }
      if (kind === 'offset-') { settings.offset = Number((settings.offset - 0.2).toFixed(1)); persist(); renderPanel(); tick(true); }
      if (kind === 'offset+') { settings.offset = Number((settings.offset + 0.2).toFixed(1)); persist(); renderPanel(); tick(true); }
      if (kind === 'reset') { settings.offset = 0; settings.bottom = 9; settings.size = 1; persist(); applyGeometry(); renderPanel(); tick(true); }
      if (kind === 'off') { chooseTrack(''); }
      if (kind === 'load') { loadLocalFile(); }
      if (kind === 'search') { onlineTried = false; searchOnline(playContext()); }
    });
    return panel;
  }

  function positionPanel() {
    if (!panel || !button) return;
    const rect = button.getBoundingClientRect();
    const width = 300;
    const left = Math.min(Math.max(12, rect.left - width + 70), Math.max(12, window.innerWidth - width - 12));
    panel.style.width = width + 'px';
    panel.style.left = Math.round(left) + 'px';
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < 320) {
      panel.style.top = 'auto';
      panel.style.bottom = Math.round(window.innerHeight - rect.top + 8) + 'px';
    } else {
      panel.style.bottom = 'auto';
      panel.style.top = Math.round(rect.bottom + 8) + 'px';
    }
  }

  function togglePanel() {
    buildPanel();
    const host = fullscreenHost();
    const mount = host && host !== 'video' ? host : doc.body;
    if (panel && panel.parentElement !== mount) mount.appendChild(panel);
    const hidden = panel.classList.contains('is-hidden');
    if (hidden) { renderPanel(); positionPanel(); panel.classList.remove('is-hidden'); }
    else panel.classList.add('is-hidden');
  }

  function renderPanel() {
    if (!panel) return;
    const rows = (list, prefix) => list.map((track, index) => {
      const active = activeTrack && activeTrack.url === track.url;
      const label = langLabel(track.language || track.lang, track.label);
      return '<button type="button" class="cf-sub-track' + (active ? ' is-active' : '') + '" data-sub-track="' + encodeURIComponent(track.url || '') + '"'
        + (track.online ? ' data-sub-online="' + index + '"' : '') + '>'
        + '<span>' + label + '</span><em>' + (track.online ? '在线' : String(track.lang || track.language || '').toUpperCase()) + '</em></button>';
    }).join('');
    const list = tracks.length || onlineTracks.length
      ? rows(tracks) + (onlineTracks.length ? '<p class="cf-sub-hint">在线字幕（来自字幕站）</p>' + rows(onlineTracks, 'online') : '')
      : (onlineBusy ? '<p class="cf-sub-hint">正在找在线字幕…</p>' : '<p class="cf-sub-hint">该片源没有字幕轨</p>');
    const aiDisabled = !activeTrack || isChinese(activeTrack.language || activeTrack.lang, activeTrack.label);
    panel.innerHTML = [
      '<div class="cf-sub-head"><strong>字幕</strong><em>' + (activeTrack ? langLabel(activeTrack.language || activeTrack.lang) : '关闭') + '</em></div>',
      '<div class="cf-sub-list">',
      '<button type="button" class="cf-sub-track' + (!activeTrack ? ' is-active' : '') + '" data-sub-track=""><span>关闭字幕</span><em>OFF</em></button>',
      list,
      '</div>',
      '<div class="cf-sub-tools">',
      '<button type="button" class="cf-sub-tool' + (settings.ai ? ' is-on' : '') + '" data-sub-act="ai"' + (aiDisabled ? ' disabled title="选中非中文字幕轨后可用"' : '') + '>AI 双语</button>',
      '<button type="button" class="cf-sub-tool" data-sub-act="size-">A-</button>',
      '<button type="button" class="cf-sub-tool" data-sub-act="size+">A+</button>',
      '<button type="button" class="cf-sub-tool" data-sub-act="offset-">-' + Math.abs(settings.offset).toFixed(1) + 's</button>',
      '<button type="button" class="cf-sub-tool" data-sub-act="offset+">+' + Math.abs(settings.offset).toFixed(1) + 's</button>',
      '<button type="button" class="cf-sub-tool" data-sub-act="load">载入字幕</button>',
      '<button type="button" class="cf-sub-tool" data-sub-act="search">搜在线</button>',
      '<button type="button" class="cf-sub-tool" data-sub-act="reset">复位</button>',
      '</div>',
      '<p class="cf-sub-note">拖字幕可调高度 · V 开关 · , . 调延迟</p>',
    ].join('');
  }

  function pickDefaultTrack(list) {
    if (!list.length) return null;
    const zh = list.find((item) => isChinese(item.language || item.lang, item.label) && !/sdh/i.test(String(item.language || '')))
      || list.find((item) => isChinese(item.language || item.lang, item.label));
    if (zh) return zh;
    const eng = list.find((item) => baseLang(item.language || item.lang) === 'eng');
    return eng || list[0];
  }

  async function chooseTrack(url) {
    const wanted = decodeURIComponent(String(url || ''));
    if (!wanted) {
      activeTrack = null; cues = []; cueIndex = -1; shownKey = '';
      engine.clearTrack();
      if (primary) primary.textContent = '';
      if (secondary) { secondary.textContent = ''; secondary.classList.remove('is-on'); }
      settings.trackUrl = ''; persist(); renderPanel(); updateButton();
      return;
    }
    const track = tracks.find((item) => item.url === wanted) || null;
    if (!track) return;
    activeTrack = track;
    settings.trackUrl = track.url;
    persist();
    renderPanel();
    updateButton();
    await loadCues(track);
  }

  async function applyLocalCues(list, name) {
    if (!Array.isArray(list) || !list.length) return;
    const entry = { url: 'local:' + (name || 'file'), lang: 'local', language: 'local', label: name || '本地字幕', online: true };
    activeTrack = entry;
    tracks = [entry];
    cueIndex = -1; shownKey = '';
    nativeLastIndex = -2;
    if (nativeTrack) nativeTrack.mode = 'hidden';
    clearNative();
    settings.trackUrl = entry.url;
    persist();
    renderPanel();
    updateButton();
    cues = list.slice().sort((a, b) => a.s - b.s);
    diag.cues = cues.length;
    bindTranslationTrack(entry);
    primeTranslate();
    tick(true);
  }

  async function loadLocalFile() {
    const api = bridge();
    if (!api || typeof api.subPick !== 'function') return;
    try {
      const result = await api.subPick();
      if (!result || result.canceled) return;
      if (!result.ok) { diag.errors.push(result.error || '本地字幕解析失败'); renderPanel(); return; }
      await applyLocalCues(result.cues, result.name);
    } catch (error) { diag.errors.push('load: ' + String((error && error.message) || error)); }
  }

  async function chooseOnline(index) {
    const track = onlineTracks[index];
    if (!track) return;
    activeTrack = track;
    settings.trackUrl = track.url;
    persist();
    renderPanel();
    updateButton();
    await loadCues(track);
  }

  async function loadCues(track) {
    const api = bridge();
    if (!api || !track) return;
    const token = ++loadToken;
    cues = []; cueIndex = -1; shownKey = '';
    nativeLastIndex = -2;
    if (nativeTrack) nativeTrack.mode = 'hidden';
    clearNative();
    bindTranslationTrack(track);
    if (primary) primary.textContent = '';
    if (secondary) secondary.textContent = '';
    diag.fetches += 1;
    try {
      const result = track.online
        ? await api.subOnlineLoad({ track: track.payload })
        : await api.subCues({ url: track.url, lang: track.lang || track.language || '' });
      if (token !== loadToken) return;
      if (result && result.ok && Array.isArray(result.cues)) {
        cues = result.cues;
        diag.cues = cues.length;
        primeTranslate();
        tick(true);
      } else {
        diag.errors.push((result && result.error) || '字幕解析失败');
        renderPanel();
      }
    } catch (error) {
      diag.errors.push(String((error && error.message) || error));
    }
  }

  function findCueIndex(time) {
    if (!cues.length) return -1;
    let lo = 0; let hi = cues.length - 1; let hit = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].s <= time) { hit = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    if (hit < 0) return -1;
    return time < cues[hit].e ? hit : -1;
  }

  function bindTranslationTrack(track) {
    if (!track) { engine.clearTrack(); return; }
    engine.setEnabled(!!settings.ai);
    engine.setTrack(createTrackKey(track), track.lang || track.language || '');
  }

  // Old builds keyed translations by raw cue text only (no track/language), so a
  // line could be reused across different subtitle languages. That format is
  // ambiguous; drop it rather than risk showing the wrong translation.
  function migrateLegacyTranslations() {
    try {
      if (window.localStorage.getItem(TRANS_KEY_LEGACY) !== null) window.localStorage.removeItem(TRANS_KEY_LEGACY);
    } catch { /* ignore */ }
  }

  async function directTranslate(text, from, signal) {
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl='
      + encodeURIComponent(from || 'auto') + '&tl=zh-CN&q=' + encodeURIComponent(text);
    const timeout = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(2500) : null;
    let merged = signal || undefined;
    if (timeout && signal && typeof AbortSignal.any === 'function') merged = AbortSignal.any([signal, timeout]);
    else if (!merged && timeout) merged = timeout;
    const response = await window.fetch(url, { mode: 'cors', signal: merged });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    const pieces = Array.isArray(data && data[0]) ? data[0] : [];
    return pieces.map((part) => (Array.isArray(part) ? String(part[0] || '') : '')).join('');
  }

  async function mainTranslate(texts, from) {
    const api = bridge();
    if (!api || typeof api.subTranslate !== 'function') return {};
    const result = await api.subTranslate({
      texts,
      from,
      to: 'zh-CN',
      lang: normalizeLang(from || ''),
      trackKey: engine.currentTrackKey(),
    });
    return (result && result.map) || {};
  }

  function pumpTranslate() {
    engine.queueCues(cues, cueIndex >= 0 ? cueIndex : 0, { window: CUE_WINDOW });
  }

  function primeTranslate() {
    if (!settings.ai || !activeTrack || !cues.length) return;
    if (isChineseLang(activeTrack.language || activeTrack.lang, activeTrack.label)) return;
    const before = engine.stats().requests;
    pumpTranslate();
    if (engine.stats().requests !== before) {
      diag.translates += 1;
      diag.ai = !!settings.ai;
    }
  }

  function renderCue(index) {
    if (!primary || !secondary) return;
    if (index < 0) {
      if (primary.textContent) primary.textContent = '';
      if (secondary.textContent) secondary.textContent = '';
      shownKey = '';
      return;
    }
    const cue = cues[index];
    const translated = settings.ai ? engine.get(cue.t) : '';
    const key = cue.t + '|' + translated;
    if (key === shownKey) return;
    shownKey = key;
    diag.renders += 1;
    primary.textContent = cue.t;
    secondary.textContent = translated;
    secondary.classList.toggle('is-on', !!translated);
    if (settings.ai && !translated && !engine.isPending(cue.t)) primeTranslate();
  }

  function tick(force) {
    if (!force && watchSwitch()) return;
    const el = doc.querySelector('#resourcePlayer') || video;
    if (el && nativeTrack && nativeTrack.mode === 'showing') {
      const now = Math.max(0, (Number(el.currentTime) || 0) + (Number(settings.offset) || 0));
      if (findCueIndex(now) !== nativeLastIndex) syncNativeTrack(true);
    }
    if (!el) return;
    if (el !== video) { video = el; cueIndex = -1; shownKey = ''; }
    if (!activeTrack) return;
    const time = Math.max(0, (Number(el.currentTime) || 0) + (Number(settings.offset) || 0));
    const index = findCueIndex(time);
    if (index !== cueIndex || force) {
      cueIndex = index;
      renderCue(index);
      if (settings.ai && index >= 0) primeTranslate();
      if (nativeTrack && nativeTrack.mode === 'showing') syncNativeTrack(true);
    }
  }

  function updateButton() {
    if (!button) return;
    const label = activeTrack ? langLabel(activeTrack.language || activeTrack.lang, activeTrack.label) : '字幕';
    button.textContent = activeTrack ? '字幕 · ' + label : '字幕';
    button.classList.toggle('is-on', !!activeTrack);
  }

  // Listeners attached to the shared <video> element. They are detached on
  // dispose too, so a closed player leaves no stray handlers behind.
  const videoListeners = [];
  function onVideo(el, type, handler) {
    if (!el || !el.addEventListener) return;
    el.addEventListener(type, handler);
    videoListeners.push([el, type, handler]);
  }
  function removeVideoListeners() {
    while (videoListeners.length) {
      const [el, type, handler] = videoListeners.pop();
      try { el.removeEventListener(type, handler); } catch { /* ignore */ }
      try { el.__cfSubWatched = false; } catch { /* ignore */ }
    }
  }

  function attach() {
    const el = doc.querySelector('#resourcePlayer');
    buildOverlay();
    buildButton();
    if (el && el !== video) {
      video = el;
      video.__cfSubBound = true;
    }
    if (el && !el.__cfSubWatched) {
      el.__cfSubWatched = true;
      onVideo(el, 'emptied', () => { if (modalOpen()) watchSwitch(); });
      onVideo(el, 'loadedmetadata', () => { if (modalOpen()) watchSwitch(); });
    }
    if (!tickTimer) tickTimer = window.setInterval(() => { if (modalOpen()) tick(false); }, TICK_MS);
    updateButton();
    renderPanel();
  }

  function stopTicker() {
    if (tickTimer) { window.clearInterval(tickTimer); tickTimer = 0; }
  }

  // Stop all background work tied to a play context: cue timer, queued/in-flight
  // translations for the old track. Called when the player closes or switches.
  function teardown() {
    stopTicker();
    engine.clearTrack();
    // Persist whatever finished before the pending debounce fires, then let the
    // debounce die with the play context instead of writing after close.
    engine.flush();
    if (panel && !panel.classList.contains('is-hidden')) panel.classList.add('is-hidden');
    // Forget the last-opened context so reopening the same film reloads cues.
    openFor.lastAt = 0;
  }

  function normalizeTracks(list) {
    return (Array.isArray(list) ? list : [])
      .filter((item) => item && typeof item.url === 'string' && /^https?:/i.test(item.url))
      .slice(0, 40)
      .map((item) => ({ url: item.url, lang: item.lang || item.language || '', language: item.language || item.lang || '' }));
  }

  function discoverTracks(context) {
    const api = bridge();
    if (!api) return;
    if (!context || !context.streamUrl || typeof api.subDiscover !== 'function') { huntOtherProviders(context); return; }
    const gen = contextGen;
    diag.discover += 1;
    api.subDiscover({ streamUrl: context.streamUrl, subtitles: [] })
      .then((result) => {
        if (gen !== contextGen) return;
        const found = normalizeTracks(result && result.tracks);
        diag.discovered = found.length;
        if (!found.length) { huntOtherProviders(context, gen); return; }
        applyTracks(found);
      })
      .catch((error) => { if (gen !== contextGen) return; diag.errors.push('discover: ' + String((error && error.message) || error)); huntOtherProviders(context, gen); });
  }

  function applyTracks(found) {
    tracks = found;
    renderPanel();
    const target = pickDefaultTrack(found);
    if (target) chooseTrack(encodeURIComponent(target.url));
  }

  async function huntOtherProviders(context, gen = contextGen) {
    const api = bridge();
    if (!api || typeof api.sources !== 'function' || !context) { searchOnline(context, gen); return; }
    const tried = new Set([String(context.provider || '')]);
    let all = [];
    try {
      const cached = JSON.parse(window.localStorage.getItem('cineflow:movy-providers:v1') || 'null');
      if (cached && Array.isArray(cached.list)) all = cached.list;
    } catch {  }
    if (!all.length) all = ['Miami', 'Boise', 'Nashville', 'Chicago', 'Vegas', 'Tokyo', 'Berlin', 'Paris'];
    const pool = all.map((item) => (typeof item === 'string' ? item : (item && (item.name || item.id)) || ''))
      .filter((name) => name && !tried.has(name));
    for (const provider of pool) {
      if (gen !== contextGen) return;
      try {
        diag.hunt = (diag.hunt || 0) + 1;
        const result = await api.sources({
          provider,
          mediaType: context.mediaType,
          title: context.title,
          year: context.year,
          tmdbId: context.tmdbId,
          seasonId: context.seasonId,
          episodeId: context.episodeId,
        });
        if (gen !== contextGen) return;
        const found = normalizeTracks(result && result.subtitles);
        if (found.length) { diag.huntHit = provider; applyTracks(found); return; }
      } catch {  }
    }
    if (gen !== contextGen) return;
    renderPanel();
    searchOnline(context, gen);
  }

  async function searchOnline(context, gen = contextGen) {
    const api = bridge();
    if (onlineTried || !api || typeof api.subOnline !== 'function' || !context) return;
    onlineTried = true;
    onlineBusy = true;
    renderPanel();
    try {
      const result = await api.subOnline({
        title: context.title,
        year: context.year,
        mediaType: context.mediaType,
        season: context.seasonId,
        episode: context.episodeId,
      });
      if (gen !== contextGen) return;
      const list = (result && Array.isArray(result.tracks) ? result.tracks : []).map((item, index) => ({
        url: 'online:' + index + ':' + (item.source || '') + ':' + (item.lang || ''),
        lang: item.lang || '',
        language: item.lang || '',
        label: item.label || '',
        online: true,
        payload: item,
      }));
      onlineTracks = list;
      diag.online = list.length;
      if (list.length && !activeTrack) {
        const best = list.find((item) => isChinese(item.lang, item.label)) || list[0];
        await chooseOnline(list.indexOf(best));
      }
    } catch (error) {
      if (gen !== contextGen) return;
      diag.errors.push('online: ' + String((error && error.message) || error));
    }
    if (gen !== contextGen) return;
    onlineBusy = false;
    renderPanel();
  }

  function contextKey(context) {
    if (!context) return '';
    return [context.tmdbId || '', context.seasonId || '', context.episodeId || '', context.streamUrl || '', context.title || ''].join('|');
  }

  let contextGen = 0;

  // Document-level listeners are tracked so dispose() can remove every one of
  // them; nothing keeps running after the player layer is torn down.
  const docListeners = [];
  function onDoc(type, handler, capture) {
    doc.addEventListener(type, handler, capture);
    docListeners.push([type, handler, capture]);
  }
  function removeDocListeners() {
    while (docListeners.length) {
      const [type, handler, capture] = docListeners.pop();
      try { doc.removeEventListener(type, handler, capture); } catch { /* ignore */ }
    }
  }

  function videoSrc() {
    const el = doc.querySelector('#resourcePlayer');
    return el ? String(el.currentSrc || el.src || '') : '';
  }

  function resetForSwitch() {
    loadToken += 1;
    contextGen += 1;
    engine.clearTrack();
    tracks = []; activeTrack = null; cues = []; cueIndex = -1; shownKey = ''; diag.cues = 0;
    onlineTracks = []; onlineBusy = false; onlineTried = false;
    nativeLastIndex = -2;
    clearNative();
    nativeTrack = null; nativeVideo = null;
    if (overlay) overlay.classList.remove('is-dragging');
    if (primary && primary.textContent) primary.textContent = '';
    if (secondary) { secondary.textContent = ''; secondary.classList.remove('is-on'); }
    renderPanel();
    updateButton();
  }

  function watchSwitch() {
    const raw = window.localStorage.getItem(PLAYCTX_KEY) || '';
    const context = playContext();
    const key = contextKey(context);
    const src = videoSrc();
    const rotated = (key && currentKey && key !== currentKey) || (src && currentSrc && src !== currentSrc);
    if (key) currentKey = key;
    if (src) currentSrc = src;
    if (!rotated) return false;
    resetForSwitch();
    if (context) openFor(context);
    else if (raw) openFor(playContext());
    return true;
  }

  function openFor(context) {
    diag.opens += 1;
    openFor.lastAt = Number((context && context.at) || 0);
    currentKey = contextKey(context);
    currentSrc = videoSrc();
    tracks = normalizeTracks(context && context.subtitles);
    onlineTracks = []; onlineTried = false; onlineBusy = false;
    const remembered = tracks.find((item) => item.url === settings.trackUrl);
    const target = remembered || pickDefaultTrack(tracks);
    if (!settings.aiTouched && target && !isChineseLang(target.language || target.lang)) {
      settings.ai = true;
    }
    engine.setEnabled(!!settings.ai);
    attach();
    if (!tracks.length) {
      activeTrack = null; cues = [];
      engine.clearTrack();
      if (primary) primary.textContent = '';
      if (secondary) secondary.textContent = '';
      renderPanel();
      updateButton();
      discoverTracks(context);
      return;
    }
    if (target) chooseTrack(encodeURIComponent(target.url));
  }

  onDoc('pointerdown', (event) => {
    const grip = event.target && event.target.closest ? event.target.closest('.cf-sub-grip') : null;
    if (!grip || !modalOpen()) return;
    overlay && overlay.classList.add('is-dragging');
    const stage = doc.querySelector('#playerStage');
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const startY = event.clientY;
    const startBottom = Number(settings.bottom) || 9;
    const move = (ev) => {
      const delta = (startY - ev.clientY) / Math.max(1, rect.height) * 100;
      settings.bottom = Math.min(45, Math.max(2, Number((startBottom + delta).toFixed(1))));
      applyGeometry();
    };
    const up = () => {
      doc.removeEventListener('pointermove', move);
      doc.removeEventListener('pointerup', up);
      overlay && overlay.classList.remove('is-dragging');
      persist();
    };
    doc.addEventListener('pointermove', move);
    doc.addEventListener('pointerup', up);
  }, true);

  onDoc('keydown', (event) => {
    if (!modalOpen()) return;
    const tag = (event.target && event.target.tagName) || '';
    if (/input|textarea|select/i.test(tag) || (event.target && event.target.isContentEditable)) return;
    const key = String(event.key || '').toLowerCase();
    if (key === 'v') {
      event.preventDefault();
      if (activeTrack) chooseTrack('');
      else { const target = pickDefaultTrack(tracks); if (target) chooseTrack(encodeURIComponent(target.url)); }
      return;
    }
    if (key === ',') { event.preventDefault(); settings.offset = Number((settings.offset - 0.1).toFixed(1)); persist(); tick(true); }
    if (key === '.') { event.preventDefault(); settings.offset = Number((settings.offset + 0.1).toFixed(1)); persist(); tick(true); }
  });

  function fullscreenHost() {
    const element = doc.fullscreenElement || doc.webkitFullscreenElement;
    if (!element) return null;
    if (element.tagName === 'VIDEO') return 'video';
    return element;
  }

  let nativeTrack = null;
  let nativeVideo = null;
  let nativeLastIndex = -2;

  function ensureNativeTrack(video) {
    if (!video || typeof video.addTextTrack !== 'function') return null;
    if (nativeTrack && nativeVideo === video) return nativeTrack;
    nativeVideo = video;
    nativeLastIndex = -2;
    try {
      nativeTrack = video.addTextTrack('subtitles', 'CineFlow', 'zh');
      nativeTrack.mode = 'hidden';
    } catch { nativeTrack = null; }
    return nativeTrack;
  }

  function clearNative() {
    if (!nativeTrack) return;
    try { while (nativeTrack.cues && nativeTrack.cues.length) nativeTrack.removeCue(nativeTrack.cues[0]); } catch {  }
  }

  function textFor(cue) {
    const base = String((cue && cue.t) || '').trim();
    const zh = settings.ai ? engine.get(cue.t) : '';
    return zh && zh !== base ? base + '\n' + zh : base;
  }

  function syncNativeTrack(enabled) {
    const video = doc.querySelector('#resourcePlayer');
    if (!video) return;
    if (!enabled) {
      if (nativeTrack) { nativeTrack.mode = 'hidden'; clearNative(); }
      nativeLastIndex = -2;
      return;
    }
    const track = ensureNativeTrack(video);
    if (!track) return;
    const time = Math.max(0, (Number(video.currentTime) || 0) + (Number(settings.offset) || 0));
    const index = findCueIndex(time);
    if (index === nativeLastIndex) return;
    nativeLastIndex = index;
    clearNative();
    if (index < 0) return;
    const from = Math.max(0, index - 1);
    const to = Math.min(cues.length - 1, index + 6);
    for (let i = from; i <= to; i += 1) {
      const cue = cues[i];
      const text = textFor(cue);
      if (!text) continue;
      try {
        const vtt = new window.VTTCue(Math.max(0, cue.s), Math.max(cue.s + 0.05, cue.e), text.replace(/\n/g, '\u000a'));
        track.addCue(vtt);
      } catch {  }
    }
    try { track.mode = 'showing'; } catch {  }
  }

  function placeOverlay() {
    if (!overlay) return;
    const host = fullscreenHost();
    if (host === 'video') {
      overlay.style.display = 'none';
      syncNativeTrack(true);
      return;
    }
    overlay.style.display = '';
    syncNativeTrack(false);
    const target = host || doc.querySelector('#playerStage');
    if (target && overlay.parentElement !== target) target.appendChild(overlay);
    positionPanel();
  }

  function decodeFileBytes(buffer) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
    catch {
      try { return new TextDecoder('gb18030').decode(buffer); } catch { return ''; }
    }
  }

  onDoc('dragover', (event) => {
    if (!modalOpen()) return;
    const stage = event.target && event.target.closest ? event.target.closest('#playerStage') : null;
    if (!stage) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }, true);

  onDoc('drop', async (event) => {
    if (!modalOpen()) return;
    const stage = event.target && event.target.closest ? event.target.closest('#playerStage') : null;
    if (!stage) return;
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (!file) return;
    event.preventDefault();
    const api = bridge();
    if (!api || typeof api.subParse !== 'function') return;
    try {
      const text = decodeFileBytes(await file.arrayBuffer());
      const result = await api.subParse({ text });
      if (result && result.ok) await applyLocalCues(result.cues, file.name);
      else diag.errors.push('拖入字幕解析失败');
    } catch (error) { diag.errors.push('drop: ' + String((error && error.message) || error)); }
  }, true);

  onDoc('fullscreenchange', placeOverlay, true);
  onDoc('webkitfullscreenchange', placeOverlay, true);

  const observer = new MutationObserver(() => {
    if (!modalOpen()) {
      const hadWork = cues.length || activeTrack || tracks.length || tickTimer;
      teardown();
      if (hadWork) { resetForSwitch(); currentKey = ''; currentSrc = ''; }
      return;
    }
    if (modalOpen() && watchSwitch()) return;
    const context = playContext();
    const sameContext = overlay && doc.body.contains(overlay) && cues.length && activeTrack;
    if (!overlay || !doc.body.contains(overlay)) { openFor(context); return; }
    buildButton();
    if (!sameContext && context && context.at && Number(context.at) !== Number(openFor.lastAt || 0)) {
      openFor.lastAt = Number(context.at);
      openFor(context);
    }
  });
  observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

  exposeHooks();

  return () => {
    observer.disconnect();
    stopTicker();
    engine.dispose();
    removeDocListeners();
    removeVideoListeners();
    if (panel && panel.parentElement) panel.parentElement.removeChild(panel);
    if (button && button.parentElement) button.parentElement.removeChild(button);
    if (overlay && overlay.parentElement) overlay.parentElement.removeChild(overlay);
    panel = null; button = null; overlay = null;
    window.__cfSubReady = false;
  };

  // Diagnostics hooks (already exposed via window.__cfSub). They mirror the
  // exact code paths the panel buttons use, so they also drive acceptance tests.
  function exposeHooks() {
    diag.selectTrack = (url) => chooseTrack(encodeURIComponent(String(url || '')));
    diag.toggleAi = () => {
      settings.ai = !settings.ai; settings.aiTouched = true; persist(); renderPanel();
      engine.setEnabled(!!settings.ai);
      if (settings.ai) primeTranslate(); else { shownKey = ''; tick(true); }
    };
    diag.snapshot = () => ({
      track: engine.currentTrackKey(),
      lang: engine.currentLang(),
      ai: settings.ai,
      enabled: engine.isEnabled(),
      cache: engine.size(),
      pending: engine.pendingCount(),
      queue: engine.queueLength(),
      translating: engine.stats(),
      primary: primary ? primary.textContent : '',
      secondary: secondary ? secondary.textContent : '',
      tracks: tracks.length,
      tickRunning: !!tickTimer,
    });
    diag.engine = engine;
  }
}
