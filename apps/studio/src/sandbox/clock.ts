/**
 * d9: pause animation while the cursor is over a gizmo handle and while a handle is being dragged.
 *
 * Why not R3F's own setFrameloop? It resets clock.elapsedTime to 0, so absolute-time animation
 * (Math.sin(clock.elapsedTime), drei Float) jumps on resume. Instead this freezes the clock itself:
 * getDelta() returns 0 and keeps oldTime fresh, so useFrame callbacks keep running with delta 0 and a
 * frozen elapsedTime, and resuming continues from exactly where the animation stopped.
 *
 * This relies on R3F's render loop calling clock.getDelta(). A test (test/clock-guard.test.ts) reads the
 * installed R3F source and fails if that stops being true, and the overlay checks at runtime that a frozen
 * frame really reports delta 0.
 */
export interface ClockLike {
  getDelta(): number;
  oldTime: number;
  elapsedTime: number;
}

export class ClockFreezer {
  private readonly reasons = new Set<string>();

  constructor(
    private readonly clock: ClockLike,
    private readonly now: () => number = () => performance.now(),
  ) {}

  get frozen(): boolean {
    return this.reasons.size > 0;
  }

  /** Turn one reason on or off ('hover', 'drag'). The clock stays frozen while any reason is on. */
  set(reason: string, on: boolean): void {
    const was = this.frozen;
    if (on) this.reasons.add(reason);
    else this.reasons.delete(reason);
    if (!was && this.frozen) this.freeze();
    else if (was && !this.frozen) this.thaw();
  }

  /** Release everything and restore the original getDelta. Safe to call repeatedly. */
  dispose(): void {
    this.reasons.clear();
    this.thaw();
  }

  private freeze(): void {
    const clock = this.clock;
    const now = this.now;
    clock.getDelta = () => {
      clock.oldTime = now();
      return 0;
    };
  }

  private thaw(): void {
    if (Object.prototype.hasOwnProperty.call(this.clock, 'getDelta')) {
      delete (this.clock as Partial<ClockLike>).getDelta;
      this.clock.oldTime = this.now();
    }
  }
}
