/**
 * jsdom does not implement the Web Audio API and its HTMLMediaElement is only a
 * partial stub. This harness installs faithful, instrumented fakes so the
 * player's equalizer / HLS lifecycle can be exercised deterministically.
 *
 * The mocks record every graph-level operation (context creation, node
 * connections, disconnections, context close) which is what lets the tests
 * prove that `createMediaElementSource` runs exactly once and that destroy()
 * releases the whole graph.
 */

import { vi } from 'vitest';

export interface MockAudioNode {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  context: MockAudioContext;
  numberOfInputs: number;
  numberOfOutputs: number;
}

export interface MockAudioParam {
  value: number;
  setTargetAtTime: ReturnType<typeof vi.fn>;
  setValueAtTime: ReturnType<typeof vi.fn>;
}

const createAudioParam = (initial = 0): MockAudioParam => ({
  value: initial,
  setTargetAtTime: vi.fn(),
  setValueAtTime: vi.fn(),
});

export class MockAudioContext {
  static createdContexts: MockAudioContext[] = [];
  // Every element ever routed, across all contexts — the browser-wide invariant.
  static globallyRoutedElements: Set<HTMLAudioElement> = new Set();
  // Total number of createMediaElementSource calls across every context.
  static totalMediaElementSourceCalls = 0;

  readonly id: number;
  state: 'suspended' | 'running' | 'closed' = 'running';
  readonly latencyHint: string;
  readonly currentTime = 0;
  readonly destination: MockAudioNode;
  // The elements already routed through this context via createMediaElementSource.
  readonly routedElements: Set<HTMLAudioElement> = new Set();
  readonly connectedNodes: Array<{ from: string; to: string }> = [];
  readonly createdNodes: Record<string, MockAudioNode[]> = {};
  closed = false;
  resume: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  createMediaElementSource: ReturnType<typeof vi.fn>;
  createBiquadFilter: ReturnType<typeof vi.fn>;
  createDynamicsCompressor: ReturnType<typeof vi.fn>;

  constructor(options?: AudioContextOptions) {
    this.id = MockAudioContext.createdContexts.length + 1;
    this.latencyHint = String(options?.latencyHint ?? '');
    MockAudioContext.createdContexts.push(this);

    this.destination = this.makeNode('destination');

    this.resume = vi.fn(() => {
      if (this.state !== 'closed') {
        this.state = 'running';
      }
      return Promise.resolve();
    });

    this.close = vi.fn(() => {
      this.closed = true;
      this.state = 'closed';
      return Promise.resolve();
    });

    this.createMediaElementSource = vi.fn((element: HTMLAudioElement) => {
      // Mirror the real browser invariant: an element can only ever feed ONE
      // graph in its entire lifetime, even across separate AudioContexts.
      if (
        this.routedElements.has(element) ||
        MockAudioContext.globallyRoutedElements.has(element)
      ) {
        throw new DOMException(
          'HTMLMediaElement already connected previously to a different MediaElementSourceNode.',
          'InvalidStateError',
        );
      }
      MockAudioContext.totalMediaElementSourceCalls += 1;
      this.routedElements.add(element);
      MockAudioContext.globallyRoutedElements.add(element);
      const node = this.makeNode('mediaElementSource');
      return node;
    });

    this.createBiquadFilter = vi.fn(() => {
      const node = this.makeNode('biquadFilter') as MockAudioNode & {
        type: BiquadFilterType;
        frequency: MockAudioParam;
        gain: MockAudioParam;
        Q: MockAudioParam;
      };
      node.type = 'peaking';
      node.frequency = createAudioParam(350);
      node.gain = createAudioParam(0);
      node.Q = createAudioParam(1);
      return node;
    });

    this.createDynamicsCompressor = vi.fn(() => {
      const node = this.makeNode('compressor') as MockAudioNode & {
        threshold: MockAudioParam;
        knee: MockAudioParam;
        ratio: MockAudioParam;
        attack: MockAudioParam;
        release: MockAudioParam;
      };
      node.threshold = createAudioParam(-24);
      node.knee = createAudioParam(30);
      node.ratio = createAudioParam(12);
      node.attack = createAudioParam(0.003);
      node.release = createAudioParam(0.25);
      return node;
    });
  }

  private makeNode(kind: string): MockAudioNode {
    if (!this.createdNodes[kind]) {
      this.createdNodes[kind] = [];
    }
    const bucket = this.createdNodes[kind] as MockAudioNode[];
    const label = `${kind}#${bucket.length}`;
    const node: MockAudioNode = {
      connect: vi.fn((destination: MockAudioNode) => {
        this.connectedNodes.push({ from: label, to: this.describe(destination) });
        return destination;
      }),
      disconnect: vi.fn(),
      context: this,
      numberOfInputs: 1,
      numberOfOutputs: 1,
    };
    bucket.push(node);
    return node;
  }

  private describe(node: MockAudioNode): string {
    const entries = Object.entries(this.createdNodes);
    for (const [kind, nodes] of entries) {
      const index = nodes.indexOf(node);
      if (index !== -1) {
        return `${kind}#${index}`;
      }
    }
    return 'unknown';
  }

  countNode(kind: string): number {
    return this.createdNodes[kind]?.length ?? 0;
  }

  static reset() {
    MockAudioContext.createdContexts = [];
    MockAudioContext.globallyRoutedElements.clear();
    MockAudioContext.totalMediaElementSourceCalls = 0;
  }
}

/**
 * Minimal HTMLAudioElement fake with the handful of properties/methods the
 * player drives directly. `play()` resolves and tracks invocation so tests can
 * assert pause/resume behavior without a real decoder.
 */
export class MockAudioElement {
  static readonly HAVE_NOTHING = 0;
  static readonly HAVE_METADATA = 1;
  static readonly HAVE_CURRENT_DATA = 2;
  static readonly HAVE_FUTURE_DATA = 3;
  static readonly HAVE_ENOUGH_DATA = 4;

  readonly HAVE_NOTHING = 0;
  readonly HAVE_METADATA = 1;
  readonly HAVE_CURRENT_DATA = 2;
  readonly HAVE_FUTURE_DATA = 3;
  readonly HAVE_ENOUGH_DATA = 4;

  src = '';
  srcObject: MediaStream | null = null;
  paused = true;
  // jsdom elements start at HAVE_NOTHING (0); tests flip this to
  // HAVE_ENOUGH_DATA once a source is loaded so the player's play() guard passes.
  readyState = 0;
  muted = false;
  volume = 1;
  playbackRate = 1;
  currentTime = 0;
  loop = false;
  autoplay = false;
  preload = '';
  crossOrigin: string | null = null;
  error: MediaError | null = null;
  readonly buffered: TimeRanges = {
    length: 0,
    start: () => 0,
    end: () => 0,
  };
  readonly played: TimeRanges = {
    length: 0,
    start: () => 0,
    end: () => 0,
  };

  readonly load = vi.fn();
  readonly play = vi.fn(() => {
    this.paused = false;
    return Promise.resolve();
  });
  readonly pause = vi.fn(() => {
    this.paused = true;
  });
  readonly setAttribute = vi.fn();
  readonly removeAttribute = vi.fn();
  readonly addEventListener = vi.fn();
  readonly removeEventListener = vi.fn();
  canPlayType = vi.fn(() => '');
}

export function installWebAudioMocks() {
  vi.stubGlobal('AudioContext', MockAudioContext);
  // Keep webkitAudioContext absent to exercise the standard code path.
  vi.stubGlobal('webkitAudioContext', undefined);
  vi.stubGlobal('Audio', MockAudioElement);
}

export function resetWebAudioMocks() {
  MockAudioContext.reset();
  vi.unstubAllGlobals();
}
