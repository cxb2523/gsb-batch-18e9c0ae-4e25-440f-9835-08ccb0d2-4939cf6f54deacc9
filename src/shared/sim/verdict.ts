/**
 * The host's authoritative swing rulings, read off two consecutive
 * `MatchState`s. This is the pure seam behind "the host decides whether the
 * swing really played the ball": `rally.ts` already does the TIMING_EARLY /
 * TIMING_LATE judgement against the frozen contact and records its answer as
 * either a new `Stroke` (hit) or an incremented `whiffs` counter; this turns
 * exactly those facts into the `hit` / `whiff` verdicts sent to phones.
 *
 * Reading state rather than the input matters under the contact model: an
 * early swing is only *armed* and strikes ticks later, several peaks merge
 * into one hardest winner, and a late peak can revise the same stroke. The
 * tick an input arrived on says nothing about its outcome.
 *
 * `refused` never comes out of a state diff — a refused peak changes nothing
 * by design. It is produced by the phone's local gate (`swing/gate.ts`) and
 * is also a valid wire `FeedbackKind` for a report the host cannot address.
 *
 * `src/shared/**` is compiled under both the DOM and Node tsconfigs, so this
 * file names no DOM type and no Node global.
 */

import type { Side, SwingVerdict } from "../protocol.ts";
import type { MatchState } from "./rally.ts";

export interface StateVerdict {
	readonly side: Side;
	/** `hit` for a new stroke, `whiff` for a newly counted air swing. */
	readonly verdict: Extract<SwingVerdict, "hit" | "whiff">;
}

const SIDES = ["near", "far"] as const;

/**
 * Every swing ruling that happened between `before` and `after`. A revised
 * stroke (a harder peak re-striking the same contact at the same `at`) is not
 * a new hit, matching the host feedback rule and `detectEvents`'s `revised`.
 */
export function swingVerdicts(
	before: MatchState,
	after: MatchState,
): StateVerdict[] {
	const rulings: StateVerdict[] = [];

	const stroke = after.stroke;
	if (stroke && stroke !== before.stroke && stroke.at !== before.stroke?.at) {
		rulings.push({ side: stroke.side, verdict: "hit" });
	}

	for (const side of SIDES) {
		if (after.whiffs[side] > before.whiffs[side]) {
			rulings.push({ side, verdict: "whiff" });
		}
	}

	return rulings;
}
