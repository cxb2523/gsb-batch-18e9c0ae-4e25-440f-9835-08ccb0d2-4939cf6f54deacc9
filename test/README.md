# Visualizer Lifecycle Tests

Local, dependency-free verification for the audio visualizer lifecycle
(`AnalyserAudio`, `VisualizerBar`, `VisualizerBarWorker`, `VisualizerBarRender`).
Runs with the built-in Node.js test runner — no `npm install` required.

## Run

```sh
npm test
```

(Requires Node.js >= 22 for the built-in test runner and ESM loader hooks.)

## How it works

- `helpers/loader.mjs` — ESM resolve hooks that redirect browser/build-specific
  imports to test doubles: `?worker&inline` worker imports → `MockWorker`,
  `lib/dom/DomSmith` → `MockDomSmith`, `lib/util/supportsWorkerModules` → a
  controllable mock. It also resolves extensionless relative imports, which Vite
  tolerates but Node does not.
- `helpers/env.mjs` — installs `requestAnimationFrame`/`cancelAnimationFrame`
  and `window` stubs and provides `stepFrames()` to drive render frames
  deterministically.
- `helpers/mocks.mjs` — mock player, audio context/analysers, DOM elements and
  canvas. The mock canvas throws if `getContext()` is called after
  `transferControlToOffscreen()`, mimicking real browser behavior.

## Covered scenarios

`analyser-audio.test.mjs`

- Track change clears frequency/waveform data and resets the smoothing state.
- Pause stops the analysis loop after `stopDelay`; resume restarts it.
- A quick pause/resume within the stop delay never interrupts the loop.
- No loop callbacks fire after `destroy()`.

`visualizer-bar.test.mjs`

- Worker path: init/resize/render messages, `clear` on track change, no stale
  frequency data afterwards, worker terminated on destroy.
- Resize forwards the new size and triggers exactly one repaint (both paths).
- Fallback path renders on the main thread when workers are unavailable.
- Pause/resume reconnects the render loop instead of freezing on an old frame.
- Destroy during the async worker init creates no worker and no callbacks.
- A failing worker construction after `transferControlToOffscreen()` does not
  fall back to main-thread rendering on the transferred canvas.
- No render callbacks or worker messages after destroy.
- Resize is safely skipped while the container has no audio analyser state.
