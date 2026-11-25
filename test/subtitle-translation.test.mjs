import { test, run, assert, createStub, makeCues } from './harness.mjs';
import { createTranslationEngine, createTrackKey, normalizeLang, isChineseLang } from '../src/subtitle-translation.mjs';

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('track key separates languages for identical text', () => {
  const en = createTrackKey({ url: 'https://cdn/a.vtt', lang: 'eng' });
  const ja = createTrackKey({ url: 'https://cdn/a.vtt', lang: 'jpn' });
  assert.notEqual(en, ja);
  assert.match(en, /\|en$/);
  assert.match(ja, /\|ja$/);
  const enAlt = createTrackKey({ url: 'https://cdn/a.vtt', language: 'en' });
  assert.equal(en, enAlt, 'alias languages collapse to one key');
});

test('chinese detection and language normalization', () => {
  assert.equal(normalizeLang('ENG'), 'en');
  assert.equal(normalizeLang('chi'), 'zh');
  assert.ok(isChineseLang('zho'));
  assert.ok(isChineseLang('', '简体中文'));
  assert.ok(!isChineseLang('jpn'));
});

test('late result from a stale track is discarded', async () => {
  const stub = createStub();
  const engine = createTranslationEngine({ translate: stub.translate, concurrency: 2 });
  engine.setTrack('u|en', 'en');
  engine.queueCues(makeCues('en', 2), 0);
  await tick();
  const [firstReq] = stub.requests;
  // user switches to a Japanese track before the English request resolves
  engine.setTrack('u|ja', 'ja');
  firstReq.resolve('旧译文');
  await tick(); await tick();
  assert.equal(engine.get('en line 0'), '', 'stale translation must not land in new track');
  assert.equal(engine.size(), 0);
});

test('switching track invalidates queued jobs so queue does not grow', async () => {
  const stub = createStub();
  const engine = createTranslationEngine({ translate: stub.translate, concurrency: 1, maxQueue: 100 });
  engine.setTrack('a|en', 'en');
  engine.queueCues(makeCues('a', 40), 0);
  await tick();
  assert.ok(engine.queueLength() > 10, 'queue should hold the prefetch window');
  for (let i = 0; i < 30; i += 1) {
    engine.setTrack('b' + i + '|en', 'en');
    engine.queueCues(makeCues('b' + i, 40), 0);
  }
  assert.ok(engine.queueLength() <= 100, 'queue is bounded');
  // After the final switch, pending work belongs only to the last track.
  assert.equal(engine.currentTrackKey(), 'b29|en');
});

test('reopening the same track reuses cache without new requests', async () => {
  const stub = createStub();
  let writes = 0;
  const engine = createTranslationEngine({ translate: stub.translate, concurrency: 4, persistDelay: 5, writeStore: () => { writes += 1; } });
  engine.setTrack('f|en', 'en');
  engine.queueCues(makeCues('f', 3), 0);
  await tick();
  stub.requests.forEach((req, i) => req.resolve('译文' + i));
  await tick(); await tick(); await tick();
  assert.equal(engine.get('f line 0'), '译文0');
  const callsAfterFirst = stub.calls;

  engine.clearTrack();
  const map = engine.setTrack('f|en', 'en');
  assert.equal(map.get('f line 0'), '译文0', 'cache survives a track switch');
  const queued = engine.queueCues(makeCues('f', 3), 0);
  assert.equal(queued, 0, 'nothing re-queued for cached track');
  assert.equal(stub.calls, callsAfterFirst, 'no new translation requests');
  engine.flush();
  assert.ok(writes >= 1, 'store was written');
});

test('disabling AI cancels in-flight work and drops later results', async () => {
  const stub = createStub();
  const engine = createTranslationEngine({ translate: stub.translate, concurrency: 3 });
  engine.setEnabled(true);
  engine.setTrack('g|en', 'en');
  engine.queueCues(makeCues('g', 6), 0);
  await tick();
  assert.ok(stub.requests.length >= 1);
  engine.setEnabled(false);
  const held = stub.requests.slice();
  held.forEach((req, i) => req.resolve('迟到的' + i));
  await tick(); await tick();
  assert.equal(engine.size(), 0);
  assert.equal(engine.queueLength(), 0);
  assert.ok(engine.stats().cancelled > 0);
});

test('results applied before a switch stay cached and are not treated as stale', async () => {
  const stub = createStub();
  const engine = createTranslationEngine({ translate: stub.translate, concurrency: 3 });
  engine.setTrack('h|en', 'en');
  engine.queueCues(makeCues('h', 2), 0);
  await tick();
  stub.requests[0].resolve('第一条译文');
  await tick(); await tick();
  assert.equal(engine.get('h line 0'), '第一条译文');
  engine.setTrack('h2|ja', 'ja');
  assert.equal(engine.get('h line 0'), '', 'new track has its own namespace');
  engine.setTrack('h|en', 'en');
  assert.equal(engine.get('h line 0'), '第一条译文');
});

test('persisted snapshot round-trips per track and drops cross-track collisions', async () => {
  const stub = createStub();
  let saved = null;
  const a = createTranslationEngine({ translate: stub.translate, concurrency: 2, persistDelay: 1, writeStore: (s) => { saved = s; } });
  a.setTrack('movie|en', 'en');
  a.queueCues(makeCues('same', 1), 0);
  await tick();
  stub.requests[0].resolve('英文译文');
  await tick(); await tick();
  a.setTrack('movie|ja', 'ja');
  a.queueCues(makeCues('same', 1), 0);
  await tick();
  stub.requests[1].resolve('日文译文');
  await tick(); await tick();
  a.flush();
  assert.ok(saved && saved.tracks['movie|en'] && saved.tracks['movie|ja']);
  assert.equal(saved.tracks['movie|en'].items['same line 0'], '英文译文');
  assert.equal(saved.tracks['movie|ja'].items['same line 0'], '日文译文');

  const b = createTranslationEngine({ translate: stub.translate });
  const restored = b.restore(JSON.parse(JSON.stringify(saved)));
  assert.equal(restored, 2);
  b.setTrack('movie|ja', 'ja');
  assert.equal(b.get('same line 0'), '日文译文');
  b.setTrack('movie|en', 'en');
  assert.equal(b.get('same line 0'), '英文译文');
});

test('chinese tracks are never queued', () => {
  const stub = createStub();
  const engine = createTranslationEngine({ translate: stub.translate });
  engine.setTrack('z|zh', 'zho');
  const queued = engine.queueCues(makeCues('中', 5), 0);
  assert.equal(queued, 0);
  assert.equal(stub.calls, 0);
});

test('fallback translator is used when direct translation fails', async () => {
  const stub = createStub();
  const engine = createTranslationEngine({
    translate: stub.translate,
    fallback: async (texts) => ({ [texts[0]]: '主进程译文' }),
    concurrency: 1,
  });
  engine.setTrack('k|en', 'en');
  engine.queueCues(makeCues('k', 1), 0);
  await tick();
  stub.requests[0].reject(new Error('network'));
  await tick(); await tick(); await tick();
  assert.equal(engine.get('k line 0'), '主进程译文');
});

test('concurrency slots free up immediately after an invalidation', async () => {
  const stub = createStub();
  const engine = createTranslationEngine({ translate: stub.translate, concurrency: 2 });
  engine.setTrack('c1|en', 'en');
  engine.queueCues(makeCues('c1', 10), 0);
  await tick();
  assert.equal(engine.activeCount(), 2);
  engine.setTrack('c2|en', 'en');       // invalidates the in-flight batch
  assert.equal(engine.activeCount(), 0, 'slots released at once');
  engine.queueCues(makeCues('c2', 2), 0);
  await tick();
  assert.equal(stub.requests.filter((r) => r.text.startsWith('c2')).length, 2, 'new track starts translating right away');
});

test('queue never exceeds maxQueue when priming repeatedly', () => {
  const stub = createStub();
  const engine = createTranslationEngine({ translate: stub.translate, concurrency: 0, maxQueue: 15 });
  engine.setTrack('q|en', 'en');
  const cues = makeCues('q', 200);
  for (let i = 0; i < 20; i += 1) engine.queueCues(cues, i * 3);
  assert.ok(engine.queueLength() <= 15);
});

test('per-track cache is bounded and evicts oldest entries', async () => {
  const stub = createStub();
  const engine = createTranslationEngine({ translate: stub.translate, concurrency: 50, maxPerTrack: 5 });
  engine.setTrack('b|en', 'en');
  engine.queueCues(makeCues('b', 12), 0);
  await tick();
  stub.requests.forEach((req) => req.resolve('v'));
  await tick(); await tick();
  assert.ok(engine.size() <= 5, 'per-track cache respects maxPerTrack');
  engine.setTrack('b2|en', 'en');
  assert.equal(engine.size(), 0, 'switching tracks exposes only the new track cache');
});

await run('renderer translation engine');
