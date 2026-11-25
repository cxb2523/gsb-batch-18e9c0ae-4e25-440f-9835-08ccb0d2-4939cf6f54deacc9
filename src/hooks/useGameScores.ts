import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase as defaultSupabase } from '../lib/supabase';
import type { GameScore } from '../lib/supabase';
import {
  LOCAL_STORAGE_KEY,
  MAX_TOP_SCORES,
  addLocalScore,
  createScoreId,
  mergeScores,
  normalizeScoreEntry,
  readLocalScores,
  withTimeout,
} from '../lib/scores';
import type { SaveScoreResult, ScoresClient } from '../lib/scores';

export { LOCAL_STORAGE_KEY, MAX_TOP_SCORES };
export type { SaveScoreResult };

/** Default cloud read/write budget. Past this we fall back to localStorage. */
const DEFAULT_CLOUD_TIMEOUT_MS = 5000;

export interface UseGameScoresOptions {
  /**
   * Supabase client override. Defaults to the app client (which is null when
   * no env credentials are configured). Primarily useful for tests.
   */
  client?: ScoresClient | null;
  /** Storage override. Defaults to `window.localStorage` when available. */
  storage?: Storage | null;
  /** Cloud request timeout in ms. Tests shrink this to exercise fallbacks. */
  cloudTimeoutMs?: number;
}

function getDefaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function extractInsertedRow(data: unknown): GameScore | null {
  const row = Array.isArray(data) ? data[0] : data;
  return normalizeScoreEntry(row);
}

/**
 * Score persistence with a single, consistent merge rule:
 *
 *   display = merge(cloud rows, entries saved this session, local rows)
 *
 * Every group goes through the same dedupe-by-id / sort-desc / top-10 path in
 * `mergeScores`, so mixing cloud and local data can never produce duplicates.
 * A score gets the same client-generated id locally and in the cloud insert,
 * which is what makes that dedupe work even when an insert "fails" after the
 * row was actually written.
 */
export function useGameScores(options: UseGameScoresOptions = {}) {
  // Single cast at the boundary: the real Supabase client structurally provides
  // the narrow query surface described by ScoresClient.
  const client: ScoresClient | null =
    options.client !== undefined
      ? options.client
      : (defaultSupabase as ScoresClient | null);
  const storage =
    options.storage !== undefined ? options.storage : getDefaultStorage();
  const cloudTimeoutMs = options.cloudTimeoutMs ?? DEFAULT_CLOUD_TIMEOUT_MS;

  // Last known cloud rows. Kept between refreshes so a transient outage
  // degrades to "last known cloud + local" instead of an empty board.
  const cloudRowsRef = useRef<GameScore[]>([]);
  // Entries successfully persisted by this hook instance. Always merged into
  // the display so a refresh that races an in-flight save cannot drop a row.
  const sessionEntriesRef = useRef<GameScore[]>([]);
  const fetchSeqRef = useRef(0);
  const saveInFlightRef = useRef(false);
  const mountedRef = useRef(true);

  const [topScores, setTopScores] = useState<GameScore[]>(() =>
    readLocalScores(storage),
  );
  const [loading, setLoading] = useState(Boolean(client));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const composeScores = useCallback(
    (local: GameScore[]) =>
      mergeScores(cloudRowsRef.current, sessionEntriesRef.current, local),
    [],
  );

  const fetchTopScores = useCallback(async () => {
    const requestId = ++fetchSeqRef.current;
    // Show known scores right away; never leave the board blank or loading
    // while the cloud request is outstanding.
    setTopScores(composeScores(readLocalScores(storage)));
    if (!client) {
      setLoading(false);
      return;
    }

    setLoading(true);
    let nextCloudRows: GameScore[] | null = null;
    try {
      const { data, error } = await withTimeout(
        client
          .from('game_scores')
          .select('*')
          .order('score', { ascending: false })
          .limit(MAX_TOP_SCORES),
        cloudTimeoutMs,
      );

      if (error) {
        console.warn('Supabase fetch failed, keeping local scores:', error.message);
      } else if (Array.isArray(data)) {
        nextCloudRows = mergeScores(data);
      }
    } catch (err) {
      console.warn('Supabase fetch failed, keeping local scores:', err);
    }

    // A newer refresh finished first; its result wins.
    if (requestId !== fetchSeqRef.current) return;
    if (nextCloudRows) cloudRowsRef.current = nextCloudRows;
    // Re-read local storage: another tab or a fallback save may have written
    // to it while the cloud request was in flight.
    if (mountedRef.current) {
      setTopScores(composeScores(readLocalScores(storage)));
      setLoading(false);
    }
  }, [client, storage, cloudTimeoutMs, composeScores]);

  useEffect(() => {
    fetchTopScores();
  }, [fetchTopScores]);

  const saveScore = useCallback(
    async (
      playerName: string,
      score: number,
      level: number,
    ): Promise<SaveScoreResult | null> => {
      // One successful submission at a time. A second click while a save is
      // in flight is ignored rather than writing a duplicate row.
      if (saveInFlightRef.current) return null;
      saveInFlightRef.current = true;
      setSaving(true);

      const safeName = playerName.trim() || 'Anonymous';
      const entry: GameScore = {
        id: createScoreId(),
        player_name: safeName,
        score,
        level,
        created_at: new Date().toISOString(),
      };

      const publish = (saved: GameScore) => {
        sessionEntriesRef.current = mergeScores(sessionEntriesRef.current, [saved]);
        if (mountedRef.current) {
          setTopScores(composeScores(readLocalScores(storage)));
        }
      };

      try {
        if (client) {
          try {
            const { data, error } = await withTimeout(
              client
                .from('game_scores')
                .insert([
                  {
                    id: entry.id,
                    player_name: entry.player_name,
                    score: entry.score,
                    level: entry.level,
                  },
                ])
                .select('*')
                .single(),
              cloudTimeoutMs,
            );

            if (!error) {
              // Prefer the row echoed by Supabase (it carries the canonical
              // created_at); fall back to the id we generated otherwise.
              // No local mirror on success: local storage is the offline
              // fallback. If a write succeeded server-side but its response was
              // lost and we fell back locally, the cloud row later arrives with
              // this same id and merging collapses the two into one entry.
              const cloudEntry = extractInsertedRow(data) ?? entry;
              publish(cloudEntry);
              return { status: 'cloud', entry: cloudEntry };
            }

            console.warn('Supabase insert failed, saving locally:', error.message);
          } catch (err) {
            console.warn('Supabase insert failed, saving locally:', err);
          }
        }

        // Cloud unavailable or rejected the write: persist on this device and
        // surface it through the same merged leaderboard.
        addLocalScore(entry, storage);
        publish(entry);
        return { status: 'local', entry };
      } finally {
        saveInFlightRef.current = false;
        if (mountedRef.current) setSaving(false);
      }
    },
    [client, storage, cloudTimeoutMs, composeScores],
  );

  return {
    topScores,
    loading,
    saving,
    saveScore,
    refreshScores: fetchTopScores,
  };
}
