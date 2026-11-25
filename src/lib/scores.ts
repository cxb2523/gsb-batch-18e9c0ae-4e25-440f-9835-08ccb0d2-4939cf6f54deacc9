import type { GameScore } from './supabase';

/**
 * Local leaderboard storage key. Must stay stable so scores saved by older
 * versions of the game remain visible.
 */
export const LOCAL_STORAGE_KEY = 'dinosour_local_scores';

/** The leaderboard only ever shows this many entries. */
export const MAX_TOP_SCORES = 10;

export interface SaveScoreResult {
  /** Where the score was durably stored. */
  status: 'cloud' | 'local';
  entry: GameScore;
}

/** Shape of a Supabase response after normalization to what we consume. */
export interface ScoreResponse {
  data: unknown;
  error: { message?: string } | null;
}

/**
 * Minimal structural view of the Supabase query builder used by the score
 * hook. Keeping it narrow lets tests pass a fake client with no `any` casts,
 * while the real client is assignable through a single boundary cast.
 */
export interface ScoreQuery extends PromiseLike<ScoreResponse> {
  select(columns?: string): ScoreQuery;
  insert(rows: ReadonlyArray<Record<string, unknown>>): ScoreQuery;
  order(column: string, options?: { ascending?: boolean }): ScoreQuery;
  limit(count: number): ScoreQuery;
  single(): PromiseLike<ScoreResponse>;
}

export interface ScoresClient {
  from(table: string): ScoreQuery;
}

/**
 * Generates a client-side UUID for a score row. Supplying the id on insert
 * means the local mirror and the cloud row share one id, so the merged
 * leaderboard can never show the same score twice.
 */
export function createScoreId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to manual generation
  }

  const bytes = new Uint8Array(16);
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      crypto.getRandomValues(bytes);
    } else {
      throw new Error('crypto unavailable');
    }
  } catch {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // RFC 4122 version 4 layout.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Coerces a value coming from Supabase or localStorage into a GameScore.
 * Returns null for rows that cannot be identified, so a single malformed row
 * can never break the whole leaderboard.
 */
export function normalizeScoreEntry(value: unknown): GameScore | null {
  if (!value || typeof value !== 'object') return null;

  const raw = value as Record<string, unknown>;
  const rawId = raw.id;
  const id =
    typeof rawId === 'string' && rawId.trim()
      ? rawId
      : typeof rawId === 'number' && Number.isFinite(rawId)
        ? String(rawId)
        : null;
  if (!id) return null;

  const rawName = raw.player_name;
  const playerName =
    typeof rawName === 'string' && rawName.trim() ? rawName : 'Anonymous';

  return {
    id,
    player_name: playerName,
    score: Math.max(0, Math.floor(toFiniteNumber(raw.score, 0))),
    level: Math.max(1, Math.floor(toFiniteNumber(raw.level, 1))),
    created_at: typeof raw.created_at === 'string' ? raw.created_at : '',
  };
}

function timestampOf(createdAt: string): number {
  const parsed = Date.parse(createdAt);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * Picks the row that should represent a duplicated id. A higher score always
 * wins; on a tie the earlier-created row wins (the original write), and a row
 * with a usable timestamp beats one without.
 */
function preferEntry(existing: GameScore, incoming: GameScore): boolean {
  if (incoming.score !== existing.score) return incoming.score > existing.score;
  const incomingTime = timestampOf(incoming.created_at);
  const existingTime = timestampOf(existing.created_at);
  if (Number.isNaN(incomingTime)) return false;
  if (Number.isNaN(existingTime)) return true;
  return incomingTime < existingTime;
}

/** Higher scores first; ties go to the older entry, then to id for stability. */
export function compareScoreEntries(a: GameScore, b: GameScore): number {
  if (b.score !== a.score) return b.score - a.score;
  const aTime = timestampOf(a.created_at);
  const bTime = timestampOf(b.created_at);
  if (!Number.isNaN(aTime) && !Number.isNaN(bTime) && aTime !== bTime) {
    return aTime - bTime;
  }
  // Rows with a usable timestamp sort ahead of rows without one.
  if (Number.isNaN(aTime) !== Number.isNaN(bTime)) return Number.isNaN(aTime) ? 1 : -1;
  return a.id.localeCompare(b.id);
}

/**
 * The single merge path used for cloud rows, local rows and freshly saved
 * entries. Deduplicates by id, sorts by score descending and keeps the top 10.
 * When the same id appears more than once the higher score wins, which also
 * protects against a stale local copy shadowing the cloud value. On a tie the
 * earlier-created / timestamped row is kept.
 */
export function mergeScores(
  ...groups: ReadonlyArray<ReadonlyArray<unknown> | null | undefined>
): GameScore[] {
  const byId = new Map<string, GameScore>();

  for (const group of groups) {
    if (!group) continue;
    for (const value of group) {
      const entry = normalizeScoreEntry(value);
      if (!entry) continue;
      const existing = byId.get(entry.id);
      if (!existing || preferEntry(existing, entry)) {
        byId.set(entry.id, entry);
      }
    }
  }

  return Array.from(byId.values()).sort(compareScoreEntries).slice(0, MAX_TOP_SCORES);
}

export function readLocalScores(storage: Storage | null | undefined): GameScore[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? mergeScores(parsed) : [];
  } catch {
    return [];
  }
}

export function writeLocalScores(
  scores: ReadonlyArray<unknown>,
  storage: Storage | null | undefined,
): void {
  if (!storage) return;
  try {
    storage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(mergeScores(scores)));
  } catch {
    // Storage can be unavailable (private mode, quota). In-memory state still works.
  }
}

/** Persists one entry locally and returns the resulting local top 10. */
export function addLocalScore(
  entry: GameScore,
  storage: Storage | null | undefined,
): GameScore[] {
  const merged = mergeScores(readLocalScores(storage), [entry]);
  writeLocalScores(merged, storage);
  return merged;
}

/**
 * Bounds a promise-like value (Supabase builders are thenables) so an
 * unreachable backend can never leave the leaderboard stuck on "Loading".
 */
export async function withTimeout<T>(
  thenable: PromiseLike<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(thenable),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Request timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
