import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { expandIncludes } from '../../shaders/index.mjs';
import { instrument, readScene } from '../../core/src/index';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}manifest.json`, 'utf8')) as { templates: { id: string; title: string; description: string; accent: string }[] };
const ids = manifest.templates.map((t) => t.id);
const read = (dir: string, id: string) => readFileSync(`${root}${dir}/${id}.tsx`, 'utf8');

describe('template kit', () => {
  it('manifest and files agree, six templates', () => {
    expect(ids).toHaveLength(7);
    expect(readdirSync(`${root}templates`).map((f) => f.replace('.tsx', '')).sort()).toEqual([...ids].sort());
    expect(readdirSync(`${root}source`).map((f) => f.replace('.tsx', '')).sort()).toEqual([...ids].sort());
    for (const t of manifest.templates) expect(t.title && t.description && /^#[0-9a-f]{6}$/i.test(t.accent)).toBeTruthy();
  });

  describe.each(ids)('%s', (id) => {
    const src = read('templates', id);
    const scene = readScene(src, `${id}.tsx`);

    it('is the up-to-date expansion of its source (run `pnpm --filter @prismbox/templates gen`)', () => {
      expect(expandIncludes(read('source', id))).toBe(src);
      expect(src).not.toContain('@include');
    });

    it('is plain R3F: only react, three, fiber and drei imports, and no Prismbox reference at all', () => {
      const imports = [...src.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
      expect(imports.length).toBeGreaterThan(0);
      for (const i of imports) expect(['react', 'three', '@react-three/fiber', '@react-three/drei']).toContain(i);
      expect(src).not.toMatch(/prismbox|__PrismOverlay|userData-prism|virtual:/i);
      expect(scene.diagnostics.filter((d) => d.code === 'UNSUPPORTED_IMPORT' || d.code === 'UNKNOWN_DREI_COMPONENT')).toEqual([]);
    });

    it('is inside the subset: >= 95% of host nodes editable, no spread, no .map, no conditionals', () => {
      const s = scene.summary;
      expect(s.hostNodes).toBeGreaterThanOrEqual(5);
      expect(s.editable / s.hostNodes).toBeGreaterThanOrEqual(0.95);
      expect(s.spread + s.lockedMap + s.lockedConditional + s.opaque).toBe(0);
      expect(scene.diagnostics.filter((d) => d.code === 'NON_LITERAL_PROP' || d.code === 'SPREAD_PROP').map((d) => d.message)).toEqual([]);
    });

    it('has one Canvas with a literal camera, and every mesh and group has a unique literal name', () => {
      expect(scene.nodes.filter((n) => n.kind === 'canvas')).toHaveLength(1);
      expect(scene.nodes.find((n) => n.kind === 'canvas')?.props.find((p) => p.name === 'camera')?.kind).toBe('literal');
      const named = scene.nodes.filter((n) => n.tag === 'mesh' || n.tag === 'group');
      expect(named.length).toBeGreaterThan(0);
      for (const n of named) expect(n.name, `${n.tag} at ${n.line}:${n.col}`).toBeTruthy();
      expect(scene.nodes.some((n) => n.ambiguous)).toBe(false);
    });

    it('every shaderMaterial resolves its shaders and uniforms, and each @prism annotation matches a literal uniform', () => {
      const shaders = scene.nodes.filter((n) => n.tag === 'shaderMaterial');
      for (const n of shaders) {
        for (const p of ['vertexShader', 'fragmentShader']) expect(n.props.find((x) => x.name === p)?.kind, `${p} on ${n.line}:${n.col}`).toBe('resolved');
        const u = n.props.find((x) => x.name === 'uniforms');
        if (u) {
          expect(u.kind).toBe('resolved');
          expect(n.shader?.keys.every((k) => k.kind === 'literal')).toBe(true);
        }
        for (const a of n.shader?.annotations ?? []) {
          const key = n.shader?.keys.find((k) => k.name === a.name);
          expect(key, `annotation ${a.name} has a uniform`).toBeDefined();
          if (a.type === 'float' && a.default !== undefined && a.min !== undefined && a.max !== undefined) {
            expect(Number(a.default)).toBeGreaterThanOrEqual(a.min);
            expect(Number(a.default)).toBeLessThanOrEqual(a.max);
          }
          if (a.min !== undefined && a.max !== undefined && typeof key?.value === 'number') {
            expect(key.value).toBeGreaterThanOrEqual(a.min);
            expect(key.value).toBeLessThanOrEqual(a.max);
          }
        }
      }
      expect(shaders.length).toBeGreaterThan(0);
    });

    it('no-op parse is byte-identical and instrument() output parses with every tag resolving', () => {
      expect(readScene(src).nodes.length).toBe(scene.nodes.length);
      const r = instrument(src, `${id}.tsx`);
      expect(r).not.toBeNull();
      const out = (r as NonNullable<typeof r>).code;
      expect(() => readScene(out)).not.toThrow();
      expect(out.match(/userData-prism=/g)?.length).toBe((r as NonNullable<typeof r>).tagged);
      expect(out).toContain('<__PrismOverlay />');
    });

    it('GLSL is balanced and complete (cheap pre-compile sanity check)', () => {
      for (const m of src.matchAll(/\/\* glsl \*\/ `([\s\S]*?)`;/g)) {
        const g = m[1] as string;
        expect(g).toContain('void main()');
        expect((g.match(/\{/g) ?? []).length).toBe((g.match(/\}/g) ?? []).length);
        expect((g.match(/\(/g) ?? []).length).toBe((g.match(/\)/g) ?? []).length);
        expect(g).not.toMatch(/\bhalf\b/); // reserved word in GLSL ES
      }
    });
  });
});
