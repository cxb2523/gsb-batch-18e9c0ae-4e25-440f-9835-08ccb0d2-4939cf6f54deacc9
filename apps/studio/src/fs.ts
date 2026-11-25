/** The Playground's in-memory file system, with an optional localStorage persistence layer. */
export class MemoryFs {
  private files = new Map<string, string>();

  constructor(initial: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(initial)) this.files.set(k, v);
  }

  read(path: string): string | undefined {
    return this.files.get(path);
  }

  write(path: string, text: string): void {
    this.files.set(path, text);
  }

  list(): string[] {
    return [...this.files.keys()].sort();
  }

  /** A plain copy of every file, for posting into the sandbox. */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.files);
  }
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const KEY = (id: string) => `prismbox:playground:v1:${id}`;

/** Saved edits per template. Failure (private mode, quota) is silent: the Playground still works, it just does not persist. */
export function loadSaved(storage: StorageLike | null, id: string): string | null {
  try {
    return storage?.getItem(KEY(id)) ?? null;
  } catch {
    return null;
  }
}

export function save(storage: StorageLike | null, id: string, source: string, original: string): void {
  try {
    if (!storage) return;
    if (source === original) storage.removeItem(KEY(id));
    else storage.setItem(KEY(id), source);
  } catch {
    /* ignore */
  }
}
