import { findNodeByTag, outline, readScene } from '@prismbox/core';
import type { OutlineEntry, SceneNode } from '@prismbox/core';
import type { Project } from '../daemon/project';

const cap = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export interface PropView {
  name: string;
  kind: string;
  value?: unknown;
  text?: string;
  reason?: string;
}

function propViews(node: SceneNode): PropView[] {
  return node.props
    .filter((p) => p.kind !== 'meta' && p.kind !== 'spread')
    .map((p) => {
      const v: PropView = { name: p.name, kind: p.kind };
      if (p.kind === 'literal' || p.kind === 'resolved') v.value = p.value ?? undefined;
      if (p.value === undefined || p.kind === 'expression') v.text = cap(p.text.replace(/\s+/g, ' '), 200);
      if (p.kind === 'expression' && p.category === 'object-partial') v.reason = 'some uniforms keys are not literals; the literal keys are editable';
      else if (p.kind === 'expression') v.reason = `an expression (${p.category ?? 'non-literal'}), so it is read-only`;
      if (p.name === 'vertexShader' || p.name === 'fragmentShader') {
        delete v.value; // GLSL source is not editable and can be large
        v.text = '(GLSL source; edit uniforms, not shader code)';
      }
      return v;
    });
}

/** Numbered source lines around a node: its opening tag plus a few lines of context, bounded. */
export function snippet(source: string, node: SceneNode, before = 2, maxLines = 10): { startLine: number; text: string } {
  const lines = source.split(/\r?\n/);
  const start = Math.max(1, node.line - before);
  const end = Math.min(lines.length, start + maxLines - 1);
  const width = String(end).length;
  const text = lines
    .slice(start - 1, end)
    .map((l, i) => `${String(start + i).padStart(width)}${start + i === node.line ? '>' : ' '}| ${cap(l, 220)}`)
    .join('\n');
  return { startLine: start, text };
}

export function describeNode(file: string, source: string, node: SceneNode, entry?: OutlineEntry) {
  return {
    file,
    line: node.line,
    col: node.col,
    tag: `${file}:${node.line}:${node.col}`,
    element: node.tag,
    name: node.name ?? null,
    id: node.id,
    kind: node.kind,
    status: node.status,
    edit: entry?.edit ?? (node.status === 'editable' ? 'editable' : 'read-only'),
    reasons: node.reasons,
    props: propViews(node),
    uniforms: node.shader
      ? node.shader.keys.map((k) => {
          const ann = node.shader?.annotations.find((a) => a.name === k.name);
          return { name: k.name, editable: k.kind === 'literal', value: k.value ?? null, ...(ann ? { annotation: ann } : {}) };
        })
      : undefined,
    snippet: snippet(source, node).text,
  };
}

/** The node a `file:line:col` tag refers to, described, or a reason it cannot be found. */
export async function describeTag(project: Project, tag: string): Promise<{ ok: true; node: ReturnType<typeof describeNode> } | { ok: false; reason: string }> {
  const m = /^(.+):(\d+):(\d+)$/.exec(tag);
  if (!m) return { ok: false, reason: `"${tag}" is not a file:line:col tag.` };
  let snap;
  try {
    snap = await project.read(m[1] as string);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  const scene = readScene(snap.source, snap.path);
  const node = findNodeByTag(scene, tag);
  if (!node) return { ok: false, reason: `Nothing at ${tag} any more: the file changed since it was selected. Ask the user to click the object again.` };
  const entry = outline(scene).find((e) => e.node === node);
  return { ok: true, node: describeNode(snap.path, snap.source, node, entry) };
}

export interface SceneFileView {
  file: string;
  hash: string;
  coverage: number;
  counts: { hostNodes: number; editable: number; partial: number; readOnly: number; opaque: number };
  nodes: { id: string; element: string; name: string | null; line: number; col: number; depth: number; edit: string; status: string; reasons: string[]; props: PropView[]; uniforms?: { name: string; editable: boolean; value: unknown; annotation?: unknown }[] }[];
  diagnostics: { code: string; severity: string; line: number; col: number; message: string }[];
}

export async function sceneFile(project: Project, file: string): Promise<SceneFileView> {
  const snap = await project.read(file);
  const scene = readScene(snap.source, snap.path);
  const entries = outline(scene);
  const hosts = entries.filter((e) => e.node.kind === 'host');
  return {
    file: snap.path,
    hash: snap.hash,
    coverage: Math.round(scene.summary.coverage * 1000) / 1000,
    counts: {
      hostNodes: scene.summary.hostNodes,
      editable: hosts.filter((e) => e.edit === 'editable').length,
      partial: hosts.filter((e) => e.edit === 'partial').length,
      readOnly: hosts.filter((e) => e.edit === 'read-only').length,
      opaque: scene.summary.opaque,
    },
    nodes: entries.map((e) => {
      const d = describeNode(snap.path, snap.source, e.node, e);
      return { id: d.id, element: d.element, name: d.name, line: d.line, col: d.col, depth: e.depth, edit: d.edit, status: d.status, reasons: d.reasons, props: d.props, ...(d.uniforms ? { uniforms: d.uniforms } : {}) };
    }),
    diagnostics: scene.diagnostics.map((d) => ({ code: d.code, severity: d.severity, line: d.line, col: d.col, message: d.message })),
  };
}

export interface LintFinding {
  code: string;
  severity: 'error' | 'warn' | 'info';
  line: number;
  col: number;
  message: string;
  fix?: string;
}

/** Subset validation plus the style-guide rules an agent can act on. */
export async function lintFile(project: Project, file: string) {
  const snap = await project.read(file);
  const scene = readScene(snap.source, snap.path);
  const findings: LintFinding[] = [];
  for (const d of scene.diagnostics) {
    const fix: Record<string, string> = {
      NON_LITERAL_PROP: 'Write the value as a literal, or move the computation out and keep the prop literal.',
      SPREAD_PROP: 'Replace the spread with explicit props.',
      UNSUPPORTED_IMPORT: 'Import only from react, three, @react-three/fiber, @react-three/drei and relative files.',
      UNKNOWN_DREI_COMPONENT: 'It will render, but Prismbox leaves it alone.',
      MULTIPLE_CANVAS: 'Use one <Canvas> per file.',
      AMBIGUOUS_NODE: 'Give each node a unique literal `name`.',
    };
    findings.push({ code: d.code, severity: d.code === 'NON_LITERAL_PROP' || d.code === 'UNKNOWN_DREI_COMPONENT' || d.code === 'MULTIPLE_CANVAS' ? 'info' : d.severity, line: d.line, col: d.col, message: d.message, ...(fix[d.code] ? { fix: fix[d.code] } : {}) });
  }
  for (const n of scene.nodes) {
    if (n.kind === 'host' && (n.tag === 'mesh' || n.tag === 'group') && !n.name) {
      findings.push({ code: 'UNNAMED_NODE', severity: 'info', line: n.line, col: n.col, message: `<${n.tag}> has no \`name\`.`, fix: 'Add a unique literal name, for example name="orb".' });
    }
    if (n.locked === 'map' || n.locked === 'conditional') {
      findings.push({ code: 'LOCKED_NODE', severity: 'info', line: n.line, col: n.col, message: `<${n.tag}> is ${n.locked === 'map' ? 'generated by .map()' : 'inside a conditional'}, so it is selectable but read-only.`, fix: 'Write the node out explicitly if it should be editable.' });
    }
    if (n.tag === 'shaderMaterial') {
      for (const p of ['vertexShader', 'fragmentShader', 'uniforms']) {
        const info = n.props.find((x) => x.name === p);
        if (info && info.kind === 'expression' && info.category !== 'object-partial') {
          findings.push({ code: 'UNRESOLVED_SHADER_PROP', severity: 'warn', line: n.line, col: n.col, message: `shaderMaterial \`${p}\` is not an inline literal or a same-file const.`, fix: `Bind it to a top-level const (or an empty-deps useMemo) in this file.` });
        }
      }
    }
  }
  if (/preserveDrawingBuffer/.test(snap.source)) findings.push({ code: 'PRESERVE_DRAWING_BUFFER', severity: 'info', line: 1, col: 1, message: 'preserveDrawingBuffer is set; Prismbox capture does not need it and it costs performance.' });
  findings.sort((a, b) => a.line - b.line || a.col - b.col);
  return {
    file: snap.path,
    coverage: Math.round(scene.summary.coverage * 1000) / 1000,
    hostNodes: scene.summary.hostNodes,
    editableNodes: scene.summary.editable,
    findings,
    ok: !findings.some((f) => f.severity === 'error' || f.severity === 'warn'),
  };
}

/** A unified diff for a one-hunk change, for tool output. */
export function unified(file: string, d: { line: number; before: string; after: string }): string {
  return `--- a/${file}\n+++ b/${file}\n@@ -${d.line},1 +${d.line},1 @@\n-${d.before}\n+${d.after}`;
}
