import { chmodSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DaemonError, Project } from '../src/daemon/project';
import { fixture, HERO, read, tmpLeft } from './helpers';
import type { Fixture } from './helpers';

let fx: Fixture | null = null;
afterEach(() => {
  fx?.cleanup();
  fx = null;
});
const setProp = (node: string, prop: string, value: unknown) => ({ op: 'setProp' as const, node, prop, value: value as never });

describe('atomic write-back and byte-exact undo', () => {
  it.each([
    ['LF', HERO],
    ['CRLF', HERO.replace(/\n/g, '\r\n')],
    ['BOM + CRLF', '﻿' + HERO.replace(/\n/g, '\r\n')],
    ['no trailing newline', HERO.trimEnd()],
  ])('%s: undo restores the exact original bytes, redo the exact edited bytes', async (_n, src) => {
    fx = fixture(src);
    const p = new Project(fx.root);
    const original = read(fx.abs);
    const e = await p.edit(fx.file, [setProp('knot', 'position', [1, 2, 3])], { author: 'you', summary: 'position' });
    expect(e.changed).toBe(true);
    const edited = read(fx.abs);
    expect(edited.equals(original)).toBe(false);
    expect(e.file.hash).toBeTruthy();
    const u = await p.undo();
    expect(read(fx.abs).equals(original)).toBe(true);
    expect(u.diff?.kind).toBe('undo');
    await p.redo();
    expect(read(fx.abs).equals(edited)).toBe(true);
    await p.undo();
    expect(read(fx.abs).equals(original)).toBe(true);
  });

  it('writes exactly one span and leaves no temp file', async () => {
    fx = fixture();
    const p = new Project(fx.root);
    await p.edit(fx.file, [setProp('knot', 'position', [0.4, 0.1, 0])], { author: 'page', summary: 'position' });
    const a = HERO.split('\n');
    const b = read(fx.abs).toString().split('\n');
    expect(b.length).toBe(a.length);
    expect(b.filter((l, i) => l !== a[i])).toHaveLength(1);
    expect(tmpLeft(path.dirname(fx.abs))).toEqual([]);
  });

  it('refuses to undo when the file changed outside Prismbox, and keeps the external change', async () => {
    fx = fixture();
    const p = new Project(fx.root);
    await p.edit(fx.file, [setProp('knot', 'scale', 2)], { author: 'you', summary: 'scale' });
    const external = read(fx.abs).toString().replace('torusKnotGeometry', 'torusKnotGeometry /*claude*/');
    writeFileSync(fx.abs, external);
    expect((await p.undoState()).canUndo).toBe(false);
    await expect(p.undo()).rejects.toMatchObject({ code: 'UNDO_CONFLICT' });
    expect(read(fx.abs).toString()).toBe(external);
    expect((await p.undoState()).undoDepth).toBe(1); // still there, just not safe right now
  });

  it('a new edit clears the redo stack; a no-op edit writes and records nothing', async () => {
    fx = fixture();
    const p = new Project(fx.root);
    await p.edit(fx.file, [setProp('knot', 'scale', 2)], { author: 'you', summary: 's' });
    await p.undo();
    expect((await p.undoState()).redoDepth).toBe(1);
    const same = await p.edit(fx.file, [setProp('knot', 'scale', 1)], { author: 'you', summary: 's' });
    expect(same.changed).toBe(false);
    expect((await p.undoState()).redoDepth).toBe(1);
    await p.edit(fx.file, [setProp('knot', 'scale', 5)], { author: 'you', summary: 's' });
    expect((await p.undoState()).redoDepth).toBe(0);
  });

  it('a conflict on baseHash carries the current file so the caller can resync', async () => {
    fx = fixture();
    const p = new Project(fx.root);
    const cur = await p.read(fx.file);
    writeFileSync(fx.abs, HERO + '\n// edited elsewhere\n');
    const err = await p.edit(fx.file, [setProp('knot', 'scale', 2)], { baseHash: cur.hash, author: 'you', summary: 's' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DaemonError);
    expect((err as DaemonError).code).toBe('CONFLICT');
    expect((err as DaemonError).file?.source).toContain('edited elsewhere');
  });

  it('keeps core error codes (read-only prop, ambiguous node) and writes nothing', async () => {
    fx = fixture(HERO.replace('<group name="rig"', '<group name="knot"'));
    const p = new Project(fx.root);
    const before = read(fx.abs);
    await expect(p.edit(fx.file, [setProp('knot', 'scale', 2)], { author: 'you', summary: 's' })).rejects.toMatchObject({ code: 'AMBIGUOUS_NODE' });
    await expect(p.edit(fx.file, [setProp('film', 'ref', 1)], { author: 'you', summary: 's' })).rejects.toMatchObject({ code: 'READ_ONLY_PROP' });
    expect(read(fx.abs).equals(before)).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('preserves the file mode', async () => {
    fx = fixture();
    chmodSync(fx.abs, 0o640);
    const p = new Project(fx.root);
    await p.edit(fx.file, [setProp('knot', 'scale', 2)], { author: 'you', summary: 's' });
    expect(statSync(fx.abs).mode & 0o777).toBe(0o640);
  });

  it('refuses a file that is not valid UTF-8 instead of corrupting it', async () => {
    fx = fixture();
    writeFileSync(fx.abs, Buffer.concat([Buffer.from('export const x = "'), Buffer.from([0xff, 0xfe]), Buffer.from('";')]));
    await expect(new Project(fx.root).read(fx.file)).rejects.toMatchObject({ code: 'NOT_UTF8' });
  });

  it.skipIf(process.platform === 'win32')('refuses a symlink that escapes the root', async () => {
    fx = fixture();
    const outside = fixture('export const a = 1;', 'x.tsx');
    try {
      symlinkSync(outside.abs, path.join(fx.root, 'src', 'link.tsx'));
      await expect(new Project(fx.root).read('src/link.tsx')).rejects.toMatchObject({ code: 'PATH_OUTSIDE_ROOT' });
    } finally {
      outside.cleanup();
    }
  });

  it('lists R3F scene files and skips node_modules, dist and dotfolders', async () => {
    fx = fixture();
    writeFileSync(path.join(fx.root, 'src', 'Plain.tsx'), 'export const A = () => <div />;');
    const p = new Project(fx.root);
    expect(await p.listScenes()).toEqual(['src/Hero3D.tsx']);
  });
});
