# Playback lifecycle tests

Local, dependency-light tests for the Game Boy engine's playback lifecycle:
pause/resume alignment, seek timbre reset, noise-buffer cache isolation,
stop/seek teardown, and live-vs-offline render parity.

## Run

```bash
npm test
```

The suite runs on Node's built-in test runner with [tsx](https://github.com/privatenumber/tsx)
loading TypeScript directly. No browser, audio device, or network is needed.

## Layout

- `playback-lifecycle.test.ts` — the test cases (node:test).
- `helpers/testMidi.ts` — builds a deterministic multi-track MIDI fixture
  (drums on channel 9, long-note bass, lead, chordal harmony) with
  `@tonejs/midi`.
- `mocks/mockAudioContext.ts` — deterministic mock of the Web Audio surface
  the engine uses (nodes, gains, oscillators, buffers, offline context).
- `mocks/timerSpy.ts` — wraps the global timers so tests can assert that
  `setInterval`/`setTimeout` creations are always matched by a clear.
- `mocks/register-hooks.cjs` + `tonejs-midi-hooks.mjs` +
  `tonejs-midi-shim.mjs` — test-only ESM interop for `@tonejs/midi`, whose
  CommonJS named exports Node cannot detect statically. Vite already handles
  this interop in the browser; application code imports `@tonejs/midi`
  directly and is untouched.

## Browser diagnostic

`/playback-lifecycle-diagnostic.html` (served by `npm run dev`, intentionally
excluded from the production build) offers the same checks against the real
Web Audio implementation, plus manual play/pause/seek/export controls. It can
load an uploaded `.mid` or a built-in fixture. Append `?autorun=1` for a
self-running smoke run that writes its verdict to `document.title`.

Headless example:

```bash
npx vite --port 3125 &
"/c/Program Files/Google/Chrome/Application/chrome.exe" \
  --headless=new --virtual-time-budget=30000 --dump-dom \
  "http://localhost:3125/playback-lifecycle-diagnostic.html?autorun=1"
```

Note: headless "virtual time" does not pump `OfflineAudioContext` rendering,
so the WAV-render assertion is skipped in that mode; the Node suite covers
the render path with the mock offline context.
