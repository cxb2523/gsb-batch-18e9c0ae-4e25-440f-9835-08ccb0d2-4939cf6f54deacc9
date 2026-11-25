import { useCallback, useState } from 'react';
import { useScoreSubmission } from './useScoreSubmission';
import type { SaveScoreResult } from '../lib/scores';

export interface UseRoundResultOptions {
  saveScore: (
    playerName: string,
    score: number,
    level: number,
  ) => Promise<SaveScoreResult | null>;
  refreshScores: () => Promise<void> | void;
}

/**
 * All UI state that belongs to a single finished round: the name input, the
 * leaderboard toggle and the one-shot submission. Kept together so starting a
 * new round can clear every one of them in a single call, while leaderboard
 * *data* stays in useGameScores and therefore survives the reset.
 */
export function useRoundResult({ saveScore, refreshScores }: UseRoundResultOptions) {
  const [playerName, setPlayerName] = useState('');
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const submission = useScoreSubmission({ saveScore });
  const { submit: submitRound, reset: resetSubmission } = submission;

  const submit = useCallback(
    async (score: number, level: number): Promise<SaveScoreResult | null> => {
      const result = await submitRound(playerName, score, level);
      if (!result) return null;
      // Show the current board either way — a cloud success must be reflected
      // immediately, and a local fallback must still be visible to the player.
      setShowLeaderboard(true);
      return result;
    },
    [submitRound, playerName],
  );

  const toggleLeaderboard = useCallback(() => {
    // Side effect kept out of the state updater: React may invoke updaters
    // twice (StrictMode), which would double the refresh request.
    if (!showLeaderboard) {
      // Refresh when opening so the board reflects scores from other tabs and
      // sessions. Local scores are published synchronously, so this never
      // blanks the list while the request is in flight.
      void refreshScores();
    }
    setShowLeaderboard(!showLeaderboard);
  }, [refreshScores, showLeaderboard]);

  const resetRound = useCallback(() => {
    setPlayerName('');
    setShowLeaderboard(false);
    resetSubmission();
  }, [resetSubmission]);

  return {
    playerName,
    setPlayerName,
    showLeaderboard,
    toggleLeaderboard,
    submission,
    submit,
    resetRound,
  };
}
