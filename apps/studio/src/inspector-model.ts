import type { PropInfo, PropValue, SceneNode } from '@prismbox/core';

export type Target = { kind: 'prop'; prop: string } | { kind: 'uniform'; uniform: string };
export type FieldState = 'set' | 'absent' | 'locked';

interface Base {
  id: string;
  label: string;
  state: FieldState;
  /** Why a field is locked. */
  reason?: string;
  /** Source text of the value, for locked fields. */
  text?: string;
}

export type Field =
  | (Base & { type: 'vec3'; prop: 'position' | 'rotation' | 'scale'; value: number[]; unit: 'm' | 'deg'; step: number })
  | (Base & { type: 'number'; target: Target; value: number; min: number; max: number; step: number; slider: boolean })
  | (Base & { type: 'bool'; target: Target; value: boolean })
  | (Base & { type: 'color'; target: Target; value: string })
  | (Base & { type: 'vec'; target: Target; value: number[]; step: number })
  | (Base & { type: 'text'; target: Target; value: string });

export interface Section {
  title: string;
  fields: Field[];
}

const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const UNIT_RANGE = new Set(['roughness', 'metalness', 'opacity', 'transmission', 'iridescence', 'clearcoat', 'clearcoatRoughness', 'reflectivity', 'sheen', 'transparency']);
const SKIP = new Set(['name', 'position', 'rotation', 'scale', 'args', 'attach', 'key', 'ref', 'userData', 'userData-prism', 'vertexShader', 'fragmentShader', 'uniforms', 'camera', 'dpr', 'style', 'shadows', 'gl', 'children']);

const isObject3D = (tag: string): boolean => !/(Geometry|Material)$/.test(tag);

function nice(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** A sensible slider range and step for a number, from its name and current value. */
export function rangeFor(name: string, value: number, hint?: { min?: number; max?: number }): { min: number; max: number; step: number } {
  if (hint?.min !== undefined && hint.max !== undefined) return { min: hint.min, max: hint.max, step: nice((hint.max - hint.min) / 200) || 0.01 };
  if (UNIT_RANGE.has(name)) return { min: 0, max: 1, step: 0.01 };
  if (name === 'ior') return { min: 1, max: 2.333, step: 0.01 };
  if (name === 'thickness') return { min: 0, max: 5, step: 0.01 };
  if (/intensity$/i.test(name)) return { min: 0, max: Math.max(10, Math.ceil(value * 2)), step: 0.05 };
  if (name === 'fov') return { min: 10, max: 120, step: 1 };
  const span = Math.max(1, Math.abs(value) * 2);
  const min = value < 0 ? -span : 0;
  const max = value < 0 ? span : span;
  return { min, max, step: nice(span / 200) || 0.01 };
}

function lockedText(p: PropInfo): string {
  let t = p.text.replace(/\s+/g, ' ').trim();
  if (t.startsWith('{') && t.endsWith('}')) t = t.slice(1, -1).trim(); // drop the JSX expression braces
  return t.length > 70 ? `${t.slice(0, 67)}...` : t;
}

function transformField(node: SceneNode, prop: 'position' | 'rotation' | 'scale'): Field | null {
  const info = node.props.find((p) => p.name === prop);
  const unit: 'm' | 'deg' = prop === 'rotation' ? 'deg' : 'm';
  const base = { id: `prop:${prop}`, label: prop, type: 'vec3' as const, prop, unit, step: prop === 'rotation' ? 1 : 0.05 };
  const dflt = prop === 'scale' ? [1, 1, 1] : [0, 0, 0];
  if (!info) return { ...base, state: 'absent', value: dflt };
  if (info.kind === 'expression') return { ...base, state: 'locked', value: dflt, reason: `${prop} is an expression (${info.category ?? 'non-literal'})`, text: lockedText(info) };
  const v = info.value;
  if (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number')) return { ...base, state: 'set', value: v as number[] };
  if (typeof v === 'number' && prop === 'scale') return { ...base, state: 'set', value: [v, v, v] };
  return { ...base, state: 'locked', value: dflt, reason: `${prop} has a value Prismbox cannot edit`, text: lockedText(info) };
}

function valueField(id: string, label: string, target: Target, value: PropValue | undefined, opts: { min?: number; max?: number; type?: string }, nameForRange: string): Field | null {
  if (typeof value === 'number') {
    const r = rangeFor(nameForRange, value, opts);
    return { id, label, target, type: 'number', state: 'set', value, ...r, slider: true };
  }
  if (typeof value === 'boolean') return { id, label, target, type: 'bool', state: 'set', value };
  if (typeof value === 'string' && (opts.type === 'color' || HEX.test(value))) return HEX.test(value) ? { id, label, target, type: 'color', state: 'set', value } : null;
  if (Array.isArray(value) && value.length >= 1 && value.length <= 4 && value.every((x) => typeof x === 'number')) return { id, label, target, type: 'vec', state: 'set', value: value as number[], step: 0.05 };
  if (typeof value === 'string') return { id, label, target, type: 'text', state: 'set', value };
  return null;
}

/** Everything the inspector shows for one scene node, as plain data (the UI only renders it). */
export function buildInspector(node: SceneNode): Section[] {
  const sections: Section[] = [];

  if (node.kind === 'host' && isObject3D(node.tag)) {
    const names: ('position' | 'rotation' | 'scale')[] = /Light$/.test(node.tag) ? ['position'] : ['position', 'rotation', 'scale'];
    const fields = names.map((n) => transformField(node, n)).filter((f): f is Field => f !== null);
    if (fields.length) sections.push({ title: 'Transform', fields });
  }

  const args = node.props.find((p) => p.name === 'args');
  if (args && node.kind === 'host') {
    const target: Target = { kind: 'prop', prop: 'args' };
    if (args.kind === 'literal' && Array.isArray(args.value) && args.value.every((x) => typeof x === 'number')) {
      sections.push({ title: 'Geometry', fields: [{ id: 'prop:args', label: 'args', target, type: 'vec', state: 'set', value: args.value as number[], step: 0.05 }] });
    } else {
      sections.push({ title: 'Geometry', fields: [{ id: 'prop:args', label: 'args', target, type: 'text', state: 'locked', value: '', reason: 'args is an expression, so it is read-only', text: lockedText(args) }] });
    }
  }

  const rest: Field[] = [];
  for (const p of node.props) {
    if (SKIP.has(p.name) || p.kind === 'meta' || p.kind === 'spread' || node.kind === 'canvas') continue;
    const target: Target = { kind: 'prop', prop: p.name };
    if (p.kind === 'expression') {
      rest.push({ id: `prop:${p.name}`, label: p.name, target, type: 'text', state: 'locked', value: '', reason: `${p.name} is an expression (${p.category ?? 'non-literal'}), so it is read-only`, text: lockedText(p) });
      continue;
    }
    const f = valueField(`prop:${p.name}`, p.name, target, p.value, {}, p.name);
    if (f) rest.push(f);
  }
  if (rest.length) sections.push({ title: node.tag.endsWith('Material') ? 'Material' : 'Properties', fields: rest });

  if (node.shader) {
    const fields: Field[] = [];
    for (const k of node.shader.keys) {
      const target: Target = { kind: 'uniform', uniform: k.name };
      const ann = node.shader.annotations.find((a) => a.name === k.name);
      const label = ann ? `${k.name}` : k.name;
      if (k.kind === 'expression') {
        fields.push({ id: `uniform:${k.name}`, label, target, type: 'text', state: 'locked', value: '', reason: `${k.name} is not a literal, so it is read-only (the other uniforms stay editable)` });
        continue;
      }
      const f = valueField(`uniform:${k.name}`, label, target, k.value, { min: ann?.min, max: ann?.max, type: ann?.type }, k.name);
      if (f) fields.push(f);
    }
    if (fields.length) sections.push({ title: 'Shader uniforms', fields });
  }
  return sections;
}

/** The value to write for one edited component of a vec3 transform (rotation is shown in degrees, written in radians). */
export function vec3Commit(field: Extract<Field, { type: 'vec3' }>, index: number, shown: number): number[] {
  const next = [...field.value];
  next[index] = field.unit === 'deg' ? (shown * Math.PI) / 180 : shown;
  return next;
}

export const toDisplay = (field: Extract<Field, { type: 'vec3' }>, v: number): number => (field.unit === 'deg' ? Math.round(((v * 180) / Math.PI) * 100) / 100 : Math.round(v * 1000) / 1000);
