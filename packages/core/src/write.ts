import MagicString from 'magic-string';
import { z } from 'zod';
import type { N } from './ast';
import { PrismError } from './errors';
import { isLiteral, round3, uniformValueOf, valuesEqual } from './literal';
import type { PropValue } from './literal';
import { analyze } from './read';
import type { Analysis, PropInfo, SceneNode } from './read';
import { GLSL_PROPS } from './subset';

// ---------- op schema ----------

export const PropValueSchema: z.ZodType<PropValue> = z.lazy(() =>
  z.union([z.number(), z.string(), z.boolean(), z.null(), z.array(PropValueSchema), z.record(z.string(), PropValueSchema)]),
);

const PROP_NAME = /^[A-Za-z_$][\w$-]*$/;

export const SetPropOpSchema = z.object({
  op: z.literal('setProp'),
  /** A `name` prop value or a path id from the scene. */
  node: z.string().min(1),
  prop: z.string().regex(PROP_NAME),
  value: PropValueSchema,
  /** The value the caller last saw. A mismatch with the file returns CONFLICT. */
  expected: PropValueSchema.optional(),
});

export const SetUniformOpSchema = z.object({
  op: z.literal('setUniform'),
  node: z.string().min(1),
  uniform: z.string().regex(/^[A-Za-z_]\w*$/),
  value: PropValueSchema,
  expected: PropValueSchema.optional(),
});

export const OpSchema = z.discriminatedUnion('op', [SetPropOpSchema, SetUniformOpSchema]);

export type SetPropOp = z.infer<typeof SetPropOpSchema>;
export type SetUniformOp = z.infer<typeof SetUniformOpSchema>;
export type Op = SetPropOp | SetUniformOp;

export interface Edit {
  /** Offsets in the ORIGINAL source. `start === end` for a pure insertion. */
  start: number;
  end: number;
  removed: string;
  inserted: string;
}

/** One node/property occurrence reached by an edit — the addressed op plus every shared reader. */
export interface AffectedTarget {
  /** `SceneNode.id` of the affected node (unique name when available, otherwise the path id). */
  nodeId: string;
  pathId: string;
  /** JSX attribute through which the value is read, e.g. `uniforms`. */
  attr: string;
  /** Uniform key inside `attr` for a `setUniform` op; omitted for whole-prop writes. */
  uniform?: string;
}

/**
 * Who reads one resolved same-file binding. Two props with the same `declStart` share one
 * declaration, so a single edit to the binding changes every one of these nodes.
 */
export interface SharedBindingInfo {
  /** Start offset of the shared `VariableDeclarator` (the grouping key). */
  declStart: number;
  via: 'const' | 'useMemo';
  name: string;
  /** Every JSX prop occurrence reading the binding, in source order. */
  targets: AffectedTarget[];
  /** Unique ids of the affected nodes, in source order. */
  nodeIds: string[];
  /** Alias of `nodeIds`: the node ids changed by editing this binding. */
  affectedNodes: string[];
  /** Alias of `nodeIds`. */
  nodes: string[];
  /** Distinct JSX attribute names read through this binding (e.g. `['uniforms']`). */
  props: string[];
  /** Number of JSX prop occurrences sharing the declaration (matches `resolved.sharedBy`). */
  count: number;
  /** True only when more than one prop occurrence reads the declaration. */
  shared: boolean;
}

export interface WriteResult {
  source: string;
  /** False when the file already held the requested value; `source` is then the input, untouched. */
  changed: boolean;
  edit: Edit | null;
  /** The full source lines around the edit, before and after, for a diff strip. */
  hunk: { line: number; before: string; after: string } | null;
  nodeId: string;
  prop: string;
  /**
   * Every node id whose rendered value changes because of this write. Always contains `nodeId`;
   * for an edit to a same-file const/useMemo binding it also contains every node sharing it.
   */
  affectedNodes: string[];
  /** Alias of `affectedNodes`. */
  affectedNodeIds: string[];
  /** Alias of `affectedNodes`. */
  impactedNodes: string[];
  /** Alias of `affectedNodes`. */
  impactedNodeIds: string[];
  /** Ids sharing the edited declaration (same as `affectedNodes` for a binding, `[nodeId]` otherwise). */
  sharedNodeIds: string[];
  /** Alias of `sharedNodeIds`. */
  sharedNodes: string[];
  /** Other node ids sharing the edited binding, excluding `nodeId`. Empty when nothing is shared. */
  sharedWith: string[];
  /** True when the write lands on a binding read by more than one prop occurrence. */
  isShared: boolean;
  /** Number of prop occurrences on the shared declaration; 1 for an inline/non-binding target. */
  sharedBy: number;
  /** Sharing details for a resolved same-file binding; null for inline literals/insertions. */
  shared: SharedBindingInfo | null;
  /** Alias of `shared`. */
  sharedBinding: SharedBindingInfo | null;
  /** Alias of `shared`. */
  sharedInfo: SharedBindingInfo | null;
  /** The addressed target plus every shared reader. */
  affectedTargets: AffectedTarget[];
}

/** One shared binding touched by an `applyOps` batch, with the ops that hit its `declStart`. */
export interface BatchSharedBinding extends SharedBindingInfo {
  /** Indices (0-based, in apply order) of the batch ops that wrote to this binding. */
  opIndexes: number[];
  /** Alias spelling of `opIndexes`. */
  opIndices: number[];
}

export interface ApplyOpsResult {
  source: string;
  results: WriteResult[];
  /** Truly shared declarations (`shared === true`) touched by the batch, first-touch order. */
  shared: BatchSharedBinding[];
  /** Alias of `shared`. */
  sharedBindings: BatchSharedBinding[];
  /** Every distinct declaration written through a binding, including single-reader ones. */
  bindingGroups: BatchSharedBinding[];
  /** Binding groups hit by two or more ops in this same batch. */
  repeatedBindings: BatchSharedBinding[];
  /** Union of every result's `affectedNodes`, de-duplicated in first-seen order. */
  affectedNodes: string[];
  /** Alias of `affectedNodes`. */
  affectedNodeIds: string[];
}

// ---------- validation ----------

const NUMBER_PROPS = new Set([
  'roughness', 'metalness', 'transmission', 'thickness', 'ior', 'iridescence', 'emissiveIntensity', 'opacity',
  'intensity', 'distance', 'angle', 'penumbra', 'decay', 'fov', 'near', 'far', 'zoom', 'size',
]);
const BOOLEAN_PROPS = new Set(['visible', 'castShadow', 'receiveShadow', 'wireframe', 'transparent']);
const COLOR_PROPS = new Set(['color', 'emissive']);
const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function isNumberTuple3(v: PropValue): boolean {
  return Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number');
}

function validateProp(prop: string, value: PropValue): void {
  const bad = (why: string): never => {
    throw new PrismError('INVALID_VALUE', `Invalid value for "${prop}": ${why}.`);
  };
  if (prop === 'ref' || prop === 'key' || /^on[A-Z]/.test(prop) || prop === 'children') {
    throw new PrismError('READ_ONLY_PROP', `"${prop}" is never written by Prismbox.`);
  }
  if (prop === 'position' || prop === 'rotation') {
    if (!isNumberTuple3(value)) bad('expected [x, y, z] numbers');
  } else if (prop === 'scale') {
    if (typeof value !== 'number' && !isNumberTuple3(value)) bad('expected a number or [x, y, z] numbers');
  } else if (prop === 'args') {
    if (!Array.isArray(value) || !value.every((x) => typeof x === 'number' || typeof x === 'boolean')) bad('expected an array of numbers');
  } else if (prop === 'name') {
    if (typeof value !== 'string' || value.length === 0) bad('expected a non-empty string');
  } else if (NUMBER_PROPS.has(prop)) {
    if (typeof value !== 'number') bad('expected a number');
  } else if (BOOLEAN_PROPS.has(prop)) {
    if (typeof value !== 'boolean') bad('expected a boolean');
  } else if (COLOR_PROPS.has(prop)) {
    if (typeof value !== 'string' || !HEX.test(value)) bad('expected a "#hex" color string');
  }
  assertFinite(value, prop);
}

function assertFinite(v: PropValue, prop: string): void {
  if (typeof v === 'number' && !Number.isFinite(v)) throw new PrismError('INVALID_VALUE', `Invalid value for "${prop}": numbers must be finite.`);
  if (Array.isArray(v)) v.forEach((x) => assertFinite(x, prop));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => assertFinite(x, prop));
}

// ---------- text generation ----------

const IDENT_KEY = /^[A-Za-z_$][\w$]*$/;

function quoteJs(s: string, q: string): string {
  return /^[^"'\\\r\n]*$/.test(s) ? `${q}${s}${q}` : JSON.stringify(s);
}

function exprText(v: PropValue, q: string): string {
  if (typeof v === 'number') return String(round3(v));
  if (typeof v === 'boolean' || v === null) return String(v);
  if (typeof v === 'string') return quoteJs(v, q);
  if (Array.isArray(v)) return `[${v.map((x) => exprText(x, q)).join(', ')}]`;
  const parts = Object.entries(v).map(([k, x]) => `${IDENT_KEY.test(k) ? k : quoteJs(k, q)}: ${exprText(x, q)}`);
  return parts.length ? `{ ${parts.join(', ')} }` : '{}';
}

/** The text of a whole attribute value: a plain quoted string when that is safe, otherwise `{expr}`. */
function attrValueText(v: PropValue, q: string): string {
  if (typeof v === 'string' && /^[^"'\\&<>{}\r\n]*$/.test(v)) return `${q}${v}${q}`;
  return `{${exprText(v, q)}}`;
}

/** The file's own quote style for JSX string attributes (majority wins, double by default). */
function detectQuote(source: string, a: Analysis): string {
  let single = 0;
  let double = 0;
  for (const { attrs } of a.entries) {
    for (const { info } of attrs.values()) {
      const ch = info.valueStart >= 0 && info.kind === 'literal' && info.text.length > 1 ? source[info.valueStart] : '';
      if (ch === "'" && info.text.endsWith("'")) single++;
      else if (ch === '"' && info.text.endsWith('"')) double++;
    }
  }
  return single > double ? "'" : '"';
}

const unwrapTs = (e: N): N => {
  let cur = e;
  while (cur && (cur.type === 'TSAsExpression' || cur.type === 'TSSatisfiesExpression' || cur.type === 'TSNonNullExpression')) cur = cur.expression;
  return cur;
};

function plainNumber(e: N): number | null {
  if (e.type === 'NumericLiteral') return e.value as number;
  if (e.type === 'UnaryExpression' && e.argument.type === 'NumericLiteral' && (e.operator === '-' || e.operator === '+')) {
    return e.operator === '-' ? -e.argument.value : e.argument.value;
  }
  return null;
}

/**
 * New text for a literal expression. When the old and new values are number arrays of the same
 * length and every old element is a plain number, the old separators and untouched elements are
 * kept, so `[0,1,0]` stays tight and `1.0` stays `1.0` if it did not change.
 */
function replacementText(source: string, oldExpr: N, value: PropValue, q: string): string {
  if (typeof value === 'number') {
    const old = plainNumber(oldExpr);
    if (old !== null && round3(old) === round3(value)) return source.slice(oldExpr.start, oldExpr.end);
  }
  if (Array.isArray(value) && oldExpr.type === 'ArrayExpression' && oldExpr.elements.length === value.length) {
    const elems: N[] = oldExpr.elements;
    const olds = elems.map((e) => (e ? plainNumber(e) : null));
    if (olds.every((o) => o !== null) && value.every((x) => typeof x === 'number')) {
      let text = source.slice(oldExpr.start, oldExpr.end);
      for (let i = elems.length - 1; i >= 0; i--) {
        const el = elems[i] as N;
        const next = value[i] as number;
        if (round3(olds[i] as number) === round3(next)) continue;
        text = text.slice(0, el.start - oldExpr.start) + String(round3(next)) + text.slice(el.end - oldExpr.start);
      }
      return text;
    }
  }
  return exprText(value, q);
}

// ---------- node lookup ----------

function findEntry(a: Analysis, query: string): Analysis['entries'][number] {
  const hits = a.entries.filter((e) => e.node.id === query || e.node.pathId === query || e.node.name === query);
  const unique = [...new Set(hits)];
  if (unique.length === 0) throw new PrismError('NODE_NOT_FOUND', `No node with id "${query}". Read the scene for valid ids.`);
  if (unique.length > 1) {
    throw new PrismError('AMBIGUOUS_NODE', `"${query}" matches ${unique.length} nodes (${unique.map((e) => `${e.node.tag} at ${e.node.line}:${e.node.col}`).join(', ')}). Give each node a unique \`name\`.`);
  }
  const entry = unique[0] as Analysis['entries'][number];
  if (entry.node.ambiguous) {
    throw new PrismError('AMBIGUOUS_NODE', `<${entry.node.tag}> at ${entry.node.line}:${entry.node.col} cannot be addressed uniquely. Give it a unique \`name\`.`);
  }
  return entry;
}

function assertWritable(node: SceneNode): void {
  if (node.locked) {
    const why = { opaque: 'an opaque element', map: 'generated by .map()', conditional: 'inside a conditional', spread: 'using a spread prop' }[node.locked];
    throw new PrismError('READ_ONLY_NODE', `<${node.tag}> at ${node.line}:${node.col} is ${why}, so it is read-only.`);
  }
}

// ---------- applying an edit ----------

interface Planned {
  /** Overwrite [start, end) with text, or insert at start when start === end. */
  start: number;
  end: number;
  text: string;
}

/** The sharing projection attached to every WriteResult. */
interface Impact {
  affectedNodes: string[];
  sharedWith: string[];
  isShared: boolean;
  sharedBy: number;
  shared: SharedBindingInfo | null;
  affectedTargets: AffectedTarget[];
}

/** Node/prop occurrences in `a` that read the declarator at `declStart`. */
function bindingTargets(a: Analysis, declStart: number): AffectedTarget[] {
  const out: AffectedTarget[] = [];
  for (const e of a.entries) {
    for (const [attr, x] of e.attrs) {
      if (x.binding && x.binding.declStart === declStart) {
        out.push({ nodeId: e.node.id, pathId: e.node.pathId, attr });
      }
    }
  }
  return out;
}

const uniq = (xs: string[]): string[] => [...new Set(xs)];

/**
 * Build the sharing info for an edit landing on `binding`. `writtenUniform` marks the exact
 * uniform key addressed by a `setUniform` op on the caller's node; every other target reads the
 * same declaration and is affected through its whole attribute.
 */
function sharedImpact(
  a: Analysis,
  binding: { declStart: number; via: 'const' | 'useMemo'; name: string },
  written: { nodeId: string; attr: string; uniform?: string },
): Impact {
  const targets = bindingTargets(a, binding.declStart).map((t) =>
    t.nodeId === written.nodeId && t.attr === written.attr && written.uniform !== undefined ? { ...t, uniform: written.uniform } : t,
  );
  const nodeIds = uniq(targets.map((t) => t.nodeId));
  const info: SharedBindingInfo = {
    declStart: binding.declStart,
    via: binding.via,
    name: binding.name,
    targets,
    nodeIds,
    affectedNodes: nodeIds,
    nodes: nodeIds,
    props: uniq(targets.map((t) => t.attr)),
    count: targets.length,
    shared: targets.length > 1,
  };
  return {
    affectedNodes: nodeIds,
    sharedWith: nodeIds.filter((id) => id !== written.nodeId),
    isShared: info.shared,
    sharedBy: targets.length,
    shared: info,
    affectedTargets: targets,
  };
}

/** Impact for an edit that does not go through a shared binding: exactly the addressed node. */
function standaloneImpact(nodeId: string, pathId: string, attr: string, uniform?: string): Impact {
  const target: AffectedTarget = uniform === undefined ? { nodeId, pathId, attr } : { nodeId, pathId, attr, uniform };
  return {
    affectedNodes: [nodeId],
    sharedWith: [],
    isShared: false,
    sharedBy: 1,
    shared: null,
    affectedTargets: [target],
  };
}

function commit(source: string, plan: Planned): { out: string; edit: Edit } {
  const s = new MagicString(source);
  if (plan.start === plan.end) s.appendLeft(plan.start, plan.text);
  else s.overwrite(plan.start, plan.end, plan.text);
  return { out: s.toString(), edit: { start: plan.start, end: plan.end, removed: source.slice(plan.start, plan.end), inserted: plan.text } };
}

function hunkFor(source: string, out: string, edit: Edit): WriteResult['hunk'] {
  const lineStart = source.lastIndexOf('\n', edit.start - 1) + 1;
  const endIdx = source.indexOf('\n', edit.end);
  const lineEnd = endIdx === -1 ? source.length : endIdx;
  const newEnd = lineEnd + (out.length - source.length);
  const line = source.slice(0, lineStart).split('\n').length;
  return { line, before: source.slice(lineStart, lineEnd).replace(/\r$/, ''), after: out.slice(lineStart, newEnd).replace(/\r$/, '') };
}

/**
 * The post-write invariant: the output is the input with exactly one contiguous span replaced.
 * (A trimmed-prefix/suffix diff cannot express this for insertions, where the inserted text may
 * share characters with its neighbours, so check the splice directly.)
 */
function assertSingleSpan(source: string, out: string, edit: Edit): void {
  if (out !== source.slice(0, edit.start) + edit.inserted + source.slice(edit.end)) {
    throw new PrismError('WRITE_VERIFICATION_FAILED', 'The edit changed bytes outside its target span; nothing was written.');
  }
}

function finish(source: string, plan: Planned | null, nodeId: string, prop: string, impact: Impact, verify: (out: string) => void): WriteResult {
  const aliases = {
    affectedNodeIds: impact.affectedNodes,
    impactedNodes: impact.affectedNodes,
    impactedNodeIds: impact.affectedNodes,
    sharedNodeIds: impact.affectedNodes,
    sharedNodes: impact.affectedNodes,
    sharedBinding: impact.shared,
    sharedInfo: impact.shared,
  };
  if (!plan) {
    return {
      source, changed: false, edit: null, hunk: null, nodeId, prop,
      ...impact, ...aliases,
    };
  }
  const { out, edit } = commit(source, plan);
  assertSingleSpan(source, out, edit);
  verify(out);
  return {
    source: out, changed: true, edit, hunk: hunkFor(source, out, edit), nodeId, prop,
    ...impact, ...aliases,
  };
}

function insertionFor(source: string, el: N, text: string): { pos: number; text: string } {
  const open = el.openingElement;
  const attrs: N[] = open.attributes;
  if (attrs.length === 0) return { pos: open.name.end, text: ` ${text}` };
  const last = attrs[attrs.length - 1] as N;
  const prevEnd = attrs.length > 1 ? (attrs[attrs.length - 2] as N).end : open.name.end;
  const gap = source.slice(prevEnd, last.start);
  const nl = gap.lastIndexOf('\n');
  if (nl !== -1) {
    const indent = /^[ \t]*/.exec(gap.slice(nl + 1))?.[0] ?? '';
    const eol = gap.includes('\r\n') ? '\r\n' : '\n';
    return { pos: last.end, text: `${eol}${indent}${text}` };
  }
  return { pos: last.end, text: ` ${text}` };
}

function currentValue(info: PropInfo): PropValue | undefined {
  return info.kind === 'literal' || info.kind === 'resolved' ? info.value : undefined;
}

function reparseForVerification(out: string): Analysis {
  try {
    return analyze(out);
  } catch {
    throw new PrismError('WRITE_VERIFICATION_FAILED', 'The edited file no longer parses; nothing was written.');
  }
}

function assertPropValue(after: Analysis, pathId: string, prop: string, want: PropValue): void {
  const entry = after.entries.find((e) => e.node.pathId === pathId);
  const info = entry?.attrs.get(prop)?.info;
  if (!entry || !info || (info.kind !== 'literal' && info.kind !== 'resolved')) {
    throw new PrismError('WRITE_VERIFICATION_FAILED', `After the edit "${prop}" is no longer a literal on the node; nothing was written.`);
  }
  if (info.value !== undefined && !valuesEqual(info.value, want)) {
    throw new PrismError('WRITE_VERIFICATION_FAILED', `After the edit "${prop}" does not hold the requested value; nothing was written.`);
  }
}

function verifyProp(out: string, pathId: string, prop: string, want: PropValue): void {
  assertPropValue(reparseForVerification(out), pathId, prop, want);
}

function assertUniformValue(after: Analysis, pathId: string, uniform: string, want: PropValue): void {
  const e2 = after.entries.find((e) => e.node.pathId === pathId);
  const u = e2?.attrs.get('uniforms')?.info;
  const key = u?.keys?.find((k) => k.name === uniform);
  if (!e2 || !u || !key || key.kind !== 'literal') {
    throw new PrismError('WRITE_VERIFICATION_FAILED', `After the edit uniform "${uniform}" is no longer a literal; nothing was written.`);
  }
  if (key.value !== undefined && !valuesEqual(key.value, want)) {
    throw new PrismError('WRITE_VERIFICATION_FAILED', `After the edit uniform "${uniform}" does not hold the requested value; nothing was written.`);
  }
}

// ---------- setProp ----------

/**
 * Set one prop on one node as a single minimal text edit.
 *
 * - An existing literal is overwritten in place.
 * - An absent prop is appended after the last attribute, in the file's own line and quote style.
 * - A prop that resolves to a same-file `const` / `useMemo` literal is edited at the binding.
 * - Expressions, locked nodes and GLSL source are refused; the file is never partially written.
 */
export function setProp(source: string, input: SetPropOp): WriteResult {
  const parsed = SetPropOpSchema.safeParse(input);
  if (!parsed.success) throw new PrismError('INVALID_VALUE', `Invalid setProp op: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  const op = parsed.data;
  validateProp(op.prop, op.value);

  const a = analyze(source);
  const entry = findEntry(a, op.node);
  assertWritable(entry.node);
  const q = detectQuote(source, a);
  const existing = entry.attrs.get(op.prop);
  const nodeId = entry.node.id;

  if (!existing) {
    if (op.expected !== undefined) throw new PrismError('CONFLICT', `"${op.prop}" is not set on <${entry.node.tag}>, but the caller expected a value.`);
    const ins = insertionFor(source, entry.el, `${op.prop}=${attrValueText(op.value, q)}`);
    const impact = standaloneImpact(nodeId, entry.node.pathId, op.prop);
    return finish(source, { start: ins.pos, end: ins.pos, text: ins.text }, nodeId, op.prop, impact, (out) => verifyProp(out, entry.node.pathId, op.prop, op.value));
  }

  const { info, binding } = existing;
  if (info.kind === 'expression') {
    throw new PrismError('OUT_OF_SUBSET', `"${op.prop}" on <${entry.node.tag}> at ${entry.node.line}:${entry.node.col} is an expression (${info.category}), not a literal, so it is read-only.`);
  }
  if (info.kind === 'meta' || info.kind === 'spread') throw new PrismError('READ_ONLY_PROP', `"${op.prop}" is never written by Prismbox.`);
  if (binding && GLSL_PROPS.has(op.prop)) throw new PrismError('READ_ONLY_PROP', `"${op.prop}" is GLSL source; Prismbox edits uniforms, not shader code.`);

  const impact: Impact = binding
    ? sharedImpact(a, binding, { nodeId, attr: op.prop })
    : standaloneImpact(nodeId, entry.node.pathId, op.prop);

  const cur = currentValue(info);
  if (op.expected !== undefined && (cur === undefined || !valuesEqual(cur, op.expected))) {
    throw new PrismError('CONFLICT', `"${op.prop}" is ${cur === undefined ? 'not comparable' : JSON.stringify(cur)} in the file, not ${JSON.stringify(op.expected)}.`);
  }
  if (cur !== undefined && valuesEqual(cur, op.value)) return finish(source, null, nodeId, op.prop, impact, () => undefined);

  let plan: Planned;
  if (binding) {
    const t = binding.target;
    plan = { start: t.start, end: t.end, text: replacementText(source, t, op.value, q) };
  } else if (info.valueStart === -1) {
    // bare boolean attribute (`<mesh visible />`): add the value after the name
    plan = { start: info.attrEnd, end: info.attrEnd, text: `=${attrValueText(op.value, q)}` };
  } else {
    const attr = existing.attr;
    const v = attr.value;
    const inner = v.type === 'JSXExpressionContainer' ? unwrapTs(v.expression) : null;
    if (inner && typeof op.value !== 'string' && !(typeof op.value === 'object' && op.value !== null && !Array.isArray(op.value))) {
      plan = { start: inner.start, end: inner.end, text: replacementText(source, inner, op.value, q) };
    } else {
      plan = { start: v.start, end: v.end, text: attrValueText(op.value, q) };
    }
  }
  return finish(source, plan, nodeId, op.prop, impact, (out) => {
    const after = reparseForVerification(out);
    assertPropValue(after, entry.node.pathId, op.prop, op.value);
    // A shared declaration backs every reader: re-resolve each one and confirm it is still a
    // literal holding the requested value, otherwise the whole write is rejected.
    if (impact.shared) {
      for (const t of impact.shared.targets) {
        if (t.pathId === entry.node.pathId || t.attr !== op.prop) continue;
        assertPropValue(after, t.pathId, t.attr, op.value);
      }
    }
  });
}

// ---------- setUniform ----------

function objectProp(obj: N, key: string): N | null {
  if (obj?.type !== 'ObjectExpression') return null;
  for (const p of obj.properties as N[]) {
    if (p.type !== 'ObjectProperty' || p.computed) continue;
    const k = p.key.type === 'Identifier' ? p.key.name : p.key.value;
    if (k === key) return p;
  }
  return null;
}

/**
 * Set `uniforms.<uniform>.value` on a `shaderMaterial`, whether `uniforms` is an inline object or
 * resolves to a same-file `const` / `useMemo` literal. One minimal edit to the value expression.
 * `new THREE.Color("#hex")` and `new THREE.VectorN(...)` values keep their constructor.
 */
export function setUniform(source: string, input: SetUniformOp): WriteResult {
  const parsed = SetUniformOpSchema.safeParse(input);
  if (!parsed.success) throw new PrismError('INVALID_VALUE', `Invalid setUniform op: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  const op = parsed.data;
  assertFinite(op.value, op.uniform);

  const a = analyze(source);
  const entry = findEntry(a, op.node);
  assertWritable(entry.node);
  const uniforms = entry.attrs.get('uniforms');
  if (!uniforms) throw new PrismError('UNIFORM_NOT_FOUND', `<${entry.node.tag}> has no \`uniforms\` prop.`);
  if (uniforms.info.kind === 'expression' && !uniforms.info.keys) {
    throw new PrismError('OUT_OF_SUBSET', `\`uniforms\` on <${entry.node.tag}> is an expression (${uniforms.info.category}), not an object literal or a same-file const, so it is read-only.`);
  }
  const objExpr = uniforms.binding ? uniforms.binding.target : unwrapTs(uniforms.attr.value.expression);
  const entryProp = objectProp(objExpr, op.uniform);
  if (!entryProp) throw new PrismError('UNIFORM_NOT_FOUND', `No literal uniform "${op.uniform}" on <${entry.node.tag}>. Known: ${(uniforms.info.keys ?? []).map((k) => k.name).join(', ') || 'none'}.`);
  const valueProp = objectProp(unwrapTs(entryProp.value), 'value');
  if (!valueProp) throw new PrismError('UNIFORM_NOT_FOUND', `Uniform "${op.uniform}" has no literal \`value\`.`);
  const vNode = unwrapTs(valueProp.value);
  if (!isLiteral(vNode, 'value')) throw new PrismError('OUT_OF_SUBSET', `Uniform "${op.uniform}" has a non-literal value, so it is read-only (other literal uniforms on this material stay editable).`);

  const cur = uniformValueOf(vNode);
  if (op.expected !== undefined && (cur === undefined || !valuesEqual(cur, op.expected))) {
    throw new PrismError('CONFLICT', `Uniform "${op.uniform}" is ${cur === undefined ? 'not comparable' : JSON.stringify(cur)} in the file, not ${JSON.stringify(op.expected)}.`);
  }
  const impact: Impact = uniforms.binding
    ? sharedImpact(a, uniforms.binding, { nodeId: entry.node.id, attr: 'uniforms', uniform: op.uniform })
    : standaloneImpact(entry.node.id, entry.node.pathId, 'uniforms', op.uniform);
  if (cur !== undefined && valuesEqual(cur, op.value)) return finish(source, null, entry.node.id, op.uniform, impact, () => undefined);

  const q = detectQuote(source, a);
  let text: string;
  if (vNode.type === 'NewExpression') {
    const callee = source.slice(vNode.callee.start, vNode.callee.end);
    const ctor = vNode.callee.type === 'Identifier' ? vNode.callee.name : vNode.callee.property?.name;
    if (ctor === 'Color') {
      if (typeof op.value !== 'string' || !HEX.test(op.value)) throw new PrismError('INVALID_VALUE', `Uniform "${op.uniform}" is a Color; expected a "#hex" string.`);
      text = `new ${callee}(${quoteJs(op.value, q)})`;
    } else {
      if (!Array.isArray(op.value) || !op.value.every((x) => typeof x === 'number')) throw new PrismError('INVALID_VALUE', `Uniform "${op.uniform}" is a ${String(ctor)}; expected an array of numbers.`);
      text = `new ${callee}(${op.value.map((x) => String(round3(x as number))).join(', ')})`;
    }
  } else {
    if (typeof op.value === 'object' && op.value !== null && !Array.isArray(op.value)) throw new PrismError('INVALID_VALUE', 'A uniform value cannot be an object.');
    text = replacementText(source, vNode, op.value, q);
  }

  return finish(source, { start: vNode.start, end: vNode.end, text }, entry.node.id, op.uniform, impact, (out) => {
    const after = reparseForVerification(out);
    assertUniformValue(after, entry.node.pathId, op.uniform, op.value);
    // The uniforms object is shared by every target on the same declStart: re-parse and confirm
    // the edited uniform is still a literal with the requested value on each sharing material.
    if (impact.shared) {
      for (const t of impact.shared.targets) {
        if (t.pathId === entry.node.pathId || t.attr !== 'uniforms') continue;
        assertUniformValue(after, t.pathId, op.uniform, op.value);
      }
    }
  });
}

// ---------- batches ----------

/**
 * Group successful per-op results by the binding they wrote through. Two results belong to the
 * same declaration when they report the same `declStart` (and name, as a guard against offsets
 * shifted by unrelated earlier edits).
 */
function summarizeBatch(results: readonly WriteResult[]): Omit<ApplyOpsResult, 'source' | 'results'> {
  const groups = new Map<string, BatchSharedBinding>();
  results.forEach((r, i) => {
    const info = r.shared;
    if (!info) return;
    const key = `${info.declStart}:${info.name}`;
    let g = groups.get(key);
    if (!g) {
      g = { ...info, opIndexes: [], opIndices: [] };
      groups.set(key, g);
    }
    g.opIndexes.push(i);
    g.opIndices.push(i);
  });
  const bindingGroups = [...groups.values()];
  const shared = bindingGroups.filter((g) => g.shared);
  const affectedNodes = uniq(results.flatMap((r) => r.affectedNodes));
  return {
    shared,
    sharedBindings: shared,
    bindingGroups,
    repeatedBindings: bindingGroups.filter((g) => g.opIndexes.length > 1),
    affectedNodes,
    affectedNodeIds: affectedNodes,
  };
}

/**
 * Apply ops in order, each against the result of the previous one.
 *
 * Failure / rollback semantics: this is all-or-nothing and pure. `source` is never mutated and
 * nothing is written to disk; if any op throws, the exception (always a {@link PrismError} with a
 * stable `code`) propagates and NO batch result is returned — the per-op results computed earlier
 * stay local and cannot be mistaken for a committed state. The caller's own `source` string is
 * untouched. On success the return additionally groups ops that hit the same shared binding
 * (`shared` / `repeatedBindings`) so callers do not have to infer collateral effects.
 */
export function applyOps(source: string, ops: readonly Op[]): ApplyOpsResult {
  let cur = source;
  const results: WriteResult[] = [];
  ops.forEach((raw, i) => {
    const parsed = OpSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PrismError('INVALID_VALUE', `Invalid op at index ${i}: ${parsed.error.issues.map((x) => x.message).join('; ')}`);
    }
    let r: WriteResult;
    try {
      r = parsed.data.op === 'setProp' ? setProp(cur, parsed.data) : setUniform(cur, parsed.data);
    } catch (err) {
      // Rollback boundary: discard `cur`/`results` by not returning them. Preserve stable codes
      // for the known refusal paths; normalize anything else into a coded PrismError.
      if (err instanceof PrismError) throw err;
      throw new PrismError('INVALID_VALUE', `Op at index ${i} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    results.push(r);
    cur = r.source;
  });
  return { source: cur, results, ...summarizeBatch(results) };
}
