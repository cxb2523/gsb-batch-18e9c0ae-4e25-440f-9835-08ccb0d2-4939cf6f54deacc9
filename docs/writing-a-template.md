# Writing a template

A template is **one plain `.tsx` file** that a person can copy into any React Three Fiber project. It has no Prismbox import, no Prismbox comment and no runtime dependency on anything in this repository.

## Rules (CI enforces them in `packages/templates/test`)

1. Default-export one component that renders its own `<Canvas camera={{...}}>` with a literal camera.
2. Imports only from `react`, `three`, `@react-three/fiber`, `@react-three/drei`. No relative files, no assets.
3. Every `mesh` and `group` has a unique literal `name`.
4. Props on scene elements are literals: numbers, strings, booleans, arrays and objects of those, `new THREE.Color("#hex")`. No spread, no `.map()` or conditionals around scene elements.
5. Put motion in small wrapper components in the same file (`Spin`, `MouseFollow`, `Clock`). They wrap plain literal children.
6. Shaders: GLSL in `/* glsl */` template literals bound to top-level `const`s, and `uniforms` in a top-level `const` object literal. Annotate tunable uniforms with comments such as `// @prism uniform uGlow float 0..2 =1`. These are ordinary GLSL comments that a shader author may keep or delete; they have no effect at runtime and import nothing.
7. At least 95% of host nodes must be fully editable literals (see [subset.md](subset.md)).

## Authoring flow

Templates are generated from `packages/templates/source/*.tsx`. In a GLSL string, a line `//@include <block>` is a valid GLSL comment, and `pnpm --filter @prismbox/templates gen` expands it with the block from `packages/shaders/glsl/<block>.glsl` (noise, fresnel, palette, studio). The expanded file in `packages/templates/templates/` is what ships; CI fails if it is stale.

Do not put backticks or `${` in a GLSL block: it ends up inside a template literal. Avoid GLSL reserved words (`half`, `input`, `output`, ...).

## Checking your work

```bash
pnpm --filter @prismbox/templates gen
pnpm --filter @prismbox/templates test
pnpm --filter @prismbox/studio dev     # http://127.0.0.1:4173/?template=<your-id>
```

Add an entry to `packages/templates/manifest.json` (`id` = file name without `.tsx`). Judge it in Studio at 1440x900: if it looks flat, washed out or badly framed, iterate on lighting, camera and contrast before opening a PR.

You can also check a template the way an agent would: with the Prismbox MCP server connected, `prism_lint` on the file reports editable coverage and findings with fixes (it works without the daemon). CI enforces the same rules through `pnpm --filter @prismbox/templates test`.
