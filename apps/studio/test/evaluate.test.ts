import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { compile, evaluate, resolveRelative } from '../src/sandbox/evaluate';

const templates = fileURLToPath(new URL('../../../packages/templates/templates/', import.meta.url));
const ids = readdirSync(templates).filter((f) => f.endsWith('.tsx')).map((f) => f.replace('.tsx', ''));

// R3F, drei and the overlay need a browser; the sandbox shell passes the real ones.
const stubs = {
  react: React,
  'react/jsx-runtime': jsxRuntime,
  three: THREE,
  '@react-three/fiber': { Canvas: () => null, useFrame: () => undefined },
  '@react-three/drei': { Stars: () => null },
  'virtual:prism-overlay': { __PrismOverlay: () => null },
};

describe('sandbox compile + evaluate', () => {
  it.each(ids)('%s: instrument() then Sucrase compiles, evaluates and exports a component', (id) => {
    const src = readFileSync(`${templates}${id}.tsx`, 'utf8');
    const js = compile('Hero.tsx', src);
    expect(js).toContain('userData-prism');
    expect(js).toContain('__PrismOverlay');
    expect(js).not.toMatch(/\bimport\b\s+[\w{*]/); // module syntax is gone (CommonJS)
    const mod = evaluate({ 'Hero.tsx': src }, 'Hero.tsx', stubs);
    expect(typeof mod.default).toBe('function');
  });

  it('keeps tag positions pointing at the ORIGINAL source (Sucrase runs after instrument())', () => {
    const src = readFileSync(`${templates}glass-card.tsx`, 'utf8');
    const tags = [...compile('Hero.tsx', src).matchAll(/"userData-prism":\s*"([^"]+)"|userData-prism["']?:?\s*"?(Hero\.tsx:\d+:\d+)/g)];
    expect(tags.length).toBeGreaterThan(5);
    const lines = src.split('\n');
    for (const m of tags) {
      const [, line, col] = /Hero\.tsx:(\d+):(\d+)/.exec(m[0]) as RegExpExecArray;
      expect(lines[Number(line) - 1]?.slice(Number(col) - 1)).toMatch(/^<[a-z]/);
    }
  });

  it('resolves relative imports inside the in-memory file system', () => {
    const files = {
      'Hero.tsx': 'import { x } from "./lib/x"; export default function Hero() { return x; }',
      'lib/x.ts': 'export const x = 42;',
    };
    expect(evaluate(files, 'Hero.tsx', stubs).default).toBeTypeOf('function');
    expect(resolveRelative('Hero.tsx', './lib/x', files)).toBe('lib/x.ts');
    expect(resolveRelative('lib/x.ts', '../Hero', files)).toBe('Hero.tsx');
    expect(resolveRelative('Hero.tsx', './nope', files)).toBeNull();
  });

  it('handles a circular import without recursing forever', () => {
    const files = {
      'a.ts': 'import { b } from "./b"; export const a = 1; export default function A() { return b; }',
      'b.ts': 'import { a } from "./a"; export const b = 2; export const readA = () => a;',
    };
    expect(() => evaluate(files, 'a.ts', stubs)).not.toThrow();
  });

  it('refuses imports outside the allowed set instead of fetching anything', () => {
    expect(() => evaluate({ 'Hero.tsx': 'import x from "leva"; export default x;' }, 'Hero.tsx', stubs)).toThrow(/UNSUPPORTED_IMPORT.*leva/);
    expect(() => evaluate({ 'Hero.tsx': 'import x from "./missing"; export default x;' }, 'Hero.tsx', stubs)).toThrow(/Cannot find/);
    expect(() => evaluate({}, 'Hero.tsx', stubs)).toThrow(/not in the file system/);
  });
});
