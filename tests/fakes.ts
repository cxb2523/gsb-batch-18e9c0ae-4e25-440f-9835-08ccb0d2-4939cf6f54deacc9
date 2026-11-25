import type { GameScore } from '../src/lib/supabase';
import type { ScoreQuery, ScoreResponse, ScoresClient } from '../src/lib/scores';

type InsertRow = Record<string, unknown>;

const DEFAULT_CREATED_AT = '2025-01-01T00:00:00.000Z';

/**
 * Controllable stand-in for the Supabase client.
 *
 * Only the query surface the score hook actually uses is implemented, which is
 * exactly what `ScoresClient` describes. Tests can make reads fail, hang or
 * return rows, and can hold an insert open to simulate a slow network.
 */
export class FakeScoresClient implements ScoresClient {
  rows: GameScore[] = [];
  insertCalls: InsertRow[][] = [];
  selectCalls = 0;
  fetchError: string | null = null;
  insertError: string | null = null;
  fetchHang = false;
  insertGate: Promise<void> | null = null;

  constructor(rows: GameScore[] = []) {
    this.rows = rows.map((row) => ({ ...row }));
  }

  from(table: string): ScoreQuery {
    void table;
    return new FakeQuery(this);
  }

  async runSelect(): Promise<ScoreResponse> {
    this.selectCalls += 1;
    if (this.fetchHang) {
      // Resolves only when the caller gives up (the hook's own timeout).
      return new Promise<ScoreResponse>(() => {});
    }
    if (this.fetchError) {
      return { data: null, error: { message: this.fetchError } };
    }
    return {
      data: this.rows
        .slice()
        .sort((a, b) => b.score - a.score)
        .slice(0, 10),
      error: null,
    };
  }

  async runInsert(row: InsertRow): Promise<ScoreResponse> {
    if (this.insertGate) await this.insertGate;
    this.insertCalls.push([row]);
    if (this.insertError) {
      return { data: null, error: { message: this.insertError } };
    }

    const stored: GameScore = {
      id: String(row.id),
      player_name: String(row.player_name ?? 'Anonymous'),
      score: Number(row.score ?? 0),
      level: Number(row.level ?? 1),
      created_at: DEFAULT_CREATED_AT,
    };
    this.rows.push(stored);
    return { data: stored, error: null };
  }
}

class FakeQuery implements ScoreQuery {
  private inserted: InsertRow | null = null;

  constructor(private readonly fake: FakeScoresClient) {}

  select(columns?: string): ScoreQuery {
    void columns;
    return this;
  }

  insert(rows: ReadonlyArray<InsertRow>): ScoreQuery {
    this.inserted = rows[0] ?? null;
    return this;
  }

  order(column?: string, options?: { ascending?: boolean }): ScoreQuery {
    void column;
    void options;
    return this;
  }

  limit(count?: number): ScoreQuery {
    void count;
    return this;
  }

  single(): PromiseLike<ScoreResponse> {
    return this.execute();
  }

  then<TResult1 = ScoreResponse, TResult2 = never>(
    onfulfilled?: ((value: ScoreResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private execute(): Promise<ScoreResponse> {
    if (this.inserted) return this.fake.runInsert(this.inserted);
    return this.fake.runSelect();
  }
}

export function makeScore(overrides: Partial<GameScore> & { id: string }): GameScore {
  return {
    player_name: 'Player',
    score: 100,
    level: 1,
    created_at: DEFAULT_CREATED_AT,
    ...overrides,
  };
}

export function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
