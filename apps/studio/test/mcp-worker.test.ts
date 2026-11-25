import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import worker, { buildData } from '../worker/index';
import type { Env } from '../worker/index';
import { handleMcp } from '../worker/mcp';
import type { McpData } from '../worker/mcp';
import { TEMPLATE_MODULES } from '../worker/templates';

const templatesDir = fileURLToPath(new URL('../../../packages/templates/', import.meta.url));
const manifest = JSON.parse(readFileSync(`${templatesDir}manifest.json`, 'utf8')) as { templates: { id: string; title: string; description: string }[] };

// Real template sources from disk (in the Worker bundle they arrive as text imports).
const data: McpData = {
  version: '9.9.9',
  templates: manifest.templates.map((t) => ({ ...t, source: readFileSync(`${templatesDir}templates/${t.id}.tsx`, 'utf8') })),
};

const URL_ = 'https://prismbox.example/mcp';
const post = (body: unknown, url = URL_) => handleMcp(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }), data);
const rpc = async (body: unknown) => (await post(body)).json() as Promise<{ id: unknown; result?: Record<string, any>; error?: { code: number; message: string } }>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('remote MCP: protocol', () => {
  it('initialize negotiates the protocol version and advertises read-only tools', async () => {
    const r = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    expect(r.id).toBe(1);
    expect(r.result?.protocolVersion).toBe('2025-03-26');
    expect(r.result?.capabilities).toEqual({ tools: { listChanged: false } });
    expect(r.result?.serverInfo).toMatchObject({ name: 'prismbox-remote', version: '9.9.9' });
    // an unknown version falls back to the newest one we support
    const r2 = await rpc({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
    expect(r2.result?.protocolVersion).toBe('2025-11-25');
  });

  it('notifications get 202 with no body, and ping answers', async () => {
    const n = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(n.status).toBe(202);
    expect(await n.text()).toBe('');
    expect((await rpc({ jsonrpc: '2.0', id: 'p', method: 'ping' })).result).toEqual({});
  });

  it('tools/list returns the three read-only tools with schemas', async () => {
    const r = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    const tools = r.result?.tools as { name: string; annotations: { readOnlyHint: boolean }; inputSchema: { type: string } }[];
    expect(tools.map((t) => t.name)).toEqual(['list_templates', 'get_template_code', 'get_prismbox_guide']);
    for (const t of tools) {
      expect(t.annotations.readOnlyHint).toBe(true);
      expect(t.inputSchema.type).toBe('object');
    }
    expect(tools[1]?.inputSchema).toMatchObject({ required: ['templateId'] });
  });

  it('answers JSON-RPC errors for bad input without throwing', async () => {
    expect((await rpc({ jsonrpc: '2.0', id: 4, method: 'resources/list' })).error?.code).toBe(-32601);
    expect((await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'delete_everything' } })).error?.code).toBe(-32602);
    expect((await rpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: {} })).error?.code).toBe(-32602);
    expect((await rpc({ id: 7, method: 'ping' })).error?.code).toBe(-32600);
    const bad = await post('{not json');
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { code: number } }).error.code).toBe(-32700);
  });

  it('handles batches, and rejects empty, oversized and huge bodies', async () => {
    const res = await post([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]);
    const out = (await res.json()) as { id: number }[];
    expect(out.map((x) => x.id)).toEqual([1, 2]);
    expect((await post([])).status).toBe(400);
    expect((await post(Array.from({ length: 21 }, (_, i) => ({ jsonrpc: '2.0', id: i, method: 'ping' })))).status).toBe(400);
    expect((await post(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', pad: 'x'.repeat(70_000) }))).status).toBe(413);
  });
});

describe('remote MCP: tools', () => {
  const call = (name: string, args?: unknown) => rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });

  it('list_templates returns every manifest template with a direct Playground URL', async () => {
    const r = await call('list_templates');
    const list = JSON.parse(r.result?.content[0].text) as { id: string; name: string; description: string; url: string }[];
    expect(list.map((t) => t.id)).toEqual(manifest.templates.map((t) => t.id));
    expect(list).toHaveLength(7);
    for (const t of list) {
      expect(t.name && t.description).toBeTruthy();
      expect(t.url).toBe(`https://prismbox.example/?template=${t.id}`);
    }
  });

  it('get_template_code returns the exact copy-paste .tsx, shader annotations included', async () => {
    for (const t of manifest.templates) {
      const r = await call('get_template_code', { templateId: t.id });
      expect(r.result?.isError).toBeUndefined();
      expect(r.result?.content[0].text).toBe(readFileSync(`${templatesDir}templates/${t.id}.tsx`, 'utf8'));
    }
    const knot = (await call('get_template_code', { templateId: 'iridescent-knot' })).result?.content[0].text as string;
    expect(knot).toContain('// @prism uniform uFilm float 0..3 =1.4');
    expect(knot).toContain('export default function Hero');
  });

  it('get_template_code lists the valid ids when the id is unknown, missing or the wrong type', async () => {
    for (const args of [{ templateId: 'nope' }, {}, { templateId: 42 }, undefined]) {
      const r = await call('get_template_code', args);
      expect(r.result?.isError).toBe(true);
      const msg = r.result?.content[0].text as string;
      expect(msg).toMatch(/^Unknown templateId /);
      for (const t of manifest.templates) expect(msg).toContain(t.id);
    }
  });

  it('get_prismbox_guide covers npx prismbox, // @prism annotations and local vs remote MCP', async () => {
    const guide = (await call('get_prismbox_guide')).result?.content[0].text as string;
    for (const needle of ['npx prismbox', '// @prism uniform', 'claude mcp add prismbox -- npx -y prismbox mcp', 'https://prismbox.prismbox.workers.dev/mcp', 'read-only']) expect(guide).toContain(needle);
    expect(guide.length).toBeLessThan(3500);
  });
});

describe('remote MCP: HTTP surface', () => {
  const cors = (r: Response) => {
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    expect(r.headers.get('access-control-allow-methods')).toBe('GET, POST, DELETE, OPTIONS');
    const allowed = (r.headers.get('access-control-allow-headers') ?? '').split(/,\s*/);
    for (const h of ['Content-Type', 'Accept', 'Mcp-Session-Id']) expect(allowed).toContain(h);
  };

  it('answers the CORS preflight with 204 and full CORS headers', async () => {
    const r = await handleMcp(new Request(URL_, { method: 'OPTIONS', headers: { origin: 'https://app.example', 'access-control-request-method': 'POST' } }), data);
    expect(r.status).toBe(204);
    cors(r);
  });

  it('GET and DELETE get a clean 405 with server info and an Allow header, and CORS on every response', async () => {
    for (const method of ['GET', 'DELETE']) {
      const r = await handleMcp(new Request(URL_, { method }), data);
      expect(r.status).toBe(405);
      expect(r.headers.get('allow')).toBe('POST, OPTIONS');
      cors(r);
      expect(((await r.json()) as { tools: string[] }).tools).toHaveLength(3);
    }
    cors(await post({ jsonrpc: '2.0', id: 1, method: 'ping' }));
    cors(await post('{bad'));
  });
});

describe('Worker routing', () => {
  const html = '<!doctype html><title>Prismbox Playground</title>';
  const calls: string[] = [];
  const env: Env = { ASSETS: { fetch: async (req) => (calls.push(new URL(req.url).pathname), new Response(html, { headers: { 'content-type': 'text/html' } })) } };

  it('keeps serving the Playground from the static assets for every non-/mcp path', async () => {
    for (const p of ['/', '/index.html', '/sandbox.html', '/assets/app.js', '/some/spa/route']) {
      const r = await worker.fetch(new Request(`https://prismbox.example${p}`), env);
      expect(r.status).toBe(200);
      expect(await r.text()).toBe(html);
    }
    expect(calls).toEqual(['/', '/index.html', '/sandbox.html', '/assets/app.js', '/some/spa/route']);
  });

  it('routes /mcp (and /mcp/) to the handler and never to the static assets', async () => {
    calls.length = 0;
    for (const p of ['/mcp', '/mcp/']) {
      const r = await worker.fetch(new Request(`https://prismbox.example${p}`, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) }), env);
      expect(((await r.json()) as { result: unknown }).result).toEqual({});
    }
    expect(calls).toEqual([]);
  });

  it('wires every manifest template into the Worker (templates.ts and manifest.json agree)', () => {
    expect(Object.keys(TEMPLATE_MODULES).sort()).toEqual(manifest.templates.map((t) => t.id).sort());
    const built = buildData(Object.fromEntries(manifest.templates.map((t) => [t.id, `src:${t.id}`])));
    expect(built.templates.map((t) => t.source)).toEqual(manifest.templates.map((t) => `src:${t.id}`));
    expect(built.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
