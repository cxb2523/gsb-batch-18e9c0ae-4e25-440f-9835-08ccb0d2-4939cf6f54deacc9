# prismbox

The CLI for [Prismbox](https://github.com/Guten-Morgen1302/prismbox), an agent-native visual editor for React Three Fiber.

**Status: early development.**

```bash
cd your-vite-r3f-project
npx prismbox          # Vite + React 19 + R3F 9
```

It starts a local daemon on `127.0.0.1`, runs **your own** Vite dev server with the Prismbox plugin attached in-process, and serves Studio. Nothing in your project is modified: your `vite.config`, `package.json` and imports stay as they are, and `vite build` output contains no Prismbox code.

Studio opens **disarmed**. Arm it to drag objects directly on your real page; each drag is written to your `.tsx` as a one-line edit. Edits are compare-and-set (a file changed by another tool is never overwritten), written atomically, and undoable byte-exact.

Options: `--root <dir>`, `--port <n>`, `--no-open`, `-v`, `-h`.

## Connect your coding agent (MCP)

```bash
prismbox mcp --print-config --root .      # prints the exact commands; changes nothing
claude mcp add prismbox -- npx -y prismbox mcp --root /path/to/project
```

With `prismbox` running, click an object on your page and tell the agent "make *this* glassier": it calls `prism_get_selection`, looks with `prism_get_view`, and edits with `prism_set_prop` / `prism_set_uniform`. Every agent edit is a one-line diff tagged `agent` in Studio, with one-click undo. Tools: `prism_get_selection`, `prism_get_view`, `prism_get_scene`, `prism_set_prop`, `prism_set_uniform`, `prism_lint`; resource `prismbox://guide`. The session descriptor lives in `~/.prismbox/sessions`, never in your project.

MIT licensed.
