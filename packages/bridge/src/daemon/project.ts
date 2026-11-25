import { applyOps } from '@prismbox/core';
import type { Op } from '@prismbox/core';
import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DiffAuthor, DiffWire, ErrorCode, FileSnap, UndoState } from '../protocol';

export class DaemonError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly file?: FileSnap,
  ) {
    super(message);
    this.name = 'DaemonError';
  }
}

export const hashBytes = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex').slice(0, 32);

const ALLOWED_EXT = new Set(['.tsx', '.ts', '.jsx', '.js']);
export const TMP_PREFIX = '.prismbox-tmp-';
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage']);

interface UndoEntry {
  file: string;
  beforeText: string;
  afterText: string;
  beforeHash: string;
  afterHash: string;
}

export interface ProjectOptions {
  /** Test hook: runs after the file is read for the commit check and before it is re-hashed (the race window). */
  beforeCommit?: (abs: string) => void | Promise<void>;
  now?: () => number;
}

export interface EditResult {
  changed: boolean;
  file: FileSnap;
  diff: DiffWire | null;
}

function firstDiff(a: string, b: string): { line: number; before: string; after: string } | null {
  if (a === b) return null;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const line = a.slice(0, i).split('\n').length;
  return { line, before: (a.split('\n')[line - 1] ?? '').replace(/\r$/, ''), after: (b.split('\n')[line - 1] ?? '').replace(/\r$/, '') };
}

/**
 * Everything that touches the user's files: confinement, fresh reads, compare-and-set, atomic writes and the
 * undo/redo stacks. Nothing else in the daemon writes to disk.
 */
export class Project {
  readonly root: string;
  private realRoot: string | null = null;
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private nextDiffId = 1;
  /** Hashes of contents this process wrote, so the watcher can tell its own writes from external ones. */
  readonly selfWrites = new Set<string>();

  constructor(
    root: string,
    private readonly opts: ProjectOptions = {},
  ) {
    this.root = path.resolve(root);
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  private async getRealRoot(): Promise<string> {
    this.realRoot ??= await fs.realpath(this.root);
    return this.realRoot;
  }

  /** Validate a project-relative path. It must stay inside the root, avoid dotfiles and node_modules, and be a source file. */
  async resolve(rel: string): Promise<{ rel: string; abs: string }> {
    if (typeof rel !== 'string' || rel.length === 0 || rel.length > 500 || rel.includes('\0')) throw new DaemonError('PATH_OUTSIDE_ROOT', 'Invalid path.');
    const posix = rel.replace(/\\/g, '/');
    if (posix.startsWith('/') || /^[A-Za-z]:/.test(posix)) throw new DaemonError('PATH_OUTSIDE_ROOT', `"${rel}" is not a project-relative path.`);
    const norm = path.posix.normalize(posix);
    const parts = norm.split('/');
    if (norm.startsWith('..') || parts.includes('..')) throw new DaemonError('PATH_OUTSIDE_ROOT', `"${rel}" leaves the project root.`);
    if (parts.some((p) => p.startsWith('.') || p === 'node_modules')) throw new DaemonError('PATH_OUTSIDE_ROOT', `"${rel}" is in a dot-directory or node_modules, which Prismbox never reads or writes.`);
    if (!ALLOWED_EXT.has(path.posix.extname(norm))) throw new DaemonError('BAD_EXTENSION', `"${rel}" is not a .tsx, .ts, .jsx or .js file.`);
    const abs = path.join(this.root, ...parts);
    let real: string;
    try {
      real = await fs.realpath(abs);
    } catch {
      throw new DaemonError('FILE_NOT_FOUND', `"${rel}" does not exist.`);
    }
    const realRoot = await this.getRealRoot();
    const within = path.relative(realRoot, real);
    if (within.startsWith('..') || path.isAbsolute(within)) throw new DaemonError('PATH_OUTSIDE_ROOT', `"${rel}" resolves outside the project root.`);
    return { rel: norm, abs: real };
  }

  /** A fresh read from disk (never a cache). */
  async read(rel: string): Promise<FileSnap> {
    const { rel: r, abs } = await this.resolve(rel);
    const buf = await fs.readFile(abs);
    const source = buf.toString('utf8');
    if (!Buffer.from(source, 'utf8').equals(buf)) throw new DaemonError('NOT_UTF8', `"${rel}" is not valid UTF-8, so it is left untouched.`);
    return { path: r, source, hash: hashBytes(buf) };
  }

  /** Every .tsx/.jsx file under the root that looks like R3F, project-relative. */
  async listScenes(): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string, rel: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(path.join(dir, e.name), childRel);
        else if (/\.(tsx|jsx)$/.test(e.name)) {
          try {
            const text = await fs.readFile(path.join(dir, e.name), 'utf8');
            if (/@react-three\/fiber|<(mesh|group|[a-z]+Light)\b/.test(text)) out.push(childRel);
          } catch {
            /* unreadable: skip */
          }
        }
        if (out.length > 2000) return;
      }
    };
    await walk(this.root, '');
    return out.sort();
  }

  /**
   * Atomic write with compare-and-set. The temp file lives next to the target; the target is re-hashed immediately
   * before the rename and the write is refused if it changed. A tiny window between that check and the rename
   * remains (no OS offers an atomic compare-and-rename), so the watcher also reports anything that slips through.
   */
  private async atomicWrite(abs: string, expectedHash: string, text: string): Promise<void> {
    const dir = path.dirname(abs);
    const tmp = path.join(dir, `${TMP_PREFIX}${process.pid}-${randomBytes(4).toString('hex')}`);
    let mode: number | undefined;
    try {
      mode = (await fs.stat(abs)).mode & 0o777;
    } catch {
      mode = undefined;
    }
    await fs.writeFile(tmp, text, { mode: mode ?? 0o644 });
    try {
      if (mode !== undefined && process.platform !== 'win32') await fs.chmod(tmp, mode);
      for (let attempt = 0; ; attempt++) {
        await this.opts.beforeCommit?.(abs);
        const cur = await fs.readFile(abs);
        if (hashBytes(cur) !== expectedHash) throw new DaemonError('CONFLICT', 'The file changed on disk while the edit was being written, so nothing was written.');
        try {
          this.selfWrites.add(hashBytes(Buffer.from(text, 'utf8')));
          await fs.rename(tmp, abs);
          return;
        } catch (e) {
          const code = (e as NodeJS.ErrnoException).code;
          if ((code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') && attempt < 4) await new Promise((r) => setTimeout(r, 20 * 2 ** attempt));
          else throw e;
        }
      }
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }

  /**
   * Apply ops to the CURRENT file on disk. `baseHash` is what the caller last saw; a mismatch is a CONFLICT and the
   * file is not touched. The caller's ops carry their own `expected` values for value-level compare-and-set.
   */
  async edit(rel: string, ops: Op[], meta: { baseHash?: string; author: DiffAuthor; summary: string }): Promise<EditResult> {
    const cur = await this.read(rel);
    if (meta.baseHash !== undefined && meta.baseHash !== cur.hash) {
      throw new DaemonError('CONFLICT', `${cur.path} changed on disk since you last saw it. It has been reloaded; repeat the edit if you still want it.`, cur);
    }
    const res = applyOps(cur.source, ops);
    if (res.source === cur.source) return { changed: false, file: cur, diff: null };
    const { abs } = await this.resolve(rel);
    await this.atomicWrite(abs, cur.hash, res.source);
    const file: FileSnap = { path: cur.path, source: res.source, hash: hashBytes(Buffer.from(res.source, 'utf8')) };
    this.undoStack.push({ file: cur.path, beforeText: cur.source, afterText: res.source, beforeHash: cur.hash, afterHash: file.hash });
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    return { changed: true, file, diff: this.diff('edit', cur.path, cur.source, res.source, meta.summary, meta.author) };
  }

  private diff(kind: DiffWire['kind'], file: string, before: string, after: string, summary: string, author: DiffAuthor): DiffWire | null {
    const d = firstDiff(before, after);
    if (!d) return null;
    return { id: this.nextDiffId++, kind, file, ...d, summary, author, at: this.now() };
  }

  /** Record a change made by someone else (a watcher event), so the strip can show it. */
  externalDiff(file: string, before: string, after: string): DiffWire | null {
    return this.diff('external', file, before, after, 'edited outside Prismbox', 'external');
  }

  private async move(from: UndoEntry[], to: UndoEntry[], dir: 'undo' | 'redo'): Promise<EditResult> {
    const entry = from[from.length - 1];
    if (!entry) throw new DaemonError('NOTHING_TO_UNDO', `Nothing to ${dir}.`);
    const cur = await this.read(entry.file);
    const need = dir === 'undo' ? entry.afterHash : entry.beforeHash;
    if (cur.hash !== need) {
      throw new DaemonError('UNDO_CONFLICT', `${entry.file} was changed outside Prismbox after this edit, so the ${dir} was refused to avoid overwriting that change.`, cur);
    }
    const text = dir === 'undo' ? entry.beforeText : entry.afterText;
    const { abs } = await this.resolve(entry.file);
    await this.atomicWrite(abs, cur.hash, text);
    from.pop();
    to.push(entry);
    const file: FileSnap = { path: entry.file, source: text, hash: dir === 'undo' ? entry.beforeHash : entry.afterHash };
    return { changed: true, file, diff: this.diff(dir, entry.file, cur.source, text, dir, 'you') };
  }

  undo(): Promise<EditResult> {
    return this.move(this.undoStack, this.redoStack, 'undo');
  }

  redo(): Promise<EditResult> {
    return this.move(this.redoStack, this.undoStack, 'redo');
  }

  async undoState(): Promise<UndoState> {
    const top = this.undoStack[this.undoStack.length - 1];
    const rtop = this.redoStack[this.redoStack.length - 1];
    const canNow = async (e: UndoEntry | undefined, want: 'afterHash' | 'beforeHash'): Promise<boolean> => {
      if (!e) return false;
      try {
        return (await this.read(e.file)).hash === e[want];
      } catch {
        return false;
      }
    };
    return { undoDepth: this.undoStack.length, redoDepth: this.redoStack.length, canUndo: await canNow(top, 'afterHash'), canRedo: await canNow(rtop, 'beforeHash') };
  }
}
