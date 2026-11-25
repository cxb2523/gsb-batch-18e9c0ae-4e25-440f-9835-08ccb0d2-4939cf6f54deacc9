/**
 * Tracks Node's global setTimeout/setInterval for a test region so tests can
 * assert that the engine cancels every timer it creates. The engine calls the
 * global timer functions (not ones hanging off the audio context), so this
 * wraps the real globals and restores them afterwards.
 */

const originals = {
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
};

interface TimerRecord {
  id: ReturnType<typeof setTimeout>;
  kind: 'timeout' | 'interval';
  cleared: boolean;
}

export class TimerSpy {
  private records = new Map<ReturnType<typeof setTimeout>, TimerRecord>();
  private active = false;

  install(): void {
    if (this.active) return;
    this.active = true;

    globalThis.setTimeout = ((callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
      const id = originals.setTimeout(callback, ms, ...args);
      this.records.set(id, { id, kind: 'timeout', cleared: false });
      return id;
    }) as typeof setTimeout;

    globalThis.clearTimeout = ((id: ReturnType<typeof setTimeout>) => {
      const record = this.records.get(id);
      if (record) record.cleared = true;
      originals.clearTimeout(id);
    }) as typeof clearTimeout;

    globalThis.setInterval = ((callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
      const id = originals.setInterval(callback, ms, ...args);
      this.records.set(id, { id, kind: 'interval', cleared: false });
      return id;
    }) as typeof setInterval;

    globalThis.clearInterval = ((id: ReturnType<typeof setInterval>) => {
      const record = this.records.get(id);
      if (record) record.cleared = true;
      originals.clearInterval(id);
    }) as typeof clearInterval;
  }

  restore(): void {
    if (!this.active) return;
    this.active = false;
    globalThis.setTimeout = originals.setTimeout;
    globalThis.clearTimeout = originals.clearTimeout;
    globalThis.setInterval = originals.setInterval;
    globalThis.clearInterval = originals.clearInterval;
  }

  /** Timers created since install() that were never explicitly cleared. */
  leaked(): TimerRecord[] {
    return [...this.records.values()].filter((r) => !r.cleared);
  }

  /** Live (uncleared) timers right now. */
  activeCount(): number {
    return this.leaked().length;
  }

  clearAll(): void {
    for (const record of this.records.values()) {
      if (record.cleared) continue;
      if (record.kind === 'timeout') originals.clearTimeout(record.id);
      else originals.clearInterval(record.id);
      record.cleared = true;
    }
  }
}
