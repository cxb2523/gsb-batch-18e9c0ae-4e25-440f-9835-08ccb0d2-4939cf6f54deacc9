import { describe, expect, it } from "vitest";
import type { Side, Swing } from "../protocol.ts";
import {
	createMatch,
	type MatchState,
	type RallyInput,
	tick,
} from "./index.ts";
import { TOSS_APEX } from "./serve.ts";
import { TIMING_IDEAL, TIMING_LATE } from "./shot.ts";
import { swingVerdicts } from "./verdict.ts";

const DT = 1 / 120;

const swing = (power: number, lag = 0): Swing => ({
	kind: "forehand",
	power,
	at: 0,
	lag,
});

const input = (side: Side, s: MatchState, sw: Swing): RallyInput => ({
	side,
	swing: sw,
	time: s.time,
});

function until(
	s: MatchState,
	stop: (s: MatchState) => boolean,
	limit = 3000,
): MatchState {
	let current = s;
	for (let i = 0; i < limit && !stop(current); i++) {
		current = tick(current, [], DT);
	}
	if (!stop(current)) throw new Error("never happened");
	return current;
}

/** Tosses, waits for the top of the toss, and hits it. */
function serve(s: MatchState, power = 0.6): MatchState {
	const server = s.toHit;
	const tossed = tick(s, [input(server, s, swing(0.5))], DT);
	const top = until(tossed, (x) => x.time >= tossed.time - DT + TOSS_APEX);
	return tick(top, [input(server, top, swing(power))], DT);
}

/** `far` serves to `near`; state once near's contact is frozen. */
function awaitingReturn(): MatchState {
	const served = serve(createMatch("far"));
	return until(
		served,
		(x) => x.phase === "rally" && x.bounces === 1 && x.contact !== null,
	);
}

describe("swingVerdicts — the host's authoritative ruling", () => {
	it("is empty when nothing about strokes or whiffs changed", () => {
		const s = createMatch("near");
		expect(swingVerdicts(s, s)).toEqual([]);
	});

	// A1, host half: a normal, in-window swing produces a new Stroke, so the
	// ruling routed back is `hit` for exactly that side.
	it("rules hit for the side that struck a new stroke", () => {
		const before = awaitingReturn();
		const c = before.contact;
		if (!c) throw new Error("no contact");
		const onTime = until(before, (x) => x.time >= c.at + TIMING_IDEAL);

		const after = tick(onTime, [input("near", onTime, swing(0.7))], DT);

		expect(after.stroke?.side).toBe("near");
		expect(swingVerdicts(onTime, after)).toEqual([
			{ side: "near", verdict: "hit" },
		]);
	});

	// A3: a reported swing outside the timing window advances the sim's whiff
	// counter. The ruling must be `whiff` (落空), never `hit`.
	it("rules whiff, not hit, when the swing lands outside the timing window", () => {
		const before = awaitingReturn();
		const c = before.contact;
		if (!c) throw new Error("no contact");
		const late = until(
			before,
			(x) => x.time >= c.at + TIMING_IDEAL + TIMING_LATE + 0.05,
		);

		const after = tick(late, [input("near", late, swing(0.9))], DT);

		expect(after.whiffs.near).toBe(late.whiffs.near + 1);
		const verdicts = swingVerdicts(late, after);
		expect(verdicts).toContainEqual({ side: "near", verdict: "whiff" });
		expect(verdicts.some((v) => v.verdict === "hit")).toBe(false);
	});

	it("attributes each ruling to its own side when both counters move", () => {
		const base = createMatch("near");
		const before: MatchState = {
			...base,
			whiffs: { near: 0, far: 0 },
		};
		const after: MatchState = {
			...base,
			whiffs: { near: 1, far: 1 },
		};
		expect(swingVerdicts(before, after)).toEqual([
			{ side: "near", verdict: "whiff" },
			{ side: "far", verdict: "whiff" },
		]);
	});

	// A harder peak revising the same stroke is not a second hit verdict:
	// one real swing stays one ruling.
	it("does not emit a second hit for a revised stroke at the same contact time", () => {
		const s = createMatch("near");
		const at = 1.25;
		const stroke = {
			side: "near" as const,
			kind: "forehand" as const,
			power: 0.4,
			air: false,
			at,
			from: { x: 0, y: 1, z: 0 },
			timing: 0,
			powerShot: false,
		};
		const before: MatchState = { ...s, stroke };
		const after: MatchState = {
			...s,
			stroke: { ...stroke, power: 0.9 },
		};
		expect(swingVerdicts(before, after)).toEqual([]);
	});
});
