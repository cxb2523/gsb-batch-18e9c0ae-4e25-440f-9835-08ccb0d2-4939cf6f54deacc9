import { describe, expect, it, vi } from "vitest";
import type { FeedbackKind } from "../shared/protocol.ts";
import { dispatchFeedback, type FeedbackCueSink } from "./feedback.ts";

function fakeRacket(): FeedbackCueSink & { cues: string[] } {
	const cues: string[] = [];
	return {
		cues,
		hit: vi.fn(() => cues.push("hit")),
		whiff: vi.fn(() => cues.push("whiff")),
		miss: vi.fn(() => cues.push("miss")),
		point: vi.fn(() => cues.push("point")),
		refused: vi.fn(() => cues.push("refused")),
	};
}

describe("dispatchFeedback — the phone presents only what the host ruled", () => {
	it("A1: hit drives the hit celebration with the last shown power", () => {
		const racket = fakeRacket();
		dispatchFeedback(racket, "hit", 0.82);
		expect(racket.hit).toHaveBeenCalledWith(0.82);
		expect(racket.cues).toEqual(["hit"]);
	});

	// A3: the crucial regression — a host whiff must show 落空 and must NOT
	// fall through to the hit animation.
	it("A3: whiff drives the whiff cue, never hit", () => {
		const racket = fakeRacket();
		dispatchFeedback(racket, "whiff", 0.9);
		expect(racket.whiff).toHaveBeenCalledOnce();
		expect(racket.hit).not.toHaveBeenCalled();
		expect(racket.cues).toEqual(["whiff"]);
	});

	it("routes a host/local refused verdict to the refusal cue", () => {
		const racket = fakeRacket();
		dispatchFeedback(racket, "refused", 0.5);
		expect(racket.refused).toHaveBeenCalledOnce();
		expect(racket.hit).not.toHaveBeenCalled();
	});

	it("keeps point and miss as distinct point-level cues", () => {
		const racket = fakeRacket();
		dispatchFeedback(racket, "point", 0);
		dispatchFeedback(racket, "miss", 0);
		expect(racket.cues).toEqual(["point", "miss"]);
	});

	it("does not throw before the racket exists", () => {
		expect(() => dispatchFeedback(null, "hit", 0.5)).not.toThrow();
		expect(() => dispatchFeedback(undefined, "whiff", 0)).not.toThrow();
	});

	it("covers every wire feedback kind with exactly one cue", () => {
		const kinds: FeedbackKind[] = ["hit", "whiff", "refused", "miss", "point"];
		for (const kind of kinds) {
			const racket = fakeRacket();
			dispatchFeedback(racket, kind, 0.5);
			expect(racket.cues, kind).toHaveLength(1);
		}
	});
});
