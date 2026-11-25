import { beforeEach, describe, expect, it } from 'vitest';
import {
  MockAudioContext,
  MockAudioElement,
  installWebAudioMocks,
  resetWebAudioMocks,
} from './setup/webAudioMock';

describe('Web Audio mock invariants', () => {
  beforeEach(() => {
    resetWebAudioMocks();
    installWebAudioMocks();
  });

  it('throws when the same element is routed into a graph a second time', () => {
    const ctx = new MockAudioContext();
    const el = new MockAudioElement() as unknown as HTMLAudioElement;

    expect(() => ctx.createMediaElementSource(el)).not.toThrow();
    expect(ctx.createMediaElementSource).toHaveBeenCalledTimes(1);

    expect(() => ctx.createMediaElementSource(el)).toThrow(DOMException);
    expect(ctx.routedElements.size).toBe(1);
  });

  it('allows a fresh context to route a fresh element after teardown', () => {
    const first = new MockAudioContext();
    const firstEl = new MockAudioElement() as unknown as HTMLAudioElement;
    first.createMediaElementSource(firstEl);
    expect(first.routedElements.size).toBe(1);

    const second = new MockAudioContext();
    const secondEl = new MockAudioElement() as unknown as HTMLAudioElement;
    expect(() => second.createMediaElementSource(secondEl)).not.toThrow();
    expect(second.routedElements.size).toBe(1);
  });
});
