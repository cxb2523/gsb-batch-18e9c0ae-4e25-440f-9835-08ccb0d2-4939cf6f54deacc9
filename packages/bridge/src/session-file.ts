import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** What `prismbox` publishes so `prismbox mcp` can find the daemon for a project. Lives OUTSIDE the project. */
export interface SessionDescriptor {
  port: number;
  /** The Studio session token: write authority. Never sent to a web page. */
  token: string;
  pid: number;
  root: string;
  startedAt: string;
  version: string;
}

/** `$PRISMBOX_HOME`, else `~/.prismbox`. */
export function prismHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.PRISMBOX_HOME && env.PRISMBOX_HOME.length > 0 ? path.resolve(env.PRISMBOX_HOME) : path.join(os.homedir(), '.prismbox');
}

export function rootHash(root: string): string {
  const norm = path.resolve(root);
  return createHash('sha256').update(process.platform === 'win32' ? norm.toLowerCase() : norm).digest('hex').slice(0, 32);
}

export const sessionsDir = (home: string): string => path.join(home, 'sessions');
export const sessionPath = (home: string, root: string): string => path.join(sessionsDir(home), `${rootHash(root)}.json`);

export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'; // exists but not ours
  }
}

export function writeSession(home: string, d: SessionDescriptor): string {
  const dir = sessionsDir(home);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = sessionPath(home, d.root);
  writeFileSync(file, JSON.stringify(d, null, 2), { mode: 0o600 });
  if (process.platform !== 'win32') chmodSync(file, 0o600);
  return file;
}

export function removeSession(home: string, root: string, onlyPid?: number): void {
  const file = sessionPath(home, root);
  try {
    if (onlyPid !== undefined) {
      const cur = JSON.parse(readFileSync(file, 'utf8')) as SessionDescriptor;
      if (cur.pid !== onlyPid) return; // a newer daemon owns this file now
    }
    rmSync(file, { force: true });
  } catch {
    /* already gone */
  }
}

/** The live session for a project, or null. A descriptor whose process is dead is deleted on the way. */
export function readSession(home: string, root: string): SessionDescriptor | null {
  const file = sessionPath(home, root);
  let d: SessionDescriptor;
  try {
    d = JSON.parse(readFileSync(file, 'utf8')) as SessionDescriptor;
  } catch {
    return null;
  }
  if (typeof d.port !== 'number' || typeof d.token !== 'string' || typeof d.pid !== 'number') return null;
  if (!pidAlive(d.pid)) {
    rmSync(file, { force: true });
    return null;
  }
  return d;
}

/** Delete every descriptor in the registry whose process is gone. Returns how many were removed. */
export function pruneSessions(home: string): number {
  let removed = 0;
  let names: string[];
  try {
    names = readdirSync(sessionsDir(home));
  } catch {
    return 0;
  }
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    const f = path.join(sessionsDir(home), n);
    try {
      const d = JSON.parse(readFileSync(f, 'utf8')) as SessionDescriptor;
      if (!pidAlive(d.pid)) {
        rmSync(f, { force: true });
        removed++;
      }
    } catch {
      rmSync(f, { force: true });
      removed++;
    }
  }
  return removed;
}
