import bridge from '../../../packages/bridge/package.json';
import manifest from '../../../packages/templates/manifest.json';
import { handleMcp } from './mcp';
import type { McpData } from './mcp';
import { TEMPLATE_MODULES } from './templates';

/** The Cloudflare Worker in front of the static Playground: `/mcp` is handled here, everything else is the static assets. */
export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export function buildData(modules: Record<string, unknown>): McpData {
  return {
    version: bridge.version,
    // In the Worker bundle each template module is its source text (wrangler `rules`: Text).
    templates: manifest.templates.map((t) => ({ id: t.id, title: t.title, description: t.description, source: String(modules[t.id] ?? '') })),
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/mcp' || pathname === '/mcp/') return handleMcp(request, buildData(TEMPLATE_MODULES));
    return env.ASSETS.fetch(request);
  },
};
