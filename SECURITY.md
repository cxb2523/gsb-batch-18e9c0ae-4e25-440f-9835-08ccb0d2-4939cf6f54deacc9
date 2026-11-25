# Security policy

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

Report it privately through GitHub's private vulnerability reporting:
<https://github.com/Guten-Morgen1302/prismbox/security/advisories/new>

Include what you found, how to reproduce it, and which version or commit it affects. You can expect an acknowledgement within a few days. Prismbox is maintained by one person in their spare time, so fix timelines are best effort, but reports that affect the write path are treated as the highest priority.

## Supported versions

Prismbox is in early development (pre-0.1). Only the latest commit on `main` is supported.

## Threat model

Prismbox is a local development tool. Its security goals, which the code will be tested against as each piece lands, are:

1. **Loopback only.** Anything Prismbox serves binds to `127.0.0.1`. No accounts, no cloud, no telemetry.
2. **Scene code cannot write files.** Code that renders a 3D scene (written by you, by an AI agent, or copied from a template) is trusted to render and nothing else. It must not be able to reach the write API.
3. **Writes are confined.** Edits only touch files under the project root with a known source extension (`.tsx`, `.ts`, `.jsx`, `.js`), never `.env*` or other dotfiles, and never through symlinks or `..` traversal that escape the root.
4. **Page data is untrusted.** Data that originates in the page being edited (node names, `userData`, console text) is treated as untrusted input and is never interpreted as instructions.
5. **Minimal diffs, no silent corruption.** A write is a minimal text edit. If a file cannot be understood, it is left untouched. The edited output is re-parsed before it replaces the original.

Implemented: the daemon, the Vite plugin, the page overlay, the write API and the MCP server (see "Local mode" and "Agent bridge" in `docs/architecture.md`), with tests for each guarantee in `packages/bridge/test` and an end-to-end run in `e2e/`.

The MCP server authenticates to the daemon with the session token read from `~/.prismbox/sessions/<hash>.json` (outside your project, mode 0600 on POSIX). That token is never sent to a web page, the agent API rejects any request that carries an `Origin` header, and agent edits go through the same parse, compare-and-set, atomic write and undo path as Studio edits. Anything that can read your home directory can read that file; treat it like an SSH agent socket.

Known limits: any process on your machine that can open a loopback socket and forge an `Origin` header (a native program, not a web page) can talk to the page channel, but its edits are still gated by the armed state, the rate limit, bounds and re-validation against the file; only a holder of the Studio token can arm or edit directly. No OS offers an atomic compare-and-rename, so a save that lands in the microseconds between the final hash check and the rename can win (the watcher reports it, and undo then refuses).

## Out of scope

Prismbox runs your project's own dev server and your own code. A malicious dependency in your project is not a Prismbox vulnerability.
