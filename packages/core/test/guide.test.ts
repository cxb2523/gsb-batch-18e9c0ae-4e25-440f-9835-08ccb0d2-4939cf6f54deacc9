import { describe, expect, it } from 'vitest';
import { DREI_COMPONENTS, GUIDE, readScene } from '../src/index';

describe('agent guide', () => {
  it('names every known drei component and the key rules', () => {
    for (const name of Object.keys(DREI_COMPONENTS)) expect(GUIDE).toContain(name);
    for (const s of ['@prism uniform', 'useMemo', 'name', 'Lightformer', 'prism_get_selection', 'prism_get_view']) expect(GUIDE).toContain(s);
    expect(GUIDE.length).toBeLessThan(6000);
  });

  it('its own examples are inside the subset it describes', () => {
    const src = `import { Canvas } from "@react-three/fiber";\nimport * as THREE from "three";\nconst vert = /* glsl */ \`void main() {}\`;\nconst frag = /* glsl */ \`// @prism uniform uGlow float 0..2 =1\nvoid main() {}\`;\nconst uniforms = { uGlow: { value: 1 }, uTint: { value: new THREE.Color("#7c5cff") } };\nexport default () => (\n  <Canvas camera={{ position: [0, 0, 6], fov: 40 }}>\n    <mesh name="orb" position={[0, 1, 0]} rotation={[Math.PI / 2, 0, 0]}>\n      <sphereGeometry args={[1, 64, 64]} />\n      <shaderMaterial vertexShader={vert} fragmentShader={frag} uniforms={uniforms} />\n    </mesh>\n  </Canvas>\n);\n`;
    const s = readScene(src);
    expect(s.summary.coverage).toBe(1);
    expect(s.diagnostics.filter((d) => d.severity === 'warn')).toEqual([]);
  });
});
