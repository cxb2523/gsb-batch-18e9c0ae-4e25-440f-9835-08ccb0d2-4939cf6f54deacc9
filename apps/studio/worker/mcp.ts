/**
 * A stateless, read-only remote MCP server (Streamable HTTP, JSON-RPC 2.0) for the hosted Playground.
 * It only serves public template sources and a short guide: no sessions, no state, no file access, no writes.
 * Editing your own project is what the local `prismbox mcp` server is for.
 */

export interface TemplateData {
  id: string;
  title: string;
  description: string;
  source: string;
}

export interface McpData {
  templates: TemplateData[];
  version: string;
}

const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BODY_BYTES = 64 * 1024;
const MAX_BATCH = 20;

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
  'Access-Control-Max-Age': '86400',
};

export const GUIDE = `# Prismbox in 60 seconds

Prismbox is an open-source visual editor for React Three Fiber. It edits your real Vite page: drag a gizmo or move a
slider and the change is written into your .tsx as a one-line diff you can read and undo exactly.

## Run it on your project
  npx prismbox
Run it from your Vite + React 19 + @react-three/fiber 9 project (or pass --root <dir>). It starts your own dev server with
a dev-only plugin and opens Studio. It never edits package.json or vite.config, and Studio starts disarmed until you arm it.

## Tunable shader uniforms: // @prism annotations
Put an ordinary GLSL comment above the uniform declaration and it becomes a slider (or colour picker) in Studio:
  // @prism uniform uFilm float 0..3 =1.4
  // @prism uniform uColorA color =#7c5cff
  uniform float uFilm;
Format: // @prism uniform <name> <float|color> [min..max] =<default>. The comment has no runtime effect, so you can keep or delete it.
The matching value must be a literal in the uniforms object (for example uFilm: { value: 1.4 }).

## Two MCP servers, two jobs
- Remote (this server, read-only): https://prismbox.prismbox.workers.dev/mcp
  Tools: list_templates, get_template_code, get_prismbox_guide. It can only read public template code.
- Local (edits your project): claude mcp add prismbox -- npx -y prismbox mcp --root <your project>
  On Windows use: claude mcp add prismbox -- cmd /c npx -y prismbox mcp --root <your project>
  It talks to the daemon started by npx prismbox (keep that running) and can read and edit your scene.

## Limits
Vite projects only for now (Next.js is planned). Edits cover literal props: numbers, strings, booleans, arrays, colours and annotated uniforms.

## Links
Playground: https://prismbox.prismbox.workers.dev
Source (MIT): https://github.com/Guten-Morgen1302/prismbox
`;

type Id = string | number | null;
interface RpcRequest {
  jsonrpc: '2.0';
  id?: Id;
  method: string;
  params?: Record<string, unknown>;
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS, ...extra } });

const rpcError = (id: Id, code: number, message: string) => ({ jsonrpc: '2.0' as const, id, error: { code, message } });
const rpcResult = (id: Id, result: unknown) => ({ jsonrpc: '2.0' as const, id, result });

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };

export const TOOLS = [
  {
    name: 'list_templates',
    title: 'List Playground templates',
    description: 'List the Prismbox Playground hero templates (React Three Fiber scenes) with id, name, description and a direct Playground URL.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: READ_ONLY,
  },
  {
    name: 'get_template_code',
    title: 'Get template code',
    description: 'Return the full copy-paste React Three Fiber .tsx source of one Playground template, including its GLSL shaders and // @prism uniform annotations.',
    inputSchema: {
      type: 'object',
      properties: { templateId: { type: 'string', description: 'A template id from list_templates, for example "liquid-chrome-blob".' } },
      required: ['templateId'],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: 'get_prismbox_guide',
    title: 'Get the Prismbox guide',
    description: 'A short guide: running `npx prismbox`, // @prism uniform annotations, and how the local and remote MCP servers differ.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: READ_ONLY,
  },
];

const text = (t: string, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });

function callTool(name: string, args: Record<string, unknown>, data: McpData, origin: string): unknown {
  switch (name) {
    case 'list_templates':
      return text(JSON.stringify(data.templates.map((t) => ({ id: t.id, name: t.title, description: t.description, url: `${origin}/?template=${t.id}` })), null, 2));
    case 'get_template_code': {
      const id = args.templateId;
      const t = typeof id === 'string' ? data.templates.find((x) => x.id === id) : undefined;
      if (!t) {
        const shown = typeof id === 'string' ? JSON.stringify(id.slice(0, 80)) : 'a missing or non-string value';
        return text(`Unknown templateId ${shown}. Valid ids: ${data.templates.map((x) => x.id).join(', ')}.`, true);
      }
      return text(t.source);
    }
    case 'get_prismbox_guide':
      return text(GUIDE);
    default:
      return undefined;
  }
}

function handleRpc(msg: unknown, data: McpData, origin: string): unknown {
  if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) return rpcError(null, -32600, 'Invalid Request');
  const m = msg as Partial<RpcRequest>;
  if (m.jsonrpc !== '2.0' || typeof m.method !== 'string') return rpcError(typeof m.id === 'string' || typeof m.id === 'number' ? m.id : null, -32600, 'Invalid Request');
  if (m.id === undefined) return undefined; // a notification (notifications/initialized, ...): accepted, nothing to answer
  const id: Id = m.id;
  const params = (typeof m.params === 'object' && m.params !== null ? m.params : {}) as Record<string, unknown>;
  switch (m.method) {
    case 'initialize': {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      return rpcResult(id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : (SUPPORTED_VERSIONS[0] as string),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'prismbox-remote', title: 'Prismbox (read-only)', version: data.version },
        instructions: 'Read-only access to the Prismbox Playground templates and guide. To edit your own project, run `npx prismbox` and add the local MCP server: see get_prismbox_guide.',
      });
    }
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: TOOLS });
    case 'tools/call': {
      const name = params.name;
      if (typeof name !== 'string') return rpcError(id, -32602, 'Invalid params: "name" is required');
      const args = (typeof params.arguments === 'object' && params.arguments !== null ? params.arguments : {}) as Record<string, unknown>;
      const result = callTool(name, args, data, origin);
      return result === undefined ? rpcError(id, -32602, `Unknown tool: ${name.slice(0, 80)}`) : rpcResult(id, result);
    }
    default:
      return rpcError(id, -32601, `Method not found: ${m.method.slice(0, 80)}`);
  }
}

/** Handle one request to /mcp. Pure: Request in, Response out. */
export async function handleMcp(request: Request, data: McpData): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (method !== 'POST') {
    // No server-initiated stream and no sessions: GET (SSE) and DELETE (end session) are not offered.
    return json(
      {
        name: 'prismbox-remote',
        version: data.version,
        description: 'Stateless read-only MCP server (Streamable HTTP). Send JSON-RPC 2.0 messages with POST.',
        tools: TOOLS.map((t) => t.name),
        docs: 'https://github.com/Guten-Morgen1302/prismbox#remote-mcp-endpoint',
      },
      405,
      { Allow: 'POST, OPTIONS' },
    );
  }
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) return json(rpcError(null, -32600, 'Request too large'), 413);
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json(rpcError(null, -32600, 'Request too large'), 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(rpcError(null, -32700, 'Parse error'), 400);
  }
  const origin = new URL(request.url).origin;
  if (Array.isArray(body)) {
    if (body.length === 0 || body.length > MAX_BATCH) return json(rpcError(null, -32600, `Batch must contain 1 to ${MAX_BATCH} messages`), 400);
    const out = body.map((m) => handleRpc(m, data, origin)).filter((r) => r !== undefined);
    return out.length === 0 ? new Response(null, { status: 202, headers: CORS }) : json(out);
  }
  const res = handleRpc(body, data, origin);
  return res === undefined ? new Response(null, { status: 202, headers: CORS }) : json(res);
}
