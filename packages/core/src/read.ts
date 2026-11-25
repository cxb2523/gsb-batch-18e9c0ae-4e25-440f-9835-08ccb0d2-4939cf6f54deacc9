import { attrName, jsxTag, lineCol, parseSource, walk } from './ast';
import type { N } from './ast';
import { DREI_PACKAGE, isKnownDrei } from './drei';
import { parsePrismAnnotations } from './glsl';
import type { PrismAnnotation } from './glsl';
import { categorize, evalLiteral, isLiteral, OPAQUE_LITERAL, uniformValueOf } from './literal';
import type { PropValue } from './literal';
import { isPlainObject, resolveBinding } from './resolve';
import type { ResolvedBinding } from './resolve';
import { ALLOWED_PACKAGES, HTML_TAGS, OPAQUE_TAGS, SHADER_RESOLVABLE_PROPS, SUBSET_VERSION } from './subset';

export type NodeKind = 'host' | 'drei' | 'canvas';
export type NodeStatus = 'editable' | 'read-only' | 'opaque' | 'instance';
export type PropKind = 'literal' | 'resolved' | 'expression' | 'spread' | 'meta';

/** One entry of a `shaderMaterial` `uniforms` object. Literal keys stay editable even when others are not. */
export interface UniformKey {
  name: string;
  kind: 'literal' | 'expression';
  /** Plain value of a literal `value` (`new THREE.Color("#hex")` gives the hex string). */
  value?: PropValue;
  /** Span of the `value` expression; -1 when the entry has no `value: ...` property. */
  valueStart: number;
  valueEnd: number;
}

export interface PropInfo {
  name: string;
  kind: PropKind;
  /** The plain value, for literal and resolved props that have one. */
  value?: PropValue;
  /** Source text of the value ('' for a bare boolean attribute). */
  text: string;
  /** Span of the whole attribute. */
  attrStart: number;
  attrEnd: number;
  /** Span of the value node (container braces or string quotes included); -1 when there is no value. */
  valueStart: number;
  valueEnd: number;
  /** For `expression` props: a coarse category such as `identifier` or `call`. */
  category?: string;
  /** `uniforms` on a shaderMaterial: per-key info, when the object (inline or same-file) is a plain object literal. */
  keys?: UniformKey[];
  /** For `resolved` props: where the value really lives. */
  resolved?: {
    via: 'const' | 'useMemo';
    name: string;
    /** Start offset of the declarator; props resolving to the same value share this. */
    declStart: number;
    targetStart: number;
    targetEnd: number;
    /** How many props in this file read the same binding (editing it changes all of them). */
    sharedBy: number;
  };
}

export interface SceneNode {
  /** The `name` prop when it is a unique string literal, otherwise the path id. */
  id: string;
  /** Tag path such as `Hero:Canvas>group[0]>mesh[1]`. */
  pathId: string;
  name?: string;
  tag: string;
  kind: NodeKind;
  line: number;
  col: number;
  start: number;
  end: number;
  status: NodeStatus;
  /** Why the node is not editable, one entry per cause. */
  reasons: string[];
  /** Set when the id matches more than one node. Writes to an ambiguous node are refused. */
  ambiguous: boolean;
  /** Why writes to this node are refused outright, if they are. A non-literal prop only locks that prop. */
  locked: "opaque" | "map" | "conditional" | "spread" | null;
  props: PropInfo[];
  /** `shaderMaterial` only: `@prism` annotations found in resolvable GLSL, and the literal uniform names. */
  shader?: { annotations: PrismAnnotation[]; uniforms: string[]; keys: UniformKey[] };
}

export interface Diagnostic {
  code:
    | 'NON_LITERAL_PROP'
    | 'SPREAD_PROP'
    | 'UNSUPPORTED_IMPORT'
    | 'UNKNOWN_DREI_COMPONENT'
    | 'MULTIPLE_CANVAS'
    | 'AMBIGUOUS_NODE';
  severity: 'info' | 'warn';
  message: string;
  line: number;
  col: number;
}

export interface SceneSummary {
  /** R3F host elements (lowercase, non-DOM tags). The denominator of coverage. */
  hostNodes: number;
  /** Host nodes that are unlocked, not opaque, spread-free and whose props are all literal. The numerator. */
  editable: number;
  /** Like `editable`, but the node also has no `ref` or event handlers. */
  strictEditable: number;
  zeroPropNodes: number;
  lockedMap: number;
  lockedConditional: number;
  opaque: number;
  spread: number;
  /** Non-meta props on host nodes, and how many of them are literal (resolved ones count as literal). */
  attrs: number;
  attrsLiteral: number;
  /** Props that are literal only because a same-file binding resolved. */
  resolvedProps: number;
  /** editable / hostNodes, or 1 when there are no host nodes. */
  coverage: number;
}

export interface Scene {
  subsetVersion: number;
  file: string;
  nodes: SceneNode[];
  diagnostics: Diagnostic[];
  summary: SceneSummary;
}

/** Internal: the scene plus the AST handles the writer needs. */
export interface Analysis {
  scene: Scene;
  ast: N;
  entries: { node: SceneNode; el: N; attrs: Map<string, { attr: N; info: PropInfo; binding?: ResolvedBinding }> }[];
}

const isMetaProp = (name: string): boolean => name === 'key' || name === 'ref' || /^on[A-Z]/.test(name);

function uniformKeys(obj: N): UniformKey[] {
  const out: UniformKey[] = [];
  for (const p of obj.properties as N[]) {
    const name = String(p.key.type === 'Identifier' ? p.key.name : p.key.value);
    const entry = unwrapTs(p.value);
    const valueProp = isPlainObject(entry)
      ? (entry.properties as N[]).find((q) => (q.key.type === 'Identifier' ? q.key.name : q.key.value) === 'value')
      : undefined;
    const vNode = valueProp ? unwrapTs(valueProp.value) : undefined;
    if (vNode && isLiteral(vNode, 'value')) {
      const value = uniformValueOf(vNode);
      out.push({ name, kind: 'literal', ...(value === undefined ? {} : { value }), valueStart: vNode.start, valueEnd: vNode.end });
    } else {
      out.push({ name, kind: 'expression', valueStart: vNode ? vNode.start : -1, valueEnd: vNode ? vNode.end : -1 });
    }
  }
  return out;
}

function unwrapTs(e: N): N {
  let cur = e;
  while (cur && (cur.type === 'TSAsExpression' || cur.type === 'TSSatisfiesExpression' || cur.type === 'TSNonNullExpression')) {
    cur = cur.expression;
  }
  return cur;
}

function lockedBy(parents: N[]): 'map' | 'conditional' | null {
  for (let i = parents.length - 1; i >= 0; i--) {
    const p = parents[i];
    if ((p.type === 'ArrowFunctionExpression' || p.type === 'FunctionExpression') && i > 0) {
      const q = parents[i - 1];
      if (q.type === 'CallExpression' && q.callee.type === 'MemberExpression' && q.callee.property?.name === 'map') {
        return 'map';
      }
    }
    if (p.type === 'ConditionalExpression' || p.type === 'LogicalExpression') return 'conditional';
  }
  return null;
}

function enclosingComponent(parents: N[], firstJsxIndex: number): string {
  for (let i = firstJsxIndex - 1; i >= 0; i--) {
    const p = parents[i];
    if (p.type === 'FunctionDeclaration' && p.id) return p.id.name as string;
    if (p.type === 'VariableDeclarator' && p.id?.type === 'Identifier') return p.id.name as string;
  }
  return '';
}

function pathIdFor(el: N, parents: N[]): string {
  const jsxIdx: number[] = [];
  parents.forEach((p, i) => {
    if (p.type === 'JSXElement') jsxIdx.push(i);
  });
  const chain: N[] = [...jsxIdx.map((i) => parents[i]), el];
  const segments = chain.map((node, j) => {
    const tag = jsxTag(node) ?? '?';
    if (j === 0) return tag;
    const parent = chain[j - 1];
    const kids = (parent.children as N[]).filter((c) => c.type === 'JSXElement' || c.type === 'JSXExpressionContainer');
    const at = kids.findIndex((c) => c.start <= node.start && node.end <= c.end);
    return `${tag}[${Math.max(at, 0)}]`;
  });
  const comp = enclosingComponent(parents, jsxIdx[0] ?? parents.length);
  return (comp ? `${comp}:` : '') + segments.join('>');
}

export function analyze(source: string, file = '<memory>'): Analysis {
  const ast = parseSource(source);
  const diagnostics: Diagnostic[] = [];
  const diag = (d: Omit<Diagnostic, 'line' | 'col'>, offset: number): void => {
    diagnostics.push({ ...d, ...lineCol(source, offset) });
  };

  // local name -> where it was imported from
  const imports = new Map<string, { source: string; imported: string }>();
  for (const stmt of ast.program.body as N[]) {
    if (stmt.type !== 'ImportDeclaration') continue;
    const from = stmt.source.value as string;
    const external = !from.startsWith('.') && !from.startsWith('/');
    if (external && !ALLOWED_PACKAGES.has(from) && !from.startsWith('three/') && !from.startsWith('react/')) {
      diag({ code: 'UNSUPPORTED_IMPORT', severity: 'warn', message: `Import from "${from}" is outside the allowed set (react, three, @react-three/fiber, @react-three/drei, relative files).` }, stmt.start);
    }
    for (const sp of stmt.specifiers as N[]) {
      const imported = sp.type === 'ImportSpecifier' ? (sp.imported.name ?? sp.imported.value) : sp.type === 'ImportDefaultSpecifier' ? 'default' : '*';
      imports.set(sp.local.name as string, { source: from, imported: imported as string });
      if (from === DREI_PACKAGE && sp.type === 'ImportSpecifier' && /^[A-Z]/.test(imported as string) && !isKnownDrei(imported as string)) {
        diag({ code: 'UNKNOWN_DREI_COMPONENT', severity: 'info', message: `drei component "${imported}" is not in the known-drei table; it is left alone.` }, sp.start);
      }
    }
  }

  const entries: Analysis['entries'] = [];
  const summary: SceneSummary = {
    hostNodes: 0, editable: 0, strictEditable: 0, zeroPropNodes: 0, lockedMap: 0, lockedConditional: 0,
    opaque: 0, spread: 0, attrs: 0, attrsLiteral: 0, resolvedProps: 0, coverage: 1,
  };

  walk(ast.program, [], (el, parents) => {
    if (el.type !== 'JSXElement') return;
    const tag = jsxTag(el);
    if (!tag) return;

    let kind: NodeKind;
    if (/^[a-z]/.test(tag)) {
      if (HTML_TAGS.has(tag)) return;
      kind = 'host';
    } else {
      const imp = imports.get(tag);
      if (!imp) return;
      if (imp.source === '@react-three/fiber' && imp.imported === 'Canvas') kind = 'canvas';
      else if (imp.source === DREI_PACKAGE && isKnownDrei(imp.imported)) kind = 'drei';
      else return;
    }

    const attrNodes = el.openingElement.attributes as N[];
    const props: PropInfo[] = [];
    const attrMap: Map<string, { attr: N; info: PropInfo; binding?: ResolvedBinding }> = new Map();
    let spread = false;
    let allLiteral = true;
    let hasMeta = false;
    const reasons: string[] = [];

    for (const a of attrNodes) {
      if (a.type === 'JSXSpreadAttribute') {
        spread = true;
        allLiteral = false;
        props.push({ name: '...', kind: 'spread', text: source.slice(a.start, a.end), attrStart: a.start, attrEnd: a.end, valueStart: -1, valueEnd: -1 });
        diag({ code: 'SPREAD_PROP', severity: 'warn', message: `<${tag}> has a spread prop; the node is read-only.` }, a.start);
        continue;
      }
      const name = attrName(a);
      const v = a.value;
      const info: PropInfo = {
        name, kind: 'literal', text: v ? source.slice(v.start, v.end) : '',
        attrStart: a.start, attrEnd: a.end, valueStart: v ? v.start : -1, valueEnd: v ? v.end : -1,
      };
      let binding: ResolvedBinding | undefined;

      if (v == null) {
        info.value = true;
      } else if (v.type === 'StringLiteral') {
        info.value = v.value as string;
      } else if (v.type === 'JSXExpressionContainer') {
        const expr = v.expression;
        if (isLiteral(expr, name)) {
          const ev = evalLiteral(expr);
          if (ev !== OPAQUE_LITERAL) info.value = ev;
        } else {
          const inner = unwrapTs(expr);
          const isUniforms = tag === 'shaderMaterial' && name === 'uniforms';
          const found = tag === 'shaderMaterial' && SHADER_RESOLVABLE_PROPS.has(name) && inner?.type === 'Identifier'
            ? resolveBinding(inner, parents, name, isUniforms)
            : null;
          if (found) {
            binding = found;
            info.resolved = { via: found.via, name: found.name, declStart: found.declStart, targetStart: found.target.start, targetEnd: found.target.end, sharedBy: 1 };
            if (isLiteral(found.target, name)) {
              info.kind = 'resolved';
              const ev = evalLiteral(found.target);
              if (ev !== OPAQUE_LITERAL) info.value = ev;
            } else {
              info.kind = 'expression';
              info.category = 'object-partial';
            }
          } else {
            info.kind = 'expression';
            info.category = isUniforms && isPlainObject(inner) ? 'object-partial' : categorize(expr);
          }
        }
      } else {
        info.kind = 'expression';
        info.category = 'jsx-value';
      }

      if (tag === 'shaderMaterial' && name === 'uniforms' && v?.type === 'JSXExpressionContainer') {
        const obj = binding ? binding.target : unwrapTs(v.expression);
        if (isPlainObject(obj)) info.keys = uniformKeys(obj);
      }

      if (isMetaProp(name)) {
        info.kind = 'meta';
        if (name !== 'key') hasMeta = true;
      } else {
        if (kind === 'host') {
          summary.attrs++;
          if (info.kind === 'literal' || info.kind === 'resolved') summary.attrsLiteral++;
          if (info.kind === 'resolved') summary.resolvedProps++;
        }
        if (info.kind === 'expression') {
          allLiteral = false;
          if (info.category === 'object-partial') {
            const bad = (info.keys ?? []).filter((k) => k.kind === 'expression').map((k) => k.name);
            reasons.push(`\`uniforms\` has non-literal keys (${bad.join(', ') || 'unknown'}); the literal keys stay editable`);
          } else reasons.push(`\`${name}\` is ${info.category === 'identifier' ? 'an identifier' : `an expression (${info.category})`}`);
          diag({ code: 'NON_LITERAL_PROP', severity: 'info', message: `<${tag}> prop "${name}" is not a literal (${info.category}); it is read-only.` }, a.start);
        }
      }
      props.push(info);
      attrMap.set(name, { attr: a, info, binding });
    }
    if (spread) reasons.push('has a spread prop');

    const locked = lockedBy(parents);
    const opaque = kind === 'host' && OPAQUE_TAGS.has(tag);
    let status: NodeStatus;
    if (opaque) { status = 'opaque'; reasons.unshift('opaque element (contents are not edited)'); }
    else if (locked === 'map') { status = 'instance'; reasons.unshift('generated by .map()'); }
    else if (locked === 'conditional') { status = 'read-only'; reasons.unshift('inside a conditional'); }
    else if (spread || !allLiteral) status = 'read-only';
    else status = 'editable';

    const nameProp = attrMap.get('name')?.info;
    const nameValue = nameProp && nameProp.kind === 'literal' && typeof nameProp.value === 'string' ? nameProp.value : undefined;
    const pos = lineCol(source, el.start);
    const pathId = pathIdFor(el, parents);
    const node: SceneNode = {
      id: nameValue ?? pathId, pathId, name: nameValue, tag, kind, line: pos.line, col: pos.col,
      start: el.start, end: el.end, status, reasons, ambiguous: false,
      locked: opaque ? "opaque" : locked === "map" ? "map" : locked === "conditional" ? "conditional" : spread ? "spread" : null,
      props,
    };

    if (tag === 'shaderMaterial') {
      const annotations: PrismAnnotation[] = [];
      for (const p of ['vertexShader', 'fragmentShader']) {
        const info = attrMap.get(p)?.info;
        if (info && (info.kind === 'literal' || info.kind === 'resolved') && typeof info.value === 'string') {
          annotations.push(...parsePrismAnnotations(info.value));
        }
      }
      const keys = attrMap.get('uniforms')?.info.keys ?? [];
      node.shader = { annotations, uniforms: keys.map((k) => k.name), keys };
    }

    if (kind === 'host') {
      summary.hostNodes++;
      if (attrNodes.length === 0) summary.zeroPropNodes++;
      if (spread) summary.spread++;
      if (locked === 'map') summary.lockedMap++;
      else if (locked === 'conditional') summary.lockedConditional++;
      if (opaque) summary.opaque++;
      if (status === 'editable') {
        summary.editable++;
        if (!hasMeta) summary.strictEditable++;
      }
    }
    entries.push({ node, el, attrs: attrMap });
  });

  // ids: a duplicate name falls back to the path id; a still-duplicated id is ambiguous
  const nameCount = new Map<string, number>();
  for (const { node } of entries) if (node.name !== undefined) nameCount.set(node.name, (nameCount.get(node.name) ?? 0) + 1);
  for (const { node } of entries) if (node.name !== undefined && (nameCount.get(node.name) ?? 0) > 1) node.id = node.pathId;
  const idCount = new Map<string, number>();
  for (const { node } of entries) idCount.set(node.id, (idCount.get(node.id) ?? 0) + 1);
  for (const { node } of entries) {
    const dupName = node.name !== undefined && (nameCount.get(node.name) ?? 0) > 1;
    node.ambiguous = dupName || (idCount.get(node.id) ?? 0) > 1;
    if (node.ambiguous) {
      diag({ code: 'AMBIGUOUS_NODE', severity: 'warn', message: `<${node.tag}> cannot be addressed uniquely (${dupName ? `name "${node.name}" is used more than once` : `path "${node.pathId}" is not unique`}); give it a unique \`name\`.` }, node.start);
    }
  }

  // how many props share each resolved binding
  const shared = new Map<number, number>();
  for (const { attrs } of entries) for (const { binding } of attrs.values()) if (binding) shared.set(binding.declStart, (shared.get(binding.declStart) ?? 0) + 1);
  for (const { attrs } of entries) for (const { info, binding } of attrs.values()) if (binding && info.resolved) info.resolved.sharedBy = shared.get(binding.declStart) ?? 1;

  const canvases = entries.filter((e) => e.node.kind === 'canvas');
  if (canvases.length > 1) {
    const second = canvases[1]!.node;
    diag({ code: 'MULTIPLE_CANVAS', severity: 'info', message: `${canvases.length} <Canvas> elements found; only the first is the active one.` }, second.start);
  }

  summary.coverage = summary.hostNodes === 0 ? 1 : summary.editable / summary.hostNodes;
  diagnostics.sort((a, b) => a.line - b.line || a.col - b.col);
  return { scene: { subsetVersion: SUBSET_VERSION, file, nodes: entries.map((e) => e.node), diagnostics, summary }, ast, entries };
}

/** Parse a source file into its scene: nodes, props, diagnostics and the coverage summary. Never writes. */
export function readScene(source: string, file = '<memory>'): Scene {
  return analyze(source, file).scene;
}
