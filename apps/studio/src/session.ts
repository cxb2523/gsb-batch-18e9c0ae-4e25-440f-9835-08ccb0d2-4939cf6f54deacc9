import { PrismError, setProp, setUniform } from '@prismbox/core';
import type { PropValue } from '@prismbox/core';

/** One row of the diff strip: the exact one-line change a write made. */
export interface DiffEntry {
  id: number;
  kind: 'edit' | 'undo' | 'redo' | 'reset';
  line: number;
  before: string;
  after: string;
  /** Human summary, for example `position` or `uniform uMix`. */
  summary: string;
  author: 'you' | 'claude';
  at: number;
}

export type EditOp =
  | { kind: 'prop'; node: string; prop: string; value: PropValue }
  | { kind: 'uniform'; node: string; uniform: string; value: PropValue };

export interface Session {
  templateId: string;
  file: string;
  /** The current source: the single source of truth. */
  source: string;
  /** The template as shipped, for Reset. */
  original: string;
  undoStack: string[];
  redoStack: string[];
  log: DiffEntry[];
  nextId: number;
  /** Set when the last edit was refused (for example a read-only prop); cleared by the next edit. */
  error: string | null;
}

export const FILE_NAME = 'Hero.tsx';
const LOG_LIMIT = 200;

export function createSession(templateId: string, original: string, saved?: string | null): Session {
  return { templateId, file: FILE_NAME, source: saved ?? original, original, undoStack: [], redoStack: [], log: [], nextId: 1, error: null };
}

function firstChangedLine(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.slice(0, i).split('\n').length;
}

/** The one-line hunk between two sources, or null when they are equal. */
function hunk(a: string, b: string): { line: number; before: string; after: string } | null {
  if (a === b) return null;
  const line = firstChangedLine(a, b);
  const la = a.split('\n');
  const lb = b.split('\n');
  return { line, before: la[line - 1] ?? '', after: lb[line - 1] ?? '' };
}

function push(s: Session, kind: DiffEntry['kind'], summary: string, before: string, after: string, now: number): Session {
  const h = hunk(before, after);
  if (!h) return s;
  const entry: DiffEntry = { id: s.nextId, kind, summary, author: 'you', at: now, ...h };
  return { ...s, log: [entry, ...s.log].slice(0, LOG_LIMIT), nextId: s.nextId + 1 };
}

export const round3 = (n: number): number => Math.round(n * 1000) / 1000 || 0;

export function sanitizePropValue(value: PropValue): PropValue {
  if (typeof value === 'number') return round3(value);
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === 'number' ? round3(v) : v)) as PropValue;
  }
  return value;
}

/** Apply one edit through @prismbox/core. A refused edit leaves the source untouched and records the reason. */
export function applyEdit(s: Session, op: EditOp, now: number = Date.now()): Session {
  try {
    const r =
      op.kind === 'prop'
        ? setProp(s.source, { op: 'setProp', node: op.node, prop: op.prop, value: op.value })
        : setUniform(s.source, { op: 'setUniform', node: op.node, uniform: op.uniform, value: op.value });
    if (!r.changed) return { ...s, error: null };
    const next: Session = { ...s, source: r.source, undoStack: [...s.undoStack, s.source], redoStack: [], error: null };
    return push(next, 'edit', op.kind === 'prop' ? op.prop : `uniform ${op.uniform}`, s.source, r.source, now);
  } catch (e) {
    return { ...s, error: e instanceof PrismError ? `${e.code}: ${e.message}` : String(e) };
  }
}

export function undo(s: Session, now: number = Date.now()): Session {
  const prev = s.undoStack[s.undoStack.length - 1];
  if (prev === undefined) return s;
  const next: Session = { ...s, source: prev, undoStack: s.undoStack.slice(0, -1), redoStack: [...s.redoStack, s.source], error: null };
  return push(next, 'undo', 'undo', s.source, prev, now);
}

export function redo(s: Session, now: number = Date.now()): Session {
  const nxt = s.redoStack[s.redoStack.length - 1];
  if (nxt === undefined) return s;
  const next: Session = { ...s, source: nxt, redoStack: s.redoStack.slice(0, -1), undoStack: [...s.undoStack, s.source], error: null };
  return push(next, 'redo', 'redo', s.source, nxt, now);
}

/** Back to the template as shipped. Undoable. */
export function reset(s: Session, now: number = Date.now()): Session {
  if (s.source === s.original) return s;
  const next: Session = { ...s, source: s.original, undoStack: [...s.undoStack, s.source], redoStack: [], error: null };
  return push(next, 'reset', 'reset to template', s.source, s.original, now);
}

/**
 * Split a before/after line pair into the unchanged prefix, the removed and inserted spans, and the unchanged suffix,
 * so the diff strip can highlight exactly what changed.
 */
export function diffParts(before: string, after: string): { prefix: string; removed: string; inserted: string; suffix: string } {
  let p = 0;
  while (p < before.length && p < after.length && before[p] === after[p]) p++;
  let q = 0;
  while (q < before.length - p && q < after.length - p && before[before.length - 1 - q] === after[after.length - 1 - q]) q++;
  return { prefix: before.slice(0, p), removed: before.slice(p, before.length - q), inserted: after.slice(p, after.length - q), suffix: before.slice(before.length - q) };
}
