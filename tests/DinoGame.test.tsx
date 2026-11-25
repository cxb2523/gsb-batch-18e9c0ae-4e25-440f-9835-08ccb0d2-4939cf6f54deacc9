import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DinoGame } from '../src/components/DinoGame';
import { LOCAL_STORAGE_KEY } from '../src/lib/scores';
import { FakeScoresClient, makeScore } from './fakes';

/**
 * Minimal 2D context: the game loop only issues draw calls, so a recording
 * no-op object is enough to drive the real collision logic deterministically.
 */
function createContextStub(): CanvasRenderingContext2D {
  const ctx: Record<string, unknown> = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
  };
  for (const method of [
    'clearRect',
    'fillRect',
    'beginPath',
    'moveTo',
    'lineTo',
    'stroke',
    'ellipse',
    'fill',
    'fillText',
  ]) {
    ctx[method] = () => {};
  }
  return ctx as unknown as CanvasRenderingContext2D;
}

let frameQueue: FrameRequestCallback[] = [];

/** Runs exactly `count` animation frames; the game schedules one per frame. */
function runFrames(count: number) {
  act(() => {
    for (let frame = 0; frame < count; frame += 1) {
      const pending = frameQueue;
      frameQueue = [];
      for (const callback of pending) callback(0);
    }
  });
}

function type(text: string) {
  fireEvent.change(screen.getByPlaceholderText('Enter your name'), {
    target: { value: text },
  });
}

/**
 * Lets the running loop play until the dinosaur hits a cactus.
 * Math.random is pinned above 0.3 so obstacles are always ground-level cacti.
 */
function advanceUntilGameOver() {
  // ~116 frames before the first obstacle spawns plus ~150 to reach the dino.
  runFrames(400);
  expect(screen.getByText(/game over/i)).toBeInTheDocument();
}

/** Starts a fresh round from the start screen and plays it to game over. */
function playUntilGameOver() {
  fireEvent.click(screen.getByRole('button', { name: /start game/i }));
  advanceUntilGameOver();
}

function clickSaveRapidly(times = 2) {
  const button = screen.getByRole('button', { name: /save score/i });
  act(() => {
    for (let i = 0; i < times; i += 1) {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
  });
}

function readStoredScores(): Array<{ id: string; score: number; player_name: string }> {
  const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

beforeEach(() => {
  window.localStorage.clear();
  frameQueue = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frameQueue.push(callback);
    return frameQueue.length;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    createContextStub() as never,
  );
  vi.spyOn(Math, 'random').mockReturnValue(0.9);
});

describe('DinoGame score flow', () => {
  it('submits a round only once even when Save is clicked repeatedly', async () => {
    const client = new FakeScoresClient();
    render(<DinoGame scoresOptions={{ client, storage: window.localStorage }} />);

    playUntilGameOver();
    expect(screen.getByText(/game over/i)).toBeInTheDocument();

    type('Alice');
    clickSaveRapidly(3);

    await waitFor(() => {
      expect(screen.getByText(/score saved to the leaderboard/i)).toBeInTheDocument();
    });

    expect(client.insertCalls).toHaveLength(1);
    expect(client.rows).toHaveLength(1);
    expect(client.rows[0]).toMatchObject({ player_name: 'Alice' });
    // The board is shown right after saving and contains the new score.
    expect(screen.getByText('Top 10 Scores')).toBeInTheDocument();
    expect(screen.getAllByText('Alice').length).toBeGreaterThan(0);
    // A submitted round no longer offers the input/save controls.
    expect(screen.queryByPlaceholderText('Enter your name')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save score/i })).not.toBeInTheDocument();
  });

  it('falls back to local storage and still shows the board when the cloud rejects the write', async () => {
    const client = new FakeScoresClient();
    client.insertError = 'insert denied';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(<DinoGame scoresOptions={{ client, storage: window.localStorage }} />);

    playUntilGameOver();
    type('Bob');
    fireEvent.click(screen.getByRole('button', { name: /save score/i }));

    await waitFor(() => {
      expect(screen.getByText(/cloud unavailable/i)).toBeInTheDocument();
    });

    expect(readStoredScores()).toHaveLength(1);
    expect(readStoredScores()[0]).toMatchObject({ player_name: 'Bob' });
    expect(screen.getByText('Bob')).toBeInTheDocument();
    warn.mockRestore();
  });

  it('clears the round result on Play Again but keeps saved scores', async () => {
    const client = new FakeScoresClient();
    render(<DinoGame scoresOptions={{ client, storage: window.localStorage }} />);

    playUntilGameOver();
    type('Carol');
    fireEvent.click(screen.getByRole('button', { name: /save score/i }));
    await waitFor(() => {
      expect(screen.getByText(/score saved to the leaderboard/i)).toBeInTheDocument();
    });

    // Replay: name, leaderboard toggle and submission state all reset.
    fireEvent.click(screen.getByRole('button', { name: /play again/i }));

    expect(screen.queryByText(/game over/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Top 10 Scores')).not.toBeInTheDocument();

    // After Play Again the game is already running; play the new round out.
    advanceUntilGameOver();
    expect(screen.getByPlaceholderText('Enter your name')).toHaveValue('');
    expect(screen.getByRole('button', { name: /save score/i })).toBeDisabled();
    expect(screen.queryByText(/score saved to the leaderboard/i)).not.toBeInTheDocument();

    // The previous round's score is still in the leaderboard.
    fireEvent.click(screen.getByRole('button', { name: /show leaderboard/i }));
    await waitFor(() => {
      expect(screen.getByText('Carol')).toBeInTheDocument();
    });

    // And the new round can be submitted exactly once.
    type('Dave');
    fireEvent.click(screen.getByRole('button', { name: /save score/i }));
    await waitFor(() => {
      expect(client.insertCalls).toHaveLength(2);
    });
    expect(screen.getByText('Dave')).toBeInTheDocument();
    expect(screen.getByText('Carol')).toBeInTheDocument();
  });

  it('shows local scores immediately while the cloud hangs, and never sticks on Loading', async () => {
    window.localStorage.setItem(
      LOCAL_STORAGE_KEY,
      JSON.stringify([makeScore({ id: 'local-1', player_name: 'Erin', score: 42 })]),
    );

    const client = new FakeScoresClient();
    client.fetchHang = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(
      <DinoGame
        scoresOptions={{ client, storage: window.localStorage, cloudTimeoutMs: 40 }}
      />,
    );

    playUntilGameOver();
    fireEvent.click(screen.getByRole('button', { name: /show leaderboard/i }));

    // Local score visible straight away, no blocking spinner.
    expect(screen.getByText('Erin')).toBeInTheDocument();
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();

    // Even after the cloud request times out the board still has content.
    await new Promise((resolve) => setTimeout(resolve, 80));
    await waitFor(() => {
      expect(screen.getByText('Erin')).toBeInTheDocument();
    });
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    warn.mockRestore();
  });

  it('merges cloud and local rows by id without duplicates', async () => {
    window.localStorage.setItem(
      LOCAL_STORAGE_KEY,
      JSON.stringify([
        makeScore({ id: 'shared', player_name: 'Frank', score: 30 }),
        makeScore({ id: 'local-only', player_name: 'Grace', score: 90 }),
      ]),
    );

    const client = new FakeScoresClient([
      makeScore({ id: 'shared', player_name: 'Frank', score: 30 }),
      makeScore({ id: 'cloud-only', player_name: 'Heidi', score: 60 }),
    ]);

    render(<DinoGame scoresOptions={{ client, storage: window.localStorage }} />);

    playUntilGameOver();
    fireEvent.click(screen.getByRole('button', { name: /show leaderboard/i }));

    await waitFor(() => {
      expect(screen.getByText('Heidi')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Frank')).toHaveLength(1);
    expect(screen.getByText('Grace')).toBeInTheDocument();

    // Sorted by score descending: Grace 90, Heidi 60, Frank 30.
    const names = screen
      .getAllByText(/^(Grace|Heidi|Frank)$/)
      .map((node) => node.textContent);
    expect(names).toEqual(['Grace', 'Heidi', 'Frank']);
  });
});
