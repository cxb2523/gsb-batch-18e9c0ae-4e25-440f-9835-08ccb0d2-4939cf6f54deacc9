import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import MagicString from 'magic-string';
import { describe, expect, it } from 'vitest';
import { applyOps, DREI_COMPONENTS, PrismError, readScene, setProp } from '../src/index';
import type { PropValue, SceneNode, SetPropOp } from '../src/index';

/**
 * Conformance suite over the ten Claude-generated "cinematic 3D hero" files from the Step 0
 * coverage spike (A* with the draft style guide, B* without). They are permanent fixtures:
 * the guarantees below must hold on real agent-written code, not only on hand-made snippets.
 */
const DIR = join(fileURLToPath(new URL('.', import.meta.url)), '../../../fixtures/subset/step0');
const files = readdirSync(DIR).filter((f) => f.endsWith('.tsx')).sort();
const sources = new Map(files.map((f) => [f, readFileSync(join(DIR, f), 'utf8')]));

/** The region of `a` that differs from `b`, as [start, end) in `a` (common prefix and suffix removed). */
function changedRegion(a: string, b: string): [number, number] {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let q = 0;
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
  return [p, a.length - q];
}

let roundTripEdits = 0;
const canonical = (n: number): string => String(Math.round(n * 1000) / 1000);

describe('step0 fixtures', () => {
  it('has the ten files', () => {
    expect(files).toHaveLength(10);
    expect(files.filter((f) => f.startsWith('A'))).toHaveLength(5);
    expect(files.filter((f) => f.startsWith('B'))).toHaveLength(5);
  });

  describe.each(files)('%s', (file) => {
    const src = sources.get(file) as string;

    it('parses', () => {
      expect(() => readScene(src, file)).not.toThrow();
    });

    it('no-op is byte-identical', () => {
      expect(new MagicString(src).toString()).toBe(src);
      expect(applyOps(src, []).source).toBe(src);
    });

    it('round-trips every plain position/rotation/scale literal on a writable node', () => {
      const scene = readScene(src, file);
      for (const node of scene.nodes) {
        if (node.locked || node.ambiguous) continue;
        for (const p of node.props) {
          if (!['position', 'rotation', 'scale'].includes(p.name) || p.kind !== 'literal') continue;
          const v = p.value;
          const plain = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
          const isPlainText = /^\{?\s*\[?\s*[-+]?[\d.]/.test(p.text) && !/Math|\*|\//.test(p.text);
          if (!isPlainText) continue;
          if (!(plain(v) || (Array.isArray(v) && v.every(plain)))) continue;
          const bumped: PropValue = Array.isArray(v) ? v.map((x) => (x as number) + 0.5) : (v as number) + 0.5;
          const first = setProp(src, { op: 'setProp', node: node.pathId, prop: p.name, value: bumped });
          expect(first.changed).toBe(true);
          // exactly one span, inside the attribute value
          const [lo, hi] = changedRegion(src, first.source);
          expect(lo).toBeGreaterThanOrEqual(p.valueStart);
          expect(hi).toBeLessThanOrEqual(p.valueEnd);
          // the result is still a literal on the same node
          const after = readScene(first.source, file).nodes.find((n: SceneNode) => n.pathId === node.pathId);
          expect(after?.props.find((q) => q.name === p.name)?.kind).toBe('literal');
          // restoring the original value restores the original bytes when its text was canonical
          const back = setProp(first.source, { op: 'setProp', node: node.pathId, prop: p.name, value: v as PropValue });
          // "canonical" = every number in the original text is already written the way Prismbox writes it
          const originalCanonical = (p.text.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).every((t) => canonical(Number(t)) === t);
          if (originalCanonical) expect(back.source).toBe(src);
          else expect(changedRegion(src, back.source)[1]).toBeLessThanOrEqual(p.valueEnd);
          roundTripEdits++;
        }
      }
    });

    it('setProp(position) on the first mesh changes exactly one span, or is refused with OUT_OF_SUBSET', () => {
      const scene = readScene(src, file);
      const mesh = scene.nodes.find((n) => n.tag === 'mesh');
      expect(mesh).toBeDefined();
      const m = mesh as SceneNode;
      const pos = m.props.find((p) => p.name === 'position');
      const op: SetPropOp = { op: 'setProp', node: m.pathId, prop: 'position', value: [0.4, 0.1, 0] };
      if (m.locked) {
        expect(() => setProp(src, op)).toThrow(PrismError);
        return;
      }
      if (pos?.kind === 'expression') {
        expect(() => setProp(src, op)).toThrowError(expect.objectContaining({ code: 'OUT_OF_SUBSET' }));
        return;
      }
      const r = setProp(src, op);
      expect(r.changed).toBe(true);
      const [lo, hi] = changedRegion(src, r.source);
      if (pos) {
        expect(lo).toBeGreaterThanOrEqual(pos.valueStart);
        expect(hi).toBeLessThanOrEqual(pos.valueEnd);
      } else {
        // an insertion: a pure addition inside the element's opening tag
        expect(lo).toBe(hi);
        expect(lo).toBeGreaterThan(m.start);
        expect(lo).toBeLessThan(m.end);
      }
      expect(r.source).not.toBe(src);
      expect(() => readScene(r.source, file)).not.toThrow();
    });
  });

  it('exercised the round-trip on a meaningful number of real props', () => {
    expect(roundTripEdits).toBeGreaterThanOrEqual(50);
  });

  describe('coverage by arm', () => {
    const arm = (prefix: string) => {
      const total = { host: 0, editable: 0, strict: 0 };
      for (const f of files.filter((x) => x.startsWith(prefix))) {
        const s = readScene(sources.get(f) as string, f).summary;
        total.host += s.hostNodes;
        total.editable += s.editable;
        total.strict += s.strictEditable;
      }
      return total;
    };

    it('with the style guide: at least the Step 0 result (156 of 160) and above the 90% bar', () => {
      const t = arm('A');
      expect(t.host).toBe(160);
      expect(t.editable).toBeGreaterThanOrEqual(156);
      expect(t.editable / t.host).toBeGreaterThanOrEqual(0.9);
    });

    it('without the style guide: at least the Step 0 result (43 of 60) and above the 70% bar', () => {
      const t = arm('B');
      expect(t.host).toBe(60);
      expect(t.editable).toBeGreaterThanOrEqual(43);
      expect(t.editable / t.host).toBeGreaterThanOrEqual(0.7);
    });
  });

  describe('known drei table', () => {
    it('includes the four components Step 0 found Claude using', () => {
      for (const name of ['Lightformer', 'Stars', 'Sparkles', 'PerspectiveCamera']) {
        expect(DREI_COMPONENTS).toHaveProperty(name);
      }
    });

    it('reports none of them as unknown in the fixtures', () => {
      const four = ['Lightformer', 'Stars', 'Sparkles', 'PerspectiveCamera'];
      for (const f of files) {
        const unknown = readScene(sources.get(f) as string, f)
          .diagnostics.filter((d) => d.code === 'UNKNOWN_DREI_COMPONENT')
          .map((d) => d.message);
        for (const name of four) expect(unknown.some((m) => m.includes(`"${name}"`))).toBe(false);
      }
    });
  });

  describe('shader bindings', () => {
    it('every shaderMaterial prop that points at a same-file literal is resolved, never silently dropped', () => {
      let shaderNodes = 0;
      for (const f of files) {
        for (const n of readScene(sources.get(f) as string, f).nodes.filter((x) => x.tag === 'shaderMaterial')) {
          shaderNodes++;
          for (const name of ['vertexShader', 'fragmentShader', 'uniforms']) {
            const p = n.props.find((x) => x.name === name);
            if (!p) continue;
            expect(['literal', 'resolved', 'expression']).toContain(p.kind);
            if (p.kind === 'resolved') expect(p.resolved?.sharedBy).toBeGreaterThanOrEqual(1);
          }
        }
      }
      expect(shaderNodes).toBeGreaterThan(0);
    });
  });
});
