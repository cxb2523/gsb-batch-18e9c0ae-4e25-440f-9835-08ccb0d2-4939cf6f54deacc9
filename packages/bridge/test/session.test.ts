import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pidAlive, pruneSessions, prismHome, readSession, removeSession, rootHash, sessionPath, writeSession } from '../src/session-file';
import type { SessionDescriptor } from '../src/session-file';

const dirs: string[] = [];
const tmp = (p: string) => {
  const d = mkdtempSync(path.join(os.tmpdir(), p));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const desc = (root: string, pid = process.pid): SessionDescriptor => ({ port: 4173, token: 't0k', pid, root, startedAt: new Date().toISOString(), version: '0.0.1' });

describe('session registry', () => {
  it('lives under PRISMBOX_HOME (or ~/.prismbox), keyed by a hash of the project root', () => {
    expect(prismHome({ PRISMBOX_HOME: '/x/y' } as NodeJS.ProcessEnv)).toBe(path.resolve('/x/y'));
    expect(prismHome({} as NodeJS.ProcessEnv)).toBe(path.join(os.homedir(), '.prismbox'));
    expect(rootHash('/a/b')).toMatch(/^[0-9a-f]{32}$/);
    expect(rootHash('/a/b')).not.toBe(rootHash('/a/c'));
    expect(rootHash('/a/b/../b')).toBe(rootHash('/a/b'));
  });

  it('writes the descriptor outside the project, readable back, with mode 0600 on POSIX', () => {
    const home = tmp('prism-home-');
    const root = tmp('prism-proj-');
    const file = writeSession(home, desc(root));
    expect(file.startsWith(path.join(home, 'sessions'))).toBe(true);
    expect(file.startsWith(root)).toBe(false);
    expect(readSession(home, root)).toMatchObject({ port: 4173, token: 't0k', pid: process.pid, root });
    expect(readdirSync(root)).toEqual([]); // zero files in the project
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('prunes a descriptor whose process is dead, on read and in bulk', () => {
    const home = tmp('prism-home-');
    const root = tmp('prism-proj-');
    const root2 = tmp('prism-proj-');
    writeSession(home, desc(root, 2147483000)); // no such pid
    writeSession(home, desc(root2, process.pid));
    expect(pidAlive(2147483000)).toBe(false);
    expect(pruneSessions(home)).toBe(1);
    expect(existsSync(sessionPath(home, root))).toBe(false);
    expect(existsSync(sessionPath(home, root2))).toBe(true);
    writeSession(home, desc(root, 2147483000));
    expect(readSession(home, root)).toBeNull();
    expect(existsSync(sessionPath(home, root))).toBe(false);
  });

  it('ignores corrupt descriptors, and removeSession only removes its own', () => {
    const home = tmp('prism-home-');
    const root = tmp('prism-proj-');
    writeSession(home, desc(root));
    writeFileSync(sessionPath(home, root), '{ not json');
    expect(readSession(home, root)).toBeNull();
    writeSession(home, desc(root, process.pid));
    removeSession(home, root, process.pid + 1); // someone else's pid: leave it
    expect(existsSync(sessionPath(home, root))).toBe(true);
    removeSession(home, root, process.pid);
    expect(existsSync(sessionPath(home, root))).toBe(false);
  });
});
