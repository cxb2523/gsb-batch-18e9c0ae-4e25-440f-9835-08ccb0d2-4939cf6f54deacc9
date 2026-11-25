import { readScene } from '@prismbox/core';
import { describe, expect, it } from 'vitest';
import { buildInspector, rangeFor, toDisplay, vec3Commit } from '../src/inspector-model';
import type { Field } from '../src/inspector-model';
import { parseFromSandbox, parseToSandbox } from '../src/protocol';

const wrap = (body: string, head = ''): string =>
  `import { Canvas } from "@react-three/fiber";\n${head}\nexport default function Hero() {\n  return (\n    <Canvas>\n${body}\n    </Canvas>\n  );\n}\n`;
const node = (src: string, name: string) => readScene(src).nodes.find((n) => n.name === name || n.tag === name)!;
const find = (sections: ReturnType<typeof buildInspector>, id: string): Field | undefined => sections.flatMap((s) => s.fields).find((f) => f.id === id);

describe('inspector model', () => {
  it('shows transform fields for a mesh, with defaults dimmed when a prop is absent', () => {
    const s = buildInspector(node(wrap(`<mesh name="a" position={[1, 2, 3]} />`), 'a'));
    expect(s[0]?.title).toBe('Transform');
    expect(find(s, 'prop:position')).toMatchObject({ type: 'vec3', state: 'set', value: [1, 2, 3] });
    expect(find(s, 'prop:rotation')).toMatchObject({ state: 'absent', value: [0, 0, 0], unit: 'deg' });
    expect(find(s, 'prop:scale')).toMatchObject({ state: 'absent', value: [1, 1, 1] });
  });

  it('locks an expression transform with its reason and source text', () => {
    const s = buildInspector(node(wrap(`<mesh name="a" position={[x, 0, 0]} />`, 'const x = 1;'), 'a'));
    expect(find(s, 'prop:position')).toMatchObject({ state: 'locked', text: '[x, 0, 0]' });
  });

  it('turns a scalar scale into a vec3 and lights only get a position', () => {
    expect(find(buildInspector(node(wrap(`<mesh name="a" scale={2} />`), 'a')), 'prop:scale')).toMatchObject({ value: [2, 2, 2] });
    const light = buildInspector(node(wrap(`<pointLight position={[0, 1, 0]} intensity={2} />`), 'pointLight'));
    expect(light[0]?.fields.map((f) => f.id)).toEqual(['prop:position']);
    expect(find(light, 'prop:intensity')).toMatchObject({ type: 'number', min: 0 });
  });

  it('builds number, bool and color controls for material props', () => {
    const s = buildInspector(node(wrap(`<meshStandardMaterial roughness={0.4} wireframe color="#ff00aa" transparent={false} />`), 'meshStandardMaterial'));
    expect(find(s, 'prop:roughness')).toMatchObject({ type: 'number', min: 0, max: 1, value: 0.4 });
    expect(find(s, 'prop:wireframe')).toMatchObject({ type: 'bool', value: true });
    expect(find(s, 'prop:color')).toMatchObject({ type: 'color', value: '#ff00aa' });
    expect(s.find((x) => x.title === 'Material')).toBeDefined();
  });

  it('builds geometry args fields, locked when args is an expression', () => {
    expect(find(buildInspector(node(wrap(`<sphereGeometry args={[1, 32, 32]} />`), 'sphereGeometry')), 'prop:args')).toMatchObject({ type: 'vec', value: [1, 32, 32] });
    expect(find(buildInspector(node(wrap(`<sphereGeometry args={[r, 32, 32]} />`, 'const r = 1;'), 'sphereGeometry')), 'prop:args')).toMatchObject({ state: 'locked' });
  });

  it('builds uniform controls from @prism annotations and keeps non-literal keys locked', () => {
    const head = `const frag = /* glsl */ \`\n// @prism uniform uMix float 0..2 =1\n// @prism uniform uTint color =#112233\nvoid main() {}\n\`;\nconst tex = null;\nconst u = { uMix: { value: 1 }, uTint: { value: new THREE.Color("#112233") }, uPos: { value: [1, 2] }, uTex: { value: tex } };`;
    const s = buildInspector(node(wrap(`<shaderMaterial name="m" fragmentShader={frag} uniforms={u} />`, head), 'm'));
    expect(find(s, 'uniform:uMix')).toMatchObject({ type: 'number', min: 0, max: 2, value: 1 });
    expect(find(s, 'uniform:uTint')).toMatchObject({ type: 'color', value: '#112233' });
    expect(find(s, 'uniform:uPos')).toMatchObject({ type: 'vec', value: [1, 2] });
    expect(find(s, 'uniform:uTex')).toMatchObject({ state: 'locked' });
  });

  it('rotation is shown in degrees and written in radians', () => {
    const s = buildInspector(node(wrap(`<mesh name="a" rotation={[0, Math.PI / 2, 0]} />`), 'a'));
    const rot = find(s, 'prop:rotation') as Extract<Field, { type: 'vec3' }>;
    expect(toDisplay(rot, rot.value[1] as number)).toBe(90);
    expect(vec3Commit(rot, 2, 180)).toEqual([0, Math.PI / 2, Math.PI]);
  });

  it('picks sensible slider ranges', () => {
    expect(rangeFor('roughness', 0.3)).toMatchObject({ min: 0, max: 1 });
    expect(rangeFor('whatever', 4)).toMatchObject({ min: 0, max: 8 });
    expect(rangeFor('whatever', -2)).toMatchObject({ min: -4, max: 4 });
    expect(rangeFor('x', 1, { min: 1, max: 2 })).toMatchObject({ min: 1, max: 2 });
  });
});

describe('sandbox protocol (the sandbox is untrusted)', () => {
  it('accepts well-formed messages and drops everything else', () => {
    expect(parseFromSandbox({ type: 'ready' })).toEqual({ type: 'ready' });
    expect(parseFromSandbox({ type: 'pick', tag: 'Hero.tsx:5:3' })).toEqual({ type: 'pick', tag: 'Hero.tsx:5:3' });
    expect(parseFromSandbox({ type: 'pick', tag: null })).toEqual({ type: 'pick', tag: null });
    expect(parseFromSandbox({ type: 'pick', tag: 'x'.repeat(400) })).toBeNull();
    expect(parseFromSandbox({ type: 'transform', tag: 't', changes: { position: { from: [0, 0, 0], to: [1, 0, 0] } } })).toMatchObject({ type: 'transform' });
    expect(parseFromSandbox({ type: 'transform', tag: 't', changes: { position: { from: [0, 0], to: [1, 0, 0] } } })).toBeNull();
    expect(parseFromSandbox({ type: 'transform', tag: 't', changes: { position: { from: [0, 0, 0], to: [1, 0, Number.NaN] } } })).toBeNull();
    expect(parseFromSandbox({ type: 'transform', tag: 't', changes: {} })).toBeNull();
    expect(parseFromSandbox({ type: 'transform', tag: 't', changes: { evil: { from: [0, 0, 0], to: [1, 1, 1] } } })).toBeNull();
    expect(parseFromSandbox({ type: 'write', path: '/etc/passwd' })).toBeNull();
    expect(parseFromSandbox('ready')).toBeNull();
    expect(parseFromSandbox(null)).toBeNull();
    expect(parseFromSandbox({ type: 'error', message: 'x'.repeat(5000) })).toMatchObject({ message: 'x'.repeat(2000) });
    expect(parseFromSandbox({ type: 'key', key: 'z', mod: true, shift: false })).toMatchObject({ type: 'key' });
    expect(parseFromSandbox({ type: 'key', key: 'x'.repeat(50), mod: true, shift: false })).toBeNull();
  });

  it('validates Studio-to-sandbox messages too', () => {
    expect(parseToSandbox({ type: 'load', files: { 'Hero.tsx': 'x' }, entry: 'Hero.tsx', selected: null })).toMatchObject({ type: 'load' });
    expect(parseToSandbox({ type: 'load', files: { 'Hero.tsx': 5 }, entry: 'Hero.tsx' })).toBeNull();
    expect(parseToSandbox({ type: 'view', mode: 'sideways' })).toBeNull();
    expect(parseToSandbox({ type: 'gizmo', mode: 'rotate' })).toEqual({ type: 'gizmo', mode: 'rotate' });
    expect(parseToSandbox({ type: 'live', tag: 't', prop: 'roughness', value: 0.5 })).toMatchObject({ uniform: false });
  });
});
