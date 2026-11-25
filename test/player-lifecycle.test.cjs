/**
 * Local acceptance samples for the device-change / power / episode-switch
 * lifecycle hardening in server/js/core/player.js.
 *
 * Runs entirely on fake video elements + fake dashjs/electronUtilsRender:
 *   node test/player-lifecycle.test.cjs
 * or:
 *   npm test
 *
 * Maps to acceptance checks A1..A6 from the task:
 *   A1 devicechange rebinds once / concurrent calls coalesce
 *   A2 old session timers & promises never rewrite a new session
 *   A3 watchdog: rebind first, rate-limited recovery on second silent pass
 *   A4 suspend/resume recovery keeps the current position (no old playhead)
 *   A5 refresh failure / rate-limited recovery never ends in PLAYING
 *   A6 stop/destroy clears & invalidates all pending tasks
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PLAYER_PATH = path.join(
  __dirname,
  "..",
  "server",
  "js",
  "core",
  "player.js"
);
const VIDEO_PATH = path.join(
  __dirname,
  "..",
  "server",
  "js",
  "screen",
  "video.js"
);
const PLAYER_SRC = fs.readFileSync(PLAYER_PATH, "utf8");
const VIDEO_SRC = fs.readFileSync(VIDEO_PATH, "utf8");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeGate() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function spy(name) {
  const fn = (...args) => {
    fn.calls.push(args);
    if (typeof fn.impl === "function") return fn.impl(...args);
    return undefined;
  };
  fn.calls = [];
  fn.spyName = name || "spy";
  return fn;
}

function makeFakeVideo(opts = {}) {
  const listeners = Object.create(null);
  const el = {
    id: "videoplayer",
    paused: opts.paused !== undefined ? opts.paused : false,
    muted: Boolean(opts.muted),
    volume: opts.volume !== undefined ? opts.volume : 1,
    currentTime: opts.currentTime || 0,
    readyState: opts.readyState !== undefined ? opts.readyState : 4,
    seeking: false,
    sinkId: "",
    error: opts.error || null,
    webkitAudioDecodedByteCount:
      opts.audioBytes !== undefined ? opts.audioBytes : 1000,
    parentNode: null,
    style: {},
    height: 720,
    videoHeight: 720,
    _setSinkIds: [],
    _plays: 0,
    _pauses: 0,
    addEventListener(type, handler) {
      (listeners[type] = listeners[type] || []).push(handler);
    },
    removeEventListener() {},
    dispatch(type, event) {
      (listeners[type] || []).slice().forEach((h) => h(event || {}));
    },
    setSinkId(id) {
      this._setSinkIds.push(id);
      if (opts.sinkIdGate) {
        return opts.sinkIdGate.promise.then(() => {
          this.sinkId = id;
        });
      }
      this.sinkId = id;
      return Promise.resolve();
    },
    play() {
      this._plays++;
      if (opts.rejectPlay) {
        this.paused = true;
        return Promise.reject(opts.rejectPlay);
      }
      this.paused = false;
      return Promise.resolve();
    },
    pause() {
      this._pauses++;
      this.paused = true;
    },
  };
  return el;
}

function makeHarness(opts = {}) {
  const el = opts.video || makeFakeVideo(opts.videoOpts || {});
  const createdVideos = [];

  const container = {
    prepend(node) {
      doc._ids.videoplayer = node;
    },
    removeChild(node) {
      if (doc._ids.videoplayer === node) doc._ids.videoplayer = null;
    },
  };

  const screenEl = {
    id: "video-screen",
    setAttribute() {},
    getAttribute() {
      return null;
    },
  };
  const doc = {
    _ids: {
      "video-screen": opts.screenMissing ? null : screenEl,
      videoplayer: el,
    },
    getElementById(id) {
      return Object.prototype.hasOwnProperty.call(this._ids, id)
        ? this._ids[id]
        : null;
    },
    createElement(tag) {
      const node = makeFakeVideo();
      createdVideos.push(node);
      return node;
    },
    querySelector(sel) {
      if (sel === "#video-screen .content") return container;
      return null;
    },
    body: {
      classList: {
        contains: () => false,
        add() {},
        remove() {},
        toggle() {},
      },
      setAttribute() {},
      getAttribute() {
        return null;
      },
    },
    addEventListener() {},
  };
  el.parentNode = opts.detached ? null : container;

  const deviceListeners = [];
  const mediaDevices = {
    addEventListener(type, handler) {
      if (type === "devicechange") deviceListeners.push(handler);
    },
    removeEventListener() {},
    enumerateDevices:
      opts.enumerateDevices ||
      (() =>
        Promise.resolve([
          { kind: "audiooutput", deviceId: "default" },
          { kind: "audiooutput", deviceId: "usb-headset" },
        ])),
  };
  const navigator = { mediaDevices };

  const powerHandlers = [];
  const electronUtilsRender = {
    onSystemPowerEvent(handler) {
      powerHandlers.push(handler);
    },
    setPlaybackPowerSave: spy("setPlaybackPowerSave"),
  };

  const videoApi = {
    episode: "ep-1",
    id: "video-screen",
    currentItem: { id: "ep-1", playhead: 12, duration: 24 },
    recoverPlayback: spy("recoverPlayback"),
    showBTN: spy("showBTN"),
    hideBTN: spy("hideBTN"),
    setPlayingTime: spy("setPlayingTime"),
    end: spy("end"),
    saveHistory: spy("saveHistory"),
    syncMediaSessionPosition: spy("syncMediaSessionPosition"),
    onPlaybackStarted: spy("onPlaybackStarted"),
    syncVolumeUI: spy("syncVolumeUI"),
    syncQualityUI: spy("syncQualityUI"),
  };
  if (opts.recoverPlaybackImpl) {
    videoApi.recoverPlayback.impl = opts.recoverPlaybackImpl;
  }

  const sessionApi = {
    storage: {
      quality: "auto",
      access_token: "access",
      refresh_token: "refresh",
    },
    isExpired: typeof opts.sessionExpired === "function" ? opts.sessionExpired : () => false,
    refresh(handlers) {
      sessionApi.refresh.calls.push(handlers);
      if (opts.refreshMode === "error") {
        const err = new Error("refresh failed");
        if (handlers && typeof handlers.error === "function") {
          return handlers.error(err);
        }
        return undefined;
      }
      if (opts.refreshMode === "pending") {
        sessionApi._pendingRefresh = handlers;
        return undefined;
      }
      if (handlers && typeof handlers.success === "function") {
        return handlers.success({ access_token: "fresh-access" });
      }
      return undefined;
    },
  };
  sessionApi.refresh.calls = [];

  const plugin = {
    reset: spy("plugin.reset"),
    initialize: spy("plugin.initialize"),
    extend: spy("plugin.extend"),
    on: spy("plugin.on"),
    updateSettings: spy("plugin.updateSettings"),
    setProtectionData: spy("plugin.setProtectionData"),
    registerLicenseRequestFilter: spy("registerLicenseRequestFilter"),
    registerLicenseResponseFilter: spy("registerLicenseResponseFilter"),
    attachSource: spy("attachSource"),
  };
  const dashjs = {
    MediaPlayer: Object.assign(
      function MediaPlayerCtor() {
        return { create: () => plugin };
      },
      {
        events: {
          QUALITY_CHANGE_RENDERED: "qualityChangeRendered",
          STREAM_INITIALIZED: "streamInitialized",
          ERROR: "error",
        },
      }
    ),
  };

  const storageMap = new Map();
  const localStorageFake = {
    getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => storageMap.set(k, String(v)),
    removeItem: (k) => storageMap.delete(k),
  };

  const serviceApi = {
    video_v2: spy("video_v2"),
    api: { drm: "" },
  };

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    Date,
    Math,
    JSON,
    Object,
    Array,
    Number,
    Boolean,
    String,
    Error,
    TypeError,
    RangeError,
    isFinite,
    isNaN,
    parseInt,
    parseFloat,
    RegExp,
    Map,
    Set,
    Uint8Array,
    TextDecoder,
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    navigator,
    document: doc,
    localStorage: localStorageFake,
    electronUtilsRender,
    video: videoApi,
    session: sessionApi,
    dashjs,
    service: serviceApi,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(PLAYER_SRC, sandbox, { filename: "player.js" });

  const player = sandbox.player;
  assert.ok(player, "player should attach to the window/global sandbox");

  return {
    sandbox,
    player,
    el,
    doc,
    container,
    createdVideos,
    navigator,
    mediaDevices,
    deviceListeners,
    electronUtilsRender,
    power: (type) => powerHandlers.forEach((h) => h(type)),
    videoApi,
    sessionApi,
    plugin,
    dispatchDeviceChange: () =>
      deviceListeners.slice().forEach((h) => h()),
  };
}

function registerCleanup(t, ctx) {
  t.after(() => {
    try {
      ctx.player.stop();
    } catch (_) {}
  });
}

/* ------------------------------------------------------------------ */
/* A1 — device change rebind + concurrency                            */
/* ------------------------------------------------------------------ */

test("A1: two rapid devicechange events collapse to one 450ms rebind pass", async (t) => {
  const ctx = makeHarness();
  registerCleanup(t, ctx);
  const { player, el } = ctx;
  player.initDeviceWatchers();
  player.state = player.states.PLAYING;

  ctx.dispatchDeviceChange();
  ctx.dispatchDeviceChange();

  await sleep(560); // past the 450ms first pass, before 1500ms second pass

  // enumerateDevices returns two output devices; chain probes "default" then
  // resets to "" — exactly one setSinkId chain must have run.
  assert.deepEqual(el._setSinkIds, ["default", ""]);
  assert.equal(player._rebindPromise, null);
});

test("A1: concurrent rebindAudioOutput calls share one in-flight chain", async (t) => {
  const gate = makeGate();
  const ctx = makeHarness({
    enumerateDevices: () => gate.promise.then(() => []),
  });
  registerCleanup(t, ctx);
  const { player, el } = ctx;

  const p1 = player.rebindAudioOutput(el, true);
  const p2 = player.rebindAudioOutput(el, true);
  assert.equal(p1, p2, "concurrent call must reuse the same promise");
  assert.equal(player._rebindPromise, p1);

  gate.resolve([]);
  await p1;
  await sleep(10);

  assert.deepEqual(el._setSinkIds, [""], "single setSinkId chain");
  assert.equal(player._rebindPromise, null);
});

test("A1: devicechange does not rebind while paused or off the video page", async (t) => {
  const ctx = makeHarness();
  registerCleanup(t, ctx);
  const { player, el } = ctx;
  player.initDeviceWatchers();

  player.state = player.states.PAUSED;
  ctx.dispatchDeviceChange();
  await sleep(520);
  assert.deepEqual(el._setSinkIds, []);
  assert.equal(player._deviceChangeTimers.length, 0);

  player.state = player.states.PLAYING;
  ctx.doc._ids["video-screen"] = null; // navigated away from video page
  ctx.dispatchDeviceChange();
  await sleep(520);
  assert.deepEqual(el._setSinkIds, []);
});

test("A1: 1500ms device pass joins an in-flight rebind instead of starting a second chain", { timeout: 10000 }, async (t) => {
  const gate = makeGate();
  const ctx = makeHarness({ enumerateDevices: () => gate.promise.then(() => []) });
  registerCleanup(t, ctx);
  const { player, el } = ctx;
  player.initDeviceWatchers();
  player.state = player.states.PLAYING;

  ctx.dispatchDeviceChange();
  await sleep(520); // 450ms pass starts and blocks on the gate
  const inFlight = player._rebindPromise;
  assert.ok(inFlight);

  await sleep(1050); // past the 1500ms second pass
  assert.equal(
    player._rebindPromise,
    inFlight,
    "second pass must reuse the same in-flight chain"
  );

  gate.resolve([]);
  await inFlight;
  await sleep(20);
  assert.deepEqual(el._setSinkIds, [""], "only one physical rebind chain");
});

test("A1/A6: stop() before the 450ms device timer fires prevents any rebind", async (t) => {
  const ctx = makeHarness();
  const { player, el } = ctx;
  player.initDeviceWatchers();
  player.state = player.states.PLAYING;
  ctx.dispatchDeviceChange();

  player.stop();
  await sleep(560);

  assert.deepEqual(el._setSinkIds, []);
  assert.equal(player.state, player.states.STOPPED);
});

test("A1: a failing setSinkId chain still resolves and frees the slot", async () => {
  const ctx = makeHarness({
    videoOpts: {},
  });
  // Replace element setSinkId with one that rejects.
  ctx.el.setSinkId = (id) => {
    ctx.el._setSinkIds.push(id);
    return Promise.reject(new Error("sink gone"));
  };
  const { player, el } = ctx;
  const p = player.rebindAudioOutput(ctx.el, true);
  await p; // must not reject
  await sleep(10);
  assert.ok(el._setSinkIds.includes(""));
  assert.equal(player._rebindPromise, null);
});

/* ------------------------------------------------------------------ */
/* A2 — old session timers / promises never rewrite the new session   */
/* ------------------------------------------------------------------ */

test("A2: external seq invalidation makes scheduled device timers no-op", async (t) => {
  const ctx = makeHarness();
  registerCleanup(t, ctx);
  const { player, el } = ctx;
  player.initDeviceWatchers();
  player.state = player.states.PLAYING;

  ctx.dispatchDeviceChange();
  // Simulate the legacy episode-switch path that only bumped _playSeq.
  player._playSeq++;

  await sleep(560);
  assert.deepEqual(el._setSinkIds, [], "old 450ms timer must not rebind");
});

test("A2: stop() clears device timers and watchdog immediately (A6)", () => {
  const ctx = makeHarness();
  const { player } = ctx;
  player.initDeviceWatchers();
  player.state = player.states.PLAYING;
  ctx.dispatchDeviceChange();
  player._startAudioHealthWatchdog(player._playSeq, false);

  assert.ok(player._deviceChangeTimers.length >= 1);
  assert.ok(player._audioWatchdogTimer);

  player.stop();

  assert.equal(player._deviceChangeTimers.length, 0);
  assert.equal(player._audioWatchdogTimer, null);
  assert.equal(player.state, player.states.STOPPED);
});

test("A2/A6: stop() invalidates an in-flight rebind; old chain cannot clobber new session", async (t) => {
  const gate = makeGate();
  const ctx = makeHarness({ enumerateDevices: () => gate.promise.then(() => []) });
  const { player } = ctx;
  t.after(() => {
    try {
      gate.resolve([]);
    } catch (_) {}
  });
  registerCleanup(t, ctx);

  const oldEl = ctx.el;
  player.state = player.states.PLAYING;
  const oldSeq = player._playSeq;
  const pOld = player.rebindAudioOutput(oldEl, true);
  assert.equal(player._rebindPromise, pOld);

  // stop/switch episode while rebind is pending.
  player.stop();
  assert.notEqual(player._playSeq, oldSeq);
  assert.equal(player._rebindPromise, null, "stored rebind slot dropped on stop");

  // New session + new element starts its own rebind immediately.
  const newEl = makeFakeVideo();
  ctx.doc._ids.videoplayer = newEl;
  player.video = newEl;
  player.state = player.states.PLAYING;
  const pNew = player.rebindAudioOutput(newEl, true);
  assert.notEqual(pNew, pOld);
  assert.equal(player._rebindPromise, pNew);

  gate.resolve([]);
  await pOld; // must settle, never throw
  await pNew;
  await sleep(10);

  assert.deepEqual(oldEl._setSinkIds, [], "stale chain must stop issuing setSinkId");
  assert.deepEqual(newEl._setSinkIds, [""], "new session rebind runs exactly once");
  assert.equal(player._rebindPromise, null, "new chain clears its own slot");
});

test("A2/A6: a late onbufferingcomplete after stop() cannot resurrect PLAYING or call play", () => {
  const ctx = makeHarness();
  const { player, el } = ctx;
  el.paused = false;
  player.state = player.states.PLAYING;

  player.stop();
  assert.equal(player.state, player.states.STOPPED);

  // Late 'playing' event / direct handler invocation from the removed source.
  assert.doesNotThrow(() => player.onbufferingcomplete());
  assert.equal(player.state, player.states.STOPPED);
  assert.equal(el._plays, 0, "stopped element must not be force-played");
});

test("A2: stale watchdog callback does not force play after seq rotation", async (t) => {
  const ctx = makeHarness();
  registerCleanup(t, ctx);
  const { player, el, videoApi } = ctx;

  // Simulate time advancing while audio bytes stay frozen.
  const iv = setInterval(() => {
    el.currentTime += 1;
  }, 120);
  t.after(() => clearInterval(iv));

  player.state = player.states.PLAYING;
  const staleSeq = player._playSeq;
  player._startAudioHealthWatchdog(staleSeq, false);
  // Episode switch rotates the sequence without clearing the timer
  // (worst case; real switch also clears it).
  player._playSeq++;
  player.state = player.states.PLAYING;

  await sleep(560); // outer 450ms fires, seq guard must reject before inner timer

  assert.equal(el._plays, 0);
  assert.equal(videoApi.recoverPlayback.calls.length, 0);
});

test("A2: stop() prevents a running watchdog from acting later", async (t) => {
  const ctx = makeHarness();
  const { player, el, videoApi } = ctx;
  const iv = setInterval(() => {
    el.currentTime += 1;
  }, 120);
  t.after(() => clearInterval(iv));

  player.state = player.states.PLAYING;
  player._startAudioHealthWatchdog(player._playSeq, false);
  player.stop();

  await sleep(2150);
  assert.equal(el._plays, 0);
  assert.equal(videoApi.recoverPlayback.calls.length, 0);
});

test("A2: stale session.refresh success after rapid switch cannot attach old source", (t) => {
  const ctx = makeHarness({ refreshMode: "pending" });
  registerCleanup(t, ctx);
  const { player, plugin } = ctx;

  player.play({ id: "ep-A", token: "ta" }, "url-A", 10, false);
  player.play({ id: "ep-B", token: "tb" }, "url-B", 20, false);

  // Episode A's refresh resolves after B has started a newer session.
  ctx.sessionApi.refresh.calls[0].success({ access_token: "a" });
  assert.equal(
    plugin.attachSource.calls.length,
    0,
    "stale session must not attach its source"
  );

  ctx.sessionApi.refresh.calls[1].success({ access_token: "b" });
  assert.equal(plugin.attachSource.calls.length, 1);
  assert.equal(plugin.attachSource.calls[0][0], "url-B");
  assert.ok(Math.abs(plugin.attachSource.calls[0][1] - 1200) < 1);
});

test("A2: stale session.refresh error after switch does not trigger recovery", (t) => {
  const ctx = makeHarness({ refreshMode: "pending" });
  registerCleanup(t, ctx);
  const { player, videoApi } = ctx;

  player.play({ id: "ep-A", token: "ta" }, "url-A", 10, false);
  player.play({ id: "ep-B", token: "tb" }, "url-B", 20, false);

  ctx.sessionApi.refresh.calls[0].error(new Error("late 401"));
  assert.equal(videoApi.recoverPlayback.calls.length, 0);
});

test("A2 integration: real video.play episode switch cancels player tasks without throwing", (t) => {
  const ctx = makeHarness();
  registerCleanup(t, ctx);
  vm.runInContext(VIDEO_SRC, ctx.sandbox, { filename: "video.js" });
  const realVideo = ctx.sandbox.video;
  // Neutralize the network leg; only exercise the synchronous switch block.
  realVideo.stopNext = () => {};
  realVideo.clearAutoSkip = () => {};
  realVideo.syncQualityUI = () => {};
  realVideo.updateMediaSession = () => {};
  realVideo.releasePendingSession = () => {};
  ctx.sandbox.$ = () => ({ hide() {} });

  const { player } = ctx;
  player.initDeviceWatchers();
  player.state = player.states.PLAYING;
  ctx.dispatchDeviceChange();
  assert.ok(player._deviceChangeTimers.length >= 1);
  player._startAudioHealthWatchdog(player._playSeq, false);
  const seqBefore = player._playSeq;

  assert.doesNotThrow(() => {
    realVideo.play({ id: "ep-2" }, false);
  });
  assert.equal(player._deviceChangeTimers.length, 0);
  assert.equal(player._audioWatchdogTimer, null);
  // Review issue #2: seq must rotate even while player.plugin is null so a
  // late session.refresh success from the previous play cannot attach.
  assert.equal(player._playSeq, seqBefore + 1);
});

/* ------------------------------------------------------------------ */
/* Pause baseline — async resume continuation vs later pause           */
/* ------------------------------------------------------------------ */

test("compat: resolved play() arms watchdog even if the fake leaves paused=true", async (t) => {
  // Minimal fake: play() resolves but does not model the paused flag flip.
  const minimalEl = makeFakeVideo({ paused: true });
  minimalEl.play = () => {
    minimalEl._plays++;
    return Promise.resolve();
  };
  const ctx = makeHarness({ video: minimalEl });
  registerCleanup(t, ctx);
  const { player } = ctx;

  player.state = player.states.PAUSED;
  player._pausedAt = 0;
  player.resume();
  await sleep(20);

  assert.equal(player.state, player.states.PLAYING);
  assert.ok(player._audioWatchdogTimer, "watchdog armed after resolved play");
});

test("pause during pending rebind: continuation must not call play or mark PLAYING", async (t) => {
  const gate = makeGate();
  const ctx = makeHarness({ enumerateDevices: () => gate.promise.then(() => []) });
  registerCleanup(t, ctx);
  const { player, el } = ctx;

  player.state = player.states.PAUSED;
  player._pausedAt = Date.now() - 6000; // >=5s -> rebind path
  player._audioDeviceChanged = false;

  player.resume();
  assert.ok(player._rebindPromise, "rebind should be in flight");
  assert.equal(el._plays, 0, "startPlay waits for rebind");

  // User changes their mind while rebind is settling.
  player.pause();
  assert.equal(player.state, player.states.PAUSED);

  gate.resolve([]);
  await sleep(60);

  assert.equal(el._plays, 0, "stale resume continuation must not call play()");
  assert.equal(player.state, player.states.PAUSED);
});

test("pause then resume again during rebind: only the newest continuation plays", async (t) => {
  const gate = makeGate();
  const ctx = makeHarness({ enumerateDevices: () => gate.promise.then(() => []) });
  registerCleanup(t, ctx);
  const { player, el } = ctx;

  player.state = player.states.PAUSED;
  player._pausedAt = Date.now() - 6000;

  player.resume(); // resume #1 -> gated rebind
  player.pause(); // invalidates #1
  gate.resolve([]);
  await sleep(40);
  assert.equal(el._plays, 0);

  player.resume(); // resume #2, fresh baseline -> direct start
  assert.equal(el._plays, 1, "new resume starts playback once");
  await sleep(20);
  assert.equal(player.state, player.states.PLAYING);
  assert.equal(el._plays, 1, "old continuation must not double-play");
});

/* ------------------------------------------------------------------ */
/* A3 — watchdog ordering                                             */
/* ------------------------------------------------------------------ */

test("A3: watchdog rebinds on first silence, recovers only on second pass", { timeout: 20000 }, async (t) => {
  const ctx = makeHarness();
  registerCleanup(t, ctx);
  const { player, el, videoApi } = ctx;

  const iv = setInterval(() => {
    el.currentTime += 1; // playback clock moves...
    // ...webkitAudioDecodedByteCount intentionally never changes.
  }, 120);
  t.after(() => clearInterval(iv));

  player.state = player.states.PLAYING;
  player._startAudioHealthWatchdog(player._playSeq, false);

  // First detection at ~450+1600ms -> rebind, no stream recovery yet.
  await sleep(2250);
  assert.ok(el._setSinkIds.includes(""), "first silent pass must rebind");
  assert.equal(
    videoApi.recoverPlayback.calls.length,
    0,
    "first pass must not recover the stream"
  );

  // Rebind resolves and arms the second pass; second detection ~2.1s later.
  await sleep(2350);
  assert.equal(videoApi.recoverPlayback.calls.length, 1);
  assert.equal(
    videoApi.recoverPlayback.calls[0][0],
    false,
    "watchdog recovery keepsPlaying=false"
  );
  assert.match(String(videoApi.recoverPlayback.calls[0][1]), /silent-audio/);
});

test("A3: muted element is ignored by watchdog", async (t) => {
  const ctx = makeHarness({ videoOpts: { muted: true } });
  registerCleanup(t, ctx);
  const { player, el } = ctx;
  player.state = player.states.PLAYING;
  player._startAudioHealthWatchdog(player._playSeq, false);
  await sleep(560);
  assert.deepEqual(el._setSinkIds, []);
});

test("A3/A5: recovery rate limiter allows two then blocks further calls", () => {
  const ctx = makeHarness();
  const { player } = ctx;
  const now = Date.now();
  player._recoveryTimestamps = [now - 1000, now - 500];
  assert.equal(
    player._triggerStreamRecovery("silent-audio-watchdog", false),
    false
  );

  player._recoveryTimestamps = [];
  assert.equal(player._triggerStreamRecovery("one", false), true);
  assert.equal(player._triggerStreamRecovery("two", false), true);
  assert.equal(player._triggerStreamRecovery("three", false), false);
});

/* ------------------------------------------------------------------ */
/* A4 — sleep/wake position continuity                                */
/* ------------------------------------------------------------------ */

test("A4: suspend/resume recovery uses the tracked current position, not old playhead", (t) => {
  const ctx = makeHarness();
  registerCleanup(t, ctx);
  const { player, el, videoApi } = ctx;
  player.initDeviceWatchers();

  // Episode originally started at minute 10 (600s); playback is now at 1234s.
  player.playhead = 600;
  player._lastKnownTime = 0;
  el.currentTime = 1234;
  player.state = player.states.PLAYING;

  ctx.power("suspend"); // snapshots 1234 before OS tears down the element
  assert.equal(player._lastKnownTime, 1234);

  el.currentTime = 0; // fake media stack reset after resume
  assert.equal(
    player.getPlayed(),
    1234,
    "getPlayed must prefer last-known position over stale playhead"
  );

  ctx.power("resume");

  assert.equal(videoApi.recoverPlayback.calls.length, 1);
  const args = videoApi.recoverPlayback.calls[0];
  assert.equal(args[0], false);
  assert.match(String(args[1]), /system-resume/);
  assert.equal(args.length, 2, "existing recoverPlayback arity preserved");

  // The real video.recoverPlayback pulls its start position via getPlayed().
  // Emulate that contract here and confirm the stale 600s marker is not used.
  const recoveredSec = player.getPlayed();
  assert.equal(recoveredSec, 1234, "fresh position seconds available");
  assert.notEqual(recoveredSec, 600);
  assert.equal(recoveredSec / 60 > 20, true);
});

test("A4: onbufferingcomplete never seeks backward onto a stale playhead", (t) => {
  const ctx = makeHarness();
  registerCleanup(t, ctx);
  const { player, el } = ctx;

  el.paused = false;
  el.currentTime = 1300; // new stream is already at the recovered position
  player.state = player.states.BUFFERING;
  player.playhead = 600; // stale episode-start marker must not be re-applied

  player.onbufferingcomplete();

  assert.equal(el.currentTime, 1300, "position must not jump back to 600");
  assert.equal(player.playhead, null);
});

test("A4: forward correction to a later requested start marker still works", (t) => {
  const ctx = makeHarness();
  registerCleanup(t, ctx);
  const { player, el } = ctx;

  el.paused = false;
  el.currentTime = 0;
  player.state = player.states.BUFFERING;
  player.playhead = 600;

  player.onbufferingcomplete();
  assert.equal(el.currentTime, 600);
});

test("A4: recovery player.play anchors playhead/baseline to the fresh minutes value", (t) => {
  const ctx = makeHarness();
  registerCleanup(t, ctx);
  const { player, plugin } = ctx;

  const freshSeconds = 1234;
  player.play({ id: "drm-id", token: "drm-token" }, "https://stream/manifest.mpd", freshSeconds / 60, false);

  assert.ok(Math.abs(player.playhead - freshSeconds) < 1);
  assert.ok(Math.abs(player._lastKnownTime - freshSeconds) < 1);
  assert.equal(player.state, player.states.BUFFERING);
  assert.equal(plugin.attachSource.calls.length, 1);
  const attachStart = plugin.attachSource.calls[0][1];
  assert.ok(Math.abs(attachStart - freshSeconds) < 1);
});

/* ------------------------------------------------------------------ */
/* A5 — failure paths must not end in PLAYING                         */
/* ------------------------------------------------------------------ */

test("happy path: player.play then 'playing' event settles PLAYING and arms watchdog", async (t) => {
  const ctx = makeHarness(); // default session.refresh invokes success sync
  registerCleanup(t, ctx);
  const { player } = ctx;

  player.play({ id: "drm", token: "t" }, "https://x/manifest.mpd", 0, false);

  // config/deleteVideo replaces the element via the fake container.
  const activeEl = ctx.doc.getElementById("videoplayer");
  assert.ok(activeEl, "active video element exists");
  activeEl.paused = false;
  activeEl.dispatch("playing"); // -> player.onbufferingcomplete
  await sleep(20);

  assert.equal(player.state, player.states.PLAYING);
  assert.ok(player._audioWatchdogTimer, "watchdog armed on playing");
});

test("A5: rejected play() with rate-limited recovery settles to PAUSED", async (t) => {
  const blocked = Object.assign(new Error("play blocked"), {
    name: "NotAllowedError",
  });
  const ctx = makeHarness({ videoOpts: { rejectPlay: blocked } });
  registerCleanup(t, ctx);
  const { player, el, videoApi } = ctx;

  player.state = player.states.PAUSED;
  player._pausedAt = 0;
  player._recoveryTimestamps = [Date.now() - 1000, Date.now() - 200];

  player.resume();
  assert.equal(player.state, player.states.PLAYING, "optimistic until rejection settles");

  await sleep(30);

  assert.equal(player.state, player.states.PAUSED);
  assert.equal(videoApi.recoverPlayback.calls.length, 0, "rate limited");
  assert.ok(el._pauses >= 1, "element reconciled to paused");
});

test("A5: rejected play() with recoverPlayback reporting false stays PAUSED", async (t) => {
  const blocked = Object.assign(new Error("blocked"), {
    name: "NotAllowedError",
  });
  const ctx = makeHarness({
    videoOpts: { rejectPlay: blocked },
    recoverPlaybackImpl: () => false,
  });
  registerCleanup(t, ctx);
  const { player, videoApi } = ctx;

  player.state = player.states.PAUSED;
  player._pausedAt = 0;

  player.resume();
  await sleep(30);

  assert.equal(player.state, player.states.PAUSED);
  assert.equal(videoApi.recoverPlayback.calls.length, 1);
  assert.match(String(videoApi.recoverPlayback.calls[0][1]), /play-rejected/);
});

test("A5: throwing recoverPlayback is contained and rolls back its rate token", () => {
  const ctx = makeHarness({
    recoverPlaybackImpl: () => {
      throw new Error("boom");
    },
  });
  const { player, videoApi } = ctx;

  let result;
  assert.doesNotThrow(() => {
    result = player._triggerStreamRecovery("throws", false);
  });
  assert.equal(result, false);
  assert.equal(player._recoveryTimestamps.length, 0, "refused attempt is not counted");

  videoApi.recoverPlayback.impl = () => undefined; // accept from now on
  assert.equal(player._triggerStreamRecovery("a", false), true);
  assert.equal(player._triggerStreamRecovery("b", false), true);
  assert.equal(player._triggerStreamRecovery("c", false), false);
});

test("A5: session.refresh error does not propagate a throwing recovery", (t) => {
  const ctx = makeHarness({
    refreshMode: "error",
    recoverPlaybackImpl: () => {
      throw new Error("boom");
    },
  });
  registerCleanup(t, ctx);
  assert.doesNotThrow(() => {
    ctx.player.play({ id: "d", token: "t" }, "url", 0, false);
  });
  assert.notEqual(ctx.player.state, ctx.player.states.PLAYING);
});

test("A5: session.refresh failure inside player.play never reaches PLAYING", async (t) => {
  const ctx = makeHarness({ refreshMode: "error" });
  registerCleanup(t, ctx);
  const { player } = ctx;

  player.play({ id: "d", token: "t" }, "url", 5, false);
  await sleep(20);

  assert.notEqual(player.state, player.states.PLAYING);
  assert.equal(player.state, player.states.BUFFERING);
});

test("A5: AbortError from an in-flight play() reconciles without recovery", async (t) => {
  const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
  const ctx = makeHarness({ videoOpts: { rejectPlay: abort } });
  registerCleanup(t, ctx);
  const { player, videoApi } = ctx;

  player.state = player.states.PAUSED;
  player._pausedAt = 0;
  player.resume();
  await sleep(30);

  // Element is paused after the abort; state must not remain PLAYING.
  assert.equal(player.state, player.states.PAUSED);
  assert.equal(videoApi.recoverPlayback.calls.length, 0);
});

test("A5: AbortError after a real pause is owned by pause(), no recovery", async (t) => {
  const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
  const ctx = makeHarness({ videoOpts: { rejectPlay: abort } });
  registerCleanup(t, ctx);
  const { player, videoApi } = ctx;

  player.state = player.states.PAUSED;
  player._pausedAt = 0;
  player.resume();
  player.pause(); // rotates the intent token and owns PAUSED state
  await sleep(30);

  assert.equal(player.state, player.states.PAUSED);
  assert.equal(videoApi.recoverPlayback.calls.length, 0);
});

/* ------------------------------------------------------------------ */
/* Cross-file integration with the real server/js/screen/video.js    */
/* ------------------------------------------------------------------ */

test("A4: long-pause resume goes through recovery with the current position and stays non-PLAYING", (t) => {
  const ctx = makeHarness();
  registerCleanup(t, ctx);
  const { player, el, videoApi } = ctx;

  player.state = player.states.PAUSED;
  player._systemResumed = false;
  player._pausedAt = Date.now() - 601000; // > 10 minutes
  player.playhead = 600;
  player._lastKnownTime = 3000;
  el.currentTime = 0; // element reset during the long pause

  player.resume();

  assert.equal(videoApi.recoverPlayback.calls.length, 1);
  assert.equal(videoApi.recoverPlayback.calls[0][0], false);
  assert.match(String(videoApi.recoverPlayback.calls[0][1]), /long-pause/);
  assert.equal(player.getPlayed(), 3000);
  assert.notEqual(player.state, player.states.PLAYING);
});

test("A4: wake while paused, then manual resume uses system-resume recovery", (t) => {
  const ctx = makeHarness();
  registerCleanup(t, ctx);
  const { player, el, videoApi } = ctx;
  player.initDeviceWatchers();

  player.state = player.states.PAUSED;
  player._pausedAt = Date.now() - 30000;
  el.currentTime = 888;
  ctx.power("suspend");
  // OS wake leaves the element at 0.
  el.currentTime = 0;
  ctx.power("resume");
  // While paused, the power-resume event itself must not force recovery/play.
  assert.equal(videoApi.recoverPlayback.calls.length, 0);

  player.resume();
  assert.equal(videoApi.recoverPlayback.calls.length, 1);
  assert.match(
    String(videoApi.recoverPlayback.calls[0][1]),
    /system-resume/
  );
  assert.equal(player.getPlayed(), 888);
  assert.notEqual(player.state, player.states.PLAYING);
});

test("A4 integration: real video.recoverPlayback forwards fresh minutes to video.play", (t) => {
  const ctx = makeHarness();
  registerCleanup(t, ctx);

  // Replace the video API fake with the genuine screen/video.js object.
  vm.runInContext(VIDEO_SRC, ctx.sandbox, { filename: "video.js" });
  const realVideo = ctx.sandbox.video;
  assert.equal(typeof realVideo.recoverPlayback, "function");

  const playSpy = spy("video.play");
  realVideo.play = playSpy;
  realVideo.episode = "ep-1";
  realVideo.currentItem = { id: "ep-1", playhead: 10, duration: 24 };

  const { player, el } = ctx;
  // Episode started at minute 10; watched to 1234s; wake reset currentTime.
  player.playhead = 600;
  player._lastKnownTime = 1234;
  el.currentTime = 0;

  const result = realVideo.recoverPlayback(false, "system-resume");
  assert.equal(result, true);
  assert.equal(playSpy.calls.length, 1);

  const item = playSpy.calls[0][0];
  const noplay = playSpy.calls[0][1];
  assert.equal(noplay, false);
  assert.ok(
    Math.abs(item.playhead - 1234 / 60) < 1e-6,
    `expected ~20.57 minutes, got ${item.playhead}`
  );
  assert.notEqual(item.playhead, 10, "must not reuse the stale minute-10 playhead");
});

/* ------------------------------------------------------------------ */
/* Lifecycle bridge loads in a plain Node require context too         */
/* ------------------------------------------------------------------ */

test("bridge: file is syntactically valid and vm-loadable with fakes", () => {
  const ctx = makeHarness();
  assert.equal(typeof ctx.player.rebindAudioOutput, "function");
  assert.equal(typeof ctx.player._invalidatePlaySession, "function");
  assert.equal(typeof ctx.player._cancelSessionTasks, "function");
});
