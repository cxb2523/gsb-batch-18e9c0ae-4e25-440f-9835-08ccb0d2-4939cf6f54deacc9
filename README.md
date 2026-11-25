<div align="center">

# Prismbox

**Edit React Three Fiber directly on your real page. Give coding agents eyes and hands on your 3D scene.**

[![CI](https://img.shields.io/github/actions/workflow/status/Guten-Morgen1302/prismbox/ci.yml?branch=main&label=CI&logo=github)](https://github.com/Guten-Morgen1302/prismbox/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/prismbox?logo=npm&label=npm)](https://www.npmjs.com/package/prismbox)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node >=20](https://img.shields.io/badge/node-%3E%3D20-3c873a?logo=node.js&logoColor=white)](package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

<a href="https://www.producthunt.com/products/prismbox-2?embed=true&amp;utm_source=badge-featured&amp;utm_medium=badge&amp;utm_campaign=badge-prismbox-2" target="_blank" rel="noopener noreferrer"><img alt="Prismbox - Edit your React Three Fiber scene live, by hand or by agent | Product Hunt" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1327442&amp;theme=light&amp;t=1795428839296"></a>

[**Live Playground**](https://prismbox.prismbox.workers.dev) · [Quickstart](#quickstart) · [MCP Tools](#mcp-tools) · [Templates](#hero-templates) · [Security](#security-model) · [Contributing](#contributing)

</div>

<!-- DEMO_VIDEO_URL -->

Prismbox is a visual editor for [React Three Fiber](https://r3f.docs.pmnd.rs) that treats your source file as the single source of truth. You run it next to your own Vite dev server, drag an object on your actual landing page, and the edit lands in the `.tsx` as a text diff, not a regenerated file. An MCP server lets Claude Code, Cursor, Windsurf or Codex see what you have selected and edit it the same way.

You commit plain React Three Fiber. Prismbox is not a dependency of your project.

## What makes it different

**1. Real-page visual editing.** The overlay runs inside your page's own `<Canvas>`, so you edit the scene in the context it ships in. Drag a mesh with a transform gizmo, or scrub a shader uniform that a `// @prism` comment in your GLSL describes. Each gesture is **one minimal `magic-string` edit** to your file: formatting, comments and line endings are untouched, and writes are atomic and compare-and-set. While a gizmo handle is hovered or dragged the R3F clock is frozen (`d9`), so animated objects hold still instead of sliding away from the cursor. Undo restores the **exact original bytes**.

**2. Agent point-and-edit over MCP.** Click a mesh and tell your agent to make *this* glassier. Claude Code, Cursor or Windsurf calls `prism_get_selection` to learn what "this" is (file, line, props, uniforms, surrounding source), `prism_get_view` to see the live canvas **without gizmos**, and `prism_set_prop` / `prism_set_uniform` to patch it. Agent edits go through the same parser and writer as yours, show up in Studio tagged `agent`, and undo with one click.

**3. Zero production lock-in.** Prismbox never touches your `package.json`, `vite.config` or imports. The plugin exists only in the dev server it starts, and `vite build` on your project emits **0 bytes of Prismbox code**. A test builds the example with the plugin loaded and asserts it, and a tarball test checks it again from the packed package.

## Quickstart

In a Vite + React 19 + React Three Fiber 9 project:

```bash
npx prismbox
```

It prints two URLs: your page, and Studio. Open both, click **Arm** in Studio, then click and drag objects on your real page. Studio starts **disarmed**, and while disarmed your page behaves exactly as it does in production.

Connect your coding agent:

```bash
# Claude Code
claude mcp add prismbox -- npx -y prismbox mcp --root /path/to/your/project

# print the commands for your platform, including Cursor and Windsurf JSON (writes nothing)
npx prismbox mcp --print-config --root .
```

Cursor (`.cursor/mcp.json`) or Windsurf (`~/.codeium/windsurf/mcp_config.json`):

```json
{
  "mcpServers": {
    "prismbox": { "command": "npx", "args": ["-y", "prismbox", "mcp", "--root", "/path/to/your/project"] }
  }
}
```

On Windows, MCP clients start servers without a shell: use `"command": "cmd", "args": ["/c", "npx", "-y", ...]`. `--print-config` prints that for you. Keep `npx prismbox` running in the project while you work.

## Live Playground

**[prismbox.prismbox.workers.dev](https://prismbox.prismbox.workers.dev)**

The Playground is Studio on an in-memory file system: pick one of the [seven templates](#hero-templates), drag, scrub, and copy the resulting `.tsx`. It edits templates, not your repo. To run it locally instead: `pnpm --filter @prismbox/studio dev` (see [Develop](#develop)).

## MCP tools

`prismbox mcp` is a stdio MCP server: only JSON-RPC frames go to stdout, logs go to stderr. It finds the running daemon through `~/.prismbox/sessions/`, so nothing is written into your project.

| Tool / resource | What it does | Needs `prismbox` running |
|---|---|---|
| `prism_get_selection` | The node you selected on the page or in Studio: file, `line:col`, name, props, shader uniforms with `@prism` ranges, a numbered source snippet | yes |
| `prism_get_view` | PNG of the live canvas (gizmo and selection box hidden, max 1280 px) plus camera and viewport. Works armed or disarmed | yes |
| `prism_get_scene` | Scene tree: nodes, edit state (editable / partial / read-only / opaque), props, uniforms, diagnostics | no, reads from disk |
| `prism_set_prop` | One-line edit of a literal prop. Omit `node` to edit the selection. `expected` for compare-and-set. Returns a unified diff | yes |
| `prism_set_uniform` | Edit `uniforms.<name>.value` on a `shaderMaterial`, including literal keys of a mixed object | yes |
| `prism_lint` | Subset and style findings with fixes, plus editable coverage | no, reads from disk |
| `prismbox://guide` (resource) | How to write R3F that Prismbox can edit | no |

Errors are agent-ready: `isError`, a stable `code`, what happened and the fix. Without the daemon, the tools that need it return `DAEMON_OFFLINE` with the command to start it.

## Remote MCP endpoint

The hosted Playground also exposes a **read-only** MCP server over Streamable HTTP, so an agent can browse the templates without installing anything:

```
https://prismbox.prismbox.workers.dev/mcp
```

```bash
# remote, read-only: list_templates, get_template_code, get_prismbox_guide
claude mcp add --transport http prismbox-templates https://prismbox.prismbox.workers.dev/mcp

# local, edits your project (needs `npx prismbox` running): see "MCP tools" above
claude mcp add prismbox -- npx -y prismbox mcp --root /path/to/your/project
```

The remote server is stateless: it has no sessions, no auth and no access to your files, and it only serves the public template sources and a short guide. Editing your own project always goes through the local `prismbox mcp`.

## Hero templates

Seven templates ship in `packages/templates`. Each is **one plain `.tsx`** that you can copy into any R3F project: no Prismbox import, `// @prism` annotations that are ordinary GLSL comments, and every tunable uniform a slider in Studio.

| Template | Look | `@prism` uniforms |
|---|---|---|
| `liquid-glass-orb` | A noise-displaced sphere refracting a procedural photo studio | `uIor` `uDispersion` `uRim` `uGlow` |
| `glass-card` | A rounded glass card that tilts to the pointer over drifting light | `uAlpha` `uEdge` `uRadius` `uStrength` |
| `glowing-globe` | A dot-matrix planet with an atmosphere rim, orbit rings and stars | `uDots` `uLand` `uGlow` `uPower` |
| `gradient-mesh` | A lit, rippling ribbon of colour | `uLight` `uSheen` |
| `iridescent-knot` | Thin-film colour over a chrome torus knot | `uFilm` `uShift` `uChrome` |
| `aurora-ribbon` | Three layered curtains of light over a starfield | `uIntensity` `uRays` |
| `liquid-chrome-blob` | A slowly morphing mirror-metal blob reflecting a procedural photo studio | `uChrome` `uSheen` `uWobble` `uSpeed` |

## How it compares

There are several good ways to work on 3D for the web. This reflects our understanding as of November 2026; if something is out of date, please open an issue.

| | Prismbox | [Triplex](https://triplex.dev) | [Spline](https://spline.design) (V2) |
|---|---|---|---|
| Where the scene lives | Your `.tsx` files | Your `.tsx` files | A Spline scene; code is exported from it |
| Where you edit | Your real running page, in your own dev server | The editor (standalone or VS Code), on a canvas that renders your components in isolation | The Spline desktop app |
| How a change reaches code | A minimal text diff to your file | An edit to your file | Re-export from the scene |
| Runtime lock-in | None; `vite build` contains no Prismbox code | None; it edits your components | The scene stays in Spline; exported code is a snapshot |
| Agent bridge | MCP server: selection, live screenshot, validated edits | No MCP server that we are aware of | An MCP integration inside the desktop app |
| What it is best at | Nudging a scene an agent wrote, on the real page, with reviewable diffs | A full editor for your R3F component tree | Designing 3D from scratch: modeling, materials, interaction |
| Frameworks | Vite today; Next.js on the roadmap | React / R3F | Any, via export |
| Price / license | Free, MIT, local only | Open source | Commercial, with a free tier |

Pick Spline to design a scene visually and export it. Pick Triplex for a dedicated editor over your component tree. Pick Prismbox when an agent writes the scene and you want to steer it on the real page and keep the diff small.

## Architecture and scope

`npx prismbox` starts a loopback **daemon**, runs **your own Vite dev server** in the same process with a dev-only plugin attached inline (your config is never edited), and serves **Studio**. The plugin tags R3F elements with their source position and injects a small overlay into your `<Canvas>`. Edits flow overlay → daemon → `@prismbox/core` parser and `magic-string` writer → your file → Vite HMR → your page.

- **Vite first.** The real-page path is Vite + React 19 + R3F 9. **Next.js is on the roadmap**; it needs a launch path that does not ask you to change your config.
- **A declared subset.** Round-tripping is only trustworthy on literal props, so that is what is editable. An expression such as `position={[x, y * 2, 0]}` is shown read-only and never rewritten, as is anything inside `.map()` or a conditional ([docs/subset.md](docs/subset.md)). Same-file `const` and empty-deps `useMemo` bindings are resolved for shader props, and literal keys of a mixed `uniforms` object stay editable. In a first measurement of ten agent-written hero scenes, about 97% of nodes were editable with the style guide and about 72% without it. That is a regression signal, not a benchmark.
- **`// @prism` comments** (`// @prism uniform uGlow float 0..2 =1`) are ordinary GLSL comments. They describe a slider range to the editor, import nothing, and ship in your shader string like any other comment.
- **Animation.** Only R3F-clock-driven animation pauses while you edit; `performance.now()` and `Date.now()` do not. The 3D scene's own pointer handlers are paused while armed; ordinary page controls keep working.
- **Early software.** This is 0.1. Expect rough edges; the API will change. Not implemented yet: `setCamera`, `unsetProp`, `insertChild`, `removeNode`.

More: [docs/architecture.md](docs/architecture.md).

## Security model

Prismbox is a local tool: no accounts, no cloud, no telemetry.

- **Loopback only.** The daemon binds to `127.0.0.1` and checks the `Host` header (DNS rebinding) and the `Origin` of every socket.
- **Armed Studio (`d8`).** Your page is treated as untrusted. A drag on the page is a *proposal* that the daemon accepts **only while you have armed Studio**; it is rate-limited, bounded, and re-validated against the daemon's own parse of the current file. Disarmed, forged, stale or malformed proposals are rejected and the file is untouched. Disconnecting Studio disarms.
- **Session token.** Studio's write token never reaches your page; it travels in the URL fragment and lives in `sessionStorage`. The MCP server reads it from a 0600 file in `~/.prismbox/sessions/`, outside your project. The agent API rejects any request that carries an `Origin` header.
- **Compare-and-set disk writes.** Every write re-reads the file, checks the hash you last saw, writes a temp file next to it, re-hashes immediately before the rename, and refuses if the file changed (an editor, an agent). Undo is refused, not forced, if the file changed since your edit.
- **Confinement.** Only `.tsx .ts .jsx .js` under the project root; never dotfiles, `.env*` or `node_modules`; symlinks that escape the root are refused.
- **Sandboxed Playground.** Template code runs in an iframe with an opaque origin and `connect-src 'none'`.

No OS offers an atomic compare-and-rename, so a save landing in the microseconds before the rename can still win; the watcher reports it and the next undo refuses. Full model and known limits: [SECURITY.md](SECURITY.md). Please report vulnerabilities privately.

## Develop

```bash
git clone https://github.com/Guten-Morgen1302/prismbox.git
cd prismbox && pnpm install && pnpm build
pnpm demo                          # prismbox on examples/vite-hero, a plain landing page with no Prismbox in it
pnpm --filter @prismbox/studio dev # the Playground at http://127.0.0.1:4173
pnpm test                          # unit and integration
pnpm e2e                           # real browser, real daemon, real MCP client (needs Chromium)
node scripts/pack-smoke.mjs        # packs the tarballs and runs them outside this repo, like npx does
```

Packages: `@prismbox/core` (parser, writer, `instrument()`), `prismbox` (CLI, daemon, Vite plugin, overlay, MCP server, bundled Studio), `apps/studio` (Studio and Playground), `packages/templates`, `packages/shaders`. Deploying the Playground: [docs/deploy-playground.md](docs/deploy-playground.md).

## Contributing

The most useful contributions are bug reports with the smallest `.tsx` that reproduces them, and **new hero templates**. A template is one plain `.tsx` file with no Prismbox import, validated by `prism_lint` (at least 95% of nodes editable, named nodes, resolvable shaders). The rules and authoring flow are in [docs/writing-a-template.md](docs/writing-a-template.md), and the PR checklist is in [CONTRIBUTING.md](CONTRIBUTING.md). Templates 7 to 10 are open.

## Star history

<a href="https://www.star-history.com/#Guten-Morgen1302/prismbox&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Guten-Morgen1302/prismbox&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Guten-Morgen1302/prismbox&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Guten-Morgen1302/prismbox&type=Date" />
  </picture>
</a>

## License

[MIT](LICENSE) © 2026 Guten-Morgen1302
