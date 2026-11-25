/**
 * Minimal AudioWorklet global scope for running the processor under Node.
 *
 * This module is imported for its side effects *before* the processor module,
 * so the `AudioWorkletProcessor` base class exists when the processor's class
 * definition is evaluated.
 */

export class FakePort {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  readonly posted: Record<string, unknown>[] = [];
  postMessage(message: Record<string, unknown>): void {
    this.posted.push(message);
  }
}

const globals = globalThis as Record<string, unknown>;
globals.sampleRate = 48000;
globals.currentFrame = 0;
globals.currentTime = 0;
globals.registerProcessor = () => {};
globals.AudioWorkletProcessor = class {
  readonly port = new FakePort();
};
