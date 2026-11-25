/**
 * d9: pause animation while a gizmo handle is hovered and while it is dragged, by freezing the R3F clock
 * (getDelta() returns 0 and keeps oldTime fresh) instead of using setFrameloop, which resets clock.elapsedTime.
 * Same implementation as the Playground's; see docs/architecture.md.
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

  set(reason: string, on: boolean): void {
    const was = this.frozen;
    if (on) this.reasons.add(reason);
    else this.reasons.delete(reason);
    if (!was && this.frozen) this.freeze();
    else if (was && !this.frozen) this.thaw();
  }

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
