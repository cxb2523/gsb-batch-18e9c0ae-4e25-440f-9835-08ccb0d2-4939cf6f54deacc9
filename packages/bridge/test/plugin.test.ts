import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { OVERLAY_ID, prismboxPlugin } from '../src/plugin';

const example = fileURLToPath(new URL('../../../examples/vite-hero/', import.meta.url));
const SRC = 'import { Canvas } from "@react-three/fiber";\nexport default () => <Canvas><mesh name="a" /></Canvas>;\n';
const ROOT = path.join(os.tmpdir(), 'proj');

function plugin(command: 'serve' | 'build' = 'serve') {
  const p = prismboxPlugin({ daemonOrigin: 'http://127.0.0.1:4173', overlayPath: fileURLToPath(new URL('../src/plugin.ts', import.meta.url)) });
  p.configResolved({ root: ROOT, command });
  return p;
}

describe('the real-page plugin', () => {
  it('is dev-only and shaped to avoid duplicate instances', () => {
    const p = plugin();
    expect(p).toMatchObject({ name: 'prismbox', apply: 'serve', enforce: 'pre' });
    const cfg = p.config();
    expect(cfg.resolve.dedupe).toEqual(['react', 'react-dom', 'three', '@react-three/fiber']);
    expect(cfg.optimizeDeps.include).toContain('three/examples/jsm/controls/TransformControls.js');
  });

  it('while serving: tags tsx/jsx with project-relative positions and injects the overlay import', () => {
    const r = plugin().transform(SRC, path.join(ROOT, 'src', 'Hero.tsx'));
    expect(r).not.toBeNull();
    expect(r!.code).toContain('userData-prism="src/Hero.tsx:2:');
    expect(r!.code).toContain(`from "${OVERLAY_ID}"`);
    expect(r!.code).toContain('<__PrismOverlay />');
  });

  it('serves the overlay as a virtual module carrying the daemon origin', () => {
    const p = plugin();
    expect(p.resolveId(OVERLAY_ID)).toBe(`\0${OVERLAY_ID}`);
    expect(p.resolveId('react')).toBeNull();
    expect(p.load(`\0${OVERLAY_ID}`)).toContain('__PRISMBOX_DAEMON__ = "http://127.0.0.1:4173"');
    expect(p.load('/x.tsx')).toBeNull();
  });

  it('leaves everything else alone: node_modules, non-JSX files, SSR, files outside the root, unparsable files', () => {
    const p = plugin();
    expect(p.transform(SRC, path.join(ROOT, 'node_modules', 'x', 'a.tsx'))).toBeNull();
    expect(p.transform(SRC, path.join(ROOT, 'src', 'a.ts'))).toBeNull();
    expect(p.transform(SRC, path.join(ROOT, 'src', 'a.tsx'), { ssr: true })).toBeNull();
    expect(p.transform(SRC, path.join(os.tmpdir(), 'elsewhere', 'a.tsx'))).toBeNull();
    expect(p.transform('const = ;', path.join(ROOT, 'src', 'bad.tsx'))).toBeNull();
    expect(p.transform('export const x = 1;', path.join(ROOT, 'src', 'x.tsx'))).toBeNull();
  });

  it('under command=build every hook is inert, even if the plugin is loaded', () => {
    const p = plugin('build');
    expect(p.transform(SRC, path.join(ROOT, 'src', 'Hero.tsx'))).toBeNull();
    expect(p.resolveId(OVERLAY_ID)).toBeNull();
    expect(p.load(`\0${OVERLAY_ID}`)).toBeNull();
  });
});

describe('zero production leakage: vite build of examples/vite-hero with the plugin loaded', () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : [path.join(d, f)]));
  const digest = (dir: string): Record<string, string> =>
    Object.fromEntries(walk(dir).map((f) => [path.relative(dir, f), createHash('sha256').update(readFileSync(f)).digest('hex')]));

  it('emits no Prismbox bytes, and is byte-identical to a build without the plugin', async () => {
    const withDir = mkdtempSync(path.join(os.tmpdir(), 'prism-with-'));
    const withoutDir = mkdtempSync(path.join(os.tmpdir(), 'prism-without-'));
    try {
      const common = { root: example, logLevel: 'silent' as const, build: { chunkSizeWarningLimit: 5000, emptyOutDir: true } };
      await build({ ...common, plugins: [prismboxPlugin({ daemonOrigin: 'http://127.0.0.1:4173' }) as never], build: { ...common.build, outDir: withDir } });
      await build({ ...common, build: { ...common.build, outDir: withoutDir } });
      // (the bare word "prismbox" is not searched here: a non-production NODE_ENV embeds absolute source paths, which contain this repo's folder name. e2e/ searches it on a real production build.)
      const bad = ['__PrismOverlay', 'userData-prism', 'virtual:prism', 'prism-overlay', '__prismDebug', '__PRISMBOX_DAEMON__'];
      let total = 0;
      for (const f of walk(withDir)) {
        const t = readFileSync(f, 'utf8');
        total += t.length;
        for (const s of bad) expect(t.includes(s), `${path.basename(f)} contains "${s}"`).toBe(false);
      }
      expect(total).toBeGreaterThan(100_000);
      expect(digest(withDir)).toEqual(digest(withoutDir));
    } finally {
      rmSync(withDir, { recursive: true, force: true });
      rmSync(withoutDir, { recursive: true, force: true });
    }
  }, 120_000);
});
