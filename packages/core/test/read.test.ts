import { describe, expect, it } from 'vitest';
import { parsePrismAnnotations, PrismError, readScene } from '../src/index';

const wrap = (body: string, head = ''): string =>
  `import { Canvas } from "@react-three/fiber";\n${head}\nexport default function Hero() {\n  return (\n    <Canvas camera={{ position: [0, 0, 5] }}>\n${body}\n    </Canvas>\n  );\n}\n`;

const find = (src: string, tag: string) => readScene(src).nodes.find((n) => n.tag === tag);

describe('literal classification', () => {
  it('treats numbers, angles, strings, booleans, arrays, objects and as const as literals', () => {
    const s = readScene(
      wrap(`<mesh name="a" position={[0, -1.5, +2]} rotation={[Math.PI / 2, -Math.PI, 2 * Math.PI]} scale={1.2} visible castShadow={false} userData={{ k: "v" }} />`),
    );
    const n = s.nodes.find((x) => x.name === 'a');
    expect(n?.status).toBe('editable');
    expect(n?.props.every((p) => p.kind === 'literal')).toBe(true);
    expect(n?.props.find((p) => p.name === 'rotation')?.value).toEqual([Math.PI / 2, -Math.PI, 2 * Math.PI]);
    expect(n?.props.find((p) => p.name === 'visible')?.value).toBe(true);
  });

  it('treats `as const` and `satisfies` as transparent', () => {
    const n = find(wrap(`<mesh position={[1, 2, 3] as const} scale={2 satisfies number} />`), 'mesh');
    expect(n?.status).toBe('editable');
  });

  it('accepts new THREE.Color(...) and THREE enums for side/blending only', () => {
    const src = wrap(`<meshStandardMaterial color={new THREE.Color("#fff")} side={THREE.DoubleSide} />`, 'import * as THREE from "three";');
    expect(find(src, 'meshStandardMaterial')?.status).toBe('editable');
    const bad = wrap(`<meshStandardMaterial roughness={THREE.DoubleSide} />`, 'import * as THREE from "three";');
    expect(find(bad, 'meshStandardMaterial')?.status).toBe('read-only');
  });

  it('classifies expressions as read-only for that prop only', () => {
    const s = readScene(wrap(`<mesh name="a" position={[x, 0, 0]} scale={2} />`, 'const x = 1;'));
    const n = s.nodes.find((q) => q.name === 'a');
    expect(n?.status).toBe('read-only');
    expect(n?.locked).toBeNull();
    expect(n?.props.find((p) => p.name === 'position')?.kind).toBe('expression');
    expect(n?.props.find((p) => p.name === 'scale')?.kind).toBe('literal');
    expect(s.diagnostics.some((d) => d.code === 'NON_LITERAL_PROP')).toBe(true);
  });

  it('ignores ref, key and handlers when judging a node, but strict coverage notices them', () => {
    const s = readScene(wrap(`<mesh ref={r} onClick={go} position={[0, 0, 0]} />`, 'const r = null; const go = () => {};'));
    expect(s.summary.editable).toBe(1);
    expect(s.summary.strictEditable).toBe(0);
  });
});

describe('locking', () => {
  it('locks nodes inside .map() as instances', () => {
    const n = find(wrap(`{[1, 2].map((i) => <mesh key={i} position={[i, 0, 0]} />)}`), 'mesh');
    expect(n?.status).toBe('instance');
    expect(n?.locked).toBe('map');
  });

  it('locks nodes inside conditionals', () => {
    const n = find(wrap(`{ok && <mesh position={[0, 0, 0]} />}`, 'const ok = true;'), 'mesh');
    expect(n?.status).toBe('read-only');
    expect(n?.locked).toBe('conditional');
  });

  it('locks nodes with a spread prop', () => {
    const n = find(wrap(`<mesh {...rest} position={[0, 0, 0]} />`, 'const rest = {};'), 'mesh');
    expect(n?.locked).toBe('spread');
  });

  it('marks bufferGeometry and primitive as opaque', () => {
    const s = readScene(wrap(`<points><bufferGeometry /></points><primitive object={m} />`, 'const m = null;'));
    expect(s.nodes.filter((n) => n.status === 'opaque').map((n) => n.tag).sort()).toEqual(['bufferGeometry', 'primitive']);
    expect(s.summary.opaque).toBe(2);
  });
});

describe('node ids', () => {
  it('uses a unique name literal as the id and a component-qualified path otherwise', () => {
    const s = readScene(wrap(`<group><mesh name="orb" /><mesh /></group>`));
    expect(s.nodes.find((n) => n.name === 'orb')?.id).toBe('orb');
    expect(s.nodes.find((n) => n.tag === 'group')?.pathId).toBe('Hero:Canvas>group[0]');
    expect(s.nodes.filter((n) => n.tag === 'mesh').map((n) => n.pathId)).toEqual(['Hero:Canvas>group[0]>mesh[0]', 'Hero:Canvas>group[0]>mesh[1]']);
  });

  it('flags a duplicated name as ambiguous and falls back to path ids', () => {
    const s = readScene(wrap(`<mesh name="a" /><mesh name="a" />`));
    expect(s.nodes.filter((n) => n.tag === 'mesh').every((n) => n.ambiguous)).toBe(true);
    expect(s.diagnostics.filter((d) => d.code === 'AMBIGUOUS_NODE')).toHaveLength(2);
  });

  it('keeps roots of different components apart', () => {
    const src = `function A() { return <group />; }\nfunction B() { return <group />; }\n`;
    const ids = readScene(src).nodes.map((n) => n.pathId);
    expect(ids).toEqual(['A:group', 'B:group']);
  });
});

describe('same-file shader bindings', () => {
  const GLSL = '/* glsl */ `\n// @prism uniform uIntensity float 0..1 =0.6\n// @prism uniform uColorA color =#7c5cff\nvoid main() { gl_FragColor = vec4(1.0); }\n`';

  it('resolves a top-level const for vertexShader, fragmentShader and uniforms', () => {
    const src = wrap(
      `<mesh><shaderMaterial name="m" vertexShader={vert} fragmentShader={frag} uniforms={uniforms} /></mesh>`,
      `const vert = ${GLSL};\nconst frag = ${GLSL};\nconst uniforms = { uIntensity: { value: 0.6 }, uTime: { value: 0 } };`,
    );
    const n = find(src, 'shaderMaterial');
    expect(n?.status).toBe('editable');
    expect(n?.props.filter((p) => p.name !== 'name').map((p) => p.kind)).toEqual(['resolved', 'resolved', 'resolved']);
    expect(n?.shader?.uniforms).toEqual(['uIntensity', 'uTime']);
    expect(n?.shader?.annotations.map((a) => a.name)).toContain('uColorA');
  });

  it('resolves a useMemo with empty deps inside the component', () => {
    const src = `import { Canvas } from "@react-three/fiber";\nimport { useMemo } from "react";\nexport default function H() {\n  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);\n  return <Canvas><shaderMaterial uniforms={uniforms} /></Canvas>;\n}\n`;
    const p = find(src, 'shaderMaterial')?.props.find((x) => x.name === 'uniforms');
    expect(p?.kind).toBe('resolved');
    expect(p?.resolved?.via).toBe('useMemo');
  });

  it('resolves a useMemo with a block body that returns an object literal', () => {
    const src = `import { Canvas } from "@react-three/fiber";\nimport { useMemo } from "react";\nexport default function H() {\n  const uniforms = useMemo(() => {\n    return { uTime: { value: 0 } };\n  }, []);\n  return <Canvas><shaderMaterial uniforms={uniforms} /></Canvas>;\n}\n`;
    expect(find(src, 'shaderMaterial')?.props.find((x) => x.name === 'uniforms')?.kind).toBe('resolved');
  });

  it('refuses useMemo with dependencies, a non-literal body, or a let/param binding', () => {
    const mk = (decl: string) => `import { Canvas } from "@react-three/fiber";\nimport { useMemo } from "react";\nexport default function H({ p }: { p: number }) {\n  ${decl}\n  return <Canvas><shaderMaterial uniforms={u} /></Canvas>;\n}\n`;
    const kind = (src: string) => find(src, 'shaderMaterial')?.props.find((x) => x.name === 'uniforms')?.kind;
    expect(kind(mk('const u = useMemo(() => ({ uT: { value: p } }), []);'))).toBe('expression');
    expect(kind(mk('const u = useMemo(() => ({ uT: { value: 0 } }), [p]);'))).toBe('expression');
    expect(kind(mk('let u = { uT: { value: 0 } };'))).toBe('expression');
    expect(kind(mk('const u = { uT: { value: p } };'))).toBe('expression');
  });

  it('does not resolve a parameter that shadows a top-level const', () => {
    const src = `import { Canvas } from "@react-three/fiber";\nconst u = { uT: { value: 0 } };\nexport default function H({ u }: { u: object }) {\n  return <Canvas><shaderMaterial uniforms={u} /></Canvas>;\n}\n`;
    expect(find(src, 'shaderMaterial')?.props.find((x) => x.name === 'uniforms')?.kind).toBe('expression');
  });

  it('resolves only shaderMaterial shader props, not arbitrary props on other nodes', () => {
    const src = wrap(`<mesh position={p} />`, 'const p = [0, 0, 0] as const;');
    expect(find(src, 'mesh')?.props.find((x) => x.name === 'position')?.kind).toBe('expression');
  });

  it('reports how many props share one binding', () => {
    const src = wrap(`<shaderMaterial uniforms={u} /><shaderMaterial uniforms={u} />`, 'const u = { uT: { value: 0 } };');
    const shared = readScene(src).nodes.flatMap((n) => n.props).filter((p) => p.kind === 'resolved').map((p) => p.resolved?.sharedBy);
    expect(shared).toEqual([2, 2]);
  });
});

describe('per-key uniforms', () => {
  it('classifies each uniforms key and keeps the node read-only with a clear reason', () => {
    const src = wrap('<shaderMaterial name="m" uniforms={{ uTex: { value: tex }, uMix: { value: 0.5 }, uBare: tex }} />', 'const tex = null;');
    const n = find(src, 'shaderMaterial');
    const keys = n?.shader?.keys.map((k) => [k.name, k.kind, k.value]);
    expect(keys).toEqual([['uTex', 'expression', undefined], ['uMix', 'literal', 0.5], ['uBare', 'expression', undefined]]);
    expect(n?.status).toBe('read-only');
    expect(n?.reasons.join(' ')).toContain('literal keys stay editable');
    expect(n?.props.find((p) => p.name === 'uniforms')?.category).toBe('object-partial');
  });

  it('exposes keys for fully literal and same-file uniforms too', () => {
    const lit = find(wrap('<shaderMaterial uniforms={u} />', 'const u = { a: { value: [1, 2] }, c: { value: new THREE.Color("#abc") } };'), 'shaderMaterial');
    expect(lit?.shader?.keys.map((k) => [k.name, k.value])).toEqual([['a', [1, 2]], ['c', '#abc']]);
  });
});

describe('@prism annotations', () => {
  it('parses float ranges, defaults and colors', () => {
    const a = parsePrismAnnotations('// @prism uniform uIntensity float 0..1 =0.6\n// @prism uniform uColorA color =#7c5cff\n// @prism uniform uN int -2..8\n// not an annotation\n// @prism uniform broken');
    expect(a).toEqual([
      { name: 'uIntensity', type: 'float', min: 0, max: 1, default: '0.6' },
      { name: 'uColorA', type: 'color', default: '#7c5cff' },
      { name: 'uN', type: 'int', min: -2, max: 8 },
    ]);
  });
});

describe('diagnostics and summary', () => {
  it('flags imports outside the allowed set and unknown drei components', () => {
    const src = `import { Canvas } from "@react-three/fiber";\nimport { Html, Stars } from "@react-three/drei";\nimport leva from "leva";\nimport x from "./local";\nexport default () => <Canvas />;\n`;
    const d = readScene(src).diagnostics;
    expect(d.some((x) => x.code === 'UNSUPPORTED_IMPORT' && x.message.includes('"leva"'))).toBe(true);
    expect(d.some((x) => x.code === 'UNKNOWN_DREI_COMPONENT' && x.message.includes('"Html"'))).toBe(true);
    expect(d.some((x) => x.message.includes('"Stars"'))).toBe(false);
    expect(d.some((x) => x.message.includes('"./local"'))).toBe(false);
  });

  it('recognizes aliased Canvas and known drei components as nodes, and reports a second Canvas', () => {
    const src = `import { Canvas as C } from "@react-three/fiber";\nimport { Stars as S } from "@react-three/drei";\nexport default () => (<><C><S radius={50} /></C><C /></>);\n`;
    const s = readScene(src);
    expect(s.nodes.filter((n) => n.kind === 'canvas')).toHaveLength(2);
    expect(s.nodes.find((n) => n.kind === 'drei')?.props[0]?.value).toBe(50);
    expect(s.diagnostics.some((d) => d.code === 'MULTIPLE_CANVAS')).toBe(true);
  });

  it('does not count DOM tags, Canvas or custom components as host nodes', () => {
    const s = readScene(wrap(`<mesh />`, '').replace('<Canvas', '<div><Canvas').replace('</Canvas>', '</Canvas></div>'));
    expect(s.summary.hostNodes).toBe(1);
  });

  it('computes coverage as editable over host nodes', () => {
    const s = readScene(wrap(`<mesh position={[0, 0, 0]} /><mesh position={p} />`, 'const p = [1, 1, 1];'));
    expect(s.summary.hostNodes).toBe(2);
    expect(s.summary.editable).toBe(1);
    expect(s.summary.coverage).toBe(0.5);
  });

  it('throws PARSE_ERROR on invalid source', () => {
    expect(() => readScene('const = ;')).toThrowError(expect.objectContaining({ code: 'PARSE_ERROR' }));
    expect(() => readScene('const = ;')).toThrow(PrismError);
  });

  it('handles a BOM and CRLF without shifting offsets', () => {
    const src = '﻿' + wrap(`<mesh name="a" position={[1, 2, 3]} />`).replace(/\n/g, '\r\n');
    const n = readScene(src).nodes.find((x) => x.name === 'a');
    const p = n?.props.find((x) => x.name === 'position');
    expect(src.slice(p?.valueStart, p?.valueEnd)).toBe('{[1, 2, 3]}');
  });
});
