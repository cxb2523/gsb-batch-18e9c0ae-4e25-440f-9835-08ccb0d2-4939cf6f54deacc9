import type { N } from './ast';
import { ENUM_PROPS, NEWABLE } from './subset';

export type PropValue = number | string | boolean | null | PropValue[] | { [key: string]: PropValue };

const isMathPI = (e: N): boolean =>
  e.type === 'MemberExpression' && e.object?.name === 'Math' && e.property?.name === 'PI';

/** Numbers, unary +/-, `Math.PI` and `*` / `/` combinations of those (angle literals). */
function isNumLike(e: N): boolean {
  if (!e) return false;
  if (e.type === 'NumericLiteral') return true;
  if (e.type === 'UnaryExpression' && (e.operator === '-' || e.operator === '+')) return isNumLike(e.argument);
  if (isMathPI(e)) return true;
  if (e.type === 'BinaryExpression' && (e.operator === '*' || e.operator === '/')) {
    return isNumLike(e.left) && isNumLike(e.right);
  }
  return false;
}

function newableName(callee: N): string | null {
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && callee.object?.name === 'THREE') return callee.property?.name ?? null;
  return null;
}

/**
 * Is this expression a literal in the Prism subset?
 * Numbers, strings, booleans, null, template literals without expressions, arrays and
 * objects of literals, `Math.PI` angle forms, `as`/`satisfies` wrappers, `new THREE.Color(...)`
 * style constructors with literal args, and `THREE.X` enum members for `side` / `blending`.
 */
export function isLiteral(e: N, prop: string): boolean {
  if (!e) return false;
  if (isNumLike(e)) return true;
  switch (e.type) {
    case 'StringLiteral':
    case 'BooleanLiteral':
    case 'NullLiteral':
      return true;
    case 'TemplateLiteral':
      return e.expressions.length === 0;
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSNonNullExpression':
      return isLiteral(e.expression, prop);
    case 'ArrayExpression':
      return e.elements.every((x: N) => x && x.type !== 'SpreadElement' && isLiteral(x, prop));
    case 'ObjectExpression':
      return e.properties.every((p: N) => p.type === 'ObjectProperty' && !p.computed && isLiteral(p.value, prop));
    case 'NewExpression': {
      const name = newableName(e.callee);
      return !!name && NEWABLE.has(name) && e.arguments.every((a: N) => isLiteral(a, prop));
    }
    case 'MemberExpression':
      return e.object?.name === 'THREE' && ENUM_PROPS.has(prop) && /^[A-Z]/.test(e.property?.name ?? '');
    default:
      return false;
  }
}

/** Coarse category of a non-literal expression, for diagnostics. */
export function categorize(e: N): string {
  switch (e.type) {
    case 'Identifier':
      return 'identifier';
    case 'MemberExpression':
      return 'member-expr';
    case 'CallExpression':
      return 'call';
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
      return 'function';
    case 'ConditionalExpression':
    case 'LogicalExpression':
      return 'conditional';
    case 'BinaryExpression':
    case 'UnaryExpression':
      return 'arithmetic-expr';
    case 'TemplateLiteral':
      return 'template-with-expr';
    case 'ObjectExpression':
      return 'object-nonliteral';
    case 'ArrayExpression':
      return 'array-nonliteral';
    case 'NewExpression':
      return 'new-expr';
    default:
      return `other:${e.type}`;
  }
}

/** Marker for a literal that cannot be turned into a plain JS value (for example `new THREE.Color(...)`). */
export const OPAQUE_LITERAL = Symbol('opaque-literal');

/**
 * Evaluate a literal expression to a plain JS value. Constructors and enum members have no
 * plain equivalent and yield `OPAQUE_LITERAL`.
 */
export function evalLiteral(e: N): PropValue | typeof OPAQUE_LITERAL {
  switch (e.type) {
    case 'NumericLiteral':
      return e.value as number;
    case 'StringLiteral':
      return e.value as string;
    case 'BooleanLiteral':
      return e.value as boolean;
    case 'NullLiteral':
      return null;
    case 'TemplateLiteral':
      return e.expressions.length === 0 ? (e.quasis[0].value.cooked as string) : OPAQUE_LITERAL;
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSNonNullExpression':
      return evalLiteral(e.expression);
    case 'UnaryExpression': {
      const v = evalLiteral(e.argument);
      if (typeof v !== 'number') return OPAQUE_LITERAL;
      return e.operator === '-' ? -v : e.operator === '+' ? v : OPAQUE_LITERAL;
    }
    case 'MemberExpression':
      return isMathPI(e) ? Math.PI : OPAQUE_LITERAL;
    case 'BinaryExpression': {
      const l = evalLiteral(e.left);
      const r = evalLiteral(e.right);
      if (typeof l !== 'number' || typeof r !== 'number') return OPAQUE_LITERAL;
      if (e.operator === '*') return l * r;
      if (e.operator === '/') return l / r;
      return OPAQUE_LITERAL;
    }
    case 'ArrayExpression': {
      const out: PropValue[] = [];
      for (const x of e.elements) {
        const v = evalLiteral(x);
        if (v === OPAQUE_LITERAL) return OPAQUE_LITERAL;
        out.push(v);
      }
      return out;
    }
    case 'ObjectExpression': {
      const out: { [key: string]: PropValue } = {};
      for (const p of e.properties) {
        const key = p.key.type === 'Identifier' ? p.key.name : p.key.value;
        const v = evalLiteral(p.value);
        if (v === OPAQUE_LITERAL) return OPAQUE_LITERAL;
        out[String(key)] = v;
      }
      return out;
    }
    default:
      return OPAQUE_LITERAL;
  }
}

/** Structural equality for plain values. Numbers compare after rounding to 3 decimals. */
export function valuesEqual(a: PropValue, b: PropValue): boolean {
  if (typeof a === 'number' && typeof b === 'number') return round3(a) === round3(b);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => valuesEqual(x, b[i] as PropValue));
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => k in b && valuesEqual(a[k] as PropValue, b[k] as PropValue));
  }
  return a === b;
}

/** Numbers written by Prismbox are rounded to 3 decimals; negative zero becomes zero. */
export function round3(n: number): number {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
}

/**
 * The plain value of a literal uniform `value`. `new THREE.Color("#hex")` yields the hex string and
 * `new THREE.VectorN(a, b)` yields the number array.
 */
export function uniformValueOf(e: N): PropValue | undefined {
  let x = e;
  while (x && (x.type === 'TSAsExpression' || x.type === 'TSSatisfiesExpression' || x.type === 'TSNonNullExpression')) x = x.expression;
  if (x?.type === 'NewExpression') {
    const args = (x.arguments as N[]).map((arg) => evalLiteral(arg));
    if (args.some((arg) => arg === OPAQUE_LITERAL)) return undefined;
    const name = x.callee.type === 'Identifier' ? x.callee.name : x.callee.property?.name;
    return name === 'Color' && args.length === 1 ? (args[0] as PropValue) : (args as PropValue[]);
  }
  const v = evalLiteral(x);
  return v === OPAQUE_LITERAL ? undefined : v;
}
