# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

- Fixed playback state handling when the module is hidden and shown again:
  - A video paused because the module was hidden resumes on show (when `resumeonshow` is `true`).
  - A video the user paused with `TOGGLE` or the controls is no longer resumed automatically on show.
  - `TOGGLE`, `NEXT` and `REPLAY` received while hidden are applied to the player, but a hidden video never plays audio; showing the module then decides whether it continues.
- Fixed list playback:
  - `loop: false` stops on the last video without repeating it.
  - `loop: true` restarts the full list without losing entries.
  - `random: true` plays every entry once per round and reshuffles only when a round ends.
  - `NEXT` with a single video behaves deterministically.
  - `REPLAY` restarts the current video instead of relying on `playedVideoArray`.
- Added a dependency-free test suite (`npm test`) and ESLint coverage for it.
- Matched the package name in `package-lock.json` to `package.json`, so npm no longer rewrites the lockfile on install.
- Documentation and repository maintenance updates
- Added ESLint configuration for local checks
