import { instrument } from '@prismbox/core';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Structural subset of Vite's Plugin type, so this package does not depend on the user's Vite version. */
export interface PrismVitePlugin {
  name: string;
  enforce: 'pre';
  apply: 'serve';
  config(): { resolve: { dedupe: string[] }; optimizeDeps: { include: string[] } };
  configResolved(cfg: { root: string; command: string }): void;
  resolveId(id: string): string | null;
  load(id: string): string | null;
  transform(code: string, id: string, options?: { ssr?: boolean }): { code: string; map: unknown } | null;
}

export const OVERLAY_ID = 'virtual:prism-overlay';
const RESOLVED = `\0${OVERLAY_ID}`;

export interface PluginOptions {
  /** Origin of the daemon, for example `http://127.0.0.1:4173`. */
  daemonOrigin: string;
  /** Path to the built overlay module (default: next to this file, or ../dist in a source checkout). */
  overlayPath?: string;
}

function findOverlay(explicit?: string): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const p of [explicit, path.join(here, 'overlay.js'), path.join(here, '..', 'dist', 'overlay.js')]) if (p && existsSync(p)) return p;
  throw new Error('prismbox: the overlay bundle (dist/overlay.js) is missing. Run `pnpm build`.');
}

/**
 * The real-page plugin. It is only ever loaded by `prismbox dev` (never from the user's config), and it is inert unless
 * Vite is serving: `apply: 'serve'`, and every hook checks `command` again so a stray `vite build` produces no Prismbox bytes.
 */
export function prismboxPlugin(options: PluginOptions): PrismVitePlugin {
  let root = process.cwd();
  let command = 'serve';
  let overlaySource: string | null = null;
  return {
    name: 'prismbox',
    enforce: 'pre',
    apply: 'serve',
    config() {
      return {
        // the overlay's imports must resolve to the USER's copies, never a second instance
        resolve: { dedupe: ['react', 'react-dom', 'three', '@react-three/fiber'] },
        optimizeDeps: { include: ['three/examples/jsm/controls/TransformControls.js', 'three/examples/jsm/controls/OrbitControls.js'] },
      };
    },
    configResolved(cfg) {
      root = cfg.root;
      command = cfg.command;
    },
    resolveId(id) {
      return command === 'serve' && id === OVERLAY_ID ? RESOLVED : null;
    },
    load(id) {
      if (command !== 'serve' || id !== RESOLVED) return null;
      overlaySource ??= readFileSync(findOverlay(options.overlayPath), 'utf8');
      return `globalThis.__PRISMBOX_DAEMON__ = ${JSON.stringify(options.daemonOrigin)};\n${overlaySource}`;
    },
    transform(code, id, opts) {
      if (command !== 'serve' || opts?.ssr) return null;
      const clean = id.split('?')[0] as string;
      if (!/\.(tsx|jsx)$/.test(clean) || clean.includes('/node_modules/') || clean.includes('\\node_modules\\') || clean.startsWith('\0')) return null;
      const rel = path.relative(root, clean).split(path.sep).join('/');
      if (rel.startsWith('..')) return null;
      try {
        const r = instrument(code, rel);
        return r ? { code: r.code, map: r.map } : null;
      } catch {
        return null; // not parseable: leave it to Vite to report the error
      }
    },
  };
}
