import { writeFileSync } from 'node:fs';
import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { fixture, HERO, PAGE_ORIGIN, read, ready, rig, tmpLeft } from './helpers';
import type { Rig } from './helpers';

let r: Rig | null = null;
afterEach(async () => {
  await r?.stop();
  r = null;
});

const changedLines = (a: string, b: string): number => {
  const x = a.split('\n');
  const y = b.split('\n');
  return Math.max(x.length, y.length) === x.length && x.length === y.length ? x.filter((l, i) => l !== y[i]).length : -1;
};

// the tag instrument() writes: path:line:col of the element in the file on disk
const at = (needle: string): string => {
  const i = HERO.indexOf(needle);
  const nl = String.fromCharCode(10);
  const line = HERO.slice(0, i).split(nl).length;
  return `src/Hero3D.tsx:${line}:${i - HERO.lastIndexOf(nl, i - 1)}`;
};
const KNOT_TAG = at('<mesh name="knot"');
const proposal = (id: number, to: number[], from: number[] = [0, 0, 0], prop = 'position') => ({
  type: 'proposal', id, tag: KNOT_TAG, changes: { [prop]: { from, to } },
});

describe('connection security', () => {
  it('rejects a spoofed Host header (DNS rebinding)', async () => {
    r = await rig();
    const res = await new Promise<number>((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: r!.port, path: '/__prism/session', headers: { Host: 'evil.example:80' } }, (x) => resolve(x.statusCode ?? 0)).on('error', reject);
    });
    expect(res).toBe(421);
    expect((await r.httpGet('/__prism/session')).status).toBe(200);
  });

  it('only the Studio origin can open the Studio channel, and it needs the session token', async () => {
    r = await rig();
    await expect(r.studio({ origin: 'http://evil.example' })).rejects.toThrow(/403/);
    await expect(r.studio({ origin: PAGE_ORIGIN })).rejects.toThrow(/403/);
    const bad = await r.studio({ token: 'wrong' });
    expect(await bad.closed).toBe(4403);
    const good = await r.studio();
    expect((await ready(good)).armed).toBe(false);
  });

  it('a Studio message before hello closes the socket', async () => {
    r = await rig();
    const ws = new WebSocket(`ws://127.0.0.1:${r.port}/studio`, { headers: { Origin: r.origin } });
    await new Promise((res) => ws.on('open', res));
    const closed = new Promise<number>((res) => ws.on('close', (c) => res(c)));
    ws.send(JSON.stringify({ type: 'arm', value: true }));
    expect(await closed).toBe(4401);
    expect(r.daemon.armed).toBe(false);
  });

  it('page tokens are issued only to the dev server origin, are one-shot, and carry no Studio authority', async () => {
    r = await rig();
    expect((await r.httpGet('/__prism/page-token', { Origin: 'http://evil.example' })).status).toBe(403);
    expect((await r.httpGet('/__prism/page-token')).status).toBe(403); // no Origin at all
    const token = await r.pageToken();
    const ws = new WebSocket(`ws://127.0.0.1:${r.port}/page`, { headers: { Origin: PAGE_ORIGIN } });
    await new Promise((res) => ws.on('open', res));
    ws.send(JSON.stringify({ type: 'hello', token }));
    await new Promise((res) => ws.on('message', res));
    // the same token again is dead
    const ws2 = new WebSocket(`ws://127.0.0.1:${r.port}/page`, { headers: { Origin: PAGE_ORIGIN } });
    await new Promise((res) => ws2.on('open', res));
    const closed = new Promise<number>((res) => ws2.on('close', (c) => res(c)));
    ws2.send(JSON.stringify({ type: 'hello', token }));
    expect(await closed).toBe(4403);
    // a page cannot use the Studio channel, nor Studio's token
    await expect(r.studio({ origin: 'http://localhost:5173' })).rejects.toThrow(/403/);
    ws.close();
  });

  it('a page socket cannot arm Studio or edit through Studio messages', async () => {
    r = await rig();
    const page = await r.page();
    page.send({ type: 'arm', value: true });
    page.send({ type: 'edit', id: 1, file: 'src/Hero3D.tsx', baseHash: 'x', op: { kind: 'prop', node: 'knot', prop: 'scale', value: 3 } });
    await new Promise((res) => setTimeout(res, 150));
    expect(r.daemon.armed).toBe(false);
    expect(read(r.fx.abs).toString()).toBe(HERO);
  });
});

describe('d8: page proposals are accepted only while armed', () => {
  it('rejects a proposal while disarmed, tells the page and Studio, and leaves the file untouched', async () => {
    r = await rig();
    const studio = await r.studio();
    await ready(studio);
    const page = await r.page();
    const before = read(r.fx.abs);
    page.send(proposal(1, [1, 0, 0]));
    const res = await page.waitFor((m) => m.type === 'proposal-result');
    expect(res).toMatchObject({ ok: false, code: 'DISARMED' });
    expect(await studio.waitFor((m) => m.type === 'rejected')).toMatchObject({ code: 'DISARMED' });
    expect(read(r.fx.abs).equals(before)).toBe(true);
    expect(r.daemon.stats().proposalsRejected).toBe(1);
  });

  it('arming comes only from Studio, reaches the page, and is dropped when Studio disconnects', async () => {
    r = await rig();
    const studio = await r.studio();
    await ready(studio);
    const page = await r.page();
    studio.send({ type: 'arm', value: true });
    expect(await page.waitFor((m) => m.type === 'arm')).toMatchObject({ value: true });
    expect(r.daemon.armed).toBe(true);
    studio.close();
    await new Promise((res) => setTimeout(res, 150));
    expect(r.daemon.armed).toBe(false);
    page.send(proposal(2, [1, 0, 0]));
    expect(await page.waitFor((m) => m.type === 'proposal-result' && m.id === 2)).toMatchObject({ ok: false, code: 'DISARMED' });
  });

  it('accepts a valid armed proposal as ONE one-line edit, authored "page", and tells Studio', async () => {
    r = await rig();
    const studio = await r.studio();
    await ready(studio);
    const page = await r.page();
    studio.send({ type: 'arm', value: true });
    await page.waitFor((m) => m.type === 'arm');
    page.send(proposal(3, [0.4, 0.1, 0]));
    expect(await page.waitFor((m) => m.type === 'proposal-result')).toMatchObject({ ok: true });
    const diff = (await studio.waitFor((m) => m.type === 'diff')).entry as Record<string, unknown>;
    expect(diff).toMatchObject({ author: 'page', kind: 'edit', file: 'src/Hero3D.tsx', summary: 'position' });
    const after = read(r.fx.abs).toString();
    expect(changedLines(HERO, after)).toBe(1);
    expect(after).toContain('<mesh name="knot" position={[0.4, 0.1, 0]} scale={1}>');
    expect(tmpLeft(r.fx.abs.replace(/[/\\][^/\\]+$/, ''))).toEqual([]);
    expect(r.daemon.stats().proposalsAccepted).toBe(1);
  });

  it('rate-limits proposals with a token bucket', async () => {
    let t = 1000;
    r = await rig(fixture(), { rate: { capacity: 3, perSecond: 1 }, now: () => t });
    const studio = await r.studio();
    await ready(studio);
    const page = await r.page();
    studio.send({ type: 'arm', value: true });
    await page.waitFor((m) => m.type === 'arm');
    let from = [0, 0, 0];
    const results: unknown[] = [];
    for (let i = 0; i < 5; i++) {
      const to = [i + 1, 0, 0];
      page.send(proposal(10 + i, to, from));
      const m = await page.waitFor((x) => x.type === 'proposal-result' && x.id === 10 + i);
      results.push((m as { ok: boolean; code?: string }).ok ? 'ok' : (m as { code: string }).code);
      if ((m as { ok: boolean }).ok) from = to;
    }
    expect(results).toEqual(['ok', 'ok', 'ok', 'RATE_LIMITED', 'RATE_LIMITED']);
    t += 2000; // refill two tokens
    page.send(proposal(20, [9, 0, 0], from));
    expect(await page.waitFor((x) => x.type === 'proposal-result' && x.id === 20)).toMatchObject({ ok: true });
  });

  it('re-validates against its own parse: out-of-range, malformed, stale, unknown node, path escape and locked nodes are refused', async () => {
    r = await rig();
    const studio = await r.studio();
    await ready(studio);
    const page = await r.page();
    studio.send({ type: 'arm', value: true });
    await page.waitFor((m) => m.type === 'arm');
    const before = read(r.fx.abs);
    const code = async (id: number, msg: Record<string, unknown>) => {
      page.send({ id, ...msg });
      return ((await page.waitFor((x) => x.type === 'proposal-result' && x.id === id)) as { code?: string }).code;
    };
    expect(await code(1, proposal(1, [1e9, 0, 0]))).toBe('INVALID_PROPOSAL');
    expect(await code(2, { type: 'proposal', tag: KNOT_TAG, changes: { position: { from: [0, 0, 0], to: [1, 'x', 0] } } })).toBe('INVALID_PROPOSAL');
    expect(await code(3, { type: 'proposal', tag: KNOT_TAG, changes: { evil: { from: [0, 0, 0], to: [1, 1, 1] } } })).toBe('INVALID_PROPOSAL');
    expect(await code(4, proposal(4, [1, 0, 0], [5, 5, 5]))).toBe('CONFLICT'); // the page's idea of the old value is wrong
    expect(await code(5, { type: 'proposal', tag: 'src/Hero3D.tsx:1:1', changes: { position: { from: [0, 0, 0], to: [1, 0, 0] } } })).toBe('NODE_NOT_FOUND');
    expect(await code(6, { type: 'proposal', tag: '../../etc/evil.tsx:1:1', changes: { position: { from: [0, 0, 0], to: [1, 0, 0] } } })).toBe('PATH_OUTSIDE_ROOT');
    expect(await code(7, { type: 'proposal', tag: 'package.json:1:1', changes: { position: { from: [0, 0, 0], to: [1, 0, 0] } } })).toBe('BAD_EXTENSION');
    expect(await code(8, { type: 'proposal', tag: 'src/Hero3D.tsx:nope', changes: { position: { from: [0, 0, 0], to: [1, 0, 0] } } })).toBe('INVALID_PROPOSAL');
    expect(await code(9, { type: 'proposal', tag: at('<group name="rig"'), changes: { position: { from: [0, 0, 0], to: [1, 0, 0] } } })).toBeDefined();
    expect(read(r.fx.abs).equals(before)).toBe(true);
  });
});

describe('page proposals on props that are absent or scalar in the source', () => {
  const armed = async () => {
    r = await rig();
    const studio = await r.studio();
    await ready(studio);
    const page = await r.page();
    studio.send({ type: 'arm', value: true });
    await page.waitFor((m) => m.type === 'arm');
    return page;
  };

  it('moving a <group> with no position prop inserts it (default [0, 0, 0] is the expected old value)', async () => {
    const page = await armed();
    page.send({ type: 'proposal', id: 1, tag: at('<group name="rig"'), changes: { position: { from: [0, 0, 0], to: [1, 2, 3] } } });
    expect(await page.waitFor((m) => m.type === 'proposal-result')).toMatchObject({ ok: true });
    expect(read(r!.fx.abs).toString()).toContain('<group name="rig" position={[1, 2, 3]}');
  });

  it('still refuses when the page claims a non-default old value for an absent prop', async () => {
    const page = await armed();
    const before = read(r!.fx.abs);
    page.send({ type: 'proposal', id: 2, tag: at('<group name="rig"'), changes: { rotation: { from: [0, 1, 0], to: [0, 2, 0] } } });
    expect(await page.waitFor((m) => m.type === 'proposal-result')).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(read(r!.fx.abs).equals(before)).toBe(true);
  });

  it('a scalar scale={1} is compared as [1, 1, 1] and written as a tuple', async () => {
    const page = await armed();
    page.send({ type: 'proposal', id: 3, tag: KNOT_TAG, changes: { scale: { from: [1, 1, 1], to: [2, 2, 2] } } });
    expect(await page.waitFor((m) => m.type === 'proposal-result')).toMatchObject({ ok: true });
    expect(read(r!.fx.abs).toString()).toContain('scale={[2, 2, 2]}');
  });
});

describe('compare-and-set', () => {
  it('Studio edits with a stale baseHash are refused with CONFLICT, the file is untouched and Studio gets the current file', async () => {
    r = await rig();
    const studio = await r.studio();
    const first = await ready(studio);
    const hash = (first.file as { hash: string }).hash;
    // someone else edits the file
    const external = HERO.replace('scale={1}', 'scale={2}');
    writeFileSync(r.fx.abs, external);
    studio.send({ type: 'edit', id: 1, file: 'src/Hero3D.tsx', baseHash: hash, op: { kind: 'prop', node: 'knot', prop: 'position', value: [1, 1, 1] } });
    const res = await studio.waitFor((m) => m.type === 'result' && m.id === 1);
    expect(res).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect((res.file as { source: string }).source).toBe(external);
    expect(read(r.fx.abs).toString()).toBe(external);
    // retrying with the fresh hash works
    studio.send({ type: 'edit', id: 2, file: 'src/Hero3D.tsx', baseHash: (res.file as { hash: string }).hash, op: { kind: 'prop', node: 'knot', prop: 'position', value: [1, 1, 1] } });
    expect(await studio.waitFor((m) => m.type === 'result' && m.id === 2)).toMatchObject({ ok: true });
    expect(read(r.fx.abs).toString()).toContain('position={[1, 1, 1]} scale={2}');
  });

  it('a change that lands between the read and the rename is caught by the re-hash and nothing is overwritten', async () => {
    const fx = fixture();
    let raced = false;
    r = await rig(fx, {
      project: {
        beforeCommit: (abs) => {
          if (!raced) {
            raced = true;
            writeFileSync(abs, HERO.replace('scale={1}', 'scale={9}')); // "VS Code saves" in the race window
          }
        },
      },
    });
    const studio = await r.studio();
    const first = await ready(studio);
    studio.send({ type: 'edit', id: 1, file: 'src/Hero3D.tsx', baseHash: (first.file as { hash: string }).hash, op: { kind: 'prop', node: 'knot', prop: 'position', value: [3, 3, 3] } });
    expect(await studio.waitFor((m) => m.type === 'result' && m.id === 1)).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(read(fx.abs).toString()).toContain('scale={9}');
    expect(read(fx.abs).toString()).not.toContain('[3, 3, 3]');
    expect(tmpLeft(fx.abs.replace(/[/\\][^/\\]+$/, ''))).toEqual([]);
  });

  it('refuses edits to files outside the project, dotfiles, node_modules and non-source files', async () => {
    r = await rig();
    const studio = await r.studio();
    await ready(studio);
    const codeFor = async (id: number, file: string) => {
      studio.send({ type: 'edit', id, file, baseHash: 'x', op: { kind: 'prop', node: 'a', prop: 'scale', value: 2 } });
      return ((await studio.waitFor((m) => m.type === 'result' && m.id === id)) as { code?: string }).code;
    };
    expect(await codeFor(1, '../outside.tsx')).toBe('PATH_OUTSIDE_ROOT');
    expect(await codeFor(2, 'src/../../x.tsx')).toBe('PATH_OUTSIDE_ROOT');
    expect(await codeFor(3, '/etc/passwd')).toBe('PATH_OUTSIDE_ROOT');
    expect(await codeFor(4, 'C:/Windows/x.tsx')).toBe('PATH_OUTSIDE_ROOT');
    expect(await codeFor(5, '.env.tsx')).toBe('PATH_OUTSIDE_ROOT');
    expect(await codeFor(6, 'node_modules/x/y.tsx')).toBe('PATH_OUTSIDE_ROOT');
    expect(await codeFor(7, 'package.json')).toBe('BAD_EXTENSION');
    expect(await codeFor(8, 'src/missing.tsx')).toBe('FILE_NOT_FOUND');
  });

  it('refuses a malformed Studio message without touching anything', async () => {
    r = await rig();
    const studio = await r.studio();
    await ready(studio);
    studio.send({ type: 'edit', id: 1, file: 'src/Hero3D.tsx' });
    expect(await studio.waitFor((m) => m.type === 'rejected')).toMatchObject({ code: 'BAD_REQUEST' });
    expect(read(r.fx.abs).toString()).toBe(HERO);
  });
});

describe('Studio edits, undo and redo over the wire', () => {
  it('edits a prop and a uniform on disk, then undo restores the exact bytes', async () => {
    r = await rig();
    const studio = await r.studio();
    let file = (await ready(studio)).file as { hash: string };
    const edit = async (id: number, op: Record<string, unknown>) => {
      studio.send({ type: 'edit', id, file: 'src/Hero3D.tsx', baseHash: file.hash, op });
      const res = (await studio.waitFor((m) => m.type === 'result' && m.id === id)) as { ok: boolean; file: { hash: string } };
      expect(res.ok).toBe(true);
      file = res.file;
    };
    await edit(1, { kind: 'uniform', node: 'film', uniform: 'uFilm', value: 2.2 });
    expect(read(r.fx.abs).toString()).toContain('uFilm: { value: 2.2 }');
    await edit(2, { kind: 'prop', node: 'knot', prop: 'scale', value: 2 });
    studio.send({ type: 'undo', id: 3 });
    expect(await studio.waitFor((m) => m.type === 'result' && m.id === 3)).toMatchObject({ ok: true });
    studio.send({ type: 'undo', id: 4 });
    expect(await studio.waitFor((m) => m.type === 'result' && m.id === 4)).toMatchObject({ ok: true });
    expect(read(r.fx.abs).equals(Buffer.from(HERO))).toBe(true);
    studio.send({ type: 'undo', id: 5 });
    expect(await studio.waitFor((m) => m.type === 'result' && m.id === 5)).toMatchObject({ ok: false, code: 'NOTHING_TO_UNDO' });
  });
});

describe('watcher: external edits reach Studio live', () => {
  it('reports an external change (and what changed) but stays silent about its own writes', async () => {
    r = await rig();
    const studio = await r.studio();
    const first = await ready(studio);
    // own write: no "external" notification
    studio.send({ type: 'edit', id: 1, file: 'src/Hero3D.tsx', baseHash: (first.file as { hash: string }).hash, op: { kind: 'prop', node: 'knot', prop: 'scale', value: 3 } });
    await studio.waitFor((m) => m.type === 'result' && m.id === 1);
    await r.daemon.onDiskChange('src/Hero3D.tsx');
    await new Promise((res) => setTimeout(res, 100));
    expect(studio.messages.some((m) => m.type === 'file' && m.cause === 'external')).toBe(false);
    // external write (Claude Code, VS Code)
    const ext = read(r.fx.abs).toString().replace('args={[1, 0.3, 128, 16]}', 'args={[1.2, 0.3, 128, 16]}');
    writeFileSync(r.fx.abs, ext);
    await r.daemon.onDiskChange('src/Hero3D.tsx');
    const file = await studio.waitFor((m) => m.type === 'file' && m.cause === 'external');
    expect((file.file as { source: string }).source).toBe(ext);
    const diff = (await studio.waitFor((m) => m.type === 'diff' && (m.entry as { author: string }).author === 'external')).entry as { line: number; after: string };
    expect(diff.after).toContain('args={[1.2, 0.3, 128, 16]}');
    // and the undo for the earlier edit is now unsafe, which Studio is told
    const undo = (await studio.waitFor((m) => m.type === 'undo' && (m.state as { canUndo: boolean }).canUndo === false)).state as { undoDepth: number };
    expect(undo.undoDepth).toBe(1);
  });

  it('picks up a real file-system change by itself (fs.watch)', async () => {
    r = await rig(fixture(), { watch: true });
    const studio = await r.studio();
    await ready(studio);
    await new Promise((res) => setTimeout(res, 200));
    writeFileSync(r.fx.abs, HERO.replace('scale={1}', 'scale={4}'));
    const f = await studio.waitFor((m) => m.type === 'file' && m.cause === 'external', 6000);
    expect((f.file as { source: string }).source).toContain('scale={4}');
  });
});

describe('serving Studio', () => {
  it('marks index.html as local (so Studio never probes an endpoint) and serves assets with CORS; unknown assets are 404', async () => {
    const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'prism-studio-'));
    mkdirSync(path.join(dir, 'assets'));
    writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><title>x</title></head><body></body></html>');
    writeFileSync(path.join(dir, 'assets', 'a.js'), 'export {}');
    r = await rig(fixture(), { studioDir: dir });
    try {
      const idx = await r.httpGet('/');
      expect(idx.status).toBe(200);
      expect(idx.body).toContain('<meta name="prismbox-local" content="1" />');
      expect((await r.httpGet('/some/deep/link')).body).toContain('prismbox-local'); // SPA fallback is marked too
      const a = await r.httpGet('/assets/a.js', { Origin: 'null' });
      expect(a.status).toBe(200);
      expect((await r.httpGet('/assets/missing.js')).status).toBe(404);
      expect((await r.httpGet('/../package.json')).status).not.toBe(200);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
