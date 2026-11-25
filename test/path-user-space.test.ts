import { describe, expect, it } from "vitest";
import * as pureimage from "../src/index";
import { Path2D } from "../src/index";

const RED = [255, 0, 0, 255];
const GREEN = [0, 255, 0, 255];
const BLUE = [0, 0, 255, 255];

function setup(width = 100, height = 100) {
  const image = pureimage.make(width, height);
  const ctx = image.getContext("2d");
  ctx.fillStyle = "#f00";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#0f0";
  const px = (x: number, y: number) => Array.from(image.getPixelRGBA_separate(x, y));
  return { image, ctx, px };
}

describe("context paths stay in user space", () => {
  it("maps the path through the transform at fill time", () => {
    const { ctx, px } = setup();
    ctx.rect(10, 10, 20, 20);

    // Building the path does not bake in a transform.
    expect(ctx.path[0][1]).toMatchObject({ x: 10, y: 10 });

    ctx.translate(50, 50);
    ctx.fill();
    expect(px(20, 20)).toEqual(RED);
    expect(px(70, 70)).toEqual(GREEN);

    // Changing the transform and filling again moves the same stored path.
    ctx.setTransform(1, 0, 0, 1, 0, 50);
    ctx.fillStyle = "#00f";
    ctx.fill();
    expect(px(20, 70)).toEqual(BLUE);
    expect(px(70, 20)).toEqual(RED);
  });

  it("can be filled again after save/restore", () => {
    const { ctx, px } = setup();
    ctx.rect(10, 10, 20, 20);

    ctx.save();
    ctx.translate(40, 0);
    ctx.fill();
    expect(ctx.isPointInPath(55, 15)).toBe(true);
    ctx.restore();

    // save/restore changes the transform but not the current path.
    expect(ctx.getTransform().e).toBe(0);
    expect(ctx.path).toHaveLength(6);
    ctx.fill();

    expect(px(20, 20)).toEqual(GREEN);
    expect(px(60, 20)).toEqual(GREEN);
  });

  it("keeps a path built inside save() after restore() in user coordinates", () => {
    const { ctx, px } = setup();
    ctx.save();
    ctx.translate(40, 0);
    ctx.rect(10, 40, 20, 20);
    ctx.restore();

    ctx.fill();
    expect(px(20, 50)).toEqual(GREEN);
    expect(px(60, 50)).toEqual(RED);
  });

  it("maps clip() through the transform at clip time", () => {
    const { ctx, px } = setup();
    ctx.rect(0, 0, 20, 20);
    ctx.translate(40, 40);
    ctx.clip();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#00f";
    ctx.fillRect(0, 0, 100, 100);

    expect(px(50, 50)).toEqual(BLUE);
    expect(px(5, 5)).toEqual(RED);
    expect(px(70, 70)).toEqual(RED);
  });

  it("reset clears the path, subpath start and transform", () => {
    const { ctx } = setup();
    ctx.rect(10, 10, 20, 20);
    ctx.translate(30, 40);

    ctx.reset();

    expect(ctx.path).toEqual([]);
    expect((ctx as unknown as { pathstart?: unknown }).pathstart).toBeUndefined();
    expect(ctx.getLineDash()).toEqual([]);
    expect(ctx.lineDashOffset).toBe(0);
    expect([ctx.getTransform().a, ctx.getTransform().d, ctx.getTransform().e, ctx.getTransform().f]).toEqual([
      1, 1, 0, 0,
    ]);
    expect(ctx.isPointInPath(15, 15)).toBe(false);

    // The current point is also reset: lineTo() starts a fresh subpath.
    ctx.lineTo(12, 34);
    expect(ctx.path[0][0]).toBe("m");
    expect(ctx.path[0][1]).toMatchObject({ x: 12, y: 34 });
  });
});

describe("Path2D reuse across transforms", () => {
  it("can be filled and hit-tested under several current transforms", () => {
    const { ctx, px } = setup();
    const path = new Path2D();
    path.rect(0, 0, 10, 10);

    ctx.fill(path);
    expect(px(5, 5)).toEqual(GREEN);

    ctx.setTransform(1, 0, 0, 1, 50, 10);
    ctx.fill(path);
    expect(px(55, 15)).toEqual(GREEN);
    expect(ctx.isPointInPath(path, 55, 15)).toBe(true);
    expect(ctx.isPointInPath(path, 5, 5)).toBe(false);

    ctx.setTransform(2, 0, 0, 2, 0, 40);
    ctx.fill(path);
    expect(px(10, 50)).toEqual(GREEN);
    expect(ctx.isPointInPath(path, 10, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 5, 42)).toBe(true);
  });

  it("addPath updates the subpath start used by a following closePath()", () => {
    const source = new Path2D();
    source.moveTo(0, 0);
    source.lineTo(10, 0);

    const path = new Path2D();
    path.addPath(source, { e: 100, f: 100 });
    expect((path as unknown as { pathstart: { x: number; y: number } }).pathstart).toMatchObject({
      x: 100,
      y: 100,
    });

    path.lineTo(110, 110);
    path.closePath();

    const { ctx } = setup(200, 200);
    expect(ctx.isPointInPath(path, 107, 103)).toBe(true);
    expect(ctx.isPointInPath(path, 103, 107)).toBe(false);
  });

  it("uses a closed added path's closing point as the start for lineTo()", () => {
    const source = new Path2D();
    source.moveTo(0, 0);
    source.lineTo(10, 0);
    source.lineTo(10, 10);
    source.closePath();

    const path = new Path2D();
    path.addPath(source, { e: 20, f: 20 });
    path.lineTo(20, 30);

    const { ctx } = setup(100, 100);
    ctx.lineWidth = 6;
    expect(ctx.isPointInStroke(path, 20, 25)).toBe(true);
  });

  it("addPath leaves the appended last point as the start for lineTo()", () => {
    const source = new Path2D();
    source.moveTo(0, 0);
    source.lineTo(10, 0);

    const path = new Path2D();
    path.addPath(source, { e: 20, f: 20 });
    path.lineTo(20, 30);

    const { ctx } = setup(100, 100);
    ctx.lineWidth = 6;
    expect(ctx.isPointInStroke(path, 25, 25)).toBe(true);
    expect(ctx.isPointInStroke(path, 15, 20)).toBe(false);
  });
});

describe("dashes", () => {
  it("normalize, copy and save/restore their pattern and offset", () => {
    const ctx = pureimage.make(20, 20).getContext("2d");
    ctx.setLineDash([5]);
    expect(ctx.getLineDash()).toEqual([5, 5]);
    const dash = ctx.getLineDash();
    dash.push(99);
    expect(ctx.getLineDash()).toEqual([5, 5]);

    ctx.lineDashOffset = 4;
    ctx.save();
    ctx.setLineDash([2, 3]);
    ctx.lineDashOffset = 1;
    ctx.restore();
    expect(ctx.getLineDash()).toEqual([5, 5]);
    expect(ctx.lineDashOffset).toBe(4);

    expect(() => ctx.setLineDash([1, -2])).not.toThrow();
    expect(ctx.getLineDash()).toEqual([5, 5]);
  });

  it("scale with the current transform at stroke/hit-test time", () => {
    const ctx = pureimage.make(200, 100).getContext("2d");
    ctx.lineWidth = 4;
    ctx.setLineDash([10, 10]);
    ctx.moveTo(0, 50);
    ctx.lineTo(100, 50);

    expect(ctx.isPointInStroke(5, 50)).toBe(true);
    expect(ctx.isPointInStroke(15, 50)).toBe(false);

    ctx.scale(2, 1);
    // Device x = 2 * user x: user 5 is in the first dash, user 15 is in the gap.
    expect(ctx.isPointInStroke(10, 50)).toBe(true);
    expect(ctx.isPointInStroke(30, 50)).toBe(false);
  });
});

describe("invalid negative path arguments", () => {
  it("do not create a subpath on an empty context path", () => {
    const ctx = pureimage.make(20, 20).getContext("2d");

    expect(() => ctx.arc(0, 0, -1, 0, Math.PI)).toThrow(DOMException);
    expect(() => ctx.arcTo(0, 0, 10, 10, -1)).toThrow(DOMException);
    expect(() => ctx.ellipse(0, 0, 5, -2, 0, 0, Math.PI)).toThrow(DOMException);
    expect(() => ctx.roundRect(0, 0, 10, 10, -3)).toThrow(RangeError);

    expect(ctx.path).toHaveLength(0);
    expect((ctx as unknown as { pathstart?: unknown }).pathstart).toBeUndefined();
  });

  it("do not mutate an existing path or its current point", () => {
    const ctx = pureimage.make(40, 40).getContext("2d");
    ctx.moveTo(10, 10);
    ctx.lineTo(20, 10);
    const length = ctx.path.length;

    expect(() => ctx.arcTo(30, 10, 30, 20, -4)).toThrow(DOMException);
    expect(() => ctx.arc(20, 20, -2, 0, 1)).toThrow(DOMException);
    expect(ctx.path).toHaveLength(length);
    expect(ctx.path[ctx.path.length - 1][1]).toMatchObject({ x: 20, y: 10 });

    ctx.lineWidth = 4;
    ctx.lineTo(20, 20);
    expect(ctx.isPointInStroke(20, 15)).toBe(true);
  });

  it("do not pollute a Path2D", () => {
    const path = new Path2D();
    path.moveTo(1, 2);
    const length = path.path.length;

    expect(() => path.arc(0, 0, -1, 0, 1)).toThrow(DOMException);
    expect(() => path.arcTo(1, 1, 2, 2, -1)).toThrow(DOMException);
    expect(path.path).toHaveLength(length);
  });
});
