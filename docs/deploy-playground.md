# Deploying the static Playground

The Playground is `apps/studio` built as static files. Two things matter on any host:

1. **CORS on assets.** Scene code runs in an iframe with `sandbox="allow-scripts"` and no `allow-same-origin`, so it has an opaque origin and loads its modules cross-origin. Everything under `/assets/` (and `sandbox.html`) needs `Access-Control-Allow-Origin: *`. They are public static files.
2. **SPA fallback** to `index.html`, but real files (`/sandbox.html`, `/assets/*`) must still be served as files and a missing asset must be a 404.

Both configs below do this and add a strict CSP for the Studio page (`frame-ancestors 'none'`) while letting `sandbox.html` be framed by Studio only. `sandbox.html` also carries its own CSP in a `<meta>` tag with `connect-src 'none'`, so scene code cannot make network requests.

## Cloudflare (Workers static assets)

New Cloudflare projects are created through **Workers & Pages → Create → Import a repository**, which runs a build command and then a deploy command. The repository root has a `wrangler.jsonc` that points the deploy at the built Playground, so the default deploy command works:

- Build command: `pnpm install --frozen-lockfile && pnpm --filter @prismbox/studio build`
- Deploy command: `npx wrangler deploy` (reads `wrangler.jsonc`: assets from `apps/studio/dist`, SPA fallback)
- Root directory: the repository root.
- Headers come from `apps/studio/public/_headers` (copied into `dist/`).

Without `wrangler.jsonc`, `wrangler deploy` fails in a monorepo with "The Cloudflare application detection logic has been run in the root of a workspace". The site is served at `https://prismbox-playground.<your-subdomain>.workers.dev`; rename it in `wrangler.jsonc` (`name`) or add a custom domain in the dashboard. Classic **Pages** projects also work: build output directory `apps/studio/dist`, no deploy command.

`wrangler.jsonc` also has a small Worker (`apps/studio/worker`) that answers only `/mcp`, a stateless read-only MCP endpoint serving the template sources (they are bundled as text through `rules`). Every other path is served straight from the static assets, with headers from `_headers`. Static hosts without Workers (Pages, Vercel, Netlify) serve the Playground without `/mcp`.

## Vercel

- Framework preset: Other. Root directory: `apps/studio`, with **Include source files outside of the Root Directory** enabled.
- Install command: `pnpm install --frozen-lockfile` (run from the repository root). Build command: `pnpm --filter @prismbox/studio build`. Output directory: `dist`.
- Headers and the SPA rewrite come from `apps/studio/vercel.json`.

## Before you announce

- Open the URL in a private window; every template should load with no console errors.
- Keep it unlisted (`noindex` is already set on both pages) until the launch.
- Put the URL in `README.md` where `<!-- PLAYGROUND_URL -->` appears.

`pnpm e2e` includes a run of the production build behind a small host that applies `_headers` (`e2e/playground.e2e.mjs`), so the header file is tested, not just the build.
