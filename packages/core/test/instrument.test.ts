import { describe, expect, it } from 'vitest';
import { findNodeByTag, instrument, OVERLAY_SPECIFIER, outline, PrismError, readScene, taggable } from '../src/index';

const FILE = 'src/Hero.tsx';
const SRC = `import { Canvas } from "@react-three/fiber";

export default function Hero() {
  return (
    <Canvas camera={{ position: [0, 0, 5] }}>
      <color attach="background" args={["#000"]} />
      <fog attach="fog" args={["#000", 1, 10]} />
      <ambientLight intensity={0.5} />
      <group name="g">
        <mesh name="orb" position={[0, 0, 0]}>
          <sphereGeometry args={[1, 32, 32]} />
          <meshStandardMaterial color="#fff" />
        </mesh>
        <primitive object={thing} />
      </group>
    </Canvas>
  );
}
const thing = null;
`;

const run = (src = SRC, opts = {}) => instrument(src, FILE, opts);

describe('taggable', () => {
  it('allows Object3D, light, geometry and material elements', () => {
    for (const t of ['mesh', 'group', 'points', 'ambientLight', 'pointLight', 'boxGeometry', 'meshStandardMaterial', 'shaderMaterial', 'perspectiveCamera']) expect(taggable(t)).toBe(true);
  });
  it('skips elements without .userData', () => {
    for (const t of ['color', 'fog', 'fogExp2', 'primitive', 'bufferAttribute', 'vector3', 'euler', 'texture']) expect(taggable(t)).toBe(false);
  });
});

describe('instrument()', () => {
  it('tags taggable host elements with their original file:line:col and never color, fog or primitive', () => {
    const r = run();
    expect(r).not.toBeNull();
    const code = (r as NonNullable<typeof r>).code;
    expect(code).toContain(`<mesh name="orb" position={[0, 0, 0]} userData-prism="${FILE}:10:9">`);
    expect(code).toContain(`<group name="g" userData-prism="${FILE}:9:7">`);
    expect(code).toContain(`<ambientLight intensity={0.5} userData-prism="${FILE}:8:7" />`);
    expect(code).toMatch(/<sphereGeometry args=\{\[1, 32, 32\]\} userData-prism=/);
    expect(code).not.toMatch(/<color [^>]*userData-prism/);
    expect(code).not.toMatch(/<fog [^>]*userData-prism/);
    expect(code).not.toMatch(/<primitive [^>]*userData-prism/);
    expect((r as NonNullable<typeof r>).tagged).toBe(5);
  });

  it('every tag points at the element it was written on (positions refer to the ORIGINAL source)', () => {
    const code = (run() as NonNullable<ReturnType<typeof run>>).code;
    const scene = readScene(SRC, FILE);
    for (const m of code.matchAll(/userData-prism="([^"]+)"/g)) {
      const n = findNodeByTag(scene, m[1] as string);
      expect(n).toBeDefined();
      expect(taggable((n as NonNullable<typeof n>).tag)).toBe(true);
    }
  });

  it('injects the overlay as the last child of the first Canvas and one import', () => {
    const code = (run() as NonNullable<ReturnType<typeof run>>).code;
    expect(code.startsWith(`import { __PrismOverlay } from "${OVERLAY_SPECIFIER}";\n`)).toBe(true);
    expect(code).toMatch(/<\/group>\s*<__PrismOverlay \/><\/Canvas>/);
    expect(code.match(/__PrismOverlay/g)).toHaveLength(2);
  });

  it('expands a self-closing Canvas and honours an aliased Canvas', () => {
    const src = `import { Canvas as C } from "@react-three/fiber";\nexport default () => <C camera={{ fov: 50 }} />;\n`;
    const code = (run(src) as NonNullable<ReturnType<typeof run>>).code;
    expect(code.replace(' ><__Prism', '><__Prism')).toContain('<C camera={{ fov: 50 }}><__PrismOverlay /></C>');
  });

  it('only the first Canvas gets the overlay', () => {
    const src = `import { Canvas } from "@react-three/fiber";\nexport default () => (<><Canvas><mesh /></Canvas><Canvas><mesh /></Canvas></>);\n`;
    const code = (run(src) as NonNullable<ReturnType<typeof run>>).code;
    expect(code.match(/<__PrismOverlay \/>/g)).toHaveLength(1);
  });

  it('puts the import after "use client" and similar directives', () => {
    const src = `'use client';\n"use strict";\nimport { Canvas } from "@react-three/fiber";\nexport default () => <Canvas><mesh /></Canvas>;\n`;
    const code = (run(src) as NonNullable<ReturnType<typeof run>>).code;
    expect(code.startsWith(`'use client';\n"use strict";\nimport { __PrismOverlay }`)).toBe(true);
  });

  it('appends the tag after the last attribute so an existing userData literal is applied first', () => {
    const src = `import { Canvas } from "@react-three/fiber";\nexport default () => <Canvas><mesh userData={{ a: 1 }} name="x" /></Canvas>;\n`;
    const code = (run(src) as NonNullable<ReturnType<typeof run>>).code;
    expect(code).toMatch(/<mesh userData=\{\{ a: 1 \}\} name="x" userData-prism="/);
  });

  it('handles a multi-line element and a spread last attribute', () => {
    const src = `import { Canvas } from "@react-three/fiber";\nexport default (p: object) => (\n  <Canvas>\n    <mesh\n      name="a"\n      {...p}\n    />\n  </Canvas>\n);\n`;
    const code = (run(src) as NonNullable<ReturnType<typeof run>>).code;
    expect(code).toContain('{...p} userData-prism="src/Hero.tsx:4:5"\n    />');
    expect(() => readScene(code)).not.toThrow();
  });

  it('the output still parses and keeps every original node', () => {
    const code = (run() as NonNullable<ReturnType<typeof run>>).code;
    const before = readScene(SRC).nodes.filter((n) => n.kind === 'host').length;
    const after = readScene(code).nodes.filter((n) => n.kind === 'host').length;
    expect(after).toBe(before);
  });

  it('is deterministic, source-mapped, and does not touch the input', () => {
    const a = run() as NonNullable<ReturnType<typeof run>>;
    const b = run() as NonNullable<ReturnType<typeof run>>;
    expect(a.code).toBe(b.code);
    expect(a.map.mappings.length).toBeGreaterThan(0);
    expect(a.map.sources).toEqual([FILE]);
    expect(SRC).not.toContain('userData-prism');
  });

  it('tags without an overlay when there is no Canvas, and returns null when there is nothing to do', () => {
    const noCanvas = run(`export const A = () => <mesh />;\n`) as NonNullable<ReturnType<typeof run>>;
    expect(noCanvas.overlay).toBe(false);
    expect(noCanvas.code).not.toContain('__PrismOverlay');
    expect(run(`export const x = 1;\n`)).toBeNull();
    expect(run(`import { Canvas } from "@react-three/fiber";\nexport default () => <Canvas><color attach="background" /></Canvas>;\n`, { overlay: false })).toBeNull();
  });

  it('is idempotent: an already instrumented file is returned as null', () => {
    const once = (run() as NonNullable<ReturnType<typeof run>>).code;
    expect(run(once)).toBeNull();
  });

  it('supports a custom overlay specifier and can skip the overlay', () => {
    expect((run(SRC, { overlaySpecifier: './overlay' }) as NonNullable<ReturnType<typeof run>>).code).toContain('from "./overlay"');
    expect((run(SRC, { overlay: false }) as NonNullable<ReturnType<typeof run>>).code).not.toContain('__PrismOverlay');
  });

  it('throws PARSE_ERROR on invalid source', () => {
    expect(() => run('const = ;')).toThrow(PrismError);
  });

  it('works for CRLF and BOM files', () => {
    const src = '﻿' + SRC.replace(/\n/g, '\r\n');
    const r = run(src) as NonNullable<ReturnType<typeof run>>;
    expect(r.code.includes(`userData-prism="${FILE}:10:9"`)).toBe(true);
    expect(() => readScene(r.code)).not.toThrow();
  });
});

describe('outline()', () => {
  it('builds a source-ordered tree and classifies edit state', () => {
    const src = `import { Canvas } from "@react-three/fiber";\nexport default () => (\n  <Canvas>\n    <group name="g">\n      <mesh name="a" position={[0, 0, 0]} />\n      <mesh name="b" position={[x, 0, 0]} scale={2} />\n      <mesh name="c" position={[x, 0, 0]} />\n      {[1].map((i) => <mesh key={i} name="m" />)}\n    </group>\n  </Canvas>\n);\nconst x = 1;\n`;
    const o = outline(readScene(src));
    const by = (name: string) => o.find((e) => e.node.name === name);
    expect(o[0]?.node.kind).toBe('canvas');
    expect(by('g')?.depth).toBe(1);
    expect(by('a')?.depth).toBe(2);
    expect(by('a')?.parent).toBe(o.findIndex((e) => e.node.name === 'g'));
    expect(by('a')?.edit).toBe('editable');
    expect(by('b')?.edit).toBe('partial');
    expect(by('c')?.edit).toBe('partial'); // `name` is a literal even though position is not
    expect(by('m')?.edit).toBe('read-only');
  });

  it('counts a shaderMaterial with literal uniform keys as partial', () => {
    const src = `const t = null;\nexport const A = () => <shaderMaterial uniforms={{ uT: { value: t }, uM: { value: 1 } }} />;\n`;
    expect(outline(readScene(src))[0]?.edit).toBe('partial');
  });
});
