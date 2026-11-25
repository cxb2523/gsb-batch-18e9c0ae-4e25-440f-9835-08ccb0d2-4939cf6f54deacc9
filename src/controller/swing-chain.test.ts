/**
 * Acceptance chain for task 41090, entirely pure logic (no browser, no
 * sockets): the real phone gate -> only admitted swings become sim inputs ->
 * the host's `swingVerdicts` -> `playerIdForSide` routing -> the phone cue
 * dispatcher. The relay half of id routing is covered over real sockets in
 * `tests/integration/relay.test.ts`.
 *
 * The A1..A5 labels line up with the task's acceptance checks.
 */
import { describe, expect, it, vi } from "vitest";
import type { LobbyPlayer, Side, SwingVerdict } from "../shared/protocol.ts";
import { playerIdForSide } from "../shared/protocol.ts";
import {
	createMatch,
	type MatchState,
	type RallyInput,
	swingVerdicts,
	tick,
} from "../shared/sim/index.ts";
import { TOSS_APEX } from "../shared/sim/serve.ts";
import { TIMING_IDEAL, TIMING_LATE } from "../shared/sim/shot.ts";
import {
	admitPeak,
	createSwingGate,
	SWING_COOLDOWN_MS,
	SWING_GROUP_MS,
	type SwingGate,
} from "../shared/swing/gate.ts";
import { dispatchFeedback, type FeedbackCueSink } from "./feedback.ts";

const DT = 1 / 120;

function swing(power: number): {
	kind: "forehand";
	power: number;
	at: 0;
	lag: 0;
} {
	return { kind: "forehand", power, at: 0, lag: 0 };
}

function until(
	s: MatchState,
	stop: (s: MatchState) => boolean,
	limit = 3000,
): MatchState {
	let current = s;
	for (let i = 0; i < limit && !stop(current); i++)
		current = tick(current, [], DT);
	if (!stop(current)) throw new Error("never happened");
	return current;
}

function serve(s: MatchState): MatchState {
	const server = s.toHit;
	const tossed = tick(
		s,
		[{ side: server, swing: swing(0.5), time: s.time }],
		DT,
	);
	const top = until(tossed, (x) => x.time >= tossed.time - DT + TOSS_APEX);
	return tick(top, [{ side: server, swing: swing(0.6), time: top.time }], DT);
}

/** far serves to near, with near's frozen contact planned. */
function awaitingReturn(): MatchState {
	return until(
		serve(createMatch("far")),
		(x) => x.phase === "rally" && x.bounces === 1 && x.contact !== null,
	);
}

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

interface Phone {
	playerId: string;
	side: Side;
	gate: SwingGate;
	racket: ReturnType<typeof fakeRacket>;
	inbox: SwingVerdict[];
	reports: RallyInput[];
}

function phone(playerId: string, side: Side): Phone {
	return {
		playerId,
		side,
		gate: createSwingGate(),
		racket: fakeRacket(),
		inbox: [],
		reports: [],
	};
}

const ROSTER: LobbyPlayer[] = [
	{ playerId: "p_near", side: "near", ready: true, connected: true },
	{ playerId: "p_far", side: "far", ready: true, connected: true },
];

/** The phone's onMotion gate step. Returns false when locally refused. */
function swingPeak(
	p: Phone,
	at: number,
	power: number,
	active: boolean,
): boolean {
	if (!admitPeak(p.gate, at, power, active)) {
		// main.ts calls racket.refused() directly for a local gate rejection.
		dispatchFeedback(p.racket, "refused", power);
		return false;
	}
	return true;
}

/** Host half: state diff -> verdict -> playerId -> that phone's cue. */
function deliverRulings(
	before: MatchState,
	after: MatchState,
	phones: readonly Phone[],
): void {
	for (const ruling of swingVerdicts(before, after)) {
		const id = playerIdForSide(ROSTER, ruling.side);
		const target = phones.find((p) => p.playerId === id);
		if (!target) continue;
		target.inbox.push(ruling.verdict);
		dispatchFeedback(target.racket, ruling.verdict, 0.7);
	}
}

describe("A1 — normal swing: gate passes, host hits, correct phone sees hit", () => {
	it("routes the hit verdict end to end", () => {
		const near = phone("p_near", "near");
		const far = phone("p_far", "far");
		const before0 = awaitingReturn();
		const c = before0.contact;
		if (!c) throw new Error("no contact");
		const atContact = until(before0, (x) => x.time >= c.at + TIMING_IDEAL);

		expect(swingPeak(near, 5000, 0.7, true)).toBe(true);
		const input: RallyInput = {
			side: "near",
			swing: swing(0.7),
			time: atContact.time,
		};
		near.reports.push(input);

		const after = tick(atContact, near.reports, DT);
		deliverRulings(atContact, after, [near, far]);

		expect(after.stroke?.side).toBe("near");
		expect(near.inbox).toEqual(["hit"]);
		expect(near.racket.hit).toHaveBeenCalledOnce();
		expect(near.racket.cues).toEqual(["hit"]);
		// The other phone must not animate near's hit as its own.
		expect(far.racket.hit).not.toHaveBeenCalled();
		expect(far.inbox).toEqual([]);
	});
});

describe("A2 — cooldown swing: locally refused, cued, and never reported", () => {
	it("does not create a host input for a refused peak", () => {
		const near = phone("p_near", "near");
		expect(swingPeak(near, 1000, 0.6, true)).toBe(true);
		// main.ts sends exactly the admitted peak.
		near.reports.push({
			side: "near",
			swing: swing(0.6),
			time: 1000 / 1000,
		});

		const secondAt = 1000 + SWING_GROUP_MS + 1;
		expect(swingPeak(near, secondAt, 0.6, true)).toBe(false);
		expect(swingPeak(near, 1000 + SWING_COOLDOWN_MS - 1, 0.6, true)).toBe(
			false,
		);

		expect(near.racket.refused).toHaveBeenCalledTimes(2);
		// The two refused peaks never became wire reports.
		expect(near.reports).toHaveLength(1);
	});

	it("the first swing after a gate reset (serve) passes", () => {
		const gate = createSwingGate();
		gate.admit(0, 0.8);
		gate.reset();
		expect(admitPeak(gate, 50, 0.9, false)).toBe(true); // inactive resets + admits
		expect(gate.admit(51, 0.9)).toBe(true);
	});
});

describe("A3 — host whiff becomes a phone whiff cue, never a hit", () => {
	it("shows 落空 for a swing outside TIMING_EARLY/TIMING_LATE", () => {
		const near = phone("p_near", "near");
		const before = awaitingReturn();
		const c = before.contact;
		if (!c) throw new Error("no contact");
		const late = until(
			before,
			(x) => x.time >= c.at + TIMING_IDEAL + TIMING_LATE + 0.05,
		);

		const after = tick(
			late,
			[{ side: "near", swing: swing(0.9), time: late.time }],
			DT,
		);
		deliverRulings(late, after, [near]);

		expect(after.whiffs.near).toBe(late.whiffs.near + 1);
		expect(near.inbox).toEqual(["whiff"]);
		expect(near.racket.whiff).toHaveBeenCalledOnce();
		expect(near.racket.hit).not.toHaveBeenCalled();
		expect(near.racket.cues).toEqual(["whiff"]);
	});
});

describe("A4 — two phones at once: playerId keeps the verdicts apart", () => {
	it("delivers near-hit and far-whiff to the matching rackets only", () => {
		const near = phone("p_near", "near");
		const far = phone("p_far", "far");
		const base = createMatch("near");
		const stroke = {
			side: "near" as const,
			kind: "forehand" as const,
			power: 0.7,
			air: false,
			at: 2.5,
			from: { x: 0, y: 1, z: 0 },
			timing: 0,
			powerShot: false,
		};
		const before: MatchState = {
			...base,
			stroke: { ...stroke, at: 2 },
			whiffs: { near: 0, far: 0 },
		};
		const after: MatchState = {
			...base,
			stroke,
			whiffs: { near: 0, far: 1 },
		};

		deliverRulings(before, after, [near, far]);

		expect(near.inbox).toEqual(["hit"]);
		expect(near.racket.hit).toHaveBeenCalledOnce();
		expect(far.inbox).toEqual(["whiff"]);
		expect(far.racket.whiff).toHaveBeenCalledOnce();
		// No cross-delivery.
		expect(near.racket.whiff).not.toHaveBeenCalled();
		expect(far.racket.hit).not.toHaveBeenCalled();
	});
});

describe("A5 — reconnect resets the gate: first swing passes", () => {
	it("admits immediately after the reconnect reset despite a stale cooldown", () => {
		const near = phone("p_near", "near");
		expect(swingPeak(near, 8000, 0.7, true)).toBe(true);
		const reopenedAt = 8000 + SWING_GROUP_MS + 100;
		// Stale gate would refuse this.
		expect(near.gate.admit(reopenedAt, 0.7)).toBe(false);

		// A fresh `assigned` after reconnect runs main.ts's cooldown.reset().
		near.gate.reset();
		expect(swingPeak(near, reopenedAt, 0.7, true)).toBe(true);
		expect(near.racket.refused).not.toHaveBeenCalled();
	});
});
