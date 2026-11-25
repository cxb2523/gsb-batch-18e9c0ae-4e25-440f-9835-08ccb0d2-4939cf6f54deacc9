// End-to-end behaviour of the subtitle layer with a fake DOM and a
// controllable-delay translation stub. No real subtitle site or network.
import { test, run, assert } from './harness.mjs';
import { createDom } from './fake-dom.mjs';

const PLAYCTX_KEY = 'cineflow:movy-playctx:v1';
const TRANS_KEY = 'cineflow:movy-sub-trans:v2';

const EN_CUES = [
  { s: 0, e: 1.8, t: 'Hello there' },
  { s: 2, e: 3.8, t: 'General Kenobi' },
  { s: 4, e: 5.8, t: 'You are a bold one' },
];
const JA_CUES = [
  { s: 0, e: 1.8, t: 'こんにちは' },
  { s: 2, e: 3.8, t: 'オビ＝ワン' },
  { s: 4, e: 5.8, t: '大胆だな' },
];

function setup({ enUrl = 'https://subs.example/en.vtt', jaUrl = 'https://subs.example/ja.vtt', enLang = 'eng', jaLang = 'jpn' } = {}) {
  const dom = createDom();
  const fetchCalls = [];
  const inflight = [];

  dom.window.fetch = (url, opts = {}) => {
    fetchCalls.push(String(url));
    return new Promise((resolve, reject) => {
      const req = { url: String(url), opts, aborted: false, settled: false };
      const done = (value) => {
        if (req.settled) return;
        req.settled = true;
        resolve({
          ok: true,
          status: 200,
          async json() {
            return [[[value, String(url)]]];
          },
        });
      };
      req.resolve = (value) => done(value);
      req.reject = (error) => { req.settled = true; reject(error); };
      if (opts.signal) {
        opts.signal.addEventListener('abort', () => { req.aborted = true; req.reject(new Error('aborted')); }, { once: true });
      }
      inflight.push(req);
    });
  };

  dom.storage.set(PLAYCTX_KEY, JSON.stringify({
    at: Date.now(),
    title: 'Film A',
    tmdbId: 101,
    mediaType: 'movie',
    streamUrl: 'https://media.example/a.m3u8',
    subtitles: [
      { url: enUrl, lang: enLang, language: enLang },
      { url: jaUrl, lang: jaLang, language: jaLang },
    ],
  }));

  globalThis.window = dom.window;
  globalThis.document = dom.document;
  globalThis.MutationObserver = dom.window.MutationObserver;

  let loadCount = 0;
  const bridge = {
    subCues: async ({ url }) => {
      loadCount += 1;
      const isJa = /ja\.vtt$/.test(url);
      return { ok: true, cues: (isJa ? JA_CUES : EN_CUES).map((c) => ({ ...c })) };
    },
    subTranslate: async ({ texts }) => { throw new Error('main fallback should not be needed'); },
    subDiscover: async () => ({ ok: false, tracks: [] }),
    subOnline: async () => ({ ok: false, tracks: [] }),
    sources: async () => ({ subtitles: [] }),
  };
  dom.window.cineflowMovy = bridge;

  return {
    dom,
    fetchCalls,
    inflight,
    loads: () => loadCount,
    findReq: (text) => inflight.filter((r) => r.url.includes(encodeURIComponent(text)) && !r.settled),
  };
}

const settle = async (n = 4) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setImmediate(r)); };

async function boot(ctx) {
  const { initMovySubtitle } = await import('../src/movy-subtitle-layer.js');
  const dispose = initMovySubtitle({ document: ctx.dom.document });
  ctx.dom.openModal();
  ctx.dom.fireObserver();
  await settle(6);
  return dispose;
}

const enKey = 'https://subs.example/en.vtt|en';
const jaKey = 'https://subs.example/ja.vtt|ja';

test('default track is bound and prefetch requests are issued', async () => {
  const ctx = setup();
  const dispose = await boot(ctx);
  const snap = ctx.dom.window.__cfSub.snapshot();
  assert.equal(snap.track, enKey, 'english track bound');
  assert.equal(snap.lang, 'en');
  assert.ok(snap.ai, 'AI auto-enabled for non-Chinese default track');
  assert.ok(ctx.fetchCalls.length > 0, 'translation requests issued');
  assert.ok(snap.pending > 0);
  dispose();
});

test('switching tracks discards in-flight results from the previous track', async () => {
  const ctx = setup();
  const dispose = await boot(ctx);
  const diag = ctx.dom.window.__cfSub;
  const held = ctx.findReq('Hello there').slice();
  assert.ok(held.length >= 1, 'english translation is in flight');

  await diag.selectTrack('https://subs.example/ja.vtt');
  await settle(6);
  const afterSwitch = diag.snapshot();
  assert.equal(afterSwitch.track, jaKey, 'japanese track now bound');
  assert.deepEqual(afterSwitch.translating.discarded >= 0, true);

  // Late English answers arrive after the switch.
  held.forEach((req) => req.resolve('【旧英文译文】'));
  await settle(6);
  const snap = diag.snapshot();
  assert.equal(snap.track, jaKey);
  assert.notEqual(snap.secondary, '【旧英文译文】', 'stale English translation never rendered');
  assert.ok(snap.translating.discarded >= held.length, 'late results discarded');
  assert.equal(snap.translating.applied >= 0, true);
  dispose();
});

test('reopening a track reuses its cached translations without new requests', async () => {
  const ctx = setup();
  const dispose = await boot(ctx);
  const diag = ctx.dom.window.__cfSub;

  // Let the first English line complete on the English track.
  const first = ctx.findReq('Hello there')[0];
  first.resolve('你好啊');
  await settle(6);
  assert.equal(diag.snapshot().translating.applied >= 1, true);
  const callsAfterEn = ctx.fetchCalls.filter((u) => u.includes(encodeURIComponent('Hello there'))).length;
  assert.equal(callsAfterEn, 1, 'one request for the line');

  // Switch away and back.
  await diag.selectTrack('https://subs.example/ja.vtt');
  await settle(4);
  await diag.selectTrack('https://subs.example/en.vtt');
  await settle(6);

  const snap = diag.snapshot();
  assert.equal(snap.track, enKey);
  const callsNow = ctx.fetchCalls.filter((u) => u.includes(encodeURIComponent('Hello there'))).length;
  assert.equal(callsNow, 1, 'cached line is not re-sent after reopening the track');
  assert.equal(snap.primary, 'Hello there');
  assert.equal(snap.secondary, '你好啊', 'cached translation reused directly');
  dispose();
});

test('turning AI off cancels queued work and clears the translation line', async () => {
  const ctx = setup();
  const dispose = await boot(ctx);
  const diag = ctx.dom.window.__cfSub;
  const enHeld = ctx.findReq('Hello there').slice();
  enHeld[0].resolve('你好啊');
  await settle(6);
  assert.equal(diag.snapshot().secondary, '你好啊');

  diag.toggleAi();  // AI off
  await settle(4);
  const off = diag.snapshot();
  assert.equal(off.ai, false);
  assert.equal(off.enabled, false);
  assert.equal(off.pending, 0, 'no translations left pending');
  assert.equal(off.queue, 0, 'queue drained');
  assert.equal(off.secondary, '', 'translation line cleared on AI off');

  // A late answer after AI-off must not repopulate the line.
  enHeld.slice(1).forEach((req) => req.resolve('迟到的译文'));
  await settle(4);
  assert.equal(diag.snapshot().secondary, '');
  dispose();
});

test('closing the player stops the ticker and drops all translation work', async () => {
  const ctx = setup();
  const dispose = await boot(ctx);
  const diag = ctx.dom.window.__cfSub;
  const held = ctx.findReq('Hello there').slice();
  assert.ok(diag.snapshot().tickRunning);

  ctx.dom.closeModal();
  ctx.dom.fireObserver();
  await settle(4);
  const closed = diag.snapshot();
  assert.equal(closed.tickRunning, false, 'cue timer stopped');
  assert.equal(closed.pending, 0);
  assert.equal(closed.cache, 0, 'track cache released for the play context');
  assert.equal(closed.primary, '');

  held.forEach((req) => req.resolve('关掉之后的迟到译文'));
  await settle(4);
  assert.equal(diag.snapshot().secondary, '', 'no callback writes after close');
  dispose();
});

test('persisted translations are namespaced per track and restored', async () => {
  const ctx = setup();
  const dispose = await boot(ctx);
  const diag = ctx.dom.window.__cfSub;
  ctx.findReq('Hello there')[0].resolve('你好啊');
  await settle(6);
  await diag.selectTrack('https://subs.example/ja.vtt');
  await settle(4);
  const jaReq = ctx.findReq('こんにちは')[0];
  jaReq.resolve('你好（日文）');
  await settle(6);
  diag.engine.flush();

  const saved = JSON.parse(ctx.dom.storage.get(TRANS_KEY));
  assert.equal(saved.v, 2);
  assert.equal(saved.tracks[enKey].items['Hello there'], '你好啊');
  assert.equal(saved.tracks[jaKey].items['こんにちは'], '你好（日文）');
  dispose();
});

test('changing the play context (different film) invalidates the old track', async () => {
  const ctx = setup();
  const dispose = await boot(ctx);
  const diag = ctx.dom.window.__cfSub;
  const held = ctx.findReq('Hello there').slice();
  const before = diag.snapshot().track;
  assert.equal(before, enKey);

  // New film writes a fresh play context.
  ctx.dom.storage.set(PLAYCTX_KEY, JSON.stringify({
    at: Date.now() + 10,
    title: 'Film B',
    tmdbId: 202,
    mediaType: 'movie',
    streamUrl: 'https://media.example/b.m3u8',
    subtitles: [{ url: 'https://subs.example/b-en.vtt', lang: 'eng', language: 'eng' }],
  }));
  ctx.dom.window.__cfSub.engine; // touch
  ctx.dom.fireObserver();
  await settle(8);

  held.forEach((req) => req.resolve('上一部片的译文'));
  await settle(6);
  const snap = diag.snapshot();
  assert.notEqual(snap.secondary, '上一部片的译文', 'previous film translation never leaks');
  assert.equal(snap.track, 'https://subs.example/b-en.vtt|en');
  dispose();
});

test('reopening the player after close reloads cues and reuses cached translations', async () => {
  const ctx = setup();
  const dispose = await boot(ctx);
  const diag = ctx.dom.window.__cfSub;
  ctx.findReq('Hello there')[0].resolve('你好啊');
  await settle(6);
  const loadsBefore = ctx.loads();
  assert.equal(diag.snapshot().tickRunning, true);

  ctx.dom.closeModal();
  ctx.dom.fireObserver();
  await settle(4);
  assert.equal(diag.snapshot().tickRunning, false);

  // Reopen the same film: cues must load again and the cached translation comes
  // straight back from the per-track cache with no new network request.
  const callsBefore = ctx.fetchCalls.filter((u) => u.includes(encodeURIComponent('Hello there'))).length;
  ctx.dom.openModal();
  ctx.dom.fireObserver();
  await settle(8);
  const snap = diag.snapshot();
  assert.equal(snap.tickRunning, true, 'timer restarts for the new session');
  assert.equal(snap.track, enKey);
  assert.ok(ctx.loads() > loadsBefore, 'cues reloaded for the reopened session');
  assert.equal(snap.secondary, '你好啊', 'cached translation reused');
  const callsAfter = ctx.fetchCalls.filter((u) => u.includes(encodeURIComponent('Hello there'))).length;
  assert.equal(callsAfter, callsBefore, 'no re-request for a cached line');
  dispose();
});

test('dispose removes listeners, timers and translation callbacks', async () => {
  const ctx = setup();
  const dispose = await boot(ctx);
  const diag = ctx.dom.window.__cfSub;
  const held = ctx.findReq('Hello there').slice();
  const docKinds = [...ctx.dom.document._listeners.keys()];
  assert.ok(docKinds.length > 0);
  const beforeCounts = Object.fromEntries(docKinds.map((k) => [k, ctx.dom.document._listeners.get(k).length]));
  const videoKinds = [...ctx.dom.video._listeners.keys()];
  const videoCounts = Object.fromEntries(videoKinds.map((k) => [k, ctx.dom.video._listeners.get(k).length]));

  dispose();
  await settle(4);
  for (const kind of docKinds) {
    const remaining = (ctx.dom.document._listeners.get(kind) || []).length;
    assert.ok(remaining < beforeCounts[kind], `document listener ${kind} removed`);
  }
  for (const kind of videoKinds) {
    const remaining = (ctx.dom.video._listeners.get(kind) || []).length;
    assert.ok(remaining < videoCounts[kind], `video listener ${kind} removed`);
  }

  held.forEach((req) => req.resolve('销毁之后的迟到译文'));
  await settle(4);
  assert.equal(diag.snapshot().secondary, '', 'no callback writes after dispose');
});

await run('renderer subtitle layer');
