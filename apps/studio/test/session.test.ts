import { describe, expect, it } from 'vitest';
import { loadSaved, MemoryFs, save } from '../src/fs';
import type { StorageLike } from '../src/fs';
import { applyEdit, createSession, diffParts, redo, reset, undo } from '../src/session';

const SRC = `import { Canvas } from "@react-three/fiber";
const u = { uA: { value: 0.5 }, uTex: { value: tex } };
const tex = null;
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

describe('session', () => {
  it('applies an edit as a one-line patch and records it', () => {
    const s = applyEdit(createSession('t', SRC), { kind: 'prop', node: 'orb', prop: 'position', value: [1, 2, 3] }, 1000);
    expect(s.source).toBe(SRC.replace('[0, 0, 0]', '[1, 2, 3]'));
    expect(s.log).toHaveLength(1);
    expect(s.log[0]).toMatchObject({ line: 7, summary: 'position', author: 'you', kind: 'edit', at: 1000 });
    expect(s.log[0]?.before).toContain('position={[0, 0, 0]}');
    expect(s.log[0]?.after).toContain('position={[1, 2, 3]}');
  });

  it('edits a literal uniform key next to a non-literal one', () => {
    const s = applyEdit(createSession('t', SRC), { kind: 'uniform', node: 'mat', uniform: 'uA', value: 0.9 });
    expect(s.source).toContain('uA: { value: 0.9 }');
    expect(s.log[0]?.summary).toBe('uniform uA');
    expect(s.error).toBeNull();
  });

  it('records a refusal without touching the source', () => {
    const s = applyEdit(createSession('t', SRC), { kind: 'uniform', node: 'mat', uniform: 'uTex', value: 1 });
    expect(s.source).toBe(SRC);
    expect(s.log).toHaveLength(0);
    expect(s.error).toMatch(/OUT_OF_SUBSET/);
    expect(applyEdit(s, { kind: 'prop', node: 'orb', prop: 'scale', value: 2 }).error).toBeNull();
  });

  it('a write that changes nothing is not logged', () => {
    const s = applyEdit(createSession('t', SRC), { kind: 'prop', node: 'orb', prop: 'position', value: [0, 0, 0] });
    expect(s.log).toHaveLength(0);
    expect(s.undoStack).toHaveLength(0);
  });

  it('undo and redo restore the exact bytes, and a new edit clears redo', () => {
    let s = createSession('t', SRC);
    s = applyEdit(s, { kind: 'prop', node: 'orb', prop: 'position', value: [1, 1, 1] });
    s = applyEdit(s, { kind: 'prop', node: 'orb', prop: 'scale', value: 2 });
    const edited = s.source;
    s = undo(s);
    s = undo(s);
    expect(s.source).toBe(SRC);
    s = redo(s);
    expect(s.source).toContain('[1, 1, 1]');
    s = redo(s);
    expect(s.source).toBe(edited);
    s = undo(s);
    s = applyEdit(s, { kind: 'prop', node: 'orb', prop: 'scale', value: 3 });
    expect(s.redoStack).toHaveLength(0);
    expect(s.log.map((e) => e.kind)).toEqual(['edit', 'undo', 'redo', 'redo', 'undo', 'undo', 'edit', 'edit']);
  });

  it('undo with nothing to undo is a no-op', () => {
    const s = createSession('t', SRC);
    expect(undo(s)).toBe(s);
    expect(redo(s)).toBe(s);
  });

  it('reset returns to the template and can be undone', () => {
    let s = createSession('t', SRC);
    s = applyEdit(s, { kind: 'prop', node: 'orb', prop: 'position', value: [9, 9, 9] });
    const edited = s.source;
    s = reset(s);
    expect(s.source).toBe(SRC);
    expect(s.log[0]?.kind).toBe('reset');
    expect(undo(s).source).toBe(edited);
  });

  it('starts from a saved source when there is one', () => {
    const s = createSession('t', SRC, SRC.replace('0.5', '0.7'));
    expect(s.source).toContain('0.7');
    expect(s.original).toBe(SRC);
  });
});

describe('diffParts', () => {
  it('isolates the changed span so the strip can highlight it', () => {
    expect(diffParts('  <mesh position={[0, 0, 0]}>', '  <mesh position={[1, 0, 0]}>')).toEqual({ prefix: '  <mesh position={[', removed: '0', inserted: '1', suffix: ', 0, 0]}>' });
    expect(diffParts('a', 'a')).toEqual({ prefix: 'a', removed: '', inserted: '', suffix: '' });
    expect(diffParts('x={1}', 'x={1} y={2}')).toMatchObject({ removed: '', inserted: ' y={2}' });
  });
});

describe('memory fs and persistence', () => {
  const store = (): StorageLike & { map: Map<string, string> } => {
    const map = new Map<string, string>();
    return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
  };

  it('reads, writes, lists and snapshots', () => {
    const fs = new MemoryFs({ 'Hero.tsx': 'a' });
    fs.write('b.tsx', 'b');
    expect(fs.read('Hero.tsx')).toBe('a');
    expect(fs.list()).toEqual(['Hero.tsx', 'b.tsx']);
    expect(fs.snapshot()).toEqual({ 'Hero.tsx': 'a', 'b.tsx': 'b' });
    expect(fs.read('missing')).toBeUndefined();
  });

  it('saves edits, drops the entry when back to the template, and survives a broken storage', () => {
    const s = store();
    save(s, 'x', 'edited', 'orig');
    expect(loadSaved(s, 'x')).toBe('edited');
    save(s, 'x', 'orig', 'orig');
    expect(loadSaved(s, 'x')).toBeNull();
    const broken: StorageLike = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('denied'); } };
    expect(() => save(broken, 'x', 'a', 'b')).not.toThrow();
    expect(loadSaved(broken, 'x')).toBeNull();
    expect(loadSaved(null, 'x')).toBeNull();
  });
});
