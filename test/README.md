# Player lifecycle acceptance samples

Zero-dependency Node tests for the device-change / power-event / episode-switch
lifecycle hardening in [`../server/js/core/player.js`](../server/js/core/player.js).

They build a vm sandbox with a controllable fake `<video>` element, fake
`navigator.mediaDevices`, `electronUtilsRender`, `dashjs`, `session` and the
screen `video` API — no Widevine, network or hardware required. One case also
loads the real `server/js/screen/video.js` to verify `recoverPlayback`
end-to-end.

## Run

```bash
npm test
# or
node --test test/player-lifecycle.test.cjs
# or directly (same file is executable as a plain Node script):
node test/player-lifecycle.test.cjs
```

Requires Node >= 18 (built-in test runner; developed on Node 24).

## Coverage map

- **A1** devicechange triggers rebind; rapid duplicate events and concurrent
  `rebindAudioOutput` calls share one in-flight `setSinkId` chain; no rebind
  while paused / off the video page; 1500 ms pass joins an in-flight chain;
  failing `setSinkId` still frees the slot.
- **A2** old 450/1500 ms device timers and watchdog callbacks no-op after
  `_playSeq` rotation; stop clears timers; stale rebind Promises cannot clobber
  a new session; stale `session.refresh` success/error after rapid `play()`
  cannot attach/recover; real `video.play` switch cancels player tasks.
- **Pause baseline** resume → pending rebind → `pause()` never calls `play()`
  or marks PLAYING; pause then resume again only runs the newest continuation.
- **A3** watchdog rebinds on the first silent pass and only requests
  rate-limited stream recovery on the second; muted elements are ignored;
  limiter allows two calls / 30 s then blocks.
- **A4** suspend/resume and long-pause/manual wake recovery use the tracked
  current position (`getPlayed()`/`_lastKnownTime`) instead of a stale
  episode-start `playhead`; `onbufferingcomplete` never seeks backward;
  real `video.recoverPlayback` forwards the fresh minutes.
- **A5** rejected `play()` with rate-limited/unavailable recovery, explicit
  `recoverPlayback -> false`, `AbortError`, and `session.refresh` failure all
  settle to PAUSED/BUFFERING rather than PLAYING.
- **A6** `stop()`/`destroy()` clears device timers + watchdog and invalidates
  the rebind slot/generation and pending resume continuations.
