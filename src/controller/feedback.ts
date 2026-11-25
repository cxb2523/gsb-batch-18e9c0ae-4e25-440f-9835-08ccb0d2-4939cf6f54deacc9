/**
 * Maps the host's authoritative feedback onto racket cues. Extracted from
 * `main.ts`'s `flash` so the presentation ruling ("a whiff shows 落空 and
 * never the hit celebration") is unit-testable without a canvas or browser.
 *
 * This module is DOM-free on purpose: it depends only on the structural
 * `FeedbackCueSink`, which `racket.ts`'s `Racket` satisfies.
 */

import type { FeedbackKind } from "../shared/protocol.ts";

/** The racket reactions feedback can drive; the subset of `Racket` used here. */
export interface FeedbackCueSink {
	hit(power: number): void;
	/** A swing met nothing: 落空. Distinct from `miss` (lost the point). */
	whiff(): void;
	/** Lost the point: strings slack, "POINT LOST". */
	miss(): void;
	/** Won the point: confetti and "POINT". */
	point(): void;
	/** Rejected by the local gate or the host: red refill flash. */
	refused(): void;
}

export function dispatchFeedback(
	racket: FeedbackCueSink | null | undefined,
	kind: FeedbackKind,
	hitPower: number,
): void {
	if (!racket) return;
	if (kind === "hit") racket.hit(hitPower);
	else if (kind === "whiff") racket.whiff();
	else if (kind === "refused") racket.refused();
	else if (kind === "point") racket.point();
	else racket.miss();
}
