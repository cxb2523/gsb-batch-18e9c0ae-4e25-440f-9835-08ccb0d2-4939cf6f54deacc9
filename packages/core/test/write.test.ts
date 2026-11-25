import { describe, expect, it } from 'vitest';
import { applyOps, PrismError, readScene, setProp, setUniform } from '../src/index';
import type { PropValue } from '../src/index';

const wrap = (body: string, head = ''): string =>
  `import { Canvas } from "@react-three/fiber";\n${head}\nexport default function Hero() {\n  return (\n    <Canvas>\n${body}\n    </Canvas>\n  );\n}\n`;

const set = (src: string, node: string, prop: string, value: PropValue, expected?: PropValue) =>
  setProp(src, { op: 'setProp', node, prop, value, ...(expected === undefined ? {} : { expected }) });

const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return e instanceof PrismError ? e.code : `non-prism:${String(e)}`;
  }
  return undefined;
};

/** Region of `a` that differs from `b` after trimming the common prefix and suffix. */
function region(a: string, b: string): [number, number] {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let q = 0;
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
  return [p, a.length - q];
}

describe('setProp: existing literals', () => {
  it('overwrites a number tuple in place and keeps the file otherwise identical', () => {
    const src = wrap(`<mesh name="orb" position={[0, 0, 0]} scale={1} />`);
    const r = set(src, 'orb', 'position', [0.4, 0.1, 0]);
    expect(r.source).toBe(src.replace('position={[0, 0, 0]}', 'position={[0.4, 0.1, 0]}'));
    expect(r.changed).toBe(true);
    expect(r.edit?.removed).toBe('[0, 0, 0]');
    expect(r.hunk?.after).toContain('position={[0.4, 0.1, 0]}');
  });

  it('keeps tight separators and untouched elements when only some numbers change', () => {
    const src = wrap(`<mesh name="o" position={[0,1.0,0]} />`);
    expect(set(src, 'o', 'position', [0, 1, 2]).source).toContain('position={[0,1.0,2]}');
    expect(set(src, 'o', 'position', [5, 1, 0]).source).toContain('position={[5,1.0,0]}');
  });

  it('rounds to three decimals and never writes -0', () => {
    const src = wrap(`<mesh name="o" position={[0, 0, 0]} scale={1} />`);
    expect(set(src, 'o', 'position', [0.123456, -0.0004, 1 / 3]).source).toContain('position={[0.123, 0, 0.333]}');
    expect(set(src, 'o', 'scale', 2.0004).source).toContain('scale={2}');
  });

  it('is a true no-op when the value is already there (even if written differently)', () => {
    const src = wrap(`<mesh name="o" position={[0,1.0,0]} rotation={[Math.PI / 2, 0, 0]} />`);
    const a = set(src, 'o', 'position', [0, 1, 0]);
    expect(a.changed).toBe(false);
    expect(a.source).toBe(src);
    expect(set(src, 'o', 'rotation', [Math.PI / 2, 0, 0]).changed).toBe(false);
  });

  it('overwrites a string attribute and switches form when the type changes', () => {
    const src = wrap(`<meshStandardMaterial name="m" color="#ff0000" roughness={0.5} />`);
    expect(set(src, 'm', 'color', '#00ff00').source).toContain('color="#00ff00"');
    expect(set(src, 'm', 'roughness', 0.9).source).toContain('roughness={0.9}');
  });

  it('keeps `as const` when overwriting', () => {
    const src = wrap(`<mesh name="o" position={[1, 2, 3] as const} />`);
    expect(set(src, 'o', 'position', [4, 5, 6]).source).toContain('position={[4, 5, 6] as const}');
  });

  it('adds a value to a bare boolean attribute', () => {
    const src = wrap(`<mesh name="o" visible castShadow />`);
    const r = set(src, 'o', 'visible', false);
    expect(r.source).toContain('visible={false} castShadow');
  });

  it('writes an angle as a decimal radian value', () => {
    const src = wrap(`<mesh name="o" rotation={[0, 0, 0]} />`);
    expect(set(src, 'o', 'rotation', [0, Math.PI / 2, 0]).source).toContain('rotation={[0, 1.571, 0]}');
  });

  it('changes exactly one span', () => {
    const src = wrap(`<group>\n<mesh name="a" position={[0, 0, 0]} />\n<mesh name="b" position={[1, 1, 1]} />\n</group>`);
    const r = set(src, 'b', 'position', [2, 2, 2]);
    const [lo, hi] = region(src, r.source);
    expect(src.slice(lo, hi)).toBe('1, 1, 1');
    expect(r.edit && lo >= r.edit.start && hi <= r.edit.end).toBe(true);
  });
});

describe('setProp: inserting an absent prop', () => {
  it('appends after the last attribute on one line', () => {
    const src = wrap(`<mesh name="o" scale={2} />`);
    expect(set(src, 'o', 'position', [1, 2, 3]).source).toBe(src.replace('scale={2} />', 'scale={2} position={[1, 2, 3]} />'));
  });

  it('adds the first attribute after the tag name', () => {
    const src = wrap(`<group />`);
    expect(set(src, 'Hero:Canvas>group[0]', 'name', 'g').source).toContain('<group name="g" />');
  });

  it('copies the indentation of a multi-line tag', () => {
    const src = wrap(`      <mesh\n        name="o"\n        scale={2}\n      />`);
    const r = set(src, 'o', 'position', [1, 2, 3]);
    expect(r.source).toContain('        scale={2}\n        position={[1, 2, 3]}\n      />');
  });

  it('uses CRLF for a multi-line insertion in a CRLF file', () => {
    const src = wrap(`      <mesh\n        name="o"\n      />`).replace(/\n/g, '\r\n');
    const r = set(src, 'o', 'scale', 2);
    expect(r.source).toContain('name="o"\r\n        scale={2}\r\n');
    expect(r.source.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('follows the file’s single-quote style', () => {
    const src = wrap(`<mesh name='o' />\n<meshStandardMaterial name='m' color='#fff' />`);
    expect(set(src, 'm', 'side', 'double').source).toContain("side='double'");
  });

  it('works in a file with a BOM', () => {
    const src = '﻿' + wrap(`<mesh name="o" />`);
    const r = set(src, 'o', 'scale', 2);
    expect(r.source.startsWith('﻿')).toBe(true);
    expect(r.source).toContain('<mesh name="o" scale={2} />');
  });

  it('uses an expression container for strings that are unsafe as JSX attribute text', () => {
    const src = wrap(`<mesh name="o" />`);
    expect(set(src, 'o', 'userData', { note: 'a & b' }).source).toContain('userData={{ note: "a & b" }}');
    expect(set(src, 'o', 'name', 'a&b').source).toContain('name={"a&b"}');
  });
});

describe('setProp: refusals', () => {
  it('refuses an expression prop with OUT_OF_SUBSET and leaves nothing written', () => {
    const src = wrap(`<mesh name="o" position={[0, 0, z]} />`, 'const z = 1;');
    expect(code(() => set(src, 'o', 'position', [1, 1, 1]))).toBe('OUT_OF_SUBSET');
  });

  it('still edits the literal props of a node that has an expression prop elsewhere', () => {
    const src = wrap(`<mesh name="o" args={[R, 1]} position={[0, 0, 0]} />`, 'const R = 1;');
    expect(set(src, 'o', 'position', [1, 1, 1]).source).toContain('position={[1, 1, 1]}');
  });

  it.each([
    ['map', `{[1].map((i) => <mesh key={i} name="o" />)}`],
    ['conditional', `{ok && <mesh name="o" />}`],
    ['spread', `<mesh name="o" {...rest} />`],
    ['opaque', `<primitive name="o" object={m} />`],
  ])('refuses a node locked by %s with READ_ONLY_NODE', (_k, body) => {
    const src = wrap(body, 'const ok = true; const rest = {}; const m = null;');
    expect(code(() => set(src, 'o', 'position', [0, 0, 0]))).toBe('READ_ONLY_NODE');
  });

  it('reports NODE_NOT_FOUND and AMBIGUOUS_NODE', () => {
    expect(code(() => set(wrap(`<mesh name="a" />`), 'nope', 'scale', 1))).toBe('NODE_NOT_FOUND');
    expect(code(() => set(wrap(`<mesh name="a" /><mesh name="a" />`), 'a', 'scale', 1))).toBe('AMBIGUOUS_NODE');
  });

  it('validates values against the prop', () => {
    const src = wrap(`<mesh name="o" />`);
    expect(code(() => set(src, 'o', 'position', [1, 2]))).toBe('INVALID_VALUE');
    expect(code(() => set(src, 'o', 'position', 'x'))).toBe('INVALID_VALUE');
    expect(code(() => set(src, 'o', 'visible', 1))).toBe('INVALID_VALUE');
    expect(code(() => set(src, 'o', 'color', 'red'))).toBe('INVALID_VALUE');
    expect(code(() => set(src, 'o', 'roughness', Number.NaN))).toBe('INVALID_VALUE');
    expect(code(() => set(src, 'o', 'bad prop!', 1))).toBe('INVALID_VALUE');
  });

  it('never writes ref, key, handlers or children', () => {
    const src = wrap(`<mesh name="o" />`);
    for (const p of ['ref', 'key', 'onClick', 'children']) expect(code(() => set(src, 'o', p, 1))).toBe('READ_ONLY_PROP');
  });

  it('refuses to edit GLSL source through setProp', () => {
    const src = wrap(`<shaderMaterial name="m" vertexShader={v} />`, 'const v = `void main() {}`;');
    expect(code(() => set(src, 'm', 'vertexShader', 'void main() { }'))).toBe('READ_ONLY_PROP');
  });

  it('returns CONFLICT when `expected` does not match the file', () => {
    const src = wrap(`<mesh name="o" position={[1, 2, 3]} />`);
    expect(code(() => set(src, 'o', 'position', [9, 9, 9], [0, 0, 0]))).toBe('CONFLICT');
    expect(set(src, 'o', 'position', [9, 9, 9], [1, 2, 3]).changed).toBe(true);
    expect(code(() => set(src, 'o', 'scale', 2, 1))).toBe('CONFLICT');
  });

  it('refuses a file that does not parse', () => {
    expect(code(() => set('const = ;', 'o', 'scale', 1))).toBe('PARSE_ERROR');
  });
});

describe('setProp: same-file bindings', () => {
  const head = `const uniforms = { uIntensity: { value: 0.6 } };`;
  const src = wrap(`<shaderMaterial name="m" uniforms={uniforms} />`, head);

  it('edits the binding’s literal, one span, when the prop resolves to a const', () => {
    const r = set(src, 'm', 'uniforms', { uIntensity: { value: 0.9 } });
    expect(r.source).toContain('const uniforms = { uIntensity: { value: 0.9 } };');
    expect(r.source).toContain('uniforms={uniforms}');
    expect(readScene(r.source).nodes.find((n) => n.name === 'm')?.props.find((p) => p.name === 'uniforms')?.kind).toBe('resolved');
  });
});

describe('setUniform', () => {
  const mat = (uniforms: string, head = '') => wrap(`<shaderMaterial name="m" uniforms=${uniforms} />`, head);

  it('edits an inline uniform number', () => {
    const src = mat('{{ uIntensity: { value: 0.6 }, uTime: { value: 0 } }}');
    const r = setUniform(src, { op: 'setUniform', node: 'm', uniform: 'uIntensity', value: 0.9 });
    expect(r.source).toBe(src.replace('uIntensity: { value: 0.6 }', 'uIntensity: { value: 0.9 }'));
    expect(r.edit?.removed).toBe('0.6');
  });

  it('edits a uniform through a top-level const', () => {
    const src = mat('{u}', 'const u = { uIntensity: { value: 0.6 } };');
    const r = setUniform(src, { op: 'setUniform', node: 'm', uniform: 'uIntensity', value: 1 });
    expect(r.source).toContain('const u = { uIntensity: { value: 1 } };');
  });

  it('edits a uniform through useMemo(() => ({...}), [])', () => {
    const src = `import { Canvas } from "@react-three/fiber";\nimport { useMemo } from "react";\nexport default function H() {\n  const u = useMemo(() => ({ uTime: { value: 0 }, uMix: { value: 0.2 } }), []);\n  return <Canvas><shaderMaterial name="m" uniforms={u} /></Canvas>;\n}\n`;
    const r = setUniform(src, { op: 'setUniform', node: 'm', uniform: 'uMix', value: 0.75 });
    expect(r.source).toContain('uMix: { value: 0.75 }');
    expect(r.source).toContain('uTime: { value: 0 }');
  });

  it('keeps the constructor for Color and Vector uniforms', () => {
    const src = mat('{{ uC: { value: new THREE.Color("#ff0000") }, uV: { value: new THREE.Vector3(1, 2, 3) } }}', 'import * as THREE from "three";');
    const a = setUniform(src, { op: 'setUniform', node: 'm', uniform: 'uC', value: '#00ff00' });
    expect(a.source).toContain('new THREE.Color("#00ff00")');
    const b = setUniform(a.source, { op: 'setUniform', node: 'm', uniform: 'uV', value: [4, 5, 6] });
    expect(b.source).toContain('new THREE.Vector3(4, 5, 6)');
    expect(code(() => setUniform(src, { op: 'setUniform', node: 'm', uniform: 'uC', value: 'red' }))).toBe('INVALID_VALUE');
  });

  it('edits the literal keys of a mixed uniforms object and refuses only the non-literal key', () => {
    const src = mat('{{ uTex: { value: tex }, uMix: { value: 0.5 }, uC: { value: new THREE.Color("#fff") } }}', 'import * as THREE from "three";\nconst tex = null;');
    const r = setUniform(src, { op: 'setUniform', node: 'm', uniform: 'uMix', value: 0.9 });
    expect(r.source).toBe(src.replace('uMix: { value: 0.5 }', 'uMix: { value: 0.9 }'));
    expect(setUniform(src, { op: 'setUniform', node: 'm', uniform: 'uC', value: '#000000' }).source).toContain('new THREE.Color("#000000")');
    expect(code(() => setUniform(src, { op: 'setUniform', node: 'm', uniform: 'uTex', value: 1 }))).toBe('OUT_OF_SUBSET');
  });

  it('edits the literal keys of a mixed uniforms object that lives in a same-file const or useMemo', () => {
    const viaConst = mat('{u}', 'const tex = null;\nconst u = { uTex: { value: tex }, uMix: { value: 0.5 } };');
    expect(setUniform(viaConst, { op: 'setUniform', node: 'm', uniform: 'uMix', value: 1 }).source).toContain('uMix: { value: 1 }');
    const viaMemo = `import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
export default function H({ tex }: { tex: object }) {
  const u = useMemo(() => ({ uTex: { value: tex }, uMix: { value: 0.2 } }), [tex]);
  return <Canvas><shaderMaterial name="m" uniforms={u} /></Canvas>;
}
`;
    // a useMemo with dependencies is not a same-file binding, so it stays fully read-only
    expect(code(() => setUniform(viaMemo, { op: 'setUniform', node: 'm', uniform: 'uMix', value: 1 }))).toBe('OUT_OF_SUBSET');
  });

  it('reports an unknown uniform', () => {
    const ok = mat('{{ uOk: { value: 1 } }}');
    expect(code(() => setUniform(ok, { op: 'setUniform', node: 'm', uniform: 'nope', value: 1 }))).toBe('UNIFORM_NOT_FOUND');
  });

  it('refuses when `uniforms` is not a literal or a same-file const', () => {
    const src = mat('{makeUniforms()}', 'const makeUniforms = () => ({});');
    expect(code(() => setUniform(src, { op: 'setUniform', node: 'm', uniform: 'uT', value: 1 }))).toBe('OUT_OF_SUBSET');
  });

  it('supports `expected`', () => {
    const src = mat('{{ uT: { value: 0.5 } }}');
    expect(code(() => setUniform(src, { op: 'setUniform', node: 'm', uniform: 'uT', value: 1, expected: 0 }))).toBe('CONFLICT');
    expect(setUniform(src, { op: 'setUniform', node: 'm', uniform: 'uT', value: 1, expected: 0.5 }).changed).toBe(true);
  });
});

describe('applyOps', () => {
  it('applies ops in order against the running source', () => {
    const src = wrap(`<mesh name="o" position={[0, 0, 0]} />`);
    const { source, results } = applyOps(src, [
      { op: 'setProp', node: 'o', prop: 'position', value: [1, 1, 1] },
      { op: 'setProp', node: 'o', prop: 'scale', value: 2 },
    ]);
    expect(results).toHaveLength(2);
    expect(source).toContain('position={[1, 1, 1]} scale={2}');
  });

  it('is all-or-nothing: a failing op throws and the caller keeps the original', () => {
    const src = wrap(`<mesh name="o" position={[0, 0, 0]} />`);
    expect(() =>
      applyOps(src, [
        { op: 'setProp', node: 'o', prop: 'position', value: [1, 1, 1] },
        { op: 'setProp', node: 'missing', prop: 'scale', value: 2 },
      ]),
    ).toThrow(PrismError);
    expect(src).toContain('position={[0, 0, 0]}');
  });

  it('an empty batch returns the source untouched', () => {
    const src = wrap(`<mesh name="o" />`);
    expect(applyOps(src, []).source).toBe(src);
  });
});
