"use strict";

/**
 * Behaviour tests for MMM-Videoplayer's playback state machine.
 *
 * Run with:  npm test   (or: node tests/videoplayer.test.js)
 *
 * The tests only use Node.js built-ins, so no install step is required.
 */

const assert = require("node:assert/strict");
const {started} = require("./harness");

const tests = [];
function test (name, fn) {
	tests.push({name, fn});
}

const LIST = ["a.mp4", "b.mp4", "c.mp4"];

// ---------------------------------------------------------------------------
// Hidden / shown with resumeonshow
// ---------------------------------------------------------------------------

test("hidden pause resumes from the same position when shown", () => {
	const mod = started({videolist: LIST});
	const video = mod.video;

	video.currentTime = 12.5;
	mod.suspend();
	assert.equal(video.paused, true, "pauseonhide pauses the video");
	assert.equal(video.currentTime, 12.5, "position is kept");

	mod.resume();
	assert.equal(video.paused, false, "resumeonshow restarts playback");
	assert.equal(video.currentTime, 12.5, "playback continues from the same position");
	assert.equal(video.src, "a.mp4", "the same clip keeps playing");
});

test("user pause through TOGGLE stays paused after hide/show", () => {
	const mod = started({videolist: LIST});
	const video = mod.video;

	mod.notificationReceived(mod.config.notification, "TOGGLE");
	assert.equal(video.paused, true, "TOGGLE pauses");

	mod.suspend();
	mod.resume();
	assert.equal(video.paused, true, "a user pause must not be undone by resumeonshow");
});

test("pauseonhide=false does not pause on hide and resume is a no-op", () => {
	const mod = started({videolist: LIST, pauseonhide: false, resumeonshow: true});
	const video = mod.video;

	mod.suspend();
	assert.equal(video.paused, false, "video keeps playing when pauseonhide is false");
	mod.resume();
	assert.equal(video.paused, false, "still playing");
});

test("resumeonshow=false leaves a hidden pause in place", () => {
	const mod = started({videolist: LIST, resumeonshow: false});
	const video = mod.video;

	mod.suspend();
	mod.resume();
	assert.equal(video.paused, true, "resumeonshow=false must not resume");
});

test("TOGGLE while hidden never plays and is applied on show", () => {
	const mod = started({videolist: LIST});
	const video = mod.video;

	// First TOGGLE while hidden = user wants it paused.
	mod.suspend();
	mod.notificationReceived(mod.config.notification, "TOGGLE");
	assert.equal(video.paused, true, "still paused while hidden");

	mod.resume();
	assert.equal(video.paused, true, "user pause wins after showing");

	// Second TOGGLE while hidden = user wants it playing again.
	mod.suspend();
	mod.notificationReceived(mod.config.notification, "TOGGLE");
	assert.equal(video.paused, true, "hidden toggle to play must not start audio");

	mod.resume();
	assert.equal(video.paused, false, "queued play happens after showing");
});

test("TOGGLE while hidden on an already playing video pauses it", () => {
	const mod = started({videolist: LIST, pauseonhide: false});
	const video = mod.video;

	mod.suspend();
	assert.equal(video.paused, false);
	mod.notificationReceived(mod.config.notification, "TOGGLE");
	assert.equal(video.paused, true, "hidden TOGGLE pauses a playing video");
});

test("NEXT while hidden loads the next clip silently and plays it on show", () => {
	const mod = started({videolist: LIST});
	const video = mod.video;

	mod.suspend();
	mod.notificationReceived(mod.config.notification, "NEXT");
	assert.equal(video.src, "b.mp4", "the next clip is selected while hidden");
	assert.equal(video.paused, true, "but it stays silent while hidden");
	assert.equal(video.playCalls.length, 1, "no extra play() while hidden");

	mod.resume();
	assert.equal(video.paused, false, "plays after being shown");
	assert.equal(video.src, "b.mp4");
});

test("REPLAY while hidden rewinds silently and plays on show", () => {
	const mod = started({videolist: LIST});
	const video = mod.video;

	video.currentTime = 30;
	mod.suspend();
	mod.notificationReceived(mod.config.notification, "REPLAY");

	assert.equal(video.src, "a.mp4", "replays the current clip");
	assert.equal(video.currentTime, 0, "rewound to the start");
	assert.equal(video.paused, true, "no audio while hidden");

	mod.resume();
	assert.equal(video.paused, false, "plays after showing");
	assert.equal(video.currentTime, 0);
});

// ---------------------------------------------------------------------------
// Sequential list playback
// ---------------------------------------------------------------------------

test("sequential playback follows the list in order", () => {
	const mod = started({videolist: LIST});
	const seen = [mod.video.src];
	mod.video.finish();
	seen.push(mod.video.src);
	mod.video.finish();
	seen.push(mod.video.src);
	assert.deepEqual(seen, ["a.mp4", "b.mp4", "c.mp4"]);
});

test("loop=false stops on the last clip and never repeats it", () => {
	const mod = started({videolist: LIST, loop: false});
	const video = mod.video;

	video.finish(); // -> b
	video.finish(); // -> c
	video.finish(); // end of list: stay on c

	assert.equal(video.src, "c.mp4", "stays on the last clip");
	assert.equal(video.paused, true, "does not restart");
	assert.equal(video.ended, true, "remains ended");

	// Another explicit NEXT must also stay at the end.
	mod.notificationReceived(mod.config.notification, "NEXT");
	assert.equal(video.src, "c.mp4", "NEXT past the end stays on the last clip");
	assert.equal(video.paused, true, "and does not play anything");
});

test("loop=true wraps around without losing entries", () => {
	const mod = started({videolist: LIST, loop: true});
	const seen = [mod.video.src];

	for (let i = 0; i < 7; i++) {
		mod.video.finish();
		seen.push(mod.video.src);
	}

	assert.deepEqual(
		seen,
		["a.mp4", "b.mp4", "c.mp4", "a.mp4", "b.mp4", "c.mp4", "a.mp4", "b.mp4"],
		"rounds repeat the full list in order"
	);
	// After two completed rounds and part of a third, the queue must still
	// contain exactly the not-yet-played entries. (Array.from bridges the vm
	// context so deepEqual compares values, not array realms.)
	assert.deepEqual(Array.from(mod.videoArray), ["c.mp4"], "queue holds the remaining entry");
	assert.deepEqual(Array.from(mod.playedVideoArray), ["a.mp4", "b.mp4"], "played entries tracked");
});

test("NEXT with a single video behaves deterministically", () => {
	const mod = started({videolist: ["only.mp4"], loop: false});
	const video = mod.video;

	// While the only clip is still playing, NEXT has nothing else to do and
	// must not interrupt it.
	mod.notificationReceived(mod.config.notification, "NEXT");
	assert.equal(video.src, "only.mp4", "stays on the only clip");
	assert.equal(video.paused, false, "does not interrupt the playing clip");

	// Once it has ended, NEXT leaves it at the end.
	video.finish();
	assert.equal(video.src, "only.mp4", "still the only clip");
	assert.equal(video.paused, true, "stays ended");
	assert.equal(video.ended, true);
	mod.notificationReceived(mod.config.notification, "NEXT");
	assert.equal(video.src, "only.mp4", "and NEXT past the end is a no-op");
	assert.equal(video.paused, true);

	const looping = started({videolist: ["only.mp4"], loop: true});
	looping.video.finish();
	assert.equal(looping.video.src, "only.mp4", "loops back to the only clip");
	assert.equal(looping.video.paused, false, "and plays it again");
});

// ---------------------------------------------------------------------------
// Random mode
// ---------------------------------------------------------------------------

test("random mode plays every entry exactly once per round", () => {
	const mod = started({videolist: LIST, random: true, loop: true});
	const played = [mod.video.src];

	for (let i = 0; i < LIST.length - 1; i++) {
		mod.video.finish();
		played.push(mod.video.src);
	}

	assert.deepEqual([...played].sort(), [...LIST].sort(), "first round contains all entries");
	assert.equal(new Set(played).size, LIST.length, "no duplicates within a round");
	assert.deepEqual(mod.videoArray, [], "queue is empty right before a new round");
	assert.deepEqual([...mod.playedVideoArray].sort(), [...LIST].sort(), "played list matches");
});

test("random mode reshuffles only at round boundaries", () => {
	const mod = started({videolist: LIST, random: true, loop: true});
	const rounds = [];
	let current = [mod.video.src];

	for (let i = 0; i < 8; i++) {
		mod.video.finish();
		const src = mod.video.src;
		if (current.includes(src)) {
			rounds.push(current);
			current = [src];
		} else {
			current.push(src);
		}
	}
	rounds.push(current);

	rounds.forEach((round, index) => {
		assert.equal(round.length, LIST.length, `round ${index} plays each clip once`);
		assert.deepEqual([...round].sort(), [...LIST].sort(), `round ${index} is complete`);
	});
});

test("random mode with loop=false still plays the whole list once", () => {
	const mod = started({videolist: LIST, random: true, loop: false});
	const played = [mod.video.src];

	for (let i = 0; i < LIST.length - 1; i++) {
		mod.video.finish();
		played.push(mod.video.src);
	}

	assert.deepEqual([...played].sort(), [...LIST].sort(), "all entries played");
	assert.equal(new Set(played).size, LIST.length, "no duplicates");

	mod.video.finish();
	assert.equal(mod.video.src, played[played.length - 1], "stops on the last clip");
	assert.equal(mod.video.paused, true);
});

// ---------------------------------------------------------------------------
// REPLAY and configuration handling
// ---------------------------------------------------------------------------

test("replay replays the current clip even after a new round started", () => {
	const mod = started({videolist: LIST, loop: true});
	const video = mod.video;

	video.finish(); // b
	video.finish(); // c (last of round 1)
	video.finish(); // starts round 2 -> a
	assert.equal(video.src, "a.mp4");

	video.currentTime = 9;
	mod.notificationReceived(mod.config.notification, "REPLAY");
	assert.equal(video.src, "a.mp4", "replays the current clip, not a stale array entry");
	assert.equal(video.currentTime, 0, "from the start");
	assert.equal(video.paused, false);
});

test("replay while playing the very first clip works", () => {
	const mod = started({videolist: LIST});
	const video = mod.video;

	video.currentTime = 5;
	mod.notificationReceived(mod.config.notification, "REPLAY");
	assert.equal(video.src, "a.mp4");
	assert.equal(video.currentTime, 0);
	assert.equal(video.paused, false);
});

test("video and videolist combine with video first", () => {
	const mod = started({video: "v.mp4", videolist: LIST});
	assert.deepEqual(Array.from(mod.videoList), ["v.mp4", "a.mp4", "b.mp4", "c.mp4"]);
	assert.equal(mod.video.src, "v.mp4");
});

test("default video is used when nothing is configured", () => {
	const mod = started({});
	assert.deepEqual(Array.from(mod.videoList), [mod.config.defaultvideo]);
	assert.equal(mod.video.src, mod.config.defaultvideo);
});

test("a rejected play() does not throw or leave the state stuck", async () => {
	const mod = started({videolist: LIST});
	const video = mod.video;

	video.playRejection = "NotAllowedError";
	mod.notificationReceived(mod.config.notification, "TOGGLE"); // pause
	assert.equal(video.paused, true);
	mod.notificationReceived(mod.config.notification, "TOGGLE"); // play, rejected
	assert.equal(video.paused, true, "a rejected play leaves it paused");

	// Let the rejection handler run, then verify the module is still usable.
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(mod.playIntent, true, "intent to play is kept after a rejection");

	video.playRejection = null;
	mod.notificationReceived(mod.config.notification, "TOGGLE"); // play again
	assert.equal(video.paused, false, "playback recovers after a rejection");
});

test("suspend before getDom does not throw", () => {
	const {createInstance} = require("./harness");
	const mod = createInstance({videolist: LIST});
	mod.suspend();
	mod.resume();
	mod.notificationReceived(mod.config.notification, "TOGGLE");
	assert.equal(mod.isHidden, false);
	assert.ok(!mod.video, "no video element yet");
});

// ---------------------------------------------------------------------------
// Native controls and event ordering
// ---------------------------------------------------------------------------

test("pause through native controls is treated as a user pause", () => {
	const mod = started({videolist: LIST});
	const video = mod.video;

	// Emulate a click on the native pause button: paused flips first, then the
	// browser dispatches the event (no programmatic pause() was involved).
	video.paused = true;
	video.dispatch("pause");

	mod.suspend();
	mod.resume();
	assert.equal(video.paused, true, "native-control pause is not resumed on show");
});

test("a play event that sneaks through while hidden is paused back", () => {
	const mod = started({videolist: LIST});
	const video = mod.video;

	mod.suspend();
	assert.equal(video.paused, true);

	// Simulate the browser starting playback despite our state (e.g. a stray
	// autoplay). handlePlay must stop it again immediately.
	video.paused = false;
	video.dispatch("play");

	assert.equal(video.paused, true, "hidden video never keeps playing");
	assert.equal(mod.pauseReason, "hidden", "pause reason remains 'hidden'");
});

test("a video paused by hiding resumes even after TOGGLE while visible", () => {
	const mod = started({videolist: LIST});
	const video = mod.video;

	mod.suspend(); // pause reason: hidden
	mod.resume(); // plays again
	assert.equal(video.paused, false);

	mod.notificationReceived(mod.config.notification, "TOGGLE"); // user pause
	assert.equal(video.paused, true);

	mod.suspend();
	mod.resume();
	assert.equal(video.paused, true, "the later user pause is respected");
});

test("hideonstart hides the module and the clip continues on show", () => {
	const mod = started({videolist: LIST, hideonstart: true});
	const video = mod.video;

	mod.hide = () => {};
	video.finish(); // triggers nextVideo -> hide()
	assert.equal(video.src, "b.mp4");

	mod.suspend();
	mod.resume();
	assert.equal(video.paused, false);
	assert.equal(video.src, "b.mp4");
});

test("NEXT while hidden on a finished non-looping list stays at the end", () => {
	const mod = started({videolist: ["a.mp4", "b.mp4"], loop: false});
	const video = mod.video;

	mod.suspend();
	video.finish(); // -> b (hidden)
	video.finish(); // b ends while hidden, list exhausted
	mod.notificationReceived(mod.config.notification, "NEXT");

	assert.equal(video.src, "b.mp4", "stays on the last clip");
	assert.equal(video.paused, true, "silent while hidden");

	mod.resume();
	assert.equal(video.paused, true, "ended list is not restarted on show");
});

test("manual NEXT calls in random mode never duplicate within a round", () => {
	const mod = started({videolist: LIST, random: true, loop: true});
	const seen = [mod.video.src];
	while (mod.videoArray.length > 0) {
		mod.notificationReceived(mod.config.notification, "NEXT");
		seen.push(mod.video.src);
	}
	assert.deepEqual([...seen].sort(), [...LIST].sort(), "whole list visited once");
	assert.equal(new Set(seen).size, LIST.length);
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

(async () => {
	let failures = 0;
	for (const {name, fn} of tests) {
		try {
			await fn();
			console.log(`ok   - ${name}`);
		} catch (error) {
			failures += 1;
			console.error(`FAIL - ${name}`);
			console.error(String(error && error.stack ? error.stack : error));
		}
	}

	console.log(`\n${tests.length - failures}/${tests.length} tests passed`);
	if (failures > 0) {
		process.exitCode = 1;
	}
})();
