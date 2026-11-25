/**
 * The phone half of the verdict chain, exercised as pure logic with the real
 * gate and a recording stand-in for the socket + racket. It calls the same
 * `admitPeak` decision `controller/main.ts` calls, so "refused means not sent"
 * is a property of production code, not of this harness.
 */
import { describe, expect, it } from "vitest";
import type { Swing } from "../protocol.ts";
import {
	admitPeak,
	createSwingGate,
	SWING_COOLDOWN_MS,
	SWING_GROUP_MS,
} from "./gate.ts";

interface SentPeak {
	at: number;
	power: number;
}

/** Mirrors main.ts's onMotion disposition, recording wire and racket cues. */
function createPhoneChain() {
	const gate = createSwingGate();
	const sent: SentPeak[] = [];
	const cues: Array<"charge" | "refused"> = [];
	let gateActive = true;
	return {
		setGateActive(active: boolean) {
			gateActive = active;
		},
		/** A (re)assigned socket: main.ts resets the gate on every `assigned`. */
		reconnected() {
			gate.reset();
		},
		peak(peak: Pick<Swing, "at" | "power">) {
			if (!admitPeak(gate, peak.at, peak.power, gateActive)) {
				cues.push("refused");
				return false;
			}
			sent.push({ at: peak.at, power: peak.power });
			cues.push("charge");
			return true;
		},
		sent,
		cues,
	};
}

describe("phone swing chain — gate before the wire", () => {
	it("A1: a peak with the cooldown full is admitted, shown charging and sent", () => {
		const phone = createPhoneChain();
		expect(phone.peak({ at: 5000, power: 0.7 })).toBe(true);
		expect(phone.sent).toEqual([{ at: 5000, power: 0.7 }]);
		expect(phone.cues).toEqual(["charge"]);
	});

	it("A2: a new swing before recharge is refused locally, shown red, and never sent", () => {
		const phone = createPhoneChain();
		expect(phone.peak({ at: 1000, power: 0.6 })).toBe(true);

		// Past the group window (so it is a new swing, not a peak of the last)
		// but still inside SWING_COOLDOWN_MS.
		const secondAt = 1000 + SWING_GROUP_MS + 1;
		expect(phone.peak({ at: secondAt, power: 0.6 })).toBe(false);
		expect(phone.peak({ at: 1000 + SWING_COOLDOWN_MS - 1, power: 0.6 })).toBe(
			false,
		);

		// Exactly one report went out; the two rejected peaks cued refusal.
		expect(phone.sent).toHaveLength(1);
		expect(phone.cues).toEqual(["charge", "refused", "refused"]);
	});

	it("A2: once SWING_COOLDOWN_MS has elapsed the next swing reports again", () => {
		const phone = createPhoneChain();
		phone.peak({ at: 0, power: 0.6 });
		expect(phone.peak({ at: SWING_COOLDOWN_MS, power: 0.6 })).toBe(true);
		expect(phone.sent).toHaveLength(2);
	});

	it("keeps one swing's several group peaks admitted without extending spam", () => {
		const phone = createPhoneChain();
		const t0 = 4000;
		for (const dt of [
			0,
			SWING_GROUP_MS / 3,
			(2 * SWING_GROUP_MS) / 3,
			SWING_GROUP_MS,
		]) {
			expect(phone.peak({ at: t0 + dt, power: 0.5 })).toBe(true);
		}
		expect(phone.sent).toHaveLength(4);
		// A flail just after the group, no harder than the opener, is a new
		// swing too early and is refused.
		expect(phone.peak({ at: t0 + SWING_GROUP_MS + 50, power: 0.5 })).toBe(
			false,
		);
	});

	it("serve: with the gate inactive every peak resets it and the first live swing passes", () => {
		const phone = createPhoneChain();
		// Build up a recent swing while live...
		phone.peak({ at: 1000, power: 0.8 });
		// ...then enter the serve flow (ball in hand/toss): gate inactive.
		phone.setGateActive(false);
		expect(phone.peak({ at: 1050, power: 0.5 })).toBe(true); // toss
		expect(phone.peak({ at: 1300, power: 0.9 })).toBe(true); // serve hit
		// Point starts; the reset performed while inactive leaves it full.
		phone.setGateActive(true);
		expect(phone.peak({ at: 1320, power: 0.7 })).toBe(true);
	});

	// A5: a reconnect must not leave the old cooldown armed. Without the
	// reset this immediate peak would be refused: 700ms after the opener is
	// past SWING_GROUP_MS but still inside SWING_COOLDOWN_MS.
	it("A5: the first peak after a reconnect is admitted even inside the old cooldown", () => {
		const stale = createSwingGate();
		stale.admit(8000, 0.7);
		const reopenedAt = 8000 + SWING_GROUP_MS + 100;
		expect(stale.admit(reopenedAt, 0.7)).toBe(false); // proves the teeth

		const phone = createPhoneChain();
		phone.peak({ at: 8000, power: 0.7 });
		phone.reconnected();

		expect(phone.peak({ at: reopenedAt, power: 0.7 })).toBe(true);
		expect(phone.sent).toHaveLength(2);
		expect(phone.cues.at(-1)).toBe("charge");
	});
});
