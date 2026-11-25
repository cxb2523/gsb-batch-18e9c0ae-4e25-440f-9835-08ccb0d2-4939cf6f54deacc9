# Monochrome CAD color mode

`CadViewer` can render authored CAD colors or apply one fixed plot color without rewriting parser-owned data.

```ts
import { CadViewer } from '@flyfish-dev/cad-viewer';

const viewer = new CadViewer({
  container,
  colorMode: 'monochrome',
  monochromeColor: '#000000',
});

await viewer.loadFile(file);

// Switch at runtime while retaining the active pan/zoom view.
viewer.setColorMode('source');
viewer.setColorMode('monochrome', '#000000');
```

The policy is applied by the shared color resolver, so normalized DWG/DXF output is consistent across Canvas2D, retained WebGL geometry, text overlays, fills, layer colors and ByBlock inheritance. Source entity colors, line types, line weights, visibility, geometry and alpha values are preserved.

Native DWF/DWFx/XPS rendering forwards the same fixed color to `dwf-viewer` when the installed native renderer exposes `setMonochromeColor()`.

## Renderer-level policy (WebGL and Canvas2D)

The renderers accept the policy directly as `colorMode` / `monochromeColor` options, so a policy switch is a normal option change:

`CadWebGLRenderer.setDocument()` applies the policy to a shallow render-only document view and uploads the GPU scene from it; `setOptions()` rebuilds the retained scene when the color policy changes. `refreshReferences()` rebuilds the scene after SHX fonts are added or removed, keeping the current view centre and `fitScale`. `clear()` and `destroy()` drop the retained buffers and the render document, so no stale scene or font state survives.

`CadCanvasRenderer` re-renders instead of rebuilding because it resolves glyphs and colors while traversing entities.

```ts
const renderer = new CadWebGLRenderer(canvas, { colorMode: 'monochrome', monochromeColor: '#102030' });
renderer.setDocument(document);          // source document stays untouched
renderer.setOptions({ colorMode: 'source' });
renderer.refreshReferences();            // after SHX fonts change
renderer.getDocument();                  // policy-decorated render view
renderer.getSourceDocument();            // caller-owned document, unmodified
```

Options always win over the policy already attached to a render document. `colorMode: 'source'` clears a previously used fixed color; `colorMode: 'monochrome'` without a color keeps the configured color, so a mode switch does not silently fall back to the foreground.

For lower-level rendering, use `createCadRenderDocument()` to attach a render-only policy to a shallow document view and pass that view to a renderer. `readCadColorPolicy()` inspects the active policy, `resolveCadColorPolicy()` merges document metadata with renderer options, and `mergeCadColorPolicy()` / `cadColorPolicySignature()` support renderer-level overrides and change detection.
