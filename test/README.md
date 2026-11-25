# Offline-startup checks

Two layers, both runnable out of the box (Node ≥ 22 for the global `WebSocket`;
no npm dependencies, no build step required).

## 1. Static contract tests (no browser)

```sh
node --test test/offline-startup.test.mjs
```

They enforce, straight from the sources:

- the service worker precaches **exactly** the libraries `src/run.js` loads;
- no stale library name (`gswaPeriodicWavesList-v1.js`) is left in the manifest;
- the cache name is `daw-{{GSDAW-VERSION}}` and the version comes only from
  `build-conf.json` (no release number is hard-coded in the worker);
- `activate` deletes every previous cache and keeps the current one;
- routing is cache-first for libraries, network-first with a cache fallback
  for navigations;
- `src/run.js` surfaces load failures (`data-failed`, retry button) and retries
  through the same boot chain, whose order stays
  `resume -> libraries -> init`;
- `build-conf.json` is the only place holding a release number (the old
  hand-maintained `version` file had already drifted and is gone; `/version`
  is now produced by `tools/build.mjs`).

## 2. Browser end-to-end check

```sh
node test/browser/offline-startup.e2e.mjs
```

It builds a temporary static site from this repository (placeholders resolved
from `build-conf.json`, plus small stubs for the `assets/`, `gs-utils` and
`gsdaw` submodules), serves it on `127.0.0.1`, launches headless Chrome/Edge
through the DevTools protocol, and reproduces the acceptance steps:

| step | scenario |
| --- | --- |
| 1 | online load installs `daw-<version>` with both boot libraries precached |
| 2 | server stopped, page reloaded: the DAW still initialises from cache |
| 3 | a boot library returns 500: the splash screen shows the retry hint; clicking retry completes the boot without a reload |
| 4 | with the server stopped: a library request is answered from cache, and a navigation falls back to the cached shell |
| 5 | a new version is published: the old cache is deleted, the new one is installed |

Notes:

- a library request is **cache-first**, so the test removes the cached copy
  before injecting the failure; otherwise the cache (correctly) hides it;
- Chrome is looked up at the usual install paths; set `CHROME_PATH` to use
  another binary. Headless Chrome rejects a URL argument together with
  `--remote-debugging-port`, so the browser is launched on `about:blank` and
  driven with `Page.navigate`;
- the browser profile is a fresh temporary directory, and the browser tree is
  killed with `taskkill /PID <pid> /T /F` on exit (including on Ctrl-C).

## 3. Build tooling

```sh
node tools/build.mjs --out dist                      # stamp placeholders
node tools/build.mjs --out dist --print-version      # current version
node tools/build.mjs --out dist --version 2.60.3     # simulate a release bump
```

`tools/build.mjs` resolves `{{GSDAW-VERSION}}` in the service worker and the
splash screen from the single `version` field in `build-conf.json`, so a release
bump is one edit, and the cache name (`daw-<version>`) stays traceable.
