# vite-hero

A plain Vite + React 19 + React Three Fiber landing page ("Meridian") with an iridescent 3D hero behind the headline. It has **no Prismbox dependency, import or config**: it is what a real project looks like, and the target of the end-to-end test.

```bash
pnpm install && pnpm build
pnpm demo            # = node packages/bridge/dist/cli.js --root examples/vite-hero
```

`prismbox` prints two URLs. Open **your page** (the landing page) and **Studio** side by side, click **Arm** in Studio, then click and drag the 3D knot on the real page. The change lands as one line in `src/Hero3D.tsx`, Vite hot-reloads it, and Studio shows the diff tagged `page`. `vite build` in this folder produces a bundle with no Prismbox in it.
