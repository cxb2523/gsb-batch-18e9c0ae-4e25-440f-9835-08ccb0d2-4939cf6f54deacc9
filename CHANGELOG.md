# Changelog

All notable changes to `prismbox` and `@prismbox/core`. The two packages are versioned together. Pre-1.0: minor versions may break things.

## 0.1.0 - 2026-11-21

First feature release. Everything before it (0.0.1) was a name-reservation placeholder.

### Added

- **`prismbox` CLI** (`npx prismbox`): detects a Vite + React 19 + React Three Fiber 9 project read-only, starts a loopback daemon, runs your own Vite dev server with a dev-only plugin attached in-process, and serves Studio. Nothing in your project is changed.
- **Real-page editing:** pick, transform gizmo and shader-uniform scrubbing on your actual page. Each gesture becomes one minimal text diff written with `magic-string`; writes are atomic and compare-and-set; undo and redo restore exact bytes; external edits (editors, agents) are picked up live.
- **Armed security model:** page-originated edits are accepted only while Studio is armed, rate-limited, bounded and re-validated against the daemon's own parse. The daemon binds to `127.0.0.1` with `Host`, `Origin` and token checks, and confines writes to source files under the project root.
- **Animation pause:** the R3F clock is frozen while a gizmo handle is hovered or dragged, without the time jump `setFrameloop` causes.
- **MCP server** (`prismbox mcp`): `prism_get_selection`, `prism_get_view` (live canvas PNG), `prism_get_scene`, `prism_set_prop`, `prism_set_uniform`, `prism_lint`, and the `prismbox://guide` resource. stdout carries only JSON-RPC frames. `--print-config` prints setup for Claude Code, Cursor and Windsurf and writes nothing. The session descriptor lives in `~/.prismbox/sessions`, never in your project.
- **Studio:** scene tree, inspector, live diff strip tagged `you`, `page`, `agent` or `external`, Arm toggle, Undo and Redo.
- **Browser Playground** (Studio on an in-memory file system): six hero templates, sandboxed preview, **Copy .tsx**. Static-host header configs for Cloudflare Pages and Vercel are included.
- **`@prismbox/core`:** reader, subset classifier, `setProp` / `setUniform` writer, `instrument()`, `outline()`, per-key `uniforms` editing, `@prism` GLSL annotation parser, and the agent `GUIDE`.
- **Six hero templates** built from shared GLSL blocks (noise, Fresnel, palette, a procedural studio environment).

### Known limitations

- Vite only. Next.js is not supported yet.
- Only literal props are editable; expressions, spreads and nodes inside `.map()` or conditionals are read-only.
- `setCamera`, `unsetProp`, `insertChild` and `removeNode` are not implemented.
- Animation not driven by the R3F clock is not paused while you edit.
