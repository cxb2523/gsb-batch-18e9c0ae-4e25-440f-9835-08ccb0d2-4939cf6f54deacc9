# Architecture

Prismbox is in early development. This page describes the intended design and marks what exists. See the README for the current status.

## Principles

- **Your source file is the single source of truth.** The editor never owns the scene.
- **Minimal diffs.** An edit is a text splice on one span. Prismbox never reprints or reformats your file.
- **A declared subset.** Round-tripping is only trustworthy on a known subset of R3F (see [subset.md](subset.md)). Everything outside it degrades to read-only, never to a corrupted file.
- **No lock-in.** Prismbox is never a dependency of your app. Delete it and nothing breaks.
- **Local, loopback, no telemetry.**

## The three surfaces (Local mode)

```
 Claude Code / Codex           your project on disk: *.tsx is the source of truth
 ┌──────────────┐ stdio   ┌──────────────────────────────────────────────────────┐
 │ MCP client   ├───────▶ │ stdio proxy ──▶ daemon (per project)                  │
 └──────────────┘         │                 ops queue, compare-and-set, scene      │
                          │                 snapshot, watcher, atomic write        │
                          └───────▲───────────────────────────────▲───────────────┘
                     observation  │ (untrusted)        write token │ (Studio only)
                   ┌──────────────┴────────────┐     ┌────────────┴───────────┐
                   │ your real page             │     │ Studio tab (localhost)  │
                   │ dev server + dev plugin    │     │ tree, inspector,        │
                   │ overlay: pick, gizmo,      │     │ diff strip, agent pill  │
                   │ capture                    │     └─────────────────────────┘
                   └────────────────────────────┘
```

1. **Your real page** runs on your own dev server. A dev-only plugin (Vite first) tags R3F elements with their source location and injects a small overlay into the page's own `<Canvas>`. The overlay does picking, the gizmo, camera swap and canvas capture through the public `useThree()` API.
2. **The daemon** owns the scene snapshot, the ops queue and the write path. Claude talks to it over MCP.
3. **Studio** is the control panel: scene tree, inspector, a diff strip showing every edit as a real diff, and an agent-context indicator.

**Fallback.** Where the plugin cannot inject (Next.js until a zero-repo-change launch exists, scene-only modules), an isolated harness renders the component in a separate-origin iframe.

**Playground.** The same Studio on an in-memory file system, for editing templates in the browser with zero install. It edits templates, not your repo.

## Local mode (M2)

`prismbox` (alias `prismbox dev`) in a Vite + React 19 + R3F 9 project:

1. detects the project read-only (versions, no changes to your files),
2. starts the **daemon** on `127.0.0.1` (default 4173) with a random per-run Studio token,
3. loads **your** installed Vite and calls `createServer` with the Prismbox plugin as an *inline* plugin, so your `vite.config` still applies and is never edited,
4. serves Studio from the daemon.

The plugin is `apply: 'serve'` and `enforce: 'pre'`, adds `resolve.dedupe` for react, react-dom, three and R3F, and re-checks `command === 'serve'` in every hook. It runs `instrument()` on your `.tsx` and serves the overlay as the virtual module `virtual:prism-overlay`. Since it is only ever passed in by `prismbox`, your own `vite build` never loads it, and a test builds the example with the plugin loaded anyway and asserts zero Prismbox bytes.

**Daemon.** HTTP + WebSocket on loopback only. Every request checks the `Host` header (DNS rebinding); the Studio socket requires the Studio origin and the session token (moved from the URL fragment into sessionStorage and stripped from the URL); the page socket requires the dev server's origin and a one-shot token fetched per page load. All messages are validated with zod. Files are confined to the project root: no `..`, no absolute paths, no dotfiles or `node_modules`, only `.tsx .ts .jsx .js`, realpath re-checked so a symlink cannot escape.

**d8: armed Studio.** A drag on the page produces one *proposal*. The daemon accepts it only while Studio is armed (disconnecting Studio disarms), applies a token-bucket rate limit, bounds the numbers, then **re-parses the current file itself**, finds the node from the tag, and compare-and-sets the old value the page claims against the value in the file. A disarmed, forged, stale or malformed proposal is rejected with a code and the file is untouched. Arming also tells the overlay to pause the 3D scene's pointer handlers (ordinary page controls keep working).

**Write path.** Every write is: fresh read from disk, `baseHash` check, `@prismbox/core` ops, temp file next to the target, **re-hash immediately before the rename** (a change that lands in between is a CONFLICT and nothing is overwritten), rename with retry, file mode preserved. The daemon keeps an undo/redo stack of exact bytes; undo is refused (not forced) if the file changed outside Prismbox since the edit. A recursive file watcher tells Studio about external edits, and ignores the daemon's own writes by content hash. One honest limit: no operating system offers an atomic compare-and-rename, so a save landing in the microseconds between the re-hash and the rename can still win; the watcher reports it and the next undo refuses.

**Studio.** Same app as the Playground. When it is served by the daemon (it answers `/__prism/session`) it runs in Local mode: the file list, scene tree and inspector are driven by the real file on disk, edits go to the daemon, and the header has the **Arm** toggle. Diff rows are tagged `you`, `page` or `external`.

## Agent bridge (M3)

`prismbox mcp [--root <dir>]` is an MCP server on stdio (`@modelcontextprotocol/sdk`). **stdout carries only MCP JSON-RPC frames**; `console.log/info/debug` are rerouted to stderr and the startup note goes to stderr (a test spawns the real CLI and checks stdout byte for byte).

**Discovery.** The daemon writes `~/.prismbox/sessions/<sha256(root)>.json` (`port`, `token`, `pid`, `root`, `startedAt`; mode 0600 on POSIX; `$PRISMBOX_HOME` overrides the home) **outside the project**, removes it on exit, and readers prune any descriptor whose pid is dead. Nothing is ever written inside your repo.

**Auth.** The MCP server calls the daemon's loopback API (`/__prism/api/*`) with `Authorization: Bearer <session token>` from that file. The token is Studio's write token and is never sent to a web page; the API refuses any request without it and any request carrying an `Origin` header (a browser). Agent edits do not need Studio to be armed, but they go through the same path as everything else: the daemon's own parse, compare-and-set, atomic write, and the undo stack. They show up in Studio tagged `agent`.

**Selection.** The daemon tracks the selected node from both the real-page overlay click and Studio's tree, and describes it on demand from a fresh read of the file (file, line:col, tag, name, props, uniforms with `@prism` annotations, a numbered source snippet). If the file changed so the tag no longer resolves, the answer says so instead of guessing.

**Capture.** `prism_get_view` asks a connected page to render synchronously and read the canvas in the same task (no `preserveDrawingBuffer`), gizmo and selection box hidden, downscaled to at most 1280 px, and returns PNG plus camera and viewport. It works whether or not Studio is armed; with no page it returns `NO_PAGE`, and a page that never answers gives `CAPTURE_FAILED` after a timeout.

| Surface | What |
|---|---|
| Resource `prismbox://guide` | the authoring guide (`GUIDE` in `@prismbox/core`) |
| `prism_get_selection` | the node the user selected: "this" |
| `prism_get_view` | PNG image block + camera/viewport |
| `prism_get_scene` | scene tree, edit states, props, uniforms, diagnostics (works offline from disk) |
| `prism_set_prop`, `prism_set_uniform` | validated one-line edits; omit `node` to edit the selection; `expected` for compare-and-set; returns a unified diff |
| `prism_lint` | subset + style-guide findings with fixes and coverage (works offline) |

Errors are agent-ready: `isError`, a stable `code`, what happened and the fix. With no daemon, the daemon-backed tools return `DAEMON_OFFLINE` with the command to start it; lint, scene and the guide keep working.

## Animation pause (d9)

While a gizmo handle is hovered **or** dragged, the overlay pauses animation by freezing the R3F clock: `clock.getDelta()` returns 0 and keeps `oldTime` fresh, so `useFrame` callbacks keep running with `delta = 0` and a frozen `elapsedTime`, and animation resumes exactly where it stopped. R3F's own `setFrameloop` is not used because it resets `clock.elapsedTime` to 0, which makes absolute-time animation jump. Code that reads time itself (`performance.now()`, GSAP, CSS) is not paused. This relies on R3F's loop calling `clock.getDelta()`; `apps/studio/test/clock.test.ts` reads the installed R3F source and fails if that stops being true, and the overlay warns at runtime if a frozen frame reports a non-zero delta.

## Playground sandbox (d2)

Scene code runs in an iframe with `sandbox="allow-scripts"` and no `allow-same-origin`: an opaque origin with no access to Studio's storage or DOM. The only channel is a typed, validated `postMessage` protocol (`apps/studio/src/protocol.ts`); Studio ignores anything that does not parse and any message not from its own iframe. Inside, `instrument()` tags the file, Sucrase strips TypeScript and JSX, and the result is evaluated against a fixed module map (react, three, R3F, drei, the overlay, relative files); any other import is an `UNSUPPORTED_IMPORT` error, never a network fetch. The production build adds a CSP to the sandbox page with `connect-src 'none'`. Edits live in an in-memory file system and are saved to `localStorage`.

## Write-back (`@prismbox/core`, implemented)

- **Parse** with `@babel/parser`. Never reprint.
- **Edit** with semantic ops resolved against a fresh AST and applied as span replacements with `magic-string`.
- **Identity**: a node's id is its `name` prop if unique, else a structural path. Ambiguity is an error, never a guess.
- **Concurrency**: ops carry the value the caller last saw (`expected`); a mismatch is `CONFLICT`.
- **Invariants** (CI-enforced): no-op is byte-identical; one primitive op changes one span; out-of-subset input produces diagnostics and zero writes; the edited output is re-parsed before it is accepted.

## Trust model (implemented in M2)

- Everything the page sends is untrusted observation: strings are length-capped, labeled untrusted in MCP results, and never placed in instruction position.
- The write token lives only in Studio-origin session storage. The page channel carries an observation token that rotates per page load and has no write authority.
- Page-originated edits (a gizmo drag happens in your page) arrive as bounded proposals and are accepted only while Studio is **armed**.
- Scene code, whether written by you, an agent or a template, can render but cannot reach the write API.

See [SECURITY.md](../SECURITY.md).

## Packages

| Path | Purpose | State |
|---|---|---|
| `packages/core` | `@prismbox/core`: parser, subset classifier, writer, `instrument()`, `outline()` | implemented (reader, `setProp`, `setUniform`, per-key uniforms) |
| `packages/bridge` | `prismbox` CLI, daemon, Vite plugin, page overlay and the MCP server | implemented (M2, M3) |
| `apps/studio` | Studio control panel and the browser Playground (memory FS, sandboxed preview) | implemented for the Playground; not deployed |
| `packages/templates`, `packages/shaders` | seven hero templates and the GLSL blocks they are built from | implemented |
| `packages/behaviors` | copy-in behavior wrappers | planned |
| `fixtures/subset` | conformance fixtures | Step 0 files |
| `examples/vite-hero` | a plain landing page with a 3D hero; the end-to-end target and demo | implemented |
| `e2e/` | real-browser end-to-end test (`pnpm e2e`) | implemented |

## Roadmap

- **M0:** repository standards, CI, `@prismbox/core` reader and writer, CLI skeleton.
- **M1:** `instrument()`, per-key uniforms, seven hero templates, Studio on the memory file system (Playground, not deployed). Still to do: `unsetProp`, behaviors package, templates 8 to 10.
- **M2 (in progress):** the Vite real-page plugin, daemon, overlay with gizmo, Local-mode Studio, live disk write-back with undo. Gate: end-to-end on `examples/vite-hero`. Still to do: `setCamera`.
- **M3 (in progress):** MCP server, agent guide and point-at selection. Next harness fallback is not in this milestone.
- **M4:** polish, demo, public launch.

The Step 0b spike showed that a dev-time plugin can inject the overlay into a real Vite page and support pick-to-source and gizmo drag; M2 builds that for real.
