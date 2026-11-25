import { describe, expect, it } from 'vitest';
import {
  LOCAL_STORAGE_KEY,
  MAX_TOP_SCORES,
  addLocalScore,
  createScoreId,
  mergeScores,
  normalizeScoreEntry,
  readLocalScores,
  withTimeout,
} from '../src/lib/scores';
import { makeScore } from './fakes';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }

  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe('mergeScores', () => {
  it('deduplicates by id across cloud and local groups', () => {
    const cloud = [makeScore({ id: 'a', score: 10 }), makeScore({ id: 'b', score: 20 })];
    const local = [makeScore({ id: 'b', score: 20 }), makeScore({ id: 'c', score: 5 })];

    const merged = mergeScores(cloud, local);

    expect(merged.map((entry) => entry.id)).toEqual(['b', 'a', 'c']);
    expect(new Set(merged.map((entry) => entry.id)).size).toBe(merged.length);
  });

  it('keeps the higher score when the same id appears twice', () => {
    const merged = mergeScores(
      [makeScore({ id: 'dup', score: 50 })],
      [makeScore({ id: 'dup', score: 80 })],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].score).toBe(80);
  });

  it('prefers the row with a usable timestamp on a duplicate id', () => {
    const merged = mergeScores(
      [makeScore({ id: 'dup', score: 50, created_at: '' })],
      [makeScore({ id: 'dup', score: 50, created_at: '2025-01-01T00:00:00.000Z' })],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].created_at).toBe('2025-01-01T00:00:00.000Z');
  });

  it('sorts rows without timestamps after rows with them', () => {
    const merged = mergeScores([
      makeScore({ id: 'no-time', score: 100, created_at: '' }),
      makeScore({ id: 'has-time', score: 100, created_at: '2025-01-01T00:00:00.000Z' }),
    ]);

    expect(merged.map((entry) => entry.id)).toEqual(['has-time', 'no-time']);
  });

  it('sorts by score descending and keeps the top 10', () => {
    const rows = Array.from({ length: 15 }, (_, index) =>
      makeScore({ id: `row-${index}`, score: index * 10 }),
    );

    const merged = mergeScores(rows);

    expect(merged).toHaveLength(MAX_TOP_SCORES);
    const scores = merged.map((entry) => entry.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(scores[0]).toBe(140);
    expect(merged.some((entry) => entry.score < 50)).toBe(false);
  });

  it('breaks score ties deterministically by creation time then id', () => {
    const merged = mergeScores([
      makeScore({ id: 'later', score: 100, created_at: '2025-02-01T00:00:00.000Z' }),
      makeScore({ id: 'earlier', score: 100, created_at: '2025-01-01T00:00:00.000Z' }),
    ]);

    expect(merged.map((entry) => entry.id)).toEqual(['earlier', 'later']);
  });

  it('ignores malformed rows instead of failing the whole board', () => {
    const merged = mergeScores(
      [null, undefined, 'nonsense', { score: 999 }, { id: 'ok', score: '42', level: '3' }],
      [],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: 'ok', score: 42, level: 3 });
  });

  it('never runs out of the top 10 after merging a large cloud set', () => {
    const cloud = Array.from({ length: 30 }, (_, index) =>
      makeScore({ id: `cloud-${index}`, score: 1000 - index }),
    );
    const local = Array.from({ length: 30 }, (_, index) =>
      makeScore({ id: `local-${index}`, score: 999 - index }),
    );

    expect(mergeScores(cloud, local)).toHaveLength(MAX_TOP_SCORES);
  });
});

describe('local storage helpers', () => {
  it('uses the existing storage key and format', () => {
    const storage = new MemoryStorage();
    addLocalScore(makeScore({ id: 'persisted', score: 7 }), storage);

    const raw = storage.getItem(LOCAL_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed[0]).toMatchObject({ id: 'persisted', score: 7 });
    expect(readLocalScores(storage)[0].id).toBe('persisted');
  });

  it('survives corrupted storage contents', () => {
    const storage = new MemoryStorage();
    storage.setItem(LOCAL_STORAGE_KEY, '{not json');

    expect(readLocalScores(storage)).toEqual([]);
  });

  it('keeps only the top 10 entries on disk', () => {
    const storage = new MemoryStorage();
    for (let index = 0; index < 14; index += 1) {
      addLocalScore(makeScore({ id: `entry-${index}`, score: index }), storage);
    }

    const raw = JSON.parse(storage.getItem(LOCAL_STORAGE_KEY) as string);
    expect(raw).toHaveLength(MAX_TOP_SCORES);
    expect(raw[0].score).toBe(13);
  });

  it('is a no-op when storage is unavailable', () => {
    expect(() => addLocalScore(makeScore({ id: 'x' }), null)).not.toThrow();
    expect(readLocalScores(null)).toEqual([]);
  });
});

describe('normalizeScoreEntry', () => {
  it('accepts numeric ids from the API', () => {
    expect(normalizeScoreEntry({ id: 12, player_name: 'Ann', score: 3, level: 1 })).toMatchObject({
      id: '12',
      player_name: 'Ann',
    });
  });

  it('defaults an empty name to Anonymous', () => {
    expect(normalizeScoreEntry({ id: 'a', player_name: '   ' })?.player_name).toBe('Anonymous');
  });
});

describe('createScoreId', () => {
  it('produces unique ids', () => {
    const ids = new Set(Array.from({ length: 200 }, () => createScoreId()));
    expect(ids.size).toBe(200);
  });
});

describe('withTimeout', () => {
  it('rejects when the request never settles', async () => {
    await expect(withTimeout(new Promise<never>(() => {}), 10)).rejects.toThrow(/timed out/);
  });

  it('resolves a thenable that settles in time', async () => {
    const thenable: PromiseLike<string> = {
      then: <TResult1 = string, TResult2 = never>(
        onfulfilled?: ((value: string) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) => {
        void onrejected;
        return Promise.resolve('ok').then(onfulfilled) as PromiseLike<TResult1 | TResult2>;
      },
    };
    await expect(withTimeout(thenable, 50)).resolves.toBe('ok');
  });
});
