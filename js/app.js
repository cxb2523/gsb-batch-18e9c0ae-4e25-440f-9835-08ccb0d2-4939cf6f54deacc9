/* =========================================================
   SIGNAL • FM — app logic
   Vanilla JS, no build step. Data from radio-browser.info.
   ========================================================= */
(() => {
  'use strict';

  // ---------------------------------------------------------------- constants
  const FALLBACK_SERVERS = [
    'de1.api.radio-browser.info',
    'de2.api.radio-browser.info',
    'fi1.api.radio-browser.info',
    'nl1.api.radio-browser.info',
    'at1.api.radio-browser.info',
  ];
  const GENRES = [
    ['pop','Pop'],['rock','Rock'],['jazz','Jazz'],['electronic','Electronic'],['news','News'],
    ['classical','Classical'],['talk','Talk'],['hip hop','Hip-Hop'],['dance','Dance'],['chillout','Chill'],
    ['lofi','Lo-Fi'],['80s','80s'],['90s','90s'],['oldies','Oldies'],['country','Country'],['metal','Metal'],
    ['reggae','Reggae'],['latin','Latin'],['soul','Soul'],['blues','Blues'],['ambient','Ambient'],
    ['house','House'],['indie','Indie'],['sports','Sports'],
  ];
  const ACCENTS = ['--cyan','--magenta','--violet','--lime','--amber','--coral','--teal'];
  const SORTS = {
    popular:  { order:'clickcount', reverse:'true',  label:'Most popular' },
    trending: { order:'clicktrend', reverse:'true',  label:'Trending now' },
    votes:    { order:'votes',      reverse:'true',  label:'Most voted' },
    bitrate:  { order:'bitrate',    reverse:'true',  label:'Best quality' },
    name:     { order:'name',       reverse:'false', label:'Name A–Z' },
  };
  const EQ_BANDS = [
    { f:60,    label:'60' },
    { f:230,   label:'230' },
    { f:910,   label:'910' },
    { f:3600,  label:'3.6k' },
    { f:14000, label:'14k' },
  ];
  const EQ_PRESETS = {
    Flat:    [0,0,0,0,0],
    'Bass+': [8,5,0,-1,-2],
    Vocal:   [-3,-1,4,5,2],
    'Treble+':[-2,-1,0,4,8],
    Loud:    [6,3,-1,3,6],
    Night:   [-4,-1,1,0,-4],
  };
  const SLEEP_OPTIONS = [0, 15, 30, 45, 60, 90];
  const PAGE_SIZE = 30;
  const CONNECT_TIMEOUT = 10000;
  const MAX_RECENT = 40;
  const HLS_URL = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.light.min.js';
  const FALLBACK_ICON = 'icons/icon.svg';
  const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const PAGE_SECURE = location.protocol === 'https:';

  // ---------------------------------------------------------------- helpers
  const $ = (s, r = document) => r.querySelector(s);
  // works for SVG elements too (they have no .hidden property)
  const show = (node, on) => node.toggleAttribute('hidden', !on);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const store = {
    get(k, d){ try{ const v = localStorage.getItem('signalfm:' + k); return v == null ? d : JSON.parse(v); }catch(e){ return d; } },
    set(k, v){ try{ localStorage.setItem('signalfm:' + k, JSON.stringify(v)); }catch(e){} },
  };
  function escapeHtml(s){
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function hash(str){
    let h = 2166136261;
    for(let i = 0; i < (str || '').length; i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function accentVar(uuid){ return ACCENTS[hash(uuid) % ACCENTS.length]; }
  function accentCss(uuid){ return `var(${accentVar(uuid)})`; }
  function freqFor(uuid){ return (87.5 + (hash(uuid) % 206) / 10).toFixed(1); }
  function flagEmoji(code){
    if(!code || !/^[A-Za-z]{2}$/.test(code)) return '🌐';
    return String.fromCodePoint(...[...code.toUpperCase()].map(c => 127397 + c.charCodeAt(0)));
  }
  let regionNames = null;
  function countryName(code){
    try{ regionNames = regionNames || new Intl.DisplayNames([navigator.language || 'en', 'en'], { type:'region' }); return regionNames.of(code.toUpperCase()) || code; }
    catch(e){ return code; }
  }
  function safeUrl(url){ return (typeof url === 'string' && /^https?:\/\//i.test(url.trim())) ? url.trim() : ''; }
  function hostOf(url){ try{ return new URL(url).host; }catch(e){ return ''; } }
  function tagsOf(st){ return (st.tags || '').split(',').map(t => t.trim()).filter(Boolean); }
  function fmtNum(n){ return Number(n || 0).toLocaleString(); }
  function shuffle(a){ a = a.slice(); for(let i = a.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function stationName(st){ return (st && st.name || '').trim() || 'Untitled station'; }
  function slim(st){
    const keep = ['stationuuid','name','url','url_resolved','favicon','tags','country','countrycode','state','language','codec','bitrate','hls','homepage','votes','clickcount','custom'];
    const o = {}; keep.forEach(k => { if(st[k] !== undefined) o[k] = st[k]; }); return o;
  }
  const isCustom = (st) => !!(st && st.custom);
  function metaLine(st){
    if(isCustom(st) && !st.country && !st.bitrate) return tagsOf(st).length ? `My station · ${tagsOf(st)[0]}` : `My station · ${hostOf(st.url) || 'custom stream'}`;
    return [st.country || (st.countrycode ? countryName(st.countrycode) : ''), st.bitrate ? `${st.bitrate}kbps` : '', (st.codec || '').toUpperCase()]
      .filter(Boolean).join(' · ');
  }
  function streamUrl(st){
    let url = safeUrl(st.url_resolved) || safeUrl(st.url);
    // On a secure page, plain-http streams are blocked or auto-upgraded by the browser anyway: ask for https up front.
    if(url && PAGE_SECURE && url.startsWith('http://')) url = 'https://' + url.slice(7);
    return url;
  }

  // ---------------------------------------------------------------- state
  const defaults = {
    theme: 'auto',
    httpsOnly: PAGE_SECURE,
    enhanced: !IS_IOS,       // Web Audio routing can stop background playback on iOS
    reconnect: true,
    volume: 0.85,
    muted: false,
    sort: 'popular',
    eq: [0,0,0,0,0],
  };
  const settings = Object.assign({}, defaults, store.get('settings', {}));
  if(!Array.isArray(settings.eq) || settings.eq.length !== EQ_BANDS.length) settings.eq = defaults.eq.slice();
  const saveSettings = () => store.set('settings', settings);

  let favorites = (store.get('favorites', []) || []).filter(s => s && s.stationuuid);
  let recent = (store.get('recent', []) || []).filter(s => s && s.stationuuid);
  let myStations = (store.get('custom', []) || []).filter(s => s && s.stationuuid && safeUrl(s.url));
  const voted = store.get('voted', {});
  const corsBlocked = new Set(store.get('corsBlocked', []));
  const stationCache = new Map();
  [...favorites, ...recent, ...myStations].forEach(s => stationCache.set(s.stationuuid, s));

  let currentStation = null;
  let playState = 'idle'; // idle | connecting | playing | paused | error
  let statusMsg = '';
  let queue = [];         // list the current station was started from (for next/prev)
  let currentList = [];   // stations shown in the grid
  const cardEls = new Map();

  // ---------------------------------------------------------------- DOM
  const el = {
    grid: $('#grid'), gridLabel: $('#gridLabel'), loadMoreWrap: $('#loadMoreWrap'), listTools: $('#listTools'), sortSelect: $('#sortSelect'),
    search: $('#searchInput'), searchClear: $('#searchClear'), kbdHint: $('#kbdHint'), countrySelect: $('#countrySelect'),
    tabRow: $('#tabRow'), chipRow: $('#chipRow'), navStat: $('#navStat'), netDot: $('#netDot'),
    lcd: $('#lcd'), lcdFreq: $('#lcdFreq'), lcdScroll: $('#lcdScroll'), lcdStatic: $('#lcdStatic'), lcdSpan1: $('#lcdSpan1'), lcdSpan2: $('#lcdSpan2'), lcdSleep: $('#lcdSleep'),
    heroFreq: $('#heroFreq'), dialIdle: $('#dialIdle'), dialStation: $('#dialStation'), dialFlag: $('#dialFlag'), dialStationName: $('#dialStationName'), dialStatus: $('#dialStatus'), dialNeedle: $('#dialNeedle'),
    player: $('#player'), playBtn: $('#playBtn'), playIcon: $('#playIcon'), pauseIcon: $('#pauseIcon'), spinIcon: $('#spinIcon'),
    prevBtn: $('#prevBtn'), nextBtn: $('#nextBtn'), pName: $('#pName'), pSub: $('#pSub'), pFav: $('#pFav'), pArt: $('#pArt'), artBtn: $('#artBtn'), artRing: $('#artRing'), liveBadge: $('#liveBadge'),
    ejectBtn: $('#ejectBtn'), volSlider: $('#volSlider'), muteBtn: $('#muteBtn'), volIcon: $('#volIcon'), muteIcon: $('#muteIcon'), canvas: $('#viz'),
    eqBtn: $('#eqBtn'), eqPanel: $('#eqPanel'), eqSliders: $('#eqSliders'), eqPresets: $('#eqPresets'), eqNote: $('#eqNote'), eqReset: $('#eqReset'),
    sleepBtn: $('#sleepBtn'), sleepPanel: $('#sleepPanel'), sleepOptions: $('#sleepOptions'), sleepLeft: $('#sleepLeft'),
    ctaStart: $('#ctaStart'), ctaStartLabel: $('#ctaStartLabel'), ctaSurprise: $('#ctaSurprise'), btnSurprise2: $('#btnSurprise2'),
    detailDlg: $('#detailDlg'), detailBody: $('#detailBody'), settingsDlg: $('#settingsDlg'), shortcutsDlg: $('#shortcutsDlg'),
    toasts: $('#toasts'), installBtn: $('#installBtn'), statFavs: $('#statFavs'),
  };

  // ---------------------------------------------------------------- toasts
  function toast(msg, ms = 2600){
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    el.toasts.appendChild(t);
    while(el.toasts.children.length > 3) el.toasts.firstChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, ms);
  }

  // ---------------------------------------------------------------- API (with mirror failover)
  let servers = FALLBACK_SERVERS.slice();
  let goodServer = store.get('server', null);

  async function fetchJson(url, timeout = 8000){
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try{
      const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      if(!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally { clearTimeout(t); }
  }
  async function discoverServers(){
    try{
      const list = await fetchJson('https://all.api.radio-browser.info/json/servers', 5000);
      const names = [...new Set((list || []).map(s => s.name).filter(Boolean))];
      if(names.length) servers = shuffle(names).concat(FALLBACK_SERVERS.filter(n => !names.includes(n)));
    }catch(e){ /* keep fallbacks */ }
  }
  async function apiGet(path, timeout){
    const order = goodServer ? [goodServer, ...servers.filter(s => s !== goodServer)] : servers;
    let lastErr;
    for(const host of order){
      try{
        const data = await fetchJson(`https://${host}${path}`, timeout);
        if(host !== goodServer){ goodServer = host; store.set('server', host); }
        return data;
      }catch(e){ lastErr = e; if(host === goodServer) goodServer = null; }
    }
    throw lastErr || new Error('All radio directory servers are unreachable');
  }
  function qs(obj){
    return Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  }
  function searchStations(params, offset = 0, limit = PAGE_SIZE){
    const base = { hidebroken: 'true', limit, offset };
    if(settings.httpsOnly) base.is_https = 'true';
    return apiGet('/json/stations/search?' + qs({ ...base, ...params })).then(cacheStations);
  }
  function cacheStations(list){
    (list || []).forEach(s => stationCache.set(s.stationuuid, s));
    return list || [];
  }
  function registerClick(uuid){ apiGet(`/json/url/${encodeURIComponent(uuid)}`).catch(() => {}); }

  // ---------------------------------------------------------------- favorites & history
  const isFav = (uuid) => favorites.some(s => s.stationuuid === uuid);
  function toggleFavorite(st){
    if(!st) return;
    if(isFav(st.stationuuid)){
      favorites = favorites.filter(s => s.stationuuid !== st.stationuuid);
      toast(`Removed “${stationName(st)}” from favorites`);
    } else {
      favorites.unshift(slim(st));
      toast(`★ Saved “${stationName(st)}”`);
    }
    store.set('favorites', favorites);
    refreshFavUI(st.stationuuid);
    renderTabs();
    if(view.kind === 'favorites') showFavorites();
  }
  function refreshFavUI(uuid){
    const card = cardEls.get(uuid);
    if(card){
      const b = card.querySelector('.star-btn');
      const f = isFav(uuid);
      b.textContent = f ? '★' : '☆'; b.classList.toggle('active', f);
      b.setAttribute('aria-label', f ? 'Remove from favorites' : 'Add to favorites');
    }
    el.statFavs.textContent = favorites.length;
    renderPlayer();
    if(el.detailDlg.open && el.detailDlg.dataset.uuid === uuid) openDetails(stationCache.get(uuid));
  }
  function addRecent(st){
    recent = [slim(st), ...recent.filter(s => s.stationuuid !== st.stationuuid)].slice(0, MAX_RECENT);
    store.set('recent', recent);
    store.set('last', slim(st));
    if(view.kind === 'recent') showRecent();
    renderTabs();
  }

  // ---------------------------------------------------------------- views
  const view = { kind: 'countries', token: 0, params: null, offset: 0, label: '', sortable: false, done: false, loading: false, genre: null };

  function tabsDef(){
    const t = [
      { id:'countries', label:'🌍 Discover' },
      { id:'trending',  label:'🔥 Trending' },
      { id:'topvoted',  label:'👍 Top voted' },
    ];
    if(localCountry) t.push({ id:'local', label:`${flagEmoji(localCountry)} Near you` });
    t.push({ id:'favorites', label:'★ Favorites', count: favorites.length });
    t.push({ id:'mine', label:'📻 My stations', count: myStations.length });
    t.push({ id:'recent', label:'🕘 Recent', count: recent.length });
    return t;
  }
  function renderTabs(){
    const activeTab = ['countries','country','trending','topvoted','local','favorites','mine','recent'].includes(view.kind)
      ? (view.kind === 'country' ? 'countries' : view.kind) : null;
    el.tabRow.innerHTML = tabsDef().map(t => `
      <button class="tab ${activeTab === t.id ? 'active' : ''}" role="tab" aria-selected="${activeTab === t.id}" data-tab="${t.id}">
        ${escapeHtml(t.label)}${t.count ? `<span class="count">${t.count}</span>` : ''}
      </button>`).join('');
  }
  function renderChips(){
    el.chipRow.innerHTML = GENRES.map(([tag, label], i) => {
      const active = view.kind === 'genre' && view.genre === tag;
      const style = active ? ` style="--c1:var(${ACCENTS[i % ACCENTS.length]});--c2:var(${ACCENTS[(i + 2) % ACCENTS.length]})"` : '';
      return `<button class="chip ${active ? 'active' : ''}" data-genre="${escapeHtml(tag)}" aria-pressed="${active}"${style}>${escapeHtml(label)}</button>`;
    }).join('');
  }
  function setNav(){ renderTabs(); renderChips(); }

  function skeletons(){
    el.grid.setAttribute('aria-busy', 'true');
    el.grid.innerHTML = '<div class="skeleton"></div>'.repeat(9);
    cardEls.clear();
  }
  function emptyState(big, small, retry){
    el.grid.setAttribute('aria-busy', 'false');
    el.grid.innerHTML = `<div class="empty-state"><div class="big">${escapeHtml(big)}</div><div class="small">${escapeHtml(small)}</div>${retry ? '<button class="btn btn-ghost btn-sm" data-retry>↻ Try again</button>' : ''}</div>`;
    if(retry) el.grid.querySelector('[data-retry]').onclick = retry;
    cardEls.clear();
  }
  function setLabel(text, back){
    el.gridLabel.innerHTML = (back ? `<button class="back-link" id="backLink">← ${escapeHtml(back.label)}</button> ` : '') + `<span>${escapeHtml(text)}</span>`;
    if(back) $('#backLink').onclick = back.fn;
  }
  function setLoadMore(show){
    el.loadMoreWrap.innerHTML = show ? '<button class="btn btn-ghost" id="loadMoreBtn">Load more stations</button>' : '';
    if(show) $('#loadMoreBtn').onclick = () => loadPage(true);
  }

  async function showCountries(){
    const token = ++view.token;
    Object.assign(view, { kind:'countries', sortable:false, genre:null });
    setNav(); el.listTools.hidden = true; setLoadMore(false); skeletons();
    setLabel('Browse by country');
    try{
      const list = await loadCountryList();
      if(token !== view.token) return;
      renderCountryGrid(list.slice(0, 96));
    }catch(e){
      if(token !== view.token) return;
      emptyState("CAN'T REACH THE NETWORK", 'The radio directory is unreachable right now.', showCountries);
    }
  }
  let countryListPromise = null;
  function loadCountryList(){
    if(!countryListPromise){
      countryListPromise = apiGet('/json/countrycodes?order=stationcount&reverse=true&hidebroken=true')
        .then(codes => {
          const list = (codes || []).filter(c => c.stationcount > 0 && /^[A-Z]{2}$/i.test(c.name));
          fillCountrySelect(list);
          return list;
        })
        .catch(e => { countryListPromise = null; throw e; });
    }
    return countryListPromise;
  }
  function fillCountrySelect(list){
    const sorted = list.map(c => ({ code: c.name.toUpperCase(), name: countryName(c.name), n: c.stationcount }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const cur = el.countrySelect.value;
    el.countrySelect.innerHTML = '<option value="">🌐 Jump to a country…</option>' +
      sorted.map(c => `<option value="${c.code}">${flagEmoji(c.code)} ${escapeHtml(c.name)} (${fmtNum(c.n)})</option>`).join('');
    el.countrySelect.value = cur;
  }
  function renderCountryGrid(list){
    el.grid.setAttribute('aria-busy', 'false');
    cardEls.clear(); currentList = [];
    if(!list.length){ emptyState('NO COUNTRIES FOUND', 'Try again shortly.', showCountries); return; }
    el.grid.innerHTML = list.map((c, i) => {
      const code = c.name.toUpperCase();
      return `<button class="card country-card" data-country="${code}" style="--accent:var(${ACCENTS[i % ACCENTS.length]})">
        <div class="country-flag">${flagEmoji(code)}</div>
        <div class="country-name">${escapeHtml(countryName(code))}</div>
        <div class="country-count">${fmtNum(c.stationcount)} stations</div>
      </button>`;
    }).join('');
  }

  // Generic paginated station list (country / genre / search / trending …)
  function openList(opts){
    view.token++;
    Object.assign(view, { kind: opts.kind, params: opts.params, label: opts.label, back: opts.back || null,
      sortable: opts.sortable !== false, fixedSort: opts.fixedSort || null, genre: opts.genre || null, offset: 0, done: false, loading: false });
    setNav();
    el.listTools.hidden = !view.sortable;
    el.sortSelect.value = settings.sort;
    setLabel(opts.label, opts.back);
    setLoadMore(false);
    skeletons();
    loadPage(false);
  }
  async function loadPage(append){
    if(view.loading || (append && view.done)) return;
    const token = view.token;
    view.loading = true;
    const btn = $('#loadMoreBtn'); if(btn){ btn.disabled = true; btn.textContent = 'Loading…'; }
    const sort = view.fixedSort || SORTS[settings.sort] || SORTS.popular;
    try{
      let data = await searchStations({ ...view.params, order: sort.order, reverse: sort.reverse }, view.offset);
      if(token !== view.token) return;
      let done = data.length < PAGE_SIZE;
      // Searches by name that come up short also look in genres/tags, so "jazz" or "lofi" just work.
      if(view.kind === 'search' && !append && data.length < PAGE_SIZE && view.params.name){
        try{
          const byTag = await searchStations({ tag: view.params.name.toLowerCase(), order: sort.order, reverse: sort.reverse }, 0);
          if(token !== view.token) return;
          const seen = new Set(data.map(s => s.stationuuid));
          data = data.concat(byTag.filter(s => !seen.has(s.stationuuid)));
        }catch(e){}
        done = true;
      }
      view.offset += data.length;
      view.done = done;
      renderStations(data, append);
      if(!append && !data.length){
        emptyState('NOTHING ON THIS FREQUENCY',
          settings.httpsOnly ? 'Try a different search — or turn off “Secure streams only” in Settings.' : 'Try a different search, genre, or country.');
      }
      setLoadMore(!view.done);
    }catch(e){
      if(token !== view.token) return;
      if(append){ setLoadMore(true); toast('Could not load more stations'); }
      else emptyState('COULD NOT LOAD STATIONS', 'The station directory did not respond.', () => openList({ ...view, kind: view.kind, back: view.back }));
    }finally{
      if(token === view.token) view.loading = false;
    }
  }

  function showCountry(code){
    openList({ kind:'country', params:{ countrycode: code }, label:`${flagEmoji(code)} ${countryName(code)}`,
      back:{ label:'All countries', fn: () => { el.countrySelect.value = ''; showCountries(); } } });
  }
  function showGenre(tag, label){
    openList({ kind:'genre', genre: tag, params:{ tag: tag.toLowerCase(), tagExact:'true' }, label:`Genre: ${label || tag}` });
  }
  function showSearch(q){
    openList({ kind:'search', params:{ name: q }, label:`Results for “${q}”` });
  }
  function showTrending(){ openList({ kind:'trending', params:{}, label:'Trending right now', sortable:false, fixedSort: SORTS.trending }); }
  function showTopVoted(){ openList({ kind:'topvoted', params:{}, label:'Top voted by listeners', sortable:false, fixedSort: SORTS.votes }); }
  function showLocal(){ openList({ kind:'local', params:{ countrycode: localCountry }, label:`Popular in ${countryName(localCountry)}` }); }
  function showLocalList(kind, list, label, emptyBig, emptySmall){
    view.token++;
    Object.assign(view, { kind, sortable:false, genre:null, done:true });
    setNav(); el.listTools.hidden = true; setLoadMore(false);
    setLabel(label);
    if(!list.length){ emptyState(emptyBig, emptySmall); currentList = []; return; }
    renderStations(list, false);
  }
  function showFavorites(){
    showLocalList('favorites', favorites, `Your favorites (${favorites.length})`, 'NO FAVORITES YET', 'Tap the ☆ on any station to save it here. Favorites are kept in this browser.');
  }
  function showRecent(){
    showLocalList('recent', recent, 'Recently played', 'NOTHING PLAYED YET', 'Stations you listen to will show up here.');
  }
  function showMine(){
    showLocalList('mine', myStations, `My stations (${myStations.length})`, 'NO STATIONS OF YOUR OWN YET',
      'Add any radio stream link: a local station, an internet stream, anything that plays.');
    el.grid.insertAdjacentHTML('afterbegin', `<button class="card add-card" data-add-station>
      <span class="plus">＋</span><span class="t">Add a station</span><span class="s">Paste any stream link</span></button>`);
  }
  function refreshLibraryView(){
    if(view.kind === 'mine') showMine();
    else if(view.kind === 'favorites') showFavorites();
    else if(view.kind === 'recent') showRecent();
  }
  // Pasting a stream link into search offers to add it instead of searching for it.
  function showPasteHint(url){
    view.token++;
    Object.assign(view, { kind:'search', params:null, sortable:false, genre:null, done:true });
    setNav(); el.listTools.hidden = true; setLoadMore(false);
    setLabel('Stream link detected');
    cardEls.clear(); currentList = [];
    el.grid.setAttribute('aria-busy', 'false');
    el.grid.innerHTML = `<div class="empty-state"><div class="big">THAT LOOKS LIKE A STREAM LINK</div>
      <div class="small">Add it to My stations to play it and keep it.</div>
      <button class="btn btn-primary btn-sm" data-add-url="${escapeHtml(url)}">＋ Add as a station</button></div>`;
  }
  function runQuery(q){
    el.countrySelect.value = '';
    if(/^https?:\/\/\S+$/i.test(q)) showPasteHint(q); else showSearch(q);
  }
  function clearFilters(){ el.search.value = ''; el.searchClear.hidden = true; el.kbdHint.hidden = false; el.countrySelect.value = ''; }

  // ---------------------------------------------------------------- station cards
  function cardHtml(st){
    const uuid = st.stationuuid;
    const fav = isFav(uuid);
    const tags = tagsOf(st).slice(0, 3);
    const hq = isCustom(st) ? '<span class="badge-mine">MINE</span>' : st.bitrate >= 256 ? '<span class="badge-hq">HQ</span>' : '';
    return `<article class="card" tabindex="0" role="button" data-uuid="${escapeHtml(uuid)}" style="--accent:${accentCss(uuid)}" aria-label="Play ${escapeHtml(stationName(st))}">
      <div class="card-actions">
        <button class="icon-btn info-btn" aria-label="Station info" title="Station info"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg></button>
        <button class="icon-btn star-btn ${fav ? 'active' : ''}" aria-label="${fav ? 'Remove from favorites' : 'Add to favorites'}" title="Favorite">${fav ? '★' : '☆'}</button>
      </div>
      <div class="card-top">
        <img class="fav-icon" loading="lazy" decoding="async" referrerpolicy="no-referrer" alt="" src="${escapeHtml(safeUrl(st.favicon) || FALLBACK_ICON)}">
        <div class="card-text">
          <div class="card-name" title="${escapeHtml(stationName(st))}">${escapeHtml(stationName(st))}</div>
          <div class="card-meta">${escapeHtml(metaLine(st) || '—')}${hq}</div>
        </div>
      </div>
      <div class="card-tags">${tags.map(t => `<button class="tag-pill" data-tag="${escapeHtml(t)}" tabindex="-1">${escapeHtml(t)}</button>`).join('')}</div>
      <div class="mini-eq" aria-hidden="true"><span></span><span></span><span></span></div>
    </article>`;
  }
  function renderStations(list, append){
    el.grid.setAttribute('aria-busy', 'false');
    if(!append){ el.grid.innerHTML = ''; cardEls.clear(); currentList = []; }
    // de-duplicate (the API sometimes returns the same station twice across pages)
    const seen = new Set(cardEls.keys());
    const fresh = list.filter(s => s && s.stationuuid && !seen.has(s.stationuuid) && seen.add(s.stationuuid));
    currentList = currentList.concat(fresh);
    el.grid.insertAdjacentHTML('beforeend', fresh.map(cardHtml).join(''));
    fresh.forEach(s => cardEls.set(s.stationuuid, el.grid.querySelector(`.card[data-uuid="${CSS.escape(s.stationuuid)}"]`)));
    refreshCardStates();
  }
  function refreshCardStates(){
    const cur = currentStation && currentStation.stationuuid;
    cardEls.forEach((card, uuid) => {
      card.classList.toggle('playing', uuid === cur && playState === 'playing');
      card.classList.toggle('connecting', uuid === cur && playState === 'connecting');
    });
  }

  // Broken / blocked favicons fall back to the app icon (capture phase: error events don't bubble).
  document.addEventListener('error', (e) => {
    const t = e.target;
    if(t && t.tagName === 'IMG' && !t.dataset.fallback){ t.dataset.fallback = '1'; t.src = FALLBACK_ICON; }
  }, true);

  el.grid.addEventListener('click', (e) => {
    if(e.target.closest('[data-add-station]')){ openCustomEditor(); return; }
    const addUrl = e.target.closest('[data-add-url]');
    if(addUrl){ openCustomEditor({ url: addUrl.dataset.addUrl }); return; }
    const country = e.target.closest('[data-country]');
    if(country){ showCountry(country.dataset.country); return; }
    const card = e.target.closest('.card[data-uuid]');
    if(!card) return;
    const st = stationCache.get(card.dataset.uuid);
    if(!st) return;
    if(e.target.closest('.star-btn')){ toggleFavorite(st); return; }
    if(e.target.closest('.info-btn')){ openDetails(st); return; }
    const tag = e.target.closest('.tag-pill');
    if(tag){ clearFilters(); showGenre(tag.dataset.tag); scrollToList(); return; }
    playFromList(st);
  });
  el.grid.addEventListener('keydown', (e) => {
    if((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('card') && e.target.dataset.uuid){
      e.preventDefault(); e.stopPropagation();
      const st = stationCache.get(e.target.dataset.uuid);
      if(st) playFromList(st);
    }
  });
  function scrollToList(){ $('#stations').scrollIntoView({ behavior: 'smooth' }); }

  // ---------------------------------------------------------------- audio engine
  // Two elements: `plainEl` plays anything; `fxEl` (CORS mode) is routed through Web Audio for EQ + a real visualizer.
  // A stream without CORS headers would be silent through Web Audio, so fxEl is only used when the station allows it.
  const plainEl = new Audio(); plainEl.preload = 'none';
  const fxEl = new Audio(); fxEl.preload = 'none'; fxEl.crossOrigin = 'anonymous';
  let audio = plainEl;
  let playToken = 0;
  let hls = null;
  let hlsLibPromise = null;
  let pausedAt = 0;
  let reconnects = 0;
  let reconnectTimer = null, stallTimer = null, stableTimer = null;
  let actx = null, analyser = null, eqNodes = [], freqData = null;

  function ensureGraph(){
    if(actx) return true;
    try{
      const AC = window.AudioContext || window.webkitAudioContext;
      if(!AC) return false;
      actx = new AC();
      const src = actx.createMediaElementSource(fxEl);
      let node = src;
      eqNodes = EQ_BANDS.map((b, i) => {
        const f = actx.createBiquadFilter();
        f.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
        f.frequency.value = b.f;
        if(f.type === 'peaking') f.Q.value = 1.1;
        f.gain.value = settings.eq[i];
        node.connect(f); node = f;
        return f;
      });
      analyser = actx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.78;
      freqData = new Uint8Array(analyser.frequencyBinCount);
      node.connect(analyser);
      analyser.connect(actx.destination);
      return true;
    }catch(e){ actx = null; return false; }
  }
  // Must be called synchronously inside a user gesture the first time, so the context can start.
  function graphReady(){
    if(!settings.enhanced || !ensureGraph()) return Promise.resolve(false);
    if(actx.state === 'running') return Promise.resolve(true);
    return Promise.race([actx.resume().catch(() => {}), sleep(500)]).then(() => actx.state === 'running');
  }
  function applyEq(){ eqNodes.forEach((n, i) => { n.gain.value = settings.eq[i]; }); }

  let fadeFactor = 1;
  function applyVolume(){
    const v = settings.muted ? 0 : Math.max(0, Math.min(1, settings.volume * fadeFactor));
    plainEl.volume = v; fxEl.volume = v;
    plainEl.muted = fxEl.muted = settings.muted;
    el.volSlider.value = settings.volume;
    const silent = settings.muted || settings.volume === 0;
    show(el.volIcon, !silent);
    show(el.muteIcon, silent);
    el.muteBtn.setAttribute('aria-label', settings.muted ? 'Unmute' : 'Mute');
  }

  function destroyHls(){ if(hls){ try{ hls.destroy(); }catch(e){} hls = null; } }
  function stopEl(a){
    try{ a.pause(); }catch(e){}
    if(a.hasAttribute('src')){ a.removeAttribute('src'); try{ a.load(); }catch(e){} }
  }
  function stopAll(){
    clearTimeout(reconnectTimer); clearTimeout(stallTimer);
    destroyHls(); stopEl(plainEl); stopEl(fxEl);
  }
  function loadHlsLib(){
    if(window.Hls) return Promise.resolve(window.Hls);
    if(!hlsLibPromise){
      hlsLibPromise = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = HLS_URL; s.async = true; s.crossOrigin = 'anonymous';
        s.onload = () => window.Hls ? res(window.Hls) : rej(new Error('hls.js missing'));
        s.onerror = () => { hlsLibPromise = null; rej(new Error('hls.js failed to load')); };
        document.head.appendChild(s);
      });
    }
    return hlsLibPromise;
  }
  function isHls(st, url){ return Number(st.hls) === 1 || /\.m3u8($|\?)/i.test(url); }

  // Resolves 'ok' | 'error' | 'timeout' | 'blocked' | 'stale'
  function tryElement(a, url, token, useHls){
    return new Promise(resolve => {
      let done = false;
      const finish = (r) => {
        if(done) return; done = true;
        a.removeEventListener('playing', onPlaying); a.removeEventListener('error', onError);
        clearTimeout(timer);
        resolve(token !== playToken ? 'stale' : r);
      };
      const onPlaying = () => finish('ok');
      const onError = () => finish('error');
      a.addEventListener('playing', onPlaying);
      a.addEventListener('error', onError);
      const timer = setTimeout(() => finish('timeout'), CONNECT_TIMEOUT);
      const start = () => {
        if(token !== playToken) return finish('stale');
        const p = a.play();
        if(p && p.catch) p.catch(err => { if(err && err.name === 'NotAllowedError') finish('blocked'); });
      };
      if(useHls){
        loadHlsLib().then(Hls => {
          if(token !== playToken) return finish('stale');
          if(!Hls.isSupported()) return finish('error');
          destroyHls();
          hls = new Hls({ enableWorker: true });
          hls.on(Hls.Events.ERROR, (_, d) => {
            if(!d || !d.fatal) return;
            if(!done) finish('error'); else if(a === audio && token === playToken) onStreamLost();
          });
          hls.loadSource(url);
          hls.attachMedia(a);
          start();
        }).catch(() => finish('error'));
      } else {
        a.src = url;
        start();
      }
    });
  }

  async function tune(st, opts = {}){
    if(!st) return false;
    if(!opts.random && !opts.reconnect) randomRun++;
    const token = ++playToken;
    const fxPromise = graphReady(); // first, while we're still inside the click handler
    stopAll();
    if(!opts.reconnect) reconnects = 0;
    currentStation = st;
    stationCache.set(st.stationuuid, st);
    setState('connecting', opts.reconnect ? `Reconnecting… (${reconnects}/3)` : 'Tuning in…');

    const url = streamUrl(st);
    if(!url){ setState('error', 'This station has no stream address'); return false; }
    const host = hostOf(url);
    const hlsMode = isHls(st, url);
    const nativeHls = hlsMode && !!plainEl.canPlayType('application/vnd.apple.mpegurl');
    const fxOk = await fxPromise;
    if(token !== playToken) return false;

    const attempts = [];
    if(hlsMode && !nativeHls) attempts.push({ a: fxOk ? fxEl : plainEl, hls: true });
    else {
      if(fxOk && !corsBlocked.has(host)) attempts.push({ a: fxEl });
      attempts.push({ a: plainEl });
    }

    for(const at of attempts){
      const r = await tryElement(at.a, url, token, at.hls);
      if(r === 'stale' || token !== playToken) return false;
      if(r === 'ok'){ audio = at.a; onConnected(st, opts); return true; }
      if(r === 'blocked'){
        audio = at.a; stopAll();
        setState('paused', 'Press play to start listening');
        return false;
      }
      stopEl(at.a); destroyHls();
      if(r === 'timeout' && at.a !== fxEl) break;
      if(r === 'error' && at.a === fxEl && !at.hls){ corsBlocked.add(host); store.set('corsBlocked', [...corsBlocked].slice(-300)); }
    }
    if(opts.reconnect && reconnects < 3 && settings.reconnect){ scheduleReconnect(); return false; }
    const hint = !navigator.onLine ? "You're offline" : (PAGE_SECURE && /^http:/i.test(st.url_resolved || st.url || '') ? 'Stream not available over HTTPS' : 'Stream unavailable — try another station');
    setState('error', hint);
    return false;
  }

  function onConnected(st, opts){
    setState('playing');
    clearTimeout(stableTimer);
    stableTimer = setTimeout(() => { reconnects = 0; }, 30000);
    if(!opts.reconnect){ if(!isCustom(st)) registerClick(st.stationuuid); addRecent(st); }
    else toast('Reconnected ✓');
  }
  function scheduleReconnect(){
    reconnects++;
    clearTimeout(reconnectTimer);
    setState('connecting', `Signal lost — reconnecting… (${reconnects}/3)`);
    const token = playToken;
    reconnectTimer = setTimeout(() => { if(token === playToken && currentStation) tune(currentStation, { reconnect: true }); }, 1200 * reconnects);
  }
  function onStreamLost(){
    if(playState !== 'playing' && playState !== 'connecting') return;
    if(settings.reconnect && reconnects < 3 && navigator.onLine) scheduleReconnect();
    else { stopAll(); setState('error', navigator.onLine ? 'Signal lost — try again' : "You're offline"); }
  }

  // Events from whichever element is live.
  [plainEl, fxEl].forEach(a => {
    a.addEventListener('error', () => { if(a === audio && playState === 'playing' && (a.hasAttribute('src') || hls)) onStreamLost(); });
    a.addEventListener('ended', () => { if(a === audio && playState === 'playing') onStreamLost(); });
    a.addEventListener('waiting', () => {
      if(a !== audio || playState !== 'playing') return;
      setStatus('Buffering…');
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => { if(a === audio && playState === 'playing') onStreamLost(); }, 15000);
    });
    a.addEventListener('playing', () => {
      if(a !== audio) return;
      clearTimeout(stallTimer);
      if(playState === 'paused') setState('playing'); // resumed from lock screen / headset
      else if(playState === 'playing') setStatus('');
    });
    a.addEventListener('pause', () => {
      if(a === audio && playState === 'playing' && a.hasAttribute('src')){ pausedAt = Date.now(); setState('paused'); }
    });
  });

  function pause(){
    randomRun++;
    if(playState === 'connecting'){ playToken++; stopAll(); setState(currentStation ? 'paused' : 'idle'); return; }
    audio.pause(); pausedAt = Date.now(); setState('paused');
  }
  function resume(){
    if(!currentStation) return;
    // Live radio: after a short pause just continue; after a longer one, re-tune to get back to "live".
    const fresh = Date.now() - pausedAt < 15000 && (audio.hasAttribute('src') || hls) && !audio.error;
    if(fresh){
      graphReady();
      setState('playing');
      audio.play().catch(() => tune(currentStation));
    } else {
      tune(currentStation);
    }
  }
  function togglePlay(){
    if(!currentStation){
      const last = store.get('last', null);
      if(last) tune(last); else playRandom();
      return;
    }
    if(playState === 'playing' || playState === 'connecting') pause();
    else resume();
  }
  function stop(){
    randomRun++; playToken++; stopAll();
    currentStation = null; queue = [];
    setState('idle');
  }
  function playFromList(st){
    queue = currentList.slice();
    if(currentStation && currentStation.stationuuid === st.stationuuid && (playState === 'playing' || playState === 'connecting')){ pause(); return; }
    tune(st);
  }
  function step(dir){
    if(!currentStation) return;
    const list = queue.length ? queue : (favorites.length ? favorites : currentList);
    if(!list.length) return;
    const i = list.findIndex(s => s.stationuuid === currentStation.stationuuid);
    const next = list[(i + dir + list.length) % list.length];
    if(next && next.stationuuid !== currentStation.stationuuid) tune(next);
  }

  // Any user action that picks/pauses/stops a station bumps randomRun, cancelling an in-progress random scan.
  let randomRun = 0;
  let randomBusy = false;
  async function playRandom(){
    if(randomBusy) return;
    randomBusy = true;
    const run = ++randomRun;
    const btns = [el.ctaSurprise, el.btnSurprise2];
    btns.forEach(b => { b.disabled = true; });
    graphReady(); // unlock audio while we're still inside the click
    playToken++; stopAll();
    currentStation = null;
    setState('connecting', 'Rolling the dice…');
    el.pName.textContent = 'Scanning the airwaves…';
    let candidates = [];
    try{
      candidates = await searchStations({ order: 'random', lastcheckok: '1' }, 0, 20);
      // prefer stations people actually listen to
      candidates = candidates.filter(s => s.clickcount > 0).concat(candidates.filter(s => !(s.clickcount > 0)));
    }catch(e){}
    if(!candidates.length && run === randomRun){
      try{ candidates = shuffle(cacheStations(await apiGet('/json/stations/topclick/100?hidebroken=true'))); }catch(e){}
    }
    let played = false;
    for(const st of candidates.slice(0, 8)){
      if(run !== randomRun) break;
      queue = candidates;
      const ok = await tune(st, { random: true });
      if(run !== randomRun) break;
      if(ok || playState === 'paused'){ played = true; break; } // paused = autoplay blocked, station is loaded
    }
    if(!played && run === randomRun){
      stop();
      setStatus("Couldn't find a live station — try again", true);
    }
    btns.forEach(b => { b.disabled = false; });
    randomBusy = false;
  }

  // ---------------------------------------------------------------- player UI
  function setState(s, msg){ playState = s; statusMsg = msg || ''; renderPlayer(); }
  function setStatus(msg, isErr){
    statusMsg = msg || '';
    el.pSub.textContent = statusMsg || (currentStation ? metaLine(currentStation) : 'Pick a station to start listening');
    el.pSub.classList.toggle('err', !!isErr);
  }
  let lastArt = null;
  function renderPlayer(){
    const st = currentStation;
    const playing = playState === 'playing';
    const connecting = playState === 'connecting';
    show(el.playIcon, !playing && !connecting);
    show(el.pauseIcon, playing);
    show(el.spinIcon, connecting);
    el.playBtn.setAttribute('aria-label', playing ? 'Pause' : connecting ? 'Cancel' : 'Play');
    el.liveBadge.style.visibility = playing ? 'visible' : 'hidden';
    el.artRing.classList.toggle('on', playing);

    if(!st){
      el.player.style.setProperty('--accent', 'var(--cyan)');
      el.lcd.style.setProperty('--lcd', 'var(--cyan)');
      if(playState !== 'connecting') el.pName.textContent = 'Nothing tuned in';
      setStatus(statusMsg, playState === 'error');
      if(lastArt !== null){ el.pArt.dataset.fallback = ''; el.pArt.src = FALLBACK_ICON; lastArt = null; }
      el.pFav.disabled = true; el.pFav.textContent = '☆'; el.pFav.classList.remove('active');
      el.prevBtn.disabled = el.nextBtn.disabled = true;
      el.lcdScroll.hidden = true; el.lcdStatic.hidden = false;
      el.lcdStatic.textContent = connecting ? 'SCANNING…' : 'NO SIGNAL — SELECT A STATION BELOW';
      document.title = 'SIGNAL•FM — Tune the World, Live';
      updateDial(); refreshCardStates(); updateMediaSession(); updateCta();
      return;
    }
    const accent = accentCss(st.stationuuid);
    el.player.style.setProperty('--accent', accent);
    el.lcd.style.setProperty('--lcd', accent);
    el.pName.textContent = stationName(st);
    el.pName.title = stationName(st);
    setStatus(statusMsg, playState === 'error');
    if(lastArt !== st.stationuuid){
      lastArt = st.stationuuid;
      el.pArt.dataset.fallback = '';
      el.pArt.src = safeUrl(st.favicon) || FALLBACK_ICON;
    }
    const fav = isFav(st.stationuuid);
    el.pFav.disabled = false;
    el.pFav.textContent = fav ? '★' : '☆';
    el.pFav.classList.toggle('active', fav);
    el.pFav.setAttribute('aria-label', fav ? 'Remove from favorites' : 'Add to favorites');
    const stepList = queue.length ? queue : favorites;
    el.prevBtn.disabled = el.nextBtn.disabled = stepList.length < 2;

    el.lcdFreq.textContent = freqFor(st.stationuuid);
    if(playing){
      const label = `TUNED TO ${stationName(st).toUpperCase()} — ${(metaLine(st) || 'LIVE').toUpperCase()}${tagsOf(st).length ? ' — ' + tagsOf(st).slice(0, 4).join(' / ').toUpperCase() : ''}`;
      if(el.lcdSpan1.textContent !== label){ el.lcdSpan1.textContent = label; el.lcdSpan2.textContent = label; }
      el.lcdScroll.hidden = false; el.lcdStatic.hidden = true;
    } else {
      el.lcdScroll.hidden = true; el.lcdStatic.hidden = false;
      el.lcdStatic.textContent = connecting ? `TUNING ${freqFor(st.stationuuid)}…` : playState === 'error' ? 'NO SIGNAL' : `PAUSED — ${stationName(st).toUpperCase()}`;
    }
    document.title = (playing ? '▶ ' : '') + stationName(st) + ' — SIGNAL•FM';
    updateDial(); refreshCardStates(); updateMediaSession(); updateEqNote(); updateCta();
  }
  function updateCta(){
    const last = store.get('last', null);
    el.ctaStartLabel.textContent = (!currentStation && last) ? `Resume ${stationName(last).slice(0, 22)}` : 'Start Listening';
  }

  // Hero dial follows the tuned station
  function updateDial(){
    const st = currentStation;
    if(st){
      el.dialIdle.hidden = true; el.dialStation.hidden = false;
      el.dialFlag.textContent = flagEmoji(st.countrycode) || '📻';
      el.dialStationName.textContent = stationName(st);
      el.dialStatus.textContent = playState === 'playing' ? 'TUNED IN' : playState === 'connecting' ? 'TUNING…' : playState === 'error' ? 'NO SIGNAL' : 'PAUSED';
      const f = parseFloat(freqFor(st.stationuuid));
      el.dialNeedle.classList.add('locked');
      el.dialNeedle.style.transform = `translate(-50%,-100%) rotate(${((f - 87.5) / 20.5) * 150 - 75}deg)`;
      el.dialNeedle.style.color = accentCss(st.stationuuid);
    } else {
      el.dialIdle.hidden = false; el.dialStation.hidden = true;
      el.dialNeedle.classList.remove('locked');
      el.dialNeedle.style.transform = ''; el.dialNeedle.style.color = '';
    }
  }
  (function buildDial(){
    const cx = 150, cy = 150, rO = 142, rI = 126;
    let html = '';
    for(let i = 0; i < 48; i++){
      const ang = (i / 48) * Math.PI * 2, len = i % 4 === 0 ? rI - 6 : rI;
      html += `<line x1="${(cx + rO * Math.cos(ang)).toFixed(1)}" y1="${(cy + rO * Math.sin(ang)).toFixed(1)}" x2="${(cx + len * Math.cos(ang)).toFixed(1)}" y2="${(cy + len * Math.sin(ang)).toFixed(1)}" style="stroke:var(${ACCENTS[i % ACCENTS.length]})" stroke-width="2" opacity="0.55"/>`;
    }
    $('#tickGroup').innerHTML = html;
    setInterval(() => { if(!currentStation) el.heroFreq.textContent = (87.5 + Math.random() * 20.5).toFixed(1); }, 4200);
  })();

  // ---------------------------------------------------------------- visualizer
  const vctx = el.canvas.getContext('2d');
  const BARS = 30;
  const bars = new Array(BARS).fill(2);
  let accentRgbCache = { key: '', rgb: [43,232,255] };
  function accentRgb(){
    const key = (currentStation ? accentVar(currentStation.stationuuid) : '--cyan') + document.documentElement.dataset.theme + (matchMedia('(prefers-color-scheme: light)').matches ? 'L' : 'D');
    if(accentRgbCache.key !== key){
      const raw = getComputedStyle(document.documentElement).getPropertyValue(currentStation ? accentVar(currentStation.stationuuid) : '--cyan').trim();
      const m = raw.match(/^#([0-9a-f]{6})$/i);
      accentRgbCache = { key, rgb: m ? [parseInt(m[1].slice(0,2),16), parseInt(m[1].slice(2,4),16), parseInt(m[1].slice(4,6),16)] : [43,232,255] };
    }
    return accentRgbCache.rgb;
  }
  function sizeCanvas(){
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = el.canvas.getBoundingClientRect();
    if(r.width){ el.canvas.width = Math.round(r.width * dpr); el.canvas.height = Math.round(40 * dpr); }
  }
  window.addEventListener('resize', sizeCanvas);
  sizeCanvas();
  function drawViz(){
    requestAnimationFrame(drawViz);
    const w = el.canvas.width, h = el.canvas.height;
    if(!w || document.hidden) return;
    vctx.clearRect(0, 0, w, h);
    const barW = w / BARS;
    const [r, g, b] = accentRgb();
    const real = playState === 'playing' && audio === fxEl && analyser && actx && actx.state === 'running';
    if(real) analyser.getByteFrequencyData(freqData);
    const now = Date.now();
    for(let i = 0; i < BARS; i++){
      let target = 2;
      if(real){
        // log-ish mapping of bins to bars
        const idx = Math.min(freqData.length - 1, Math.floor(Math.pow(i / BARS, 1.6) * freqData.length * 0.85));
        target = 2 + (freqData[idx] / 255) * h * 0.95;
      } else if(playState === 'playing'){
        const wave = Math.sin(now / 220 + i * 0.6) * 0.5 + 0.5;
        target = 3 + wave * (h * 0.5) + Math.random() * (h * 0.22);
      } else if(playState === 'connecting'){
        target = 2 + (Math.sin(now / 120 - i * 0.5) * 0.5 + 0.5) * h * 0.25;
      }
      bars[i] += (target - bars[i]) * 0.35;
      const bh = Math.max(2, bars[i]);
      vctx.fillStyle = `rgba(${r},${g},${b},${0.4 + (bh / h) * 0.6})`;
      vctx.fillRect(i * barW + 1, h - bh, Math.max(1, barW - 2), bh);
    }
  }
  requestAnimationFrame(drawViz);

  // ---------------------------------------------------------------- equalizer
  el.eqSliders.innerHTML = EQ_BANDS.map((b, i) => `
    <div class="eq-band"><input type="range" min="-12" max="12" step="1" value="${settings.eq[i]}" data-band="${i}" aria-label="${b.label} Hz"><label>${b.label}</label></div>`).join('');
  el.eqPresets.innerHTML = Object.keys(EQ_PRESETS).map(n => `<button class="pill-btn" data-preset="${escapeHtml(n)}">${escapeHtml(n)}</button>`).join('');
  function syncEqUI(){
    el.eqSliders.querySelectorAll('input').forEach((inp, i) => { inp.value = settings.eq[i]; });
    const match = Object.entries(EQ_PRESETS).find(([, v]) => v.every((x, i) => x === settings.eq[i]));
    el.eqPresets.querySelectorAll('.pill-btn').forEach(b => b.classList.toggle('active', !!match && b.dataset.preset === match[0]));
    el.eqBtn.classList.toggle('active', settings.eq.some(v => v !== 0) || el.eqPanel.classList.contains('open'));
  }
  function updateEqNote(){
    let note = '';
    if(!settings.enhanced) note = 'Turn on “Enhanced audio” in Settings to use the equalizer.';
    else if(currentStation && playState === 'playing' && audio !== fxEl) note = "This station's stream doesn't allow audio processing, so the EQ can't change it.";
    el.eqNote.hidden = !note; el.eqNote.textContent = note;
  }
  el.eqSliders.addEventListener('input', (e) => {
    const i = Number(e.target.dataset.band);
    if(Number.isNaN(i)) return;
    settings.eq[i] = Number(e.target.value); applyEq(); syncEqUI(); saveSettings();
  });
  el.eqPresets.addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]'); if(!b) return;
    settings.eq = EQ_PRESETS[b.dataset.preset].slice(); applyEq(); syncEqUI(); saveSettings();
  });
  el.eqReset.addEventListener('click', () => { settings.eq = EQ_PRESETS.Flat.slice(); applyEq(); syncEqUI(); saveSettings(); });

  // Popovers (EQ, sleep)
  function togglePop(btn, panel, force){
    const open = force !== undefined ? force : !panel.classList.contains('open');
    closePops();
    panel.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
    if(open && panel === el.eqPanel){ graphReady(); updateEqNote(); }
    syncEqUI();
  }
  function closePops(){
    [[el.eqBtn, el.eqPanel], [el.sleepBtn, el.sleepPanel]].forEach(([b, p]) => { p.classList.remove('open'); b.setAttribute('aria-expanded', 'false'); });
    syncEqUI();
  }
  el.eqBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePop(el.eqBtn, el.eqPanel); });
  el.sleepBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePop(el.sleepBtn, el.sleepPanel); });
  document.addEventListener('click', (e) => { if(!e.target.closest('.pop-wrap')) closePops(); });

  // ---------------------------------------------------------------- sleep timer
  let sleepEnd = 0, sleepInt = null;
  function renderSleepOptions(){
    el.sleepOptions.innerHTML = SLEEP_OPTIONS.map(m => {
      const active = m === 0 ? !sleepEnd : false;
      return `<button class="pill-btn ${active ? 'active' : ''}" data-min="${m}">${m === 0 ? 'Off' : m + ' min'}</button>`;
    }).join('');
  }
  function setSleep(min){
    clearInterval(sleepInt); sleepInt = null;
    fadeFactor = 1; applyVolume();
    if(!min){ sleepEnd = 0; tickSleep(); renderSleepOptions(); return; }
    sleepEnd = Date.now() + min * 60000;
    sleepInt = setInterval(tickSleep, 1000);
    tickSleep(); renderSleepOptions();
    toast(`⏾ Sleep timer: ${min} minutes`);
  }
  function tickSleep(){
    if(!sleepEnd){ el.lcdSleep.hidden = true; el.sleepLeft.textContent = ''; el.sleepBtn.classList.remove('active'); return; }
    const left = sleepEnd - Date.now();
    if(left <= 0){
      setSleep(0);
      if(playState === 'playing' || playState === 'connecting') pause();
      toast('⏾ Sleep timer ended — good night');
      return;
    }
    fadeFactor = left < 30000 ? left / 30000 : 1;
    applyVolume();
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    const txt = `⏾ ${m}:${String(s).padStart(2, '0')}`;
    el.lcdSleep.hidden = false; el.lcdSleep.textContent = txt; el.sleepLeft.textContent = txt.slice(2);
    el.sleepBtn.classList.add('active');
  }
  el.sleepOptions.addEventListener('click', (e) => {
    const b = e.target.closest('[data-min]'); if(!b) return;
    setSleep(Number(b.dataset.min)); closePops();
  });
  renderSleepOptions();
  function cycleSleep(){
    const cur = sleepEnd ? Math.ceil((sleepEnd - Date.now()) / 60000) : 0;
    const next = SLEEP_OPTIONS.find(m => m > cur) ?? 0;
    setSleep(next);
    if(!next) toast('⏾ Sleep timer off');
  }

  // ---------------------------------------------------------------- media session (lock screen / media keys)
  function updateMediaSession(){
    if(!('mediaSession' in navigator)) return;
    const st = currentStation;
    try{
      if(st){
        const art = safeUrl(st.favicon);
        navigator.mediaSession.metadata = new MediaMetadata({
          title: stationName(st),
          artist: metaLine(st) || 'Live radio',
          album: 'SIGNAL•FM',
          artwork: art ? [{ src: art, sizes: '512x512' }] : [{ src: new URL(FALLBACK_ICON, location.href).href, sizes: 'any', type: 'image/svg+xml' }],
        });
      } else navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = playState === 'playing' ? 'playing' : st ? 'paused' : 'none';
    }catch(e){}
  }
  if('mediaSession' in navigator){
    const set = (a, fn) => { try{ navigator.mediaSession.setActionHandler(a, fn); }catch(e){} };
    set('play', () => resume());
    set('pause', () => pause());
    set('stop', () => stop());
    set('nexttrack', () => step(1));
    set('previoustrack', () => step(-1));
  }

  // ---------------------------------------------------------------- details dialog
  function openDetails(st){
    if(!st) return;
    const uuid = st.stationuuid;
    const fav = isFav(uuid);
    const home = safeUrl(st.homepage);
    const loc = [st.state, st.country || (st.countrycode ? countryName(st.countrycode) : '')].filter(Boolean).join(', ');
    const mine = isCustom(st);
    const stats = mine ? [
      ['Server', hostOf(st.url) || '—'],
      ['Type', Number(st.hls) === 1 ? 'HLS stream' : 'Audio stream'],
      ['Frequency', `${freqFor(uuid)} SFM`],
    ] : [
      ['Codec', (st.codec || '—').toUpperCase()],
      ['Bitrate', st.bitrate ? `${st.bitrate} kbps` : '—'],
      ['Language', st.language || '—'],
      ['Votes', fmtNum(st.votes)],
      ['Listens', fmtNum(st.clickcount)],
      ['Frequency', `${freqFor(uuid)} SFM`],
    ];
    const isCur = currentStation && currentStation.stationuuid === uuid && playState === 'playing';
    el.detailDlg.dataset.uuid = uuid;
    el.detailBody.innerHTML = `
      <div class="detail-top">
        <img class="detail-art" alt="" referrerpolicy="no-referrer" src="${escapeHtml(safeUrl(st.favicon) || FALLBACK_ICON)}">
        <div style="min-width:0">
          <div class="detail-name" id="detailName">${escapeHtml(stationName(st))}</div>
          <div class="detail-loc">${mine ? '📻 My station' : `${flagEmoji(st.countrycode)} ${escapeHtml(loc || 'Unknown location')}`}</div>
        </div>
      </div>
      <div class="detail-actions">
        <button class="btn btn-primary btn-sm" data-act="play">${isCur ? '❚❚ Pause' : '▶ Play'}</button>
        <button class="btn btn-ghost btn-sm" data-act="fav">${fav ? '★ Saved' : '☆ Favorite'}</button>
        ${mine ? `<button class="btn btn-ghost btn-sm" data-act="edit">✎ Edit</button>
        <button class="btn btn-ghost btn-sm" data-act="delete">🗑 Delete</button>` : `
        <button class="btn btn-ghost btn-sm" data-act="vote" ${voted[uuid] ? 'disabled' : ''}>${voted[uuid] ? '👍 Voted' : '👍 Vote'}</button>
        <button class="btn btn-ghost btn-sm" data-act="share">↗ Share</button>`}
      </div>
      <div class="detail-grid">${stats.map(([k, v]) => `<div class="detail-stat"><div class="k">${k}</div><div class="v" title="${escapeHtml(v)}">${escapeHtml(v)}</div></div>`).join('')}</div>
      ${tagsOf(st).length ? `<div class="detail-tags">${tagsOf(st).slice(0, 16).map(t => `<button class="tag-pill" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('')}</div>` : ''}
      <div class="detail-actions">
        ${home ? `<a class="btn btn-ghost btn-sm" href="${escapeHtml(home)}" target="_blank" rel="noopener noreferrer">🌐 Website</a>` : ''}
        <button class="btn btn-ghost btn-sm" data-act="copy">⧉ Copy stream URL</button>
      </div>`;
    if(!el.detailDlg.open) el.detailDlg.showModal();
  }
  el.detailBody.addEventListener('click', async (e) => {
    const uuid = el.detailDlg.dataset.uuid;
    const st = stationCache.get(uuid);
    if(!st) return;
    const tag = e.target.closest('[data-tag]');
    if(tag){ el.detailDlg.close(); clearFilters(); showGenre(tag.dataset.tag); scrollToList(); return; }
    const act = e.target.closest('[data-act]'); if(!act) return;
    switch(act.dataset.act){
      case 'play':
        if(currentStation && currentStation.stationuuid === uuid && playState === 'playing') pause();
        else { if(!queue.some(s => s.stationuuid === uuid)) queue = currentList.some(s => s.stationuuid === uuid) ? currentList.slice() : []; tune(st); }
        el.detailDlg.close();
        break;
      case 'fav': toggleFavorite(st); break;
      case 'vote':
        act.disabled = true;
        try{
          const r = await apiGet(`/json/vote/${encodeURIComponent(uuid)}`);
          voted[uuid] = Date.now(); store.set('voted', voted);
          if(r && r.ok === false) toast(r.message || 'Vote not counted (try again later)');
          else { st.votes = (st.votes || 0) + 1; toast('👍 Thanks for voting!'); }
          openDetails(st);
        }catch(err){ act.disabled = false; toast('Could not send vote'); }
        break;
      case 'share': shareStation(st); break;
      case 'edit': el.detailDlg.close(); openCustomEditor(st); break;
      case 'delete': if(deleteCustom(st)) el.detailDlg.close(); break;
      case 'copy': copyText(st.url_resolved || st.url, 'Stream URL copied'); break;
    }
  });
  function shareUrl(st){ return `${location.origin}${location.pathname}#station=${encodeURIComponent(st.stationuuid)}`; }
  async function shareStation(st){
    const url = shareUrl(st);
    if(navigator.share){
      try{ await navigator.share({ title: `${stationName(st)} on SIGNAL•FM`, text: `Listen to ${stationName(st)} live`, url }); return; }
      catch(e){ if(e && e.name === 'AbortError') return; }
    }
    copyText(url, 'Share link copied');
  }
  async function copyText(text, msg){
    try{ await navigator.clipboard.writeText(text); toast(msg); }
    catch(e){ window.prompt('Copy this:', text); }
  }
  document.querySelectorAll('dialog').forEach(d => {
    d.addEventListener('click', (e) => { if(e.target === d || e.target.closest('[data-close]')) d.close(); });
  });

  // ---------------------------------------------------------------- my stations (custom stream URLs)
  const customDlg = $('#customDlg');
  const cNote = $('#cNote');
  let draftId = null, editingId = null;
  function newCustomId(){
    const rnd = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    return 'custom-' + rnd;
  }
  function setCNote(msg, ok){ cNote.hidden = !msg; cNote.textContent = msg || ''; cNote.classList.toggle('ok', !!ok); }
  function openCustomEditor(st){
    editingId = st && st.stationuuid && isCustom(st) ? st.stationuuid : null;
    draftId = editingId || newCustomId();
    $('#customTitle').textContent = editingId ? 'Edit station' : 'Add a station';
    $('#cSave').textContent = editingId ? 'Save changes' : 'Save station';
    $('#cUrl').value = (st && st.url) || '';
    $('#cName').value = (st && st.name) || '';
    $('#cLogo').value = (st && st.favicon) || '';
    $('#cTags').value = (st && st.tags) || '';
    setCNote('');
    closePops();
    if(!customDlg.open) customDlg.showModal();
    ($('#cUrl').value ? $('#cName') : $('#cUrl')).focus();
  }
  // .pls / .m3u files are playlists that point at the real stream: read the first link out of them.
  async function resolvePlaylist(url){
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    try{
      const res = await fetch(url, { signal: ctrl.signal });
      const text = (await res.text()).slice(0, 20000);
      const m = text.match(/^\s*(?:File\d+\s*=\s*)?(https?:\/\/\S+)/im);
      return m ? m[1].trim() : null;
    }catch(e){ return null; }
    finally{ clearTimeout(t); }
  }
  async function readDraft(){
    let url = $('#cUrl').value.trim();
    if(!safeUrl(url)){ setCNote('Enter a stream link that starts with http:// or https://'); $('#cUrl').focus(); return null; }
    if(/\.(pls|m3u)($|\?)/i.test(url)){
      setCNote('Reading playlist…', true);
      const real = await resolvePlaylist(url);
      if(real){ url = real; $('#cUrl').value = real; setCNote(''); }
      else setCNote("Couldn't read that playlist file, so it will be tried as a stream.");
    }
    const tags = $('#cTags').value.split(',').map(t => t.trim().toLowerCase()).filter(Boolean).slice(0, 8).join(',');
    let name = $('#cName').value.trim();
    if(!name){ name = hostOf(url).replace(/^www\./, '') || 'My station'; $('#cName').value = name; }
    return {
      stationuuid: draftId, custom: true, name, url, url_resolved: url,
      favicon: safeUrl($('#cLogo').value), tags,
      hls: /\.m3u8($|\?)/i.test(url) ? 1 : 0,
    };
  }
  function replaceEverywhere(st){
    const swap = (list) => list.map(s => s.stationuuid === st.stationuuid ? slim(st) : s);
    favorites = swap(favorites); recent = swap(recent);
    store.set('favorites', favorites); store.set('recent', recent);
    const last = store.get('last', null);
    if(last && last.stationuuid === st.stationuuid) store.set('last', slim(st));
    stationCache.set(st.stationuuid, st);
    if(currentStation && currentStation.stationuuid === st.stationuuid){ currentStation = st; lastArt = null; renderPlayer(); }
  }
  $('#cTest').addEventListener('click', async () => {
    const btn = $('#cTest');
    const d = await readDraft(); if(!d) return;
    btn.disabled = true;
    setCNote('Connecting…', true);
    queue = [];
    const ok = await tune(d);
    btn.disabled = false;
    if(!customDlg.open) return;
    if(ok) setCNote('✓ It works! Save it to keep it.', true);
    else if(playState === 'paused') setCNote('Press play in the player to start it.', true);
    else setCNote(PAGE_SECURE && /^http:/i.test(d.url)
      ? "Couldn't play it. This is an http:// link, and secure sites can only play https:// streams."
      : "Couldn't play this link. Check that it's a direct audio stream and that it's online.");
  });
  $('#customForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = await readDraft(); if(!d) return;
    const i = myStations.findIndex(s => s.stationuuid === d.stationuuid);
    if(i >= 0) myStations[i] = d; else myStations.unshift(d);
    store.set('custom', myStations);
    replaceEverywhere(d);
    customDlg.close();
    toast(i >= 0 ? 'Station updated' : `📻 Added “${d.name}” to My stations`);
    clearFilters();
    showMine();
  });
  function deleteCustom(st){
    if(!window.confirm(`Delete “${stationName(st)}” from My stations?`)) return false;
    const id = st.stationuuid;
    myStations = myStations.filter(s => s.stationuuid !== id);
    favorites = favorites.filter(s => s.stationuuid !== id);
    recent = recent.filter(s => s.stationuuid !== id);
    store.set('custom', myStations); store.set('favorites', favorites); store.set('recent', recent);
    const last = store.get('last', null);
    if(last && last.stationuuid === id) store.set('last', null);
    queue = queue.filter(s => s.stationuuid !== id);
    el.statFavs.textContent = favorites.length;
    renderTabs(); refreshLibraryView(); renderPlayer();
    toast('Station deleted');
    return true;
  }

  // ---------------------------------------------------------------- settings dialog
  function applyTheme(){
    document.documentElement.dataset.theme = settings.theme;
    el.settingsDlg.querySelectorAll('#themeSeg button').forEach(b => b.classList.toggle('active', b.dataset.v === settings.theme));
    accentRgbCache.key = '';
  }
  function updateLibSummary(){
    $('#libSummary').textContent = `${favorites.length} favorites · ${myStations.length} of your own stations · ${recent.length} recently played. Saved in this browser only.`;
  }
  function openSettings(){
    $('#optHttps').checked = settings.httpsOnly;
    $('#optEnhanced').checked = settings.enhanced;
    $('#optReconnect').checked = settings.reconnect;
    updateLibSummary();
    applyTheme();
    el.settingsDlg.showModal();
  }
  $('#themeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]'); if(!b) return;
    settings.theme = b.dataset.v; saveSettings(); applyTheme();
  });
  $('#optHttps').addEventListener('change', (e) => {
    settings.httpsOnly = e.target.checked; saveSettings();
    if(view.params) openList({ ...view, kind: view.kind, back: view.back, label: view.label });
  });
  $('#optEnhanced').addEventListener('change', (e) => {
    settings.enhanced = e.target.checked; saveSettings(); updateEqNote();
    toast(settings.enhanced ? 'Enhanced audio on — applies to the next station' : 'Enhanced audio off — applies to the next station');
  });
  $('#optReconnect').addEventListener('change', (e) => { settings.reconnect = e.target.checked; saveSettings(); });
  $('#exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ app: 'SIGNAL•FM', version: 3, exported: new Date().toISOString(), favorites, custom: myStations }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'signalfm-library.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if(!file) return;
    try{
      const data = JSON.parse(await file.text());
      const list = (Array.isArray(data) ? data : data.favorites || []).filter(s => s && typeof s.stationuuid === 'string' && (s.url || s.url_resolved));
      let added = 0;
      list.forEach(s => { if(!isFav(s.stationuuid)){ favorites.push(slim(s)); stationCache.set(s.stationuuid, s); added++; } });
      store.set('favorites', favorites);
      const mine = (Array.isArray(data.custom) ? data.custom : [])
        .filter(s => s && typeof s.stationuuid === 'string' && safeUrl(s.url))
        .map(s => ({ ...slim(s), custom: true, name: String(s.name || hostOf(s.url)).slice(0, 80) }));
      let addedMine = 0;
      mine.forEach(s => { if(!myStations.some(m => m.stationuuid === s.stationuuid)){ myStations.push(s); stationCache.set(s.stationuuid, s); addedMine++; } });
      store.set('custom', myStations);
      refreshLibraryView();
      el.statFavs.textContent = favorites.length;
      renderTabs();
      toast(`Imported ${added} favorite${added === 1 ? '' : 's'}${addedMine ? ` and ${addedMine} of your own station${addedMine === 1 ? '' : 's'}` : ''}`);
      updateLibSummary();
    }catch(err){ toast('That file is not a valid SIGNAL•FM export'); }
  });
  $('#clearRecentBtn').addEventListener('click', () => {
    recent = []; store.set('recent', recent); renderTabs();
    if(view.kind === 'recent') showRecent();
    updateLibSummary();
    toast('History cleared');
  });
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#shortcutsBtn').addEventListener('click', () => el.shortcutsDlg.showModal());

  // ---------------------------------------------------------------- wiring
  el.playBtn.addEventListener('click', togglePlay);
  el.prevBtn.addEventListener('click', () => step(-1));
  el.nextBtn.addEventListener('click', () => step(1));
  el.pFav.addEventListener('click', () => toggleFavorite(currentStation));
  el.ejectBtn.addEventListener('click', stop);
  el.artBtn.addEventListener('click', () => { if(currentStation) openDetails(currentStation); });
  el.volSlider.addEventListener('input', () => {
    settings.volume = parseFloat(el.volSlider.value);
    if(settings.volume > 0) settings.muted = false;
    applyVolume(); saveSettings();
  });
  el.volSlider.addEventListener('wheel', (e) => { e.preventDefault(); nudgeVolume(e.deltaY < 0 ? 0.05 : -0.05); }, { passive: false });
  el.muteBtn.addEventListener('click', () => { settings.muted = !settings.muted; applyVolume(); saveSettings(); });
  function nudgeVolume(d){
    settings.volume = Math.max(0, Math.min(1, Math.round((settings.volume + d) * 100) / 100));
    settings.muted = false; applyVolume(); saveSettings();
    toast(`Volume ${Math.round(settings.volume * 100)}%`, 900);
  }

  el.ctaStart.addEventListener('click', () => {
    const last = store.get('last', null);
    if(!currentStation && last){ queue = favorites.some(s => s.stationuuid === last.stationuuid) ? favorites.slice() : []; tune(last); }
    scrollToList();
  });
  el.ctaSurprise.addEventListener('click', playRandom);
  el.btnSurprise2.addEventListener('click', playRandom);

  el.tabRow.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]'); if(!t) return;
    clearFilters();
    ({ countries: showCountries, trending: showTrending, topvoted: showTopVoted, local: showLocal, favorites: showFavorites, mine: showMine, recent: showRecent })[t.dataset.tab]();
  });
  el.chipRow.addEventListener('click', (e) => {
    const c = e.target.closest('[data-genre]'); if(!c) return;
    clearFilters();
    if(view.kind === 'genre' && view.genre === c.dataset.genre){ showCountries(); return; }
    const g = GENRES.find(([t]) => t === c.dataset.genre);
    showGenre(c.dataset.genre, g ? g[1] : c.dataset.genre);
  });
  el.sortSelect.addEventListener('change', () => {
    settings.sort = el.sortSelect.value; saveSettings();
    if(view.params) openList({ ...view, kind: view.kind, back: view.back, label: view.label });
  });

  let searchTimer = null;
  el.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = el.search.value.trim();
    el.searchClear.hidden = !el.search.value;
    el.kbdHint.hidden = !!el.search.value || document.activeElement === el.search;
    searchTimer = setTimeout(() => {
      if(!q){ showCountries(); return; }
      if(q.length < 2) return;
      runQuery(q);
    }, 380);
  });
  el.search.addEventListener('keydown', (e) => {
    if(e.key === 'Enter'){ clearTimeout(searchTimer); const q = el.search.value.trim(); if(q) runQuery(q); }
    if(e.key === 'Escape'){ el.search.blur(); }
  });
  el.search.addEventListener('focus', () => { el.kbdHint.hidden = true; });
  el.search.addEventListener('blur', () => { el.kbdHint.hidden = !!el.search.value; });
  el.searchClear.addEventListener('click', () => { clearFilters(); showCountries(); el.search.focus(); });
  el.countrySelect.addEventListener('change', () => {
    const code = el.countrySelect.value;
    el.search.value = ''; el.searchClear.hidden = true;
    if(!code){ showCountries(); return; }
    showCountry(code);
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if(e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if(e.key === 'Escape'){ closePops(); return; }
    if(typing || document.querySelector('dialog[open]')) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const onButton = t && (t.tagName === 'BUTTON' || t.getAttribute('role') === 'button');
    switch(k){
      case ' ': if(onButton) return; e.preventDefault(); togglePlay(); break;
      case 'k': togglePlay(); break;
      case 'n': step(1); break;
      case 'p': step(-1); break;
      case 'r': playRandom(); break;
      case 'm': settings.muted = !settings.muted; applyVolume(); saveSettings(); toast(settings.muted ? 'Muted' : 'Unmuted', 900); break;
      case 'f': if(currentStation) toggleFavorite(currentStation); break;
      case 'i': if(currentStation) openDetails(currentStation); break;
      case 'e': togglePop(el.eqBtn, el.eqPanel); break;
      case 's': cycleSleep(); break;
      case '/': e.preventDefault(); scrollToList(); el.search.focus({ preventScroll: true }); break;
      case '?': el.shortcutsDlg.showModal(); break;
      case 'a': e.preventDefault(); openCustomEditor(); break;
      case 'ArrowUp': if(e.shiftKey){ e.preventDefault(); nudgeVolume(0.05); } break;
      case 'ArrowDown': if(e.shiftKey){ e.preventDefault(); nudgeVolume(-0.05); } break;
      default: return;
    }
  });

  // Network status
  function setOnline(){
    el.netDot.classList.toggle('off', !navigator.onLine);
    if(!navigator.onLine){ el.navStat.textContent = 'offline'; }
    else if(statsText) el.navStat.textContent = statsText;
  }
  window.addEventListener('online', () => { setOnline(); toast('Back online'); if(playState === 'error' && currentStation) tune(currentStation); });
  window.addEventListener('offline', () => { setOnline(); toast("You're offline"); });

  // Deep links: #station=<uuid>
  async function handleHash(){
    const m = location.hash.match(/station=([0-9a-f-]{36})/i);
    if(!m) return;
    const uuid = m[1].toLowerCase();
    history.replaceState(null, '', location.pathname + location.search);
    let st = stationCache.get(uuid);
    if(!st){
      try{ st = cacheStations(await apiGet(`/json/stations/byuuid/${uuid}`))[0]; }catch(e){}
    }
    if(!st){ toast('That shared station could not be found'); return; }
    playToken++; stopAll();
    currentStation = st; queue = [];
    setState('paused', 'Shared with you — press play ▶');
    openDetails(st);
  }
  window.addEventListener('hashchange', handleHash);

  // Stats
  let statsText = '';
  async function loadStats(){
    try{
      const s = await apiGet('/json/stats');
      statsText = `${fmtNum(s.stations)} live stations worldwide`;
      $('#statStations').textContent = fmtNum(s.stations);
      $('#statCountries').textContent = fmtNum(s.countries);
      $('#statTags').textContent = fmtNum(s.tags);
    }catch(e){
      statsText = 'thousands of live stations worldwide';
    }
    setOnline();
  }

  // PWA install + service worker
  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; el.installBtn.hidden = false; });
  el.installBtn.addEventListener('click', async () => {
    if(!deferredInstall) return;
    deferredInstall.prompt();
    try{ await deferredInstall.userChoice; }catch(e){}
    deferredInstall = null; el.installBtn.hidden = true;
  });
  window.addEventListener('appinstalled', () => { el.installBtn.hidden = true; toast('SIGNAL•FM installed 🎉'); });
  if('serviceWorker' in navigator && (PAGE_SECURE || location.hostname === 'localhost' || location.hostname === '127.0.0.1')){
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  // ---------------------------------------------------------------- boot
  const localCountry = (() => {
    for(const l of (navigator.languages || [navigator.language || ''])){
      const m = /[-_]([A-Za-z]{2})$/.exec(l || '');
      if(m) return m[1].toUpperCase();
    }
    return null;
  })();

  applyTheme();
  applyVolume();
  applyEq();
  syncEqUI();
  el.statFavs.textContent = favorites.length;
  setNav();
  renderPlayer();
  setOnline();
  // Show the last station in the player (paused) so one tap resumes it.
  const last = store.get('last', null);
  if(last && !/station=/.test(location.hash)){
    currentStation = last; stationCache.set(last.stationuuid, last);
    if(favorites.some(s => s.stationuuid === last.stationuuid)) queue = favorites.slice();
    setState('paused', 'Last played — press play to resume');
  }
  discoverServers();
  loadStats();
  showCountries();
  handleHash();
})();
