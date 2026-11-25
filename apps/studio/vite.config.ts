import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

const core = fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url));

/**
 * The sandbox page runs scene code that may come from an agent or a community template. In the production build
 * it gets a CSP with no network access (d2). Dev keeps the default so Vite's own client keeps working.
 */
function sandboxCsp(): Plugin {
  return {
    name: 'prismbox-sandbox-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.filename.endsWith('sandbox.html')) return html;
        const csp = "default-src 'none'; script-src 'self' 'unsafe-eval' 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; worker-src blob:";
        return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`);
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), sandboxCsp()],
  resolve: {
    alias: { '@prismbox/core': core },
    dedupe: ['react', 'react-dom', 'three', '@react-three/fiber'],
  },
  // cors: true because the sandboxed iframe has an opaque origin ("null") and loads its modules cross-origin
  server: { host: '127.0.0.1', port: 4173, strictPort: true, cors: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true, cors: true },
  build: {
    chunkSizeWarningLimit: 2500,
    rollupOptions: { input: { index: 'index.html', sandbox: 'sandbox.html' } },
  },
});
