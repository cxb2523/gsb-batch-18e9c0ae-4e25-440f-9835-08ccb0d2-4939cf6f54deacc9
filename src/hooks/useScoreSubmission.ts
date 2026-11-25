import { useCallback, useRef, useState } from 'react';
import type { SaveScoreResult } from '../lib/scores';

export type SubmissionPhase = 'idle' | 'saving' | 'saved-cloud' | 'saved-local';

export interface UseScoreSubmissionOptions {
  saveScore: (
    playerName: string,
    score: number,
    level: number,
  ) => Promise<SaveScoreResult | null>;
}

/**
 * Round-scoped submission state for the game-over panel.
 *
 * A round may be submitted successfully at most once: the guard is a ref, so
 * two clicks dispatched in the same React batch (before the button can
 * re-render as disabled) still produce a single write. `reset()` is called
 * when a new round starts; it clears the guard, the visible phase and bumps a
 * generation token so a save that was still in flight cannot paint its result
 * onto the next round.
 *
 * Leaderboard data lives in useGameScores, so resetting here never discards
 * scores that were already saved.
 */
export function useScoreSubmission({ saveScore }: UseScoreSubmissionOptions) {
  const [phase, setPhase] = useState<SubmissionPhase>('idle');
  const inFlightRef = useRef(false);
  const submittedRef = useRef(false);
  const generationRef = useRef(0);

  const submit = useCallback(
    async (
      playerName: string,
      score: number,
      level: number,
    ): Promise<SaveScoreResult | null> => {
      const trimmed = playerName.trim();
      if (!trimmed || inFlightRef.current || submittedRef.current) {
        return null;
      }

      const generation = generationRef.current;
      const isCurrentRound = () => generationRef.current === generation;

      inFlightRef.current = true;
      setPhase('saving');

      try {
        const result = await saveScore(trimmed, score, level);

        // The player already started a new round; do not carry this round's
        // outcome (or open its leaderboard) into the new one.
        if (!isCurrentRound()) return null;

        if (!result) {
          // The score layer refused or produced nothing to persist; allow a
          // retry rather than showing a false success.
          setPhase('idle');
          return null;
        }

        submittedRef.current = true;
        setPhase(result.status === 'cloud' ? 'saved-cloud' : 'saved-local');
        return result;
      } catch (err) {
        console.warn('Saving the score failed:', err);
        if (isCurrentRound()) setPhase('idle');
        return null;
      } finally {
        if (isCurrentRound()) inFlightRef.current = false;
      }
    },
    [saveScore],
  );

  const reset = useCallback(() => {
    generationRef.current += 1;
    inFlightRef.current = false;
    submittedRef.current = false;
    setPhase('idle');
  }, []);

  return {
    phase,
    isSaving: phase === 'saving',
    isSaved: phase === 'saved-cloud' || phase === 'saved-local',
    savedToCloud: phase === 'saved-cloud',
    submit,
    reset,
  };
}
