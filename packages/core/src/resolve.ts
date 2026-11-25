import type { N } from './ast';
import { isLiteral } from './literal';

/**
 * A prop value that is an identifier, resolved to a same-file literal.
 * Edits to such a prop land on the binding's literal, not on the JSX attribute.
 */
export interface ResolvedBinding {
  /** `const x = <literal>` or `const x = useMemo(() => <literal>, [])`. */
  via: 'const' | 'useMemo';
  name: string;
  /** Start offset of the declarator, used to group the props that share one binding. */
  declStart: number;
  /** The literal that holds the value (after unwrapping `as const` / `satisfies`). */
  target: N;
}

const WRAPPERS = new Set(['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression']);

function unwrap(e: N): N {
  let cur = e;
  while (cur && WRAPPERS.has(cur.type)) cur = cur.expression;
  return cur;
}

function isUseMemoCall(e: N): boolean {
  if (e?.type !== 'CallExpression') return false;
  const c = e.callee;
  return (c.type === 'Identifier' && c.name === 'useMemo') || (c.type === 'MemberExpression' && c.property?.name === 'useMemo');
}

/** The expression a `useMemo(() => <expr>, [])` callback returns, if it is that simple. */
function useMemoResult(call: N): N | null {
  const [fn, deps] = call.arguments as N[];
  if (!fn || (fn.type !== 'ArrowFunctionExpression' && fn.type !== 'FunctionExpression')) return null;
  if (!deps || deps.type !== 'ArrayExpression' || deps.elements.length !== 0) return null;
  if (fn.type === 'ArrowFunctionExpression' && fn.body.type !== 'BlockStatement') return unwrap(fn.body);
  const body = fn.body;
  if (body.type !== 'BlockStatement' || body.body.length !== 1) return null;
  const only = body.body[0];
  return only.type === 'ReturnStatement' && only.argument ? unwrap(only.argument) : null;
}

/** Every identifier a binding pattern (`x`, `{ a, b: [c] }`, `...rest`, `x = 1`) introduces. */
function patternNames(p: N, out: string[] = []): string[] {
  if (!p) return out;
  switch (p.type) {
    case 'Identifier':
      out.push(p.name as string);
      break;
    case 'ObjectPattern':
      for (const prop of p.properties as N[]) patternNames(prop.type === 'RestElement' ? prop.argument : prop.value, out);
      break;
    case 'ArrayPattern':
      for (const el of p.elements as N[]) patternNames(el, out);
      break;
    case 'AssignmentPattern':
      patternNames(p.left, out);
      break;
    case 'RestElement':
      patternNames(p.argument, out);
      break;
    case 'TSParameterProperty':
      patternNames(p.parameter, out);
      break;
  }
  return out;
}

type Found = { declarator: N; kind: string } | { declarator: null; kind: 'other' };

/** The declaration of `name` directly inside `statements`, of any kind (so a `let` still shadows). */
function declarationIn(statements: N[], name: string): Found | null {
  for (const s of statements) {
    const decl = s.type === 'ExportNamedDeclaration' ? s.declaration : s;
    if (!decl) continue;
    if (decl.type === 'VariableDeclaration') {
      for (const d of decl.declarations as N[]) {
        if (patternNames(d.id).includes(name)) return d.id.type === 'Identifier' ? { declarator: d, kind: decl.kind as string } : { declarator: null, kind: 'other' };
      }
    } else if ((decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') && decl.id?.name === name) {
      return { declarator: null, kind: 'other' };
    }
  }
  return null;
}

/** An object literal with only plain `key: value` properties (no spread, computed keys, methods). */
export function isPlainObject(e: N): boolean {
  return e?.type === 'ObjectExpression' && e.properties.every((p: N) => p.type === 'ObjectProperty' && !p.computed);
}

function isFunction(n: N): boolean {
  return n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression';
}

/**
 * Resolve `ident` (an Identifier used as a prop value) against the enclosing scopes,
 * innermost first. Only simple `const` bindings qualify; anything else returns null and the
 * prop stays read-only. `parents` is the ancestor chain of the JSX attribute.
 */
export function resolveBinding(ident: N, parents: N[], prop: string, partialObject = false): ResolvedBinding | null {
  // `partialObject`: also accept an object literal whose values are not all literal (per-key uniforms editing)
  const accept = (e: N): boolean => isLiteral(e, prop) || (partialObject && isPlainObject(e));
  for (let i = parents.length - 1; i >= 0; i--) {
    const p = parents[i];
    if (isFunction(p) && p.params.some((param: N) => patternNames(param).includes(ident.name))) {
      return null; // shadowed by a parameter
    }
    const statements: N[] | null = p.type === 'BlockStatement' || p.type === 'Program' ? p.body : null;
    if (!statements) continue;
    const found = declarationIn(statements, ident.name);
    if (!found) continue;
    if (found.kind !== 'const' || !found.declarator) return null;
    const decl = found.declarator;
    if (!decl.init) return null;
    const init = unwrap(decl.init);
    if (accept(init)) return { via: 'const', name: ident.name, declStart: decl.start, target: init };
    if (isUseMemoCall(init)) {
      const result = useMemoResult(init);
      if (result && accept(result)) return { via: 'useMemo', name: ident.name, declStart: decl.start, target: result };
    }
    return null;
  }
  return null;
}
