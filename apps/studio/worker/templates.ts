// One import per template. On Cloudflare these are bundled as text (see `rules` in wrangler.jsonc); nothing is copied.
// TypeScript sees the real template modules, so index.ts converts through `unknown`. test/mcp-worker.test.ts fails
// if this list and packages/templates/manifest.json ever disagree.
import auroraRibbon from '../../../packages/templates/templates/aurora-ribbon.tsx';
import glassCard from '../../../packages/templates/templates/glass-card.tsx';
import glowingGlobe from '../../../packages/templates/templates/glowing-globe.tsx';
import gradientMesh from '../../../packages/templates/templates/gradient-mesh.tsx';
import iridescentKnot from '../../../packages/templates/templates/iridescent-knot.tsx';
import liquidChromeBlob from '../../../packages/templates/templates/liquid-chrome-blob.tsx';
import liquidGlassOrb from '../../../packages/templates/templates/liquid-glass-orb.tsx';

export const TEMPLATE_MODULES: Record<string, unknown> = {
  'aurora-ribbon': auroraRibbon,
  'glass-card': glassCard,
  'glowing-globe': glowingGlobe,
  'gradient-mesh': gradientMesh,
  'iridescent-knot': iridescentKnot,
  'liquid-chrome-blob': liquidChromeBlob,
  'liquid-glass-orb': liquidGlassOrb,
};
