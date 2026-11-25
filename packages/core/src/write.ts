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

export interface WriteResult {
  source: string;
  /** False when the file already held the requested value; `source` is then the input, untouched. */
  changed: boolean;
  edit: Edit | null;
  /** The full source lines around the edit, before and after, for a diff strip. */
  hunk: { line: number; before: string; after: string } | null;
  nodeId: string;
  prop: string;
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

function finish(source: string, plan: Planned | null, nodeId: string, prop: string, verify: (out: string) => void): WriteResult {
  if (!plan) return { source, changed: false, edit: null, hunk: null, nodeId, prop };
  const { out, edit } = commit(source, plan);
  assertSingleSpan(source, out, edit);
  verify(out);
  return { source: out, changed: true, edit, hunk: hunkFor(source, out, edit), nodeId, prop };
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

function verifyProp(out: string, pathId: string, prop: string, want: PropValue): void {
  let after: Analysis;
  try {
    after = analyze(out);
  } catch {
    throw new PrismError('WRITE_VERIFICATION_FAILED', 'The edited file no longer parses; nothing was written.');
  }
  const entry = after.entries.find((e) => e.node.pathId === pathId);
  const info = entry?.attrs.get(prop)?.info;
  if (!entry || !info || (info.kind !== 'literal' && info.kind !== 'resolved')) {
    throw new PrismError('WRITE_VERIFICATION_FAILED', `After the edit "${prop}" is no longer a literal on the node; nothing was written.`);
  }
  if (info.value !== undefined && !valuesEqual(info.value, want)) {
    throw new PrismError('WRITE_VERIFICATION_FAILED', `After the edit "${prop}" does not hold the requested value; nothing was written.`);
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
    return finish(source, { start: ins.pos, end: ins.pos, text: ins.text }, nodeId, op.prop, (out) => verifyProp(out, entry.node.pathId, op.prop, op.value));
  }

  const { info, binding } = existing;
  if (info.kind === 'expression') {
    throw new PrismError('OUT_OF_SUBSET', `"${op.prop}" on <${entry.node.tag}> at ${entry.node.line}:${entry.node.col} is an expression (${info.category}), not a literal, so it is read-only.`);
  }
  if (info.kind === 'meta' || info.kind === 'spread') throw new PrismError('READ_ONLY_PROP', `"${op.prop}" is never written by Prismbox.`);
  if (binding && GLSL_PROPS.has(op.prop)) throw new PrismError('READ_ONLY_PROP', `"${op.prop}" is GLSL source; Prismbox edits uniforms, not shader code.`);

  const cur = currentValue(info);
  if (op.expected !== undefined && (cur === undefined || !valuesEqual(cur, op.expected))) {
    throw new PrismError('CONFLICT', `"${op.prop}" is ${cur === undefined ? 'not comparable' : JSON.stringify(cur)} in the file, not ${JSON.stringify(op.expected)}.`);
  }
  if (cur !== undefined && valuesEqual(cur, op.value)) return finish(source, null, nodeId, op.prop, () => undefined);

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
  return finish(source, plan, nodeId, op.prop, (out) => verifyProp(out, entry.node.pathId, op.prop, op.value));
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
  if (cur !== undefined && valuesEqual(cur, op.value)) return finish(source, null, entry.node.id, op.uniform, () => undefined);

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

  return finish(source, { start: vNode.start, end: vNode.end, text }, entry.node.id, op.uniform, (out) => {
    let after: Analysis;
    try {
      after = analyze(out);
    } catch {
      throw new PrismError('WRITE_VERIFICATION_FAILED', 'The edited file no longer parses; nothing was written.');
    }
    const e2 = after.entries.find((e) => e.node.pathId === entry.node.pathId);
    const u = e2?.attrs.get('uniforms')?.info;
    const key = u?.keys?.find((k) => k.name === op.uniform);
    if (!e2 || !u || !key || key.kind !== 'literal') {
      throw new PrismError('WRITE_VERIFICATION_FAILED', `After the edit uniform "${op.uniform}" is no longer a literal; nothing was written.`);
    }
    if (key.value !== undefined && !valuesEqual(key.value, op.value)) {
      throw new PrismError('WRITE_VERIFICATION_FAILED', `After the edit uniform "${op.uniform}" does not hold the requested value; nothing was written.`);
    }
  });
}

// ---------- batches ----------

/**
 * Apply ops in order, each against the result of the previous one. All-or-nothing: if any op
 * throws, the caller keeps the original source (nothing here touches disk).
 */
export function applyOps(source: string, ops: readonly Op[]): { source: string; results: WriteResult[] } {
  let cur = source;
  const results: WriteResult[] = [];
  for (const raw of ops) {
    const op = OpSchema.parse(raw);
    const r = op.op === 'setProp' ? setProp(cur, op) : setUniform(cur, op);
    results.push(r);
    cur = r.source;
  }
  return { source: cur, results };
}
