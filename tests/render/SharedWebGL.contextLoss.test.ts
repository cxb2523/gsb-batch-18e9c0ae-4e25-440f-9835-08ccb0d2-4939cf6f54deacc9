import { afterEach, describe, expect, it, jest, spyOn } from "bun:test";
import { SharedWebGLContext } from "../../src/render/webgl2/SharedWebGL.ts";
import { WebGL2Backend } from "../../src/render/webgl2/WebGL2Backend.ts";
import { SegmentSet } from "../../src/render/SegmentSet.ts";
import type { ChartRenderer } from "../../src/render/ChartRenderer.ts";
import type { DrawCommand, GpuBackend } from "../../src/render/webgl2/types.ts";
import { releaseWarm } from "../../src/render/webgl2/warm.ts";
import { FakeGl } from "./fakeGl.ts";

const style = {
  first: 0,
  count: 2,
  scaleX: 1,
  scaleY: 1,
  offsetX: 0,
  offsetY: 0,
  width: 1,
  color: [1, 1, 1, 1] as [number, number, number, number],
};
const makeSet = () => new SegmentSet(new Float32Array([0, 0, 10, 0, 10, 10]), 3, new Uint32Array([0, 1, 1, 2]), 2);

interface FakeShared {
  gl: FakeGl;
  shared: SharedWebGLContext;
  client: ChartRenderer;
  hidden: EventTarget;
  lose: () => void;
  restore: () => void;
}

/** A shared context whose hidden canvas is a fakeGl-backed WebGL2Backend, with loss/restore drivers. */
function fakeShared(): FakeShared {
  const gl = new FakeGl();
  const hidden = new EventTarget();
  const hiddenCanvas = Object.assign(hidden, { width: 100, height: 100, getContext: () => gl }) as unknown as HTMLCanvasElement;
  const chartCanvas = Object.assign(new EventTarget(), {
    width: 100,
    height: 100,
    getContext: (kind: string) => (kind === "2d" ? { setTransform() {}, clearRect() {}, drawImage() {} } : null),
  }) as unknown as HTMLCanvasElement;
  const doc = { createElement: () => hiddenCanvas } as unknown as Document;
  const shared = new SharedWebGLContext(doc, (canvas) => new WebGL2Backend(canvas));
  const client = shared.renderer()({ canvas: chartCanvas }) as ChartRenderer;
  return {
    gl,
    shared,
    client,
    hidden,
    lose: () => {
      gl.lost = true;
      hidden.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    },
    restore: () => {
      gl.lost = false;
      gl.generation++;
      gl.enabled.clear();
      hidden.dispatchEvent(new Event("webglcontextrestored"));
    },
  };
}

function drawFrame(f: Pick<FakeShared, "client">, set: SegmentSet): void {
  f.client.beginFrame(100, 100, 1);
  f.client.drawSegmentSet(set, style);
  f.client.endFrame();
}

afterEach(() => {
  // Flush any pending shared-context idle teardown while its fakes are still in scope, then restore timers.
  releaseWarm();
  jest.useRealTimers();
});

describe("shared renderer segment-set context restore (acceptance A1-A4)", () => {
  it("A1: fully uploads the set to the new backend on its first draw after restore, with no partial upload", () => {
    const f = fakeShared();
    const set = makeSet();
    drawFrame(f, set);
    expect(f.gl.count("texImage2D")).toBe(1);
    expect(f.gl.count("texSubImage2D")).toBe(0);

    f.lose();
    f.restore();

    // The first post-restore draw is a fresh GPU copy: one full upload, never a partial row update.
    drawFrame(f, set);
    expect(f.gl.count("texImage2D")).toBe(2);
    expect(f.gl.count("texSubImage2D")).toBe(0);

    // Drawing again without changes uploads nothing further.
    drawFrame(f, set);
    expect(f.gl.count("texImage2D")).toBe(2);
    expect(f.gl.count("texSubImage2D")).toBe(0);

    f.client.dispose();
  });

  it("A1: a set changed while the context was lost is still uploaded in full on the first restored draw", () => {
    const f = fakeShared();
    const set = makeSet();
    drawFrame(f, set);

    f.lose();
    set.setPoints(new Float32Array([9, 9, 8, 8]), 0);
    f.restore();

    drawFrame(f, set);
    // The replacement copy seeds its version at the set's current version, so it must not partial-upload.
    expect(f.gl.count("texImage2D")).toBe(2);
    expect(f.gl.count("texSubImage2D")).toBe(0);

    f.client.dispose();
  });

  it("A2: after restore, a small point change uploads exactly the touched row range once", () => {
    const f = fakeShared();
    const set = makeSet();
    drawFrame(f, set);
    f.lose();
    f.restore();
    drawFrame(f, set); // full re-upload on the new backend

    const sub = spyOn(f.gl, "texSubImage2D");
    set.setPoints(new Float32Array([5, 5]), 1);
    drawFrame(f, set);
    expect(sub).toHaveBeenCalledTimes(1);
    // Row origin (argument index 3) 0 and one row high (index 5): the edited points live in row 0.
    const args = sub.mock.calls[0] as unknown as readonly number[];
    expect(args[3]).toBe(0);
    expect(args[5]).toBe(1);

    // No further upload when nothing changed.
    drawFrame(f, set);
    expect(sub).toHaveBeenCalledTimes(1);
    f.client.dispose();
  });

  it("A3: disposing the set after restore deletes texture/index buffer/VAO exactly once on the healthy context", () => {
    const f = fakeShared();
    const set = makeSet();
    drawFrame(f, set);
    f.lose();
    f.restore();
    drawFrame(f, set);

    f.gl.validDeletes.length = 0;
    f.gl.invalidDeletes.length = 0;
    set.dispose();
    expect(f.gl.invalidDeletes).toEqual([]);
    expect(f.gl.validDeletes.filter((k) => k === "texture")).toHaveLength(1);
    expect(f.gl.validDeletes.filter((k) => k === "buffer")).toHaveLength(1);
    expect(f.gl.validDeletes.filter((k) => k === "vertexArray")).toHaveLength(1);

    // A second dispose releases nothing more.
    set.dispose();
    expect(f.gl.validDeletes.filter((k) => k === "texture")).toHaveLength(1);
    expect(f.gl.validDeletes.filter((k) => k === "vertexArray")).toHaveLength(1);
    expect(f.gl.invalidDeletes).toEqual([]);
    f.client.dispose();
  });

  it("A3: disposing the new backend before the set releases its objects and never double-frees on set.dispose", () => {
    const f = fakeShared();
    const set = makeSet();
    drawFrame(f, set);
    f.lose();
    f.restore();
    drawFrame(f, set);

    f.gl.validDeletes.length = 0;
    f.gl.invalidDeletes.length = 0;
    // Last chart goes away and the idle shared context is torn down immediately.
    f.client.dispose();
    f.shared.dispose();
    // The backend frees the set's point texture exactly once (the only texture this frame created).
    expect(f.gl.validDeletes.filter((k) => k === "texture")).toHaveLength(1);
    const deletesAtBackendTeardown = f.gl.validDeletes.length;

    // The backend unregistered the set's release callback, so disposing the set now deletes nothing more.
    set.dispose();
    expect(f.gl.validDeletes).toHaveLength(deletesAtBackendTeardown);
    expect(f.gl.invalidDeletes).toEqual([]);
  });

  it("A4: a successful restore unregisters the old backend's release callback; later set disposal never touches the dead generation", () => {
    const f = fakeShared();
    const set = makeSet();
    drawFrame(f, set);
    f.lose();
    f.restore(); // destroys the old (lost) backend, which must drop its onRelease registration
    drawFrame(f, set);

    set.dispose();
    expect(f.gl.invalidDeletes).toEqual([]);
    // Exactly one texture (the new backend's) is deleted despite both backends having held the set.
    expect(f.gl.validDeletes.filter((k) => k === "texture")).toHaveLength(1);
    f.client.dispose();
  });

  it("A4: destroying the shared context while still lost drops callbacks without deleting invalid objects", () => {
    const f = fakeShared();
    const set = makeSet();
    drawFrame(f, set);
    f.lose();

    f.client.dispose();
    f.shared.dispose(); // renderer.dispose -> old backend.destroy on a lost context
    expect(f.gl.invalidDeletes).toEqual([]);

    set.dispose(); // old backend must no longer be subscribed, and must not delete anything
    expect(f.gl.invalidDeletes).toEqual([]);
    // No valid texture delete either: a lost-context backend drops objects without GL deletes.
    expect(f.gl.validDeletes.filter((k) => k === "texture")).toHaveLength(0);
  });

  it("A4: disposing a set while lost unregisters before teardown and never deletes on the invalid context", () => {
    const f = fakeShared();
    const set = makeSet();
    drawFrame(f, set);
    f.lose();

    set.dispose(); // fires the old backend's release, which must skip GL deletes on a lost context
    expect(f.gl.invalidDeletes).toEqual([]);

    f.restore(); // destroys the old backend; the disposed set is already out of its map and release list
    expect(f.gl.invalidDeletes).toEqual([]);

    // Other still-drawn sets still rebuild normally on the new backend.
    const other = makeSet();
    drawFrame(f, other);
    expect(f.gl.count("texImage2D")).toBe(2);
    other.dispose();
    expect(f.gl.invalidDeletes).toEqual([]);
    f.client.dispose();
  });

  it("survives several loss/restore cycles without invalid or duplicate deletes", () => {
    const f = fakeShared();
    const set = makeSet();
    for (let cycle = 0; cycle < 3; cycle++) {
      drawFrame(f, set);
      f.lose();
      f.restore();
    }
    drawFrame(f, set);
    expect(f.gl.invalidDeletes).toEqual([]);
    set.dispose();
    expect(f.gl.invalidDeletes).toEqual([]);
    expect(f.gl.validDeletes.filter((k) => k === "texture")).toHaveLength(1);
    expect(f.gl.validDeletes.filter((k) => k === "vertexArray")).toHaveLength(1);
    f.client.dispose();
  });
});

class MockBackend implements GpuBackend {
  readonly submits: Array<{ commands: readonly DrawCommand[] }> = [];
  destroyCount = 0;
  private readonly gl = { isContextLost: () => false, getExtension: () => null } as unknown as WebGL2RenderingContext;
  getContext(): WebGL2RenderingContext {
    return this.gl;
  }
  submit(_stream: Float32Array, _floatCount: number, commands: readonly DrawCommand[]): void {
    this.submits.push({ commands: [...commands] });
  }
  clear(): void {}
  viewport(): void {}
  prepare(): void {}
  destroy(): void {
    this.destroyCount++;
  }
}

describe("shared renderer restore retry gating (A5)", () => {
  function mockShared(initialFailures: number) {
    jest.useFakeTimers();
    const backends: MockBackend[] = [];
    let failures = initialFailures;
    const hidden = new EventTarget();
    const hiddenCanvas = hidden as unknown as HTMLCanvasElement;
    const chartCanvas = {
      getContext: () => ({ setTransform() {}, clearRect() {}, drawImage() {} }),
    } as unknown as HTMLCanvasElement;
    const doc = { createElement: () => hiddenCanvas } as unknown as Document;
    const shared = new SharedWebGLContext(doc, () => {
      // First call builds the live backend; later calls are restore attempts.
      if (backends.length > 0 && failures > 0) {
        failures--;
        throw new Error("no WebGL2");
      }
      const backend = new MockBackend();
      backends.push(backend);
      return backend;
    });
    const client = shared.renderer()({ canvas: chartCanvas }) as ChartRenderer;
    return {
      shared,
      client,
      backends,
      lose: () => hidden.dispatchEvent(new Event("webglcontextlost", { cancelable: true })),
      tryRestore: () => hidden.dispatchEvent(new Event("webglcontextrestored")),
    };
  }

  it("A5: isLost stays true and no frame is submitted while a rebuild retry is pending, then draws on recovery", () => {
    const t = mockShared(1);
    const set = makeSet();
    t.client.beginFrame(100, 100, 1);
    t.client.drawSegmentSet(set, style);
    t.client.endFrame();
    expect(t.backends[0]!.submits).toHaveLength(1);

    const errors = spyOn(console, "error").mockImplementation(() => {});
    t.lose();
    t.tryRestore(); // first rebuild fails; a retry is scheduled
    expect(t.shared.isLost).toBe(true);

    // Frames attempted during the retry window must not reach the old backend.
    t.client.beginFrame(100, 100, 1);
    t.client.drawSegmentSet(set, style);
    const report = t.client.endFrame();
    expect(t.backends[0]!.submits).toHaveLength(1);
    expect(report.drawCalls).toBe(0);

    jest.advanceTimersByTime(300); // scheduled retry succeeds
    expect(t.shared.isLost).toBe(false);
    t.client.beginFrame(100, 100, 1);
    t.client.drawSegmentSet(set, style);
    t.client.endFrame();
    expect(t.backends[1]!.submits).toHaveLength(1);
    // The very same still-drawn set is what the new backend receives, so its per-backend cache rebuilds it.
    const restoredCommand = t.backends[1]!.submits[0]!.commands[0];
    expect(restoredCommand?.kind).toBe("segmentSet");
    if (restoredCommand?.kind === "segmentSet") expect(restoredCommand.set).toBe(set);
    // The old backend was destroyed exactly once when its replacement was installed.
    expect(t.backends[0]!.destroyCount).toBe(1);
    errors.mockRestore();
    t.client.dispose();
  });

  it("A5: disposing the last client during a pending retry tears the shared context down without leaking the timer", () => {
    const t = mockShared(100); // never recovers within the assertions
    expect(t.shared.chartCount).toBe(1);
    const errors = spyOn(console, "error").mockImplementation(() => {});
    t.lose();
    t.tryRestore();
    expect(t.shared.isLost).toBe(true);

    t.client.dispose();
    expect(t.shared.chartCount).toBe(0);
    // Immediate idle teardown (the test asks for it) disposes the renderer and clears the retry timer.
    t.shared.dispose();
    const createsBefore = t.backends.length;
    jest.advanceTimersByTime(60_000);
    expect(t.backends.length).toBe(createsBefore);
    errors.mockRestore();
  });
});
