import { instrument } from '@prismbox/core';
import { transform } from 'sucrase';

type Exports = Record<string, unknown>;
export type Builtins = Record<string, unknown>;

const EXTENSIONS = ['', '.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'];

function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

/** Resolve `spec` relative to the file `from` inside a flat path -> source map. */
export function resolveRelative(from: string, spec: string, files: Record<string, string>): string | null {
  const parts = `${dirname(from)}/${spec}`.split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  const base = out.join('/');
  for (const ext of EXTENSIONS) if (Object.prototype.hasOwnProperty.call(files, base + ext)) return base + ext;
  return null;
}

/**
 * Compile one file for the sandbox: instrument() (tags + overlay) then Sucrase strips TypeScript and JSX and
 * turns imports into require() calls. Sucrase does no tagging of its own. Returns CommonJS source.
 */
export function compile(path: string, source: string): string {
  const inst = instrument(source, path);
  return transform(inst?.code ?? source, {
    transforms: ['typescript', 'jsx', 'imports'],
    jsxRuntime: 'automatic',
    production: true,
    filePath: path,
  }).code;
}

/**
 * Evaluate the entry file and everything it imports from the in-memory file map. Bare imports resolve only
 * against `builtins` (react, three, @react-three/fiber, @react-three/drei, the overlay); anything else is an
 * explicit error, never a network fetch.
 */
export function evaluate(files: Record<string, string>, entry: string, builtins: Builtins): Exports {
  const cache = new Map<string, Exports>();

  function load(path: string): Exports {
    const hit = cache.get(path);
    if (hit) return hit;
    const module = { exports: {} as Exports };
    cache.set(path, module.exports);
    const code = compile(path, files[path] as string);
    const require = (spec: string): unknown => {
      if (spec.startsWith('.') || spec.startsWith('/')) {
        const target = resolveRelative(path, spec, files);
        if (!target) throw new Error(`Cannot find "${spec}" imported from ${path}`);
        return load(target);
      }
      if (Object.prototype.hasOwnProperty.call(builtins, spec)) return builtins[spec];
      throw new Error(`UNSUPPORTED_IMPORT: "${spec}" is not available in the Playground. Allowed: ${Object.keys(builtins).filter((k) => k !== 'virtual:prism-overlay').join(', ')} and relative files.`);
    };
    new Function('require', 'module', 'exports', code)(require, module, module.exports);
    cache.set(path, module.exports);
    return module.exports;
  }

  if (!Object.prototype.hasOwnProperty.call(files, entry)) throw new Error(`Entry file "${entry}" is not in the file system`);
  return load(entry);
}
