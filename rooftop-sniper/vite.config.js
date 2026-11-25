import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build:offline` produces offline/index.html: one self-contained file
// that can be opened by double-clicking (no server, no network).
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'offline' ? [viteSingleFile()] : [],
  build: {
    outDir: mode === 'offline' ? 'offline' : 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
  server: { port: 5173 },
}));
