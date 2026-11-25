import { test, run, assert } from './harness.mjs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { createMovySubtitle, translateCode, translateBucket } = require('../electron/movy-subtitle.cjs');

const SRT = [
  '1',
  '00:00:01,000 --> 00:00:02,500',
  'Hello there',
  '',
  '2',
  '00:00:03,000 --> 00:00:04,500',
  'General Kenobi',
  '',
  '3',
  '00:00:05,000 --> 00:00:06,500',
  'Hello there',
  '',
].join('\n');

// A controllable fetch stub standing in for an Electron session: it records
// every URL and answers translation endpoints after a manual delay.
function createFetchStub(handler) {
  const calls = [];
  const stub = {
    calls,
    fetch: async (url) => {
      calls.push(String(url));
      const answer = handler(String(url));
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        async text() { return answer; },
        async json() { return JSON.parse(answer); },
        async arrayBuffer() { return Buffer.from(answer); },
      };
    },
  };
  return stub;
}

function makeModule(fetchImpl) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-sub-'));
  const mod = createMovySubtitle({ userDataDir, sessionFetchers: [fetchImpl] });
  return { mod, userDataDir };
}

test('translateCode / translateBucket distinguish languages', () => {
  assert.equal(translateCode('eng'), 'en');
  assert.equal(translateBucket('eng'), 'en');
  assert.notEqual(translateBucket('eng'), translateBucket('jpn'));
  assert.notEqual(translateBucket('eng'), translateBucket('unknown'));
  assert.match(translateBucket('unknown'), /^auto:/);
});

test('same source line from different languages does not overwrite each other', async () => {
  let counter = 0;
  const fetcher = createFetchStub(() => {
    counter += 1;
    return JSON.stringify([['译文' + counter]]);
  });
  const { mod } = makeModule(fetcher.fetch);
  const en = await mod.translate({ texts: ['Hello there'], from: 'eng', to: 'zh-CN' });
  const ja = await mod.translate({ texts: ['Hello there'], from: 'jpn', to: 'zh-CN' });
  assert.equal(en.map['Hello there'], '译文1');
  assert.equal(ja.map['Hello there'], '译文2');
  // Re-asking per language hits the language-specific cache, not the other one.
  const enAgain = await mod.translate({ texts: ['Hello there'], from: 'eng', to: 'zh-CN' });
  const jaAgain = await mod.translate({ texts: ['Hello there'], from: 'jpn', to: 'zh-CN' });
  assert.equal(enAgain.map['Hello there'], '译文1');
  assert.equal(jaAgain.map['Hello there'], '译文2');
  assert.equal(enAgain.fetched, 0);
  assert.equal(jaAgain.fetched, 0);
});

test('disk persistence keeps language buckets separate across restarts', async () => {
  let counter = 0;
  const fetcher = createFetchStub(() => { counter += 1; return JSON.stringify([['T' + counter]]); });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-sub-'));
  const first = createMovySubtitle({ userDataDir, sessionFetchers: [fetcher.fetch] });
  await first.translate({ texts: ['Line'], from: 'eng', to: 'zh-CN' });
  await first.translate({ texts: ['Line'], from: 'jpn', to: 'zh-CN' });
  first.flushTranslateDisk();

  const disk = path.join(userDataDir, 'movy-subs', 'translate.json');
  assert.ok(fs.existsSync(disk), 'translate.json should exist');
  const raw = JSON.parse(fs.readFileSync(disk, 'utf8'));
  assert.equal(raw.v, 2);
  assert.ok(Object.keys(raw.map).some((key) => key.startsWith('en|')), 'english key present');
  assert.ok(Object.keys(raw.map).some((key) => key.startsWith('ja|')), 'japanese key present');

  const second = createMovySubtitle({ userDataDir, sessionFetchers: [fetcher.fetch] });
  const en = await second.translate({ texts: ['Line'], from: 'eng', to: 'zh-CN' });
  const ja = await second.translate({ texts: ['Line'], from: 'jpn', to: 'zh-CN' });
  assert.equal(en.fetched, 0);
  assert.equal(ja.fetched, 0);
  assert.notEqual(en.map.Line, ja.map.Line);
});

test('legacy ambiguous disk entries are ignored', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-sub-'));
  const dir = path.join(userDataDir, 'movy-subs');
  fs.mkdirSync(dir, { recursive: true });
  // v1 format: flat map with an empty source bucket for unknown languages.
  fs.writeFileSync(path.join(dir, 'translate.json'), JSON.stringify({
    '|zh-CN|Line': 'ambiguous',
    'en|zh-CN|Line': 'from-english',
  }));
  const fetcher = createFetchStub(() => JSON.stringify([['fresh']]));
  const mod = createMovySubtitle({ userDataDir, sessionFetchers: [fetcher.fetch] });
  const en = await mod.translate({ texts: ['Line'], from: 'eng', to: 'zh-CN' });
  assert.equal(en.map.Line, 'from-english', 'qualified legacy key is still used');
  const unknown = await mod.translate({ texts: ['Line'], from: 'xyz', to: 'zh-CN' });
  assert.equal(unknown.map.Line, 'fresh', 'ambiguous legacy key is not returned');
});

test('parses the local srt fixture into cues', () => {
  const { mod } = makeModule(createFetchStub(() => '[]').fetch);
  const cues = mod.parseCues(SRT);
  assert.equal(cues.length, 3);
  assert.equal(cues[0].t, 'Hello there');
  assert.equal(cues[1].t, 'General Kenobi');
});

test('bounded main-process translate queue does not grow without limit', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fetcher = {
    fetch: async (url) => {
      await gate;
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, async json() { return []; }, async text() { return '[]'; }, async arrayBuffer() { return Buffer.alloc(0); } };
    },
  };
  const { mod } = makeModule(fetcher.fetch);
  const calls = [];
  for (let i = 0; i < 400; i += 1) calls.push(mod.translate({ texts: ['t' + i], from: 'eng', to: 'zh-CN' }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(mod.stats().queue <= 64, 'queue capped at TRANSLATE_QUEUE_MAX');
  release();
  await Promise.all(calls);
});

await run('main-process subtitle cache');
