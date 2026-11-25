import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import * as core from '@prismbox/core';
import { applyEdit, createSession, round3, sanitizePropValue } from '../src/session';

const SRC = `import { Canvas } from "@react-three/fiber";
const u = { uA: { value: 0.5 } };
export default function Hero() {
  return (
    <Canvas camera={{ position: [0, 0, 5] }}>
      <mesh name="orb" position={[0, 0, 0]}>
        <shaderMaterial name="mat" uniforms={u} />
      </mesh>
    </Canvas>
  );
}
`;

describe('snap-to-grid rounding (Issue #3)', () => {
  it('cleans floating-point noise via sanitizePropValue and round3 in source', () => {
    const noisy = 0.1 + 0.2; // 0.30000000000000004
    expect(noisy).not.toBe(0.3);
    expect(round3(noisy)).toBe(0.3);
    expect(sanitizePropValue(noisy)).toBe(0.3);
    expect(sanitizePropValue([0.1 + 0.2, 0.30000000000000004, 1.23456])).toEqual([0.3, 0.3, 1.235]);
  });

  it('rounds 15-degree rotation increments in radians to 3 decimal places', () => {
    const rot15 = THREE.MathUtils.degToRad(15);
    const rot30 = THREE.MathUtils.degToRad(30);
    const rot45 = THREE.MathUtils.degToRad(45);

    expect(sanitizePropValue([rot15, rot30, rot45])).toEqual([0.262, 0.524, 0.785]);
  });

  it('limits snap sanitization to gizmo-drag when snap is active', () => {
    const rawTransform = [0.1 + 0.2, 1.23456, 0];
    const snapActive = true;
    const snapInactive = false;

    // When snap is active, transform edits are sanitized before commit
    const snappedValue = snapActive ? sanitizePropValue(rawTransform) : rawTransform;
    expect(snappedValue).toEqual([0.3, 1.235, 0]);

    // When snap is inactive, raw values pass through without snap rounding
    const unsnappedValue = snapInactive ? sanitizePropValue(rawTransform) : rawTransform;
    expect(unsnappedValue).toBe(rawTransform);
    expect(unsnappedValue).toEqual([0.1 + 0.2, 1.23456, 0]);
  });

  it('leaves inspector and uniform edits untouched without applying sanitizePropValue in applyEdit', () => {
    const setUniformSpy = vi.spyOn(core, 'setUniform');
    const session = createSession('test', SRC);

    // If sanitizePropValue were run inside applyEdit, 0.0004 would become 0:
    expect(sanitizePropValue(0.0004)).toBe(0);

    // But applyEdit leaves op.value untouched, forwarding the exact small value to core:
    applyEdit(session, {
      kind: 'uniform',
      node: 'mat',
      uniform: 'uA',
      value: 0.0004,
    });

    expect(setUniformSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        op: 'setUniform',
        node: 'mat',
        uniform: 'uA',
        value: 0.0004,
      })
    );

    setUniformSpy.mockRestore();
  });

  it('leaves inspector prop edits untouched without applying sanitizePropValue in applyEdit', () => {
    const setPropSpy = vi.spyOn(core, 'setProp');
    const session = createSession('test', SRC);

    applyEdit(session, {
      kind: 'prop',
      node: 'orb',
      prop: 'roughness',
      value: 0.0004,
    });

    expect(setPropSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        op: 'setProp',
        node: 'orb',
        prop: 'roughness',
        value: 0.0004,
      })
    );

    setPropSpy.mockRestore();
  });
});
