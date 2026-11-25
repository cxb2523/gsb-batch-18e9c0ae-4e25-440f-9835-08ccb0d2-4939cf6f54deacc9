import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createDaemon } from '../src/daemon/server';
import { writeSession } from '../src/session-file';
import { fixture, HERO, PAGE_ORIGIN, read, ready, TOKEN } from './helpers';
import type { Fixture } from './helpers';
import WebSocket from 'ws';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c();
});

const tmpHome = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'prism-mcp-home-'));
  cleanup.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
};

async function connect(root: string, home: string) {
  const stderr: string[] = [];
  const transport = new StdioClientTransport({ command: process.execPath, args: [CLI, 'mcp', '--root', root], env: { ...process.env, PRISMBOX_HOME: home } as Record<string, string>, stderr: 'pipe' });
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(transport);
  (transport.stderr as NodeJS.ReadableStream | null)?.on('data', (d: Buffer) => stderr.push(String(d)));
  cleanup.push(() => client.close());
  return { client, stderr };
}

const text = (r: unknown): string => ((r as { content: { type: string; text?: string }[] }).content.find((c) => c.type === 'text')?.text ?? '');
const parse = (r: unknown) => JSON.parse(text(r)) as Record<string, unknown>;

describe('prismbox mcp: stdio hygiene (raw bytes)', () => {
  it('writes only JSON-RPC frames to stdout, everything else to stderr', async () => {
    const fx = fixture();
    cleanup.push(() => fx.cleanup());
    const home = tmpHome();
    const child = spawn(process.execPath, [CLI, 'mcp', '--root', fx.root], { env: { ...process.env, PRISMBOX_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] });
    cleanup.push(() => void child.kill());
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const send = (m: unknown) => child.stdin.write(`${JSON.stringify(m)}\n`);
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    send({ jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: 'prismbox://guide' } });
    send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'prism_get_selection', arguments: {} } }); // daemon offline: an error result, still a frame
    const t0 = Date.now();
    while (out.split('\n').filter(Boolean).length < 4 && Date.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 50));
    child.stdin.end();
    const lines = out.split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBe(4);
    for (const l of lines) {
      const m = JSON.parse(l) as { jsonrpc: string };
      expect(m.jsonrpc).toBe('2.0');
    }
    expect(err).toContain('ready for'); // the startup note went to stderr
    expect(out).not.toContain('ready for');
  });

  it('--print-config prints setup for Claude Code and Cursor/Windsurf and writes nothing', async () => {
    const fx = fixture();
    cleanup.push(() => fx.cleanup());
    const before = readdirSync(fx.root);
    const out = await new Promise<string>((resolve) => {
      const c = spawn(process.execPath, [CLI, 'mcp', '--print-config', '--root', fx.root], { stdio: ['ignore', 'pipe', 'pipe'] });
      let s = '';
      c.stdout.on('data', (d) => (s += d));
      c.on('close', () => resolve(s));
    });
    expect(out).toContain('claude mcp add prismbox --');
    expect(out).toMatch(/npx.*-y.*prismbox.*mcp.*--root/s); // the primary command is the npm one
    expect(out).toContain('"mcpServers"');
    expect(out).toContain('Running from a source checkout'); // this test runs the CLI from the repo, so the local variant is offered too
    expect(out).toContain('.cursor/mcp.json');
    expect(readdirSync(fx.root)).toEqual(before);
  });
});

describe('prismbox mcp: daemon offline (standalone)', () => {
  it('lists 6 tools and the guide resource; lint, guide and scene work; daemon tools give a graceful agent-ready error', async () => {
    const fx = fixture();
    cleanup.push(() => fx.cleanup());
    const home = tmpHome();
    const { client } = await connect(fx.root, home);

    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(['prism_get_scene', 'prism_get_selection', 'prism_get_view', 'prism_lint', 'prism_set_prop', 'prism_set_uniform']);
    const res = await client.listResources();
    expect(res.resources.map((r) => r.uri)).toEqual(['prismbox://guide']);
    const guide = await client.readResource({ uri: 'prismbox://guide' });
    expect(guide.contents[0]).toMatchObject({ mimeType: 'text/markdown' });
    expect(String((guide.contents[0] as { text: string }).text)).toContain('Prism subset');

    const lint = parse(await client.callTool({ name: 'prism_lint', arguments: {} }));
    expect(lint).toMatchObject({ ok: true, editableCoverage: 1 });
    expect((lint.files as { file: string }[])[0]?.file).toBe('src/Hero3D.tsx');

    const scene = parse(await client.callTool({ name: 'prism_get_scene', arguments: { file: 'src/Hero3D.tsx' } }));
    expect(scene.daemon).toBe('offline');
    expect(JSON.stringify(scene)).toContain('"name":"knot"');

    for (const [name, args] of [['prism_get_selection', {}], ['prism_get_view', {}], ['prism_set_prop', { prop: 'scale', value: 2, node: 'knot' }], ['prism_set_uniform', { uniform: 'uFilm', value: 2, node: 'film' }]] as const) {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError, name).toBe(true);
      expect(parse(r)).toMatchObject({ ok: false, code: 'DAEMON_OFFLINE' });
      expect(parse(r).fix).toContain('npx prismbox');
    }
    expect(read(fx.abs).toString()).toBe(HERO);
    expect(readdirSync(fx.root).sort()).toEqual(['package.json', 'src']); // zero files created inside the project
  });

  it('a stale session (dead pid) is cleaned up and treated as offline', async () => {
    const fx = fixture();
    cleanup.push(() => fx.cleanup());
    const home = tmpHome();
    const file = writeSession(home, { port: 9, token: 'x', pid: 2147483000, root: fx.root, startedAt: new Date().toISOString(), version: '0' });
    const { client } = await connect(fx.root, home);
    expect(parse(await client.callTool({ name: 'prism_get_selection', arguments: {} })).code).toBe('DAEMON_OFFLINE');
    expect(existsSync(file)).toBe(false);
  });

  it('a live pid with a dead port is also reported as offline', async () => {
    const fx = fixture();
    cleanup.push(() => fx.cleanup());
    const home = tmpHome();
    writeSession(home, { port: 9, token: 'x', pid: process.pid, root: fx.root, startedAt: new Date().toISOString(), version: '0' });
    const { client } = await connect(fx.root, home);
    expect(parse(await client.callTool({ name: 'prism_get_selection', arguments: {} })).code).toBe('DAEMON_OFFLINE');
  });
});

describe('prismbox mcp with a live daemon: all tools end to end', () => {
  async function live(fx: Fixture = fixture()) {
    cleanup.push(() => fx.cleanup());
    const home = tmpHome();
    const daemon = createDaemon({ root: fx.root, token: TOKEN, port: 0, watch: false, captureTimeoutMs: 1500 });
    const { port, origin } = await daemon.listen();
    daemon.allowPageOrigin(PAGE_ORIGIN);
    cleanup.push(() => daemon.close());
    writeSession(home, { port, token: TOKEN, pid: process.pid, root: fx.root, startedAt: new Date().toISOString(), version: '0' });
    const { client } = await connect(fx.root, home);
    const sockets: WebSocket[] = [];
    cleanup.push(() => sockets.forEach((s) => s.terminate()));
    const studioWs = new WebSocket(`ws://127.0.0.1:${port}/studio`, { headers: { Origin: origin } });
    sockets.push(studioWs);
    const studioMsgs: Record<string, unknown>[] = [];
    studioWs.on('message', (d) => studioMsgs.push(JSON.parse(String(d))));
    await new Promise((r) => studioWs.on('open', r));
    studioWs.send(JSON.stringify({ type: 'hello', token: TOKEN }));
    const waitStudio = async (pred: (m: Record<string, unknown>) => boolean) => {
      for (let i = 0; i < 100; i++) {
        const m = studioMsgs.find(pred);
        if (m) return m;
        await new Promise((r) => setTimeout(r, 30));
      }
      throw new Error('studio message not seen');
    };
    await waitStudio((m) => m.type === 'ready');
    const tokenRes = await fetch(`http://127.0.0.1:${port}/__prism/page-token`, { headers: { Origin: PAGE_ORIGIN } });
    const { token } = (await tokenRes.json()) as { token: string };
    const pageWs = new WebSocket(`ws://127.0.0.1:${port}/page`, { headers: { Origin: PAGE_ORIGIN } });
    sockets.push(pageWs);
    const pageMsgs: Record<string, unknown>[] = [];
    pageWs.on('message', (d) => pageMsgs.push(JSON.parse(String(d))));
    await new Promise((r) => pageWs.on('open', r));
    pageWs.send(JSON.stringify({ type: 'hello', token }));
    for (let i = 0; i < 100 && !pageMsgs.some((m) => m.type === 'hello-ok'); i++) await new Promise((r) => setTimeout(r, 30));
    return { fx, client, daemon, studioWs, pageWs, pageMsgs, studioMsgs, waitStudio };
  }
  const at = (needle: string): string => {
    const i = HERO.indexOf(needle);
    const nl = String.fromCharCode(10);
    return `src/Hero3D.tsx:${HERO.slice(0, i).split(nl).length}:${i - HERO.lastIndexOf(nl, i - 1)}`;
  };

  it('prism_get_selection: nothing selected, then the node picked on the page, with props, uniforms and a source snippet', async () => {
    const { client, pageWs } = await live();
    const none = parse(await client.callTool({ name: 'prism_get_selection', arguments: {} }));
    expect(none).toMatchObject({ ok: true, selected: false });
    expect(String(none.message)).toContain('click');

    const knot = at('<mesh name="knot"');
    pageWs.send(JSON.stringify({ type: 'pick', tag: knot }));
    await new Promise((r) => setTimeout(r, 150));
    const sel = parse(await client.callTool({ name: 'prism_get_selection', arguments: {} }));
    const [, line, col] = /:(\d+):(\d+)$/.exec(knot) as RegExpExecArray;
    expect(sel).toMatchObject({ selected: true, file: 'src/Hero3D.tsx', line: Number(line), col: Number(col), tag: knot, name: 'knot', element: 'mesh', edit: 'editable' });
    expect(String(sel.snippet)).toContain('<mesh name="knot"');
    expect(String(sel.snippet)).toMatch(/^\s*\d+>?\|/m);
    expect((sel.props as { name: string; value?: unknown }[]).find((p) => p.name === 'scale')).toMatchObject({ value: 1 });

    // select the material: uniforms with annotations
    const film = at('<shaderMaterial name="film"');
    pageWs.send(JSON.stringify({ type: 'pick', tag: film }));
    await new Promise((r) => setTimeout(r, 150));
    const m = parse(await client.callTool({ name: 'prism_get_selection', arguments: {} }));
    expect(m.uniforms).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'uFilm', editable: true, value: 1.4 })]));
    expect((m.uniforms as { name: string; annotation?: unknown }[]).find((u) => u.name === 'uFilm')?.annotation).toMatchObject({ type: 'float', min: 0, max: 3 });
  });

  it('selection follows Studio too, and goes stale (with a helpful message) when the file changes under it', async () => {
    const { client, studioWs, fx } = await live();
    studioWs.send(JSON.stringify({ type: 'select', tag: at('<group name="rig"') }));
    await new Promise((r) => setTimeout(r, 150));
    expect(parse(await client.callTool({ name: 'prism_get_selection', arguments: {} }))).toMatchObject({ selected: true, name: 'rig' });
    writeFileSync(fx.abs, `// moved\n// down\n${HERO}`);
    const stale = parse(await client.callTool({ name: 'prism_get_selection', arguments: {} }));
    expect(stale).toMatchObject({ selected: false, stale: true });
  });

  it('prism_get_scene (live) and prism_lint', async () => {
    const { client } = await live();
    const scene = parse(await client.callTool({ name: 'prism_get_scene', arguments: {} }));
    const f = (scene.files as { file: string; coverage: number; nodes: { name: string | null; edit: string }[] }[])[0]!;
    expect(f.file).toBe('src/Hero3D.tsx');
    expect(f.coverage).toBe(1);
    expect(f.nodes.map((n) => n.name)).toEqual(expect.arrayContaining(['rig', 'knot', 'film']));
    const lint = parse(await client.callTool({ name: 'prism_lint', arguments: { file: 'src/Hero3D.tsx' } }));
    expect(lint).toMatchObject({ ok: true, editableCoverage: 1 });
    const bad = await client.callTool({ name: 'prism_lint', arguments: { file: '../outside.tsx' } });
    expect(bad.isError).toBe(true);
    expect(parse(bad).code).toBe('PATH_OUTSIDE_ROOT');
  });

  it('prism_lint reports actionable findings for out-of-subset code', async () => {
    const src = `import { Canvas } from "@react-three/fiber";\nconst x = 1;\nexport default (p: object) => (\n  <Canvas>\n    <mesh position={[x, 0, 0]} />\n    <mesh name="b" {...p} />\n    {[1].map((i) => <mesh key={i} name={"m" + i} />)}\n  </Canvas>\n);\n`;
    const { client } = await live(fixture(src));
    const r = parse(await client.callTool({ name: 'prism_lint', arguments: {} }));
    expect(r.ok).toBe(false); // a spread prop is a warning
    const codes = (r.files as { findings: { code: string; fix?: string }[] }[])[0]!.findings.map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining(['NON_LITERAL_PROP', 'UNNAMED_NODE', 'SPREAD_PROP', 'LOCKED_NODE']));
    expect((r.editableCoverage as number) < 1).toBe(true);
  });

  it('prism_set_prop / prism_set_uniform: minimal one-line diffs on disk, tagged "agent", undoable, compare-and-set', async () => {
    const { client, studioWs, waitStudio, fx } = await live();
    const r1 = await client.callTool({ name: 'prism_set_prop', arguments: { node: 'knot', prop: 'position', value: [0.5, 0.25, 0] } });
    expect(r1.isError).toBeFalsy();
    expect(text(r1)).toContain('+        <mesh name="knot" position={[0.5, 0.25, 0]} scale={1}>');
    expect(text(r1)).toContain('--- a/src/Hero3D.tsx');
    const after1 = read(fx.abs).toString();
    expect(after1.split('\n').filter((l, i) => l !== HERO.split('\n')[i])).toHaveLength(1);
    const diff = (await waitStudio((m) => m.type === 'diff')).entry as { author: string; summary: string };
    expect(diff).toMatchObject({ author: 'agent', summary: 'position' });

    const r2 = await client.callTool({ name: 'prism_set_uniform', arguments: { node: 'film', uniform: 'uFilm', value: 2.2 } });
    expect(r2.isError).toBeFalsy();
    expect(text(r2)).toContain('uFilm: { value: 2.2 }');
    expect(read(fx.abs).toString()).toContain('uFilm: { value: 2.2 }');

    // compare-and-set via `expected`
    const stale = await client.callTool({ name: 'prism_set_prop', arguments: { node: 'knot', prop: 'scale', value: 3, expected: 7 } });
    expect(stale.isError).toBe(true);
    expect(parse(stale)).toMatchObject({ code: 'CONFLICT' });
    // unknown things give agent-ready errors, and nothing is written
    const before = read(fx.abs);
    expect(parse(await client.callTool({ name: 'prism_set_prop', arguments: { node: 'nope', prop: 'scale', value: 3 } })).code).toBe('NODE_NOT_FOUND');
    expect(parse(await client.callTool({ name: 'prism_set_prop', arguments: { node: 'knot', prop: 'position', value: 'x' } })).code).toBe('INVALID_VALUE');
    expect(parse(await client.callTool({ name: 'prism_set_uniform', arguments: { node: 'film', uniform: 'nope', value: 1 } })).code).toBe('UNIFORM_NOT_FOUND');
    expect(parse(await client.callTool({ name: 'prism_set_prop', arguments: { prop: 'scale', value: 3 } })).code).toBe('NO_SELECTION');
    expect(read(fx.abs).equals(before)).toBe(true);

    // 1-click undo (Studio's own undo message) restores both edits byte-exact
    for (const id of [1, 2]) {
      studioWs.send(JSON.stringify({ type: 'undo', id }));
      await waitStudio((m) => m.type === 'result' && m.id === id && m.ok === true);
    }
    expect(read(fx.abs).equals(Buffer.from(HERO))).toBe(true);
  });

  it('"edit this": with no node, the selection is the target', async () => {
    const { client, pageWs, fx } = await live();
    pageWs.send(JSON.stringify({ type: 'pick', tag: at('<mesh name="knot"') }));
    await new Promise((r) => setTimeout(r, 150));
    const r = await client.callTool({ name: 'prism_set_prop', arguments: { prop: 'scale', value: 2 } });
    expect(r.isError).toBeFalsy();
    expect(read(fx.abs).toString()).toContain('<mesh name="knot" position={[0, 0, 0]} scale={2}>');
  });

  it('edits do not need the page to be armed (and the daemon stays disarmed)', async () => {
    const { client, daemon } = await live();
    expect(daemon.armed).toBe(false);
    expect((await client.callTool({ name: 'prism_set_prop', arguments: { node: 'knot', prop: 'scale', value: 2 } })).isError).toBeFalsy();
    expect(daemon.armed).toBe(false);
  });

  it('prism_get_view: asks the page to capture and returns a real image block plus metadata; no page is a clear error', async () => {
    const { client, pageWs, pageMsgs } = await live();
    const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
    pageWs.on('message', (d) => {
      const m = JSON.parse(String(d)) as { type: string; id: number };
      if (m.type === 'capture') pageWs.send(JSON.stringify({ type: 'capture-result', id: m.id, ok: true, url: `data:image/png;base64,${PNG}`, width: 1, height: 1, camera: { position: [0, 0, 6], rotation: [0, 0, 0], fov: 40, type: 'PerspectiveCamera' }, viewport: { cssWidth: 100, cssHeight: 80, dpr: 1 } }));
    });
    const r = (await client.callTool({ name: 'prism_get_view', arguments: {} })) as { content: { type: string; data?: string; mimeType?: string; text?: string }[] };
    const img = r.content.find((c) => c.type === 'image');
    expect(img).toMatchObject({ mimeType: 'image/png', data: PNG });
    expect(JSON.parse(r.content.find((c) => c.type === 'text')!.text!)).toMatchObject({ camera: { fov: 40 }, viewport: { cssWidth: 100 }, armed: false });
    expect(pageMsgs.some((m) => m.type === 'capture')).toBe(true);

    pageWs.terminate();
    await new Promise((r2) => setTimeout(r2, 200));
    const none = await client.callTool({ name: 'prism_get_view', arguments: {} });
    expect(none.isError).toBe(true);
    expect(parse(none).code).toBe('NO_PAGE');
  });

  it('prism_get_view times out sensibly when the page never answers', async () => {
    const { client } = await live();
    const t0 = Date.now();
    const r = await client.callTool({ name: 'prism_get_view', arguments: {} });
    expect(r.isError).toBe(true);
    expect(parse(r).code).toBe('CAPTURE_FAILED');
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it('the agent API refuses callers without the token and any request carrying an Origin (a web page)', async () => {
    const { daemon } = await live();
    void daemon;
    const fx2 = fixture();
    cleanup.push(() => fx2.cleanup());
    const d2 = createDaemon({ root: fx2.root, token: TOKEN, port: 0, watch: false });
    const { port } = await d2.listen();
    cleanup.push(() => d2.close());
    const call = (headers: Record<string, string>) => fetch(`http://127.0.0.1:${port}/__prism/api/selection`, { headers: { host: `127.0.0.1:${port}`, ...headers } });
    expect((await call({})).status).toBe(401);
    expect((await call({ authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await call({ authorization: `Bearer ${TOKEN}`, origin: 'http://evil.example' })).status).toBe(401);
    expect((await call({ authorization: `Bearer ${TOKEN}` })).status).toBe(200);
    void ready;
  });
});
