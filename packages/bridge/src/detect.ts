import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type * as ViteModule from 'vite';

/**
 * Non-blocking compatibility notes. `three` older than r156 is below @react-three/fiber 9's peer range, so scenes may
 * misbehave in ways unrelated to Prismbox; say so up front instead of leaving the user to debug it.
 */
export function compatWarnings(versions: { three: string | null }): string[] {
  const out: string[] = [];
  const m = /^(\d+)\.(\d+)/.exec(versions.three ?? '');
  if (m && Number(m[1]) === 0 && Number(m[2]) < 156) {
    out.push(`three ${versions.three} is older than r156, the minimum @react-three/fiber 9 supports. Prismbox will run, but upgrade three if the scene misbehaves.`);
  }
  return out;
}

export interface Project {
  root: string;
  viteConfig: string | null;
  versions: { vite: string; react: string; three: string | null; fiber: string };
}

export class DetectError extends Error {
  constructor(
    readonly code: 'NOT_A_PROJECT' | 'NOT_VITE' | 'NO_R3F' | 'UNSUPPORTED_VERSION' | 'NOT_INSTALLED',
    message: string,
  ) {
    super(message);
    this.name = 'DetectError';
  }
}

const CONFIGS = ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs', 'vite.config.cts'];

const major = (v: string): number => Number.parseInt(v.replace(/^[^\d]*/, ''), 10);

function installedVersion(req: NodeRequire, name: string): string | null {
  const read = (p: string): string | null => {
    try {
      return (JSON.parse(readFileSync(p, 'utf8')) as { version: string }).version;
    } catch {
      return null;
    }
  };
  try {
    return read(req.resolve(`${name}/package.json`));
  } catch {
    /* the package does not export ./package.json: walk up from its entry point */
  }
  try {
    let dir = path.dirname(req.resolve(name));
    for (let i = 0; i < 6; i++, dir = path.dirname(dir)) {
      const v = existsSync(path.join(dir, 'package.json')) ? read(path.join(dir, 'package.json')) : null;
      const n = v && (JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as { name?: string }).name;
      if (v && n === name) return v;
    }
  } catch {
    /* not installed */
  }
  return null;
}

/** Recognise a Vite + React 19 + R3F 9 project. Reads only; never modifies anything in the project. */
export function detect(rootArg: string): Project {
  const root = path.resolve(rootArg);
  const pkgPath = path.join(root, 'package.json');
  if (!existsSync(pkgPath)) throw new DetectError('NOT_A_PROJECT', `No package.json in ${root}. Run prismbox from your project folder, or pass --root <dir>.`);
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!deps.vite) throw new DetectError('NOT_VITE', 'This does not look like a Vite project (no "vite" in package.json). Prismbox supports Vite projects for now.');
  if (!deps['@react-three/fiber']) throw new DetectError('NO_R3F', 'No "@react-three/fiber" in package.json. Prismbox edits React Three Fiber scenes.');
  const req = createRequire(pkgPath);
  const vite = installedVersion(req, 'vite');
  const react = installedVersion(req, 'react');
  const fiber = installedVersion(req, '@react-three/fiber');
  const three = installedVersion(req, 'three');
  if (!vite || !react || !fiber) throw new DetectError('NOT_INSTALLED', 'Dependencies are not installed. Run your package manager\'s install first.');
  if (major(react) < 19) throw new DetectError('UNSUPPORTED_VERSION', `React ${react} is installed but Prismbox needs React 19 or newer.`);
  if (major(fiber) < 9) throw new DetectError('UNSUPPORTED_VERSION', `@react-three/fiber ${fiber} is installed but Prismbox needs 9 or newer.`);
  if (major(vite) < 5) throw new DetectError('UNSUPPORTED_VERSION', `Vite ${vite} is installed but Prismbox needs Vite 5 or newer.`);
  const viteConfig = CONFIGS.map((c) => path.join(root, c)).find((p) => existsSync(p)) ?? null;
  return { root, viteConfig, versions: { vite, react, three, fiber } };
}

/** Load the USER's installed Vite (never a bundled one), so their config and plugins run against their own version. */
export async function loadUserVite(root: string): Promise<typeof ViteModule> {
  const req = createRequire(path.join(root, 'package.json'));
  const pkgJson = req.resolve('vite/package.json');
  const pkg = JSON.parse(readFileSync(pkgJson, 'utf8')) as { exports?: Record<string, unknown>; module?: string; main?: string };
  const dir = path.dirname(pkgJson);
  const pick = (v: unknown): string | null => {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      return pick(o.import) ?? pick(o.default) ?? null;
    }
    return null;
  };
  const rel = pick(pkg.exports?.['.']) ?? pkg.module ?? pkg.main ?? 'index.js';
  return (await import(pathToFileURL(path.join(dir, rel)).href)) as typeof ViteModule;
}
