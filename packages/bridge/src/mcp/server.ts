import { GUIDE } from '@prismbox/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lintFile, sceneFile } from '../agent/describe';
import { Project } from '../daemon/project';
import { prismHome, readSession } from '../session-file';
import type { SessionDescriptor } from '../session-file';

export interface McpOptions {
  root: string;
  /** Where the session registry lives (default `$PRISMBOX_HOME` or `~/.prismbox`). */
  home?: string;
  version: string;
}

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
interface ToolResult {
  [k: string]: unknown;
  content: Content[];
  isError?: boolean;
}

const text = (t: string): ToolResult => ({ content: [{ type: 'text', text: t }] });
const json = (o: unknown): ToolResult => text(JSON.stringify(o, null, 2));

/** Agent-ready error: what happened, the fix, a stable code. Never throws to the transport. */
function fail(code: string, what: string, fix: string): ToolResult {
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false, code, what, fix }, null, 2) }] };
}

class DaemonOffline extends Error {}

/** A thin authenticated client for the daemon that `prismbox` started for this project. */
class DaemonClient {
  constructor(
    private readonly root: string,
    private readonly home: string,
  ) {}

  session(): SessionDescriptor {
    const s = readSession(this.home, this.root);
    if (!s) throw new DaemonOffline();
    return s;
  }

  async call(method: 'GET' | 'POST', route: string, body?: unknown): Promise<Record<string, unknown>> {
    const s = this.session();
    let res: Response;
    try {
      res = await fetch(`http://127.0.0.1:${s.port}/__prism/api/${route}`, {
        method,
        headers: { authorization: `Bearer ${s.token}`, host: `127.0.0.1:${s.port}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new DaemonOffline(); // port closed: the daemon died without cleaning up
    }
    return (await res.json()) as Record<string, unknown>;
  }
}

const OFFLINE = (root: string) =>
  fail('DAEMON_OFFLINE', `prismbox is not running for ${root}.`, `Ask the user to run \`npx prismbox\` in that project folder (and open the page it prints), then retry. prism_lint and prismbox://guide work without it.`);

/** Build the MCP server: 1 resource and 6 tools. Everything it knows about the live editor comes from the daemon. */
export function createMcpServer(opts: McpOptions): McpServer {
  const root = opts.root;
  const home = opts.home ?? prismHome();
  const daemon = new DaemonClient(root, home);
  const project = new Project(root);
  const server = new McpServer({ name: 'prismbox', version: opts.version }, { instructions: 'Prismbox is a visual editor for React Three Fiber. Read prismbox://guide once. When the user says "this", "that" or "here", call prism_get_selection. Look at the result with prism_get_view.' });

  server.registerResource('guide', 'prismbox://guide', { title: 'Prismbox agent guide', description: 'How to write R3F that Prismbox can edit, and how to use these tools.', mimeType: 'text/markdown' }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'text/markdown', text: GUIDE }],
  }));

  const wrap = (fn: () => Promise<ToolResult>): Promise<ToolResult> =>
    fn().catch((e: unknown) => {
      if (e instanceof DaemonOffline) return OFFLINE(root);
      const er = e as { code?: string; message?: string };
      return fail(typeof er.code === 'string' ? er.code : 'INTERNAL', er.message ?? String(e), 'See the error code in prismbox://guide, or retry.');
    });

  const apiError = (r: Record<string, unknown>): ToolResult | null => {
    if (r.ok !== false) return null;
    const code = String(r.code ?? 'INTERNAL');
    const fix: Record<string, string> = {
      CONFLICT: 'The file changed since you last looked. Call prism_get_scene or prism_get_selection again and retry with the fresh value.',
      OUT_OF_SUBSET: 'That prop is an expression, not a literal. Edit the source by hand, or rewrite it as a literal first.',
      NO_SELECTION: 'Pass `node` (a name from prism_get_scene) or ask the user to select an object.',
      NO_PAGE: 'Ask the user to open their page (the URL prismbox printed) in a browser tab.',
      NODE_NOT_FOUND: 'Call prism_get_scene for valid node names.',
      AMBIGUOUS_NODE: 'Give the nodes unique `name` props, or address one by its path id from prism_get_scene.',
      INVALID_VALUE: 'Check the value type for that prop (position and rotation are [x, y, z]; colors are "#hex").',
      READ_ONLY_PROP: 'Prismbox never writes ref, key, handlers or GLSL source.',
      READ_ONLY_NODE: 'This node is locked (.map(), a conditional, a spread, or opaque). Edit the source by hand.',
      UNIFORM_NOT_FOUND: 'Call prism_get_scene to see the shader uniforms that are editable.',
      CAPTURE_FAILED: 'Make sure the tab is open and the 3D canvas is visible, then retry.',
    };
    return fail(code, String(r.message ?? 'The daemon refused the request.'), fix[code] ?? 'See prismbox://guide.');
  };

  // ---- prism_get_selection ----
  server.registerTool('prism_get_selection', {
    title: 'Get the selected 3D node',
    description: 'Returns the node the user currently has selected in the editor (clicked on their real page or picked in Studio): file, line:col, tag, name, props, shader uniforms and the surrounding source. Call this whenever the user says "this", "that" or "here".',
    inputSchema: {},
  }, () => wrap(async () => {
    const r = await daemon.call('GET', 'selection');
    return apiError(r) ?? json(r);
  }));

  // ---- prism_get_view ----
  server.registerTool('prism_get_view', {
    title: 'See the live 3D canvas',
    description: 'Captures the live <Canvas> on the user\'s page as a PNG (gizmo hidden, works whether or not Studio is armed) plus camera and viewport metadata, so you can look at the scene.',
    inputSchema: {},
  }, () => wrap(async () => {
    const r = await daemon.call('GET', 'view');
    const err = apiError(r);
    if (err) return err;
    const meta = { width: r.width, height: r.height, camera: r.camera, viewport: r.viewport, armed: r.armed, selection: r.selection };
    return { content: [{ type: 'image', data: String(r.png), mimeType: 'image/png' }, { type: 'text', text: JSON.stringify(meta) }] };
  }));

  // ---- prism_get_scene ----
  server.registerTool('prism_get_scene', {
    title: 'Get the scene outline',
    description: 'The instrumented scene tree for one R3F file (or every scene file in the project): nodes with name, line, edit state (editable, partial, read-only), props and shader uniforms, plus subset diagnostics. Use the `name` values as `node` in the set tools.',
    inputSchema: { file: z.string().optional().describe('Project-relative path, for example src/Hero3D.tsx. Omit for all scene files.') },
  }, ({ file }) => wrap(async () => {
    try {
      const r = await daemon.call('GET', `scene${file ? `?file=${encodeURIComponent(file)}` : ''}`);
      return apiError(r) ?? json(r);
    } catch (e) {
      if (!(e instanceof DaemonOffline)) throw e;
      // standalone: read straight from disk
      const list = file ? [file] : await project.listScenes();
      return json({ ok: true, daemon: 'offline', files: await Promise.all(list.map((f) => sceneFile(project, f))) });
    }
  }));

  const valueSchema = z.union([z.number(), z.string(), z.boolean(), z.array(z.number()), z.record(z.string(), z.unknown())]);
  const target = {
    node: z.string().optional().describe('Node name (or path id) from prism_get_scene. Omit to edit the node the user has selected ("this").'),
    file: z.string().optional().describe('Project-relative file. Defaults to the selected node\'s file or the open scene file.'),
    expected: valueSchema.optional().describe('The value you last saw. If the file holds something else the edit is refused (CONFLICT).'),
  };
  const editResult = (r: Record<string, unknown>): ToolResult => {
    const d = r.diff as { unified: string } | null;
    const head = r.changed ? `Edited ${String(r.file)} (node ${String(r.node)}). The user can undo this in Studio with one click.` : `No change: ${String(r.file)} already had that value.`;
    return text(`${head}\n\n${d ? `${d.unified}\n\n` : ''}${JSON.stringify({ ok: true, changed: r.changed, file: r.file, node: r.node, hash: r.hash })}`);
  };

  // ---- prism_set_prop ----
  server.registerTool('prism_set_prop', {
    title: 'Set a prop on a node',
    description: 'A minimal one-line edit of a literal prop (position, rotation, scale, color, roughness, args, ...) as text, validated against the Prismbox subset and compare-and-set against the file on disk. Shown to the user tagged "agent" and undoable. Returns the diff.',
    inputSchema: { ...target, prop: z.string().describe('Prop name, for example position, rotation, scale, roughness, color.'), value: valueSchema.describe('Literal value: numbers, "#hex" strings, booleans, [x, y, z] arrays (rotation in radians).') },
  }, ({ node, file, expected, prop, value }) => wrap(async () => {
    const r = await daemon.call('POST', 'edit', { kind: 'prop', node, file, prop, value, expected });
    return apiError(r) ?? editResult(r);
  }));

  // ---- prism_set_uniform ----
  server.registerTool('prism_set_uniform', {
    title: 'Set a shader uniform',
    description: 'Edits uniforms.<name>.value on a shaderMaterial (inline or a same-file const). Literal keys of a mixed uniforms object stay editable. new THREE.Color / VectorN keep their constructor. Same safety, diff and undo as prism_set_prop.',
    inputSchema: { ...target, uniform: z.string().describe('Uniform name, for example uFilm.'), value: valueSchema.describe('A number, boolean, "#hex" for a Color uniform, or [x, y, z] for a vector.') },
  }, ({ node, file, expected, uniform, value }) => wrap(async () => {
    const r = await daemon.call('POST', 'edit', { kind: 'uniform', node, file, uniform, value, expected });
    return apiError(r) ?? editResult(r);
  }));

  // ---- prism_lint ----
  server.registerTool('prism_lint', {
    title: 'Lint a file against the Prism subset',
    description: 'Checks a scene file (or every scene file) against the editable subset and the style guide: editable coverage and actionable diagnostics with fixes. Works without the daemon, straight from disk.',
    inputSchema: { file: z.string().optional().describe('Project-relative path. Omit for all scene files.') },
  }, ({ file }) => wrap(async () => {
    const list = file ? [file] : await project.listScenes();
    if (list.length === 0) return fail('FILE_NOT_FOUND', `No React Three Fiber scene files found under ${root}.`, 'Pass `file`, or run from the project folder.');
    const results = await Promise.all(list.map((f) => lintFile(project, f)));
    const total = results.reduce((a, r) => ({ host: a.host + r.hostNodes, ed: a.ed + r.editableNodes }), { host: 0, ed: 0 });
    return json({ ok: results.every((r) => r.ok), editableCoverage: total.host ? Math.round((total.ed / total.host) * 1000) / 1000 : 1, files: results });
  }));

  return server;
}
