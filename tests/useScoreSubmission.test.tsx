import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useScoreSubmission } from '../src/hooks/useScoreSubmission';
import type { SaveScoreResult } from '../src/lib/scores';
import { createDeferred, makeScore } from './fakes';

function cloudResult(): SaveScoreResult {
  return { status: 'cloud', entry: makeScore({ id: 'x' }) };
}

describe('useScoreSubmission', () => {
  it('allows only one successful submission per round', async () => {
    const saveScore = vi.fn(async () => cloudResult());
    const { result } = renderHook(() => useScoreSubmission({ saveScore }));

    await act(async () => {
      await result.current.submit('Alice', 10, 1);
    });

    expect(result.current.phase).toBe('saved-cloud');
    expect(result.current.isSaved).toBe(true);

    let later: SaveScoreResult | null = cloudResult();
    await act(async () => {
      later = await result.current.submit('Alice', 10, 1);
    });

    expect(later).toBeNull();
    expect(saveScore).toHaveBeenCalledTimes(1);
  });

  it('ignores a second click while the first save is in flight', async () => {
    const gate = createDeferred();
    const saveScore = vi.fn(async () => {
      await gate.promise;
      return cloudResult();
    });
    const { result } = renderHook(() => useScoreSubmission({ saveScore }));

    let first: Promise<SaveScoreResult | null> = Promise.resolve(null);
    let second: Promise<SaveScoreResult | null> = Promise.resolve(null);
    act(() => {
      first = result.current.submit('Alice', 10, 1);
      second = result.current.submit('Alice', 10, 1);
    });

    await act(async () => {
      gate.resolve();
      await Promise.all([first, second]);
    });

    expect(await second).toBeNull();
    expect(saveScore).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('saved-cloud');
  });

  it('returns to idle after a failed save so the player can retry', async () => {
    const saveScore = vi.fn(async () => null);
    const { result } = renderHook(() => useScoreSubmission({ saveScore }));

    await act(async () => {
      await result.current.submit('Alice', 10, 1);
    });

    expect(result.current.phase).toBe('idle');
    expect(result.current.isSaved).toBe(false);
  });

  it('resets state for a new round without discarding the save ability', async () => {
    const saveScore = vi.fn(async () => cloudResult());
    const { result } = renderHook(() => useScoreSubmission({ saveScore }));

    await act(async () => {
      await result.current.submit('Alice', 10, 1);
    });
    expect(result.current.isSaved).toBe(true);

    act(() => result.current.reset());
    expect(result.current.phase).toBe('idle');

    await act(async () => {
      await result.current.submit('Alice', 20, 1);
    });
    expect(saveScore).toHaveBeenCalledTimes(2);
  });

  it('does not leak an in-flight save into the next round', async () => {
    const gate = createDeferred();
    const saveScore = vi.fn(async () => {
      await gate.promise;
      return cloudResult();
    });
    const { result } = renderHook(() => useScoreSubmission({ saveScore }));

    let pending: Promise<SaveScoreResult | null> = Promise.resolve(null);
    act(() => {
      pending = result.current.submit('Alice', 10, 1);
    });

    // Player restarts before the previous save settles.
    act(() => result.current.reset());

    await act(async () => {
      gate.resolve();
      expect(await pending).toBeNull();
    });

    expect(result.current.phase).toBe('idle');
    expect(result.current.isSaved).toBe(false);
  });
});
