/* eslint-disable @typescript-eslint/no-explicit-any -- Babel's node union is huge; the walker is deliberately loose. */
import { parse } from '@babel/parser';
import { PrismError } from './errors';

/** A Babel AST node, loosely typed. Nothing outside `@prismbox/core` ever sees one. */
export type N = any;

export function parseSource(source: string): N {
  try {
    return parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  } catch (e) {
    const err = e as { message?: string };
    throw new PrismError('PARSE_ERROR', `Could not parse the file: ${err.message ?? String(e)}`);
  }
}

const SKIP_KEYS = new Set(['loc', 'start', 'end', 'range', 'extra', 'leadingComments', 'trailingComments', 'innerComments']);

/** Depth-first walk. `parents` is the ancestor chain of the node being visited (root first). */
export function walk(node: N, parents: N[], visit: (n: N, parents: N[]) => void): void {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parents);
  parents.push(node);
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const v = node[key];
    if (Array.isArray(v)) {
      for (const c of v) if (c && typeof c.type === 'string') walk(c, parents, visit);
    } else if (v && typeof v.type === 'string') {
      walk(v, parents, visit);
    }
  }
  parents.pop();
}

export function attrName(a: N): string {
  return a.name.type === 'JSXIdentifier' ? a.name.name : `${a.name.namespace.name}:${a.name.name.name}`;
}

export function jsxTag(el: N): string | null {
  const name = el.openingElement.name;
  return name.type === 'JSXIdentifier' ? name.name : null;
}

/** 1-based line and column for a source offset. */
export function lineCol(source: string, offset: number): { line: number; col: number } {
  let line = 1;
  let last = -1;
  for (let i = source.indexOf('\n'); i !== -1 && i < offset; i = source.indexOf('\n', i + 1)) {
    line++;
    last = i;
  }
  return { line, col: offset - last };
}
