# Contributing to Prismbox

Thanks for helping. Prismbox is in early development, so the most useful contributions right now are bug reports, failing R3F files that the parser mishandles, and small focused PRs.

## Setup

Requirements: Node.js 22.12 or newer for development (the published packages run on Node.js 20+) and [pnpm](https://pnpm.io) 10.

```bash
git clone https://github.com/Guten-Morgen1302/prismbox.git
cd prismbox
pnpm install
```

## Everyday commands

| Command | What it does |
|---|---|
| `pnpm typecheck` | TypeScript across all packages |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest: unit tests and the AST conformance suite |
| `pnpm build` | Build every package (and check the generated templates are up to date) |
| `pnpm --filter @prismbox/studio dev` | Run the Playground at http://127.0.0.1:4173 |

CI runs the same four steps on Linux and Windows. A PR needs all of them green.

## The one rule that matters

Prismbox edits **your** source files, so the write path is held to a strict standard:

- A no-op parse must leave the file **byte-identical**.
- One primitive edit changes **exactly one span** of the file.
- A file or node outside the supported subset is reported and **never rewritten**.

If your change touches the parser or writer, add a fixture or test that proves these still hold. The conformance fixtures live in `fixtures/subset/`.

## Reporting a file the parser gets wrong

Open an issue with the smallest `.tsx` that reproduces it. Please only share code you have the right to share; it may become a fixture.

## Hero templates

A template is a single plain `.tsx` inside the supported subset. The rules and the authoring flow are in [docs/writing-a-template.md](docs/writing-a-template.md). The first seven ship in `packages/templates`; templates 8 to 10 are open for community PRs.

## Pull requests

- Branch from `main`, keep PRs small and focused, and fill in the PR template.
- Use [Conventional Commits](https://www.conventionalcommits.org): `feat(core): ...`, `fix(bridge): ...`, `docs: ...`, `chore: ...`. PRs are squash-merged, so the PR title becomes the commit message.
- Add or update tests with the change. Do not commit secrets, `.env*` files or local scratch directories.

## Security

Do not report security problems in public issues. See [SECURITY.md](SECURITY.md).

By contributing you agree that your contributions are licensed under the MIT License, and you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
