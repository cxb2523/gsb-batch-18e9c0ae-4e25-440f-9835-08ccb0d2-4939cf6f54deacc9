import type { Scene, SceneNode } from './read';

export interface OutlineEntry {
  node: SceneNode;
  /** Number of ancestor nodes (custom wrapper components such as `<Spin>` are not nodes and do not count). */
  depth: number;
  /** Index of the nearest ancestor entry, or -1. */
  parent: number;
  /**
   * `editable`: every prop is a literal. `partial`: some props are literal and some are not (a node that
   * is read-only as a whole can still have editable props). `read-only`: nothing on it can be edited.
   */
  edit: 'editable' | 'partial' | 'read-only';
}

/** A flat, source-ordered tree of the scene's nodes, ready to render as an indented list. */
export function outline(scene: Scene): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  const stack: number[] = [];
  for (const node of scene.nodes) {
    while (stack.length && (out[stack[stack.length - 1] as number] as OutlineEntry).node.end <= node.start) stack.pop();
    const parent = stack.length ? (stack[stack.length - 1] as number) : -1;
    const literalProps = node.props.filter((p) => p.kind === 'literal' || p.kind === 'resolved').length;
    const keyEditable = node.shader?.keys.some((k) => k.kind === 'literal') ?? false;
    let edit: OutlineEntry['edit'];
    if (node.locked) edit = 'read-only';
    else if (node.status === 'editable') edit = 'editable';
    else edit = literalProps > 0 || keyEditable ? 'partial' : 'read-only';
    out.push({ node, depth: stack.length, parent, edit });
    stack.push(out.length - 1);
  }
  return out;
}

/** Find a node by the `file:line:col` tag the instrumenter wrote (`userData.prism`). */
export function findNodeByTag(scene: Scene, tag: string): SceneNode | undefined {
  const m = /:(\d+):(\d+)$/.exec(tag);
  if (!m) return undefined;
  const line = Number(m[1]);
  const col = Number(m[2]);
  return scene.nodes.find((n) => n.line === line && n.col === col);
}
