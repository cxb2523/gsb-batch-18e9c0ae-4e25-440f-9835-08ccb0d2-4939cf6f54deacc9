import { describe, expect, it } from 'vitest';
import { applyOps, PrismError, setProp, setUniform } from '../src/index';

const wrap = (body: string, head = ''): string =>
  `import { Canvas } from "@react-three/fiber";\n${head}\nexport default function Hero() {\n  return (\n    <Canvas>\n${body}\n    </Canvas>\n  );\n}\n`;

const SHARED_CONST = 'const u = { uIntensity: { value: 0.6 }, uTime: { value: 0 } };';
const sharedConstSrc = wrap(
  `      <shaderMaterial name="matA" uniforms={u} />\n      <shaderMaterial name="matB" uniforms={u} />`,
  SHARED_CONST,
);

const sharedMemoSrc = `import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
export default function H() {
  const u = useMemo(() => ({ uMix: { value: 0.2 }, uTime: { value: 0 } }), []);
  return (
    <Canvas>
      <shaderMaterial name="matA" uniforms={u} />
      <shaderMaterial name="matB" uniforms={u} />
    </Canvas>
  );
}
`;

const inlineSrc = wrap(
  `      <shaderMaterial name="matA" uniforms={{ uIntensity: { value: 0.6 } }} />\n      <shaderMaterial name="matB" uniforms={{ uIntensity: { value: 0.6 } }} />`,
);

describe('WriteResult affected nodes: shared const binding', () => {
  it('setUniform reports every node sharing the const and edits the declaration once', () => {
    const r = setUniform(sharedConstSrc, { op: 'setUniform', node: 'matA', uniform: 'uIntensity', value: 0.9 });

    expect(r.affectedNodes).toHaveLength(2);
    expect(r.affectedNodes).toEqual(expect.arrayContaining(['matA', 'matB']));
    // id-list aliases carry the same list
    expect(r.affectedNodeIds).toEqual(r.affectedNodes);
    expect(r.sharedNodeIds).toEqual(r.affectedNodes);
    expect(r.isShared).toBe(true);
    expect(r.sharedWith).toEqual(['matB']);
    expect(r.sharedBy).toBe(2);

    expect(r.shared).not.toBeNull();
    expect(r.shared?.via).toBe('const');
    expect(r.shared?.name).toBe('u');
    expect(r.shared?.declStart).toEqual(expect.any(Number));
    expect(r.shared?.nodeIds).toEqual(expect.arrayContaining(['matA', 'matB']));
    expect(r.shared?.targets.map((t) => t.nodeId)).toEqual(expect.arrayContaining(['matA', 'matB']));

    // the value lands on the const exactly once; both JSX references are untouched
    expect(r.source).toContain('const u = { uIntensity: { value: 0.9 }, uTime: { value: 0 } };');
    expect(r.source.match(/value: 0\.9/g)).toHaveLength(1);
    expect(r.source.match(/uniforms=\{u\}/g)).toHaveLength(2);
    // minimal single span: just the number literal
    expect(r.changed).toBe(true);
    expect(r.edit?.removed).toBe('0.6');
  });

  it('reports the same affected list when editing through the second material', () => {
    const r = setUniform(sharedConstSrc, { op: 'setUniform', node: 'matB', uniform: 'uTime', value: 3 });
    expect(r.affectedNodes).toEqual(expect.arrayContaining(['matA', 'matB']));
    expect(r.sharedWith).toEqual(['matA']);
    expect(r.source).toContain('uTime: { value: 3 }');
    expect(r.source).toContain('uIntensity: { value: 0.6 }');
  });

  it('setProp on the shared uniforms binding also exposes both node ids', () => {
    const r = setProp(sharedConstSrc, {
      op: 'setProp',
      node: 'matA',
      prop: 'uniforms',
      value: { uIntensity: { value: 1.5 } },
    });
    expect(r.affectedNodes).toHaveLength(2);
    expect(r.affectedNodes).toEqual(expect.arrayContaining(['matA', 'matB']));
    expect(r.isShared).toBe(true);
    expect(r.source).toContain('const u = { uIntensity: { value: 1.5 } };');
  });

  it('still reports the shared readers for a no-op write', () => {
    const r = setUniform(sharedConstSrc, { op: 'setUniform', node: 'matA', uniform: 'uIntensity', value: 0.6 });
    expect(r.changed).toBe(false);
    expect(r.affectedNodes).toEqual(expect.arrayContaining(['matA', 'matB']));
    expect(r.isShared).toBe(true);
  });
});

describe('WriteResult affected nodes: shared useMemo binding', () => {
  it('reports both materials and writes into the useMemo returned object', () => {
    const r = setUniform(sharedMemoSrc, { op: 'setUniform', node: 'matA', uniform: 'uMix', value: 0.75 });

    expect(r.affectedNodes).toHaveLength(2);
    expect(r.affectedNodes).toEqual(expect.arrayContaining(['matA', 'matB']));
    expect(r.isShared).toBe(true);
    expect(r.shared?.via).toBe('useMemo');
    expect(r.shared?.declStart).toEqual(expect.any(Number));
    expect(r.source).toContain('uMix: { value: 0.75 }');
    expect(r.source).toContain('uTime: { value: 0 }');
    expect(r.source.match(/uniforms=\{u\}/g)).toHaveLength(2);
  });
});

describe('non-shared bindings are unaffected', () => {
  it('inline uniforms on two materials: only the addressed node is affected', () => {
    const r = setUniform(inlineSrc, { op: 'setUniform', node: 'matA', uniform: 'uIntensity', value: 0.9 });

    expect(r.affectedNodes).toEqual(['matA']);
    expect(r.affectedNodeIds).toEqual(['matA']);
    expect(r.sharedWith).toEqual([]);
    expect(r.isShared).toBe(false);
    expect(r.shared).toBeNull();
    expect(r.sharedBinding).toBeNull();

    // matA changed, matB byte-for-byte keeps 0.6
    expect(r.source).toContain('name="matA" uniforms={{ uIntensity: { value: 0.9 } }}');
    expect(r.source).toContain('name="matB" uniforms={{ uIntensity: { value: 0.6 } }}');
  });

  it('two distinct const declarations do not report the other material', () => {
    const src = wrap(
      `      <shaderMaterial name="matA" uniforms={uA} />\n      <shaderMaterial name="matB" uniforms={uB} />`,
      'const uA = { uI: { value: 1 } };\nconst uB = { uI: { value: 2 } };',
    );
    const r = setUniform(src, { op: 'setUniform', node: 'matA', uniform: 'uI', value: 5 });
    expect(r.affectedNodes).toEqual(['matA']);
    expect(r.isShared).toBe(false);
    expect(r.source).toContain('const uA = { uI: { value: 5 } };');
    expect(r.source).toContain('const uB = { uI: { value: 2 } };');
  });
});

describe('applyOps shared-binding grouping', () => {
  it('groups two ops that hit the same declStart and reports the union of affected nodes', () => {
    const out = applyOps(sharedConstSrc, [
      { op: 'setUniform', node: 'matA', uniform: 'uIntensity', value: 1 },
      { op: 'setUniform', node: 'matB', uniform: 'uTime', value: 4 },
    ]);

    expect(out.results).toHaveLength(2);
    expect(out.sharedBindings).toHaveLength(1);
    expect(out.shared).toHaveLength(1);
    const g = out.sharedBindings[0]!;
    expect(g.opIndexes).toEqual([0, 1]);
    expect(g.opIndices).toEqual([0, 1]);
    expect(g.declStart).toEqual(expect.any(Number));
    expect(g.nodeIds).toEqual(expect.arrayContaining(['matA', 'matB']));
    expect(out.repeatedBindings).toHaveLength(1);
    expect(out.affectedNodes).toEqual(expect.arrayContaining(['matA', 'matB']));
    expect(out.source).toContain('uIntensity: { value: 1 }');
    expect(out.source).toContain('uTime: { value: 4 }');
  });

  it('does not merge ops on distinct declarations', () => {
    const src = wrap(
      `      <shaderMaterial name="matA" uniforms={uA} />\n      <shaderMaterial name="matB" uniforms={uB} />`,
      'const uA = { uI: { value: 1 } };\nconst uB = { uI: { value: 2 } };',
    );
    const out = applyOps(src, [
      { op: 'setUniform', node: 'matA', uniform: 'uI', value: 5 },
      { op: 'setUniform', node: 'matB', uniform: 'uI', value: 6 },
    ]);
    expect(out.bindingGroups).toHaveLength(2);
    expect(out.repeatedBindings).toHaveLength(0);
    expect(out.source).toContain('const uA = { uI: { value: 5 } };');
    expect(out.source).toContain('const uB = { uI: { value: 6 } };');
  });
});

describe('applyOps failure / rollback semantics', () => {
  it('a failing later op throws a coded PrismError and the caller source is untouched', () => {
    const original = sharedConstSrc;
    let caught: unknown;
    let returned: unknown;
    try {
      returned = applyOps(original, [
        { op: 'setUniform', node: 'matA', uniform: 'uIntensity', value: 1 },
        { op: 'setUniform', node: 'does-not-exist', uniform: 'uIntensity', value: 2 },
      ]);
    } catch (e) {
      caught = e;
    }
    expect(returned).toBeUndefined();
    expect(caught).toBeInstanceOf(PrismError);
    expect((caught as PrismError).code).toBe('NODE_NOT_FOUND');
    // the caller's string was never mutated and holds the original value
    expect(original).toContain('uIntensity: { value: 0.6 }');
  });

  it('keeps stable codes for baseline refusal paths inside a batch', () => {
    const exprSrc = wrap(`<mesh name="o" position={[0, 0, z]} />`, 'const z = 1;');
    let code: string | undefined;
    try {
      applyOps(exprSrc, [{ op: 'setProp', node: 'o', prop: 'position', value: [1, 1, 1] }]);
    } catch (e) {
      code = e instanceof PrismError ? e.code : 'not-prism';
    }
    expect(code).toBe('OUT_OF_SUBSET');
  });

  it('normalizes a malformed op to a PrismError with a stable code', () => {
    let caught: unknown;
    try {
      // @ts-expect-error deliberate malformed op
      applyOps(sharedConstSrc, [{ op: 'setUniform', node: 'matA' }]);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PrismError);
    expect((caught as PrismError).code).toBe('INVALID_VALUE');
  });
});
