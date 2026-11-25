import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameScores } from '../src/hooks/useGameScores';
import { LOCAL_STORAGE_KEY } from '../src/lib/scores';
import { FakeScoresClient, createDeferred, makeScore } from './fakes';
import type { SaveScoreResult } from '../src/lib/scores';

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

function seedLocal(storage: Storage, scores: Parameters<typeof makeScore>[0][]) {
  storage.setItem(
    LOCAL_STORAGE_KEY,
    JSON.stringify(scores.map((score) => makeScore(score))),
  );
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('useGameScores', () => {
  it('writes to Supabase with the client-generated id', async () => {
    const client = new FakeScoresClient();
    const storage = new MemoryStorage();
    const { result } = renderHook(() => useGameScores({ client, storage }));

    await waitFor(() => expect(result.current.loading).toBe(false));

    let outcome: SaveScoreResult | null = null;
    await act(async () => {
      outcome = await result.current.saveScore('Alice', 321, 2);
    });

    expect(outcome).not.toBeNull();
    expect(outcome!.status).toBe('cloud');
    expect(client.insertCalls).toHaveLength(1);
    expect(client.insertCalls[0][0]).toMatchObject({
      id: outcome!.entry.id,
      player_name: 'Alice',
      score: 321,
      level: 2,
    });
    // Cloud success is reflected immediately in the leaderboard.
    expect(result.current.topScores[0]).toMatchObject({ player_name: 'Alice', score: 321 });
    // Local storage stays reserved for the offline fallback.
    expect(storage.getItem(LOCAL_STORAGE_KEY)).toBeNull();
    expect(result.current.topScores).toHaveLength(1);
  });

  it('ignores a second save while the first is still in flight', async () => {
    const client = new FakeScoresClient();
    const gate = createDeferred();
    client.insertGate = gate.promise;
    const storage = new MemoryStorage();
    const { result } = renderHook(() => useGameScores({ client, storage }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let first: Promise<SaveScoreResult | null> = Promise.resolve(null);
    let second: Promise<SaveScoreResult | null> = Promise.resolve(null);
    act(() => {
      first = result.current.saveScore('Alice', 10, 1);
      second = result.current.saveScore('Alice', 10, 1);
    });

    await act(async () => {
      gate.resolve();
      await Promise.all([first, second]);
    });

    expect(await second).toBeNull();
    expect(client.insertCalls).toHaveLength(1);
  });

  it('falls back to local storage when the insert errors', async () => {
    const client = new FakeScoresClient();
    client.insertError = 'boom';
    const storage = new MemoryStorage();
    const { result } = renderHook(() => useGameScores({ client, storage }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let outcome: SaveScoreResult | null = null;
    await act(async () => {
      outcome = await result.current.saveScore('Bob', 55, 1);
    });

    expect(outcome!.status).toBe('local');
    const stored = JSON.parse(storage.getItem(LOCAL_STORAGE_KEY) as string);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ player_name: 'Bob', score: 55 });
    expect(result.current.topScores[0]).toMatchObject({ player_name: 'Bob', score: 55 });
  });

  it('falls back to local storage when the client is not configured', async () => {
    const storage = new MemoryStorage();
    const { result } = renderHook(() => useGameScores({ client: null, storage }));

    expect(result.current.loading).toBe(false);

    let outcome: SaveScoreResult | null = null;
    await act(async () => {
      outcome = await result.current.saveScore('Cara', 7, 1);
    });

    expect(outcome!.status).toBe('local');
    expect(result.current.topScores).toHaveLength(1);
  });

  it('keeps the board populated when the cloud read fails', async () => {
    const storage = new MemoryStorage();
    seedLocal(storage, [{ id: 'local-a', player_name: 'Local Ann', score: 12 }]);
    const client = new FakeScoresClient();
    client.fetchError = 'offline';

    const { result } = renderHook(() => useGameScores({ client, storage }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.topScores).toHaveLength(1);
    expect(result.current.topScores[0].player_name).toBe('Local Ann');
  });

  it('never hangs on loading when the cloud read stalls', async () => {
    const storage = new MemoryStorage();
    seedLocal(storage, [{ id: 'local-b', player_name: 'Local Bea', score: 20 }]);
    const client = new FakeScoresClient();
    client.fetchHang = true;

    const { result } = renderHook(() =>
      useGameScores({ client, storage, cloudTimeoutMs: 30 }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 2000 });
    expect(result.current.topScores[0].player_name).toBe('Local Bea');
  });

  it('merges cloud and local rows by id, sorted and capped at ten', async () => {
    const storage = new MemoryStorage();
    seedLocal(storage, [
      { id: 'shared', player_name: 'Shared', score: 50 },
      { id: 'local-only', player_name: 'Local', score: 200 },
    ]);
    const client = new FakeScoresClient([
      makeScore({ id: 'shared', player_name: 'Shared', score: 50 }),
      makeScore({ id: 'cloud-only', player_name: 'Cloud', score: 100 }),
      ...Array.from({ length: 12 }, (_, index) =>
        makeScore({ id: `cloud-${index}`, score: index + 1 }),
      ),
    ]);

    const { result } = renderHook(() => useGameScores({ client, storage }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const top = result.current.topScores;
    expect(top).toHaveLength(10);
    expect(top.map((entry) => entry.id)).toEqual([
      'local-only',
      'cloud-only',
      'shared',
      'cloud-11',
      'cloud-10',
      'cloud-9',
      'cloud-8',
      'cloud-7',
      'cloud-6',
      'cloud-5',
    ]);
    expect(new Set(top.map((entry) => entry.id)).size).toBe(top.length);
  });
});
