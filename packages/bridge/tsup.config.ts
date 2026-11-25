import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { cli: 'src/cli.ts', plugin: 'src/plugin.ts' },
    format: ['esm'],
    platform: 'node',
    target: 'node20',
    // not `clean`: dist/studio is copied in by the build script and must survive a plain `tsup` (the tests run one)
    clean: false,
    sourcemap: false,
    // the user's Vite is loaded at runtime from their project; never bundle it
    external: ['vite', '@modelcontextprotocol/sdk'],
  },
  {
    // runs in the user's page: react, three and R3F must resolve to the USER's copies
    entry: { overlay: 'src/overlay/overlay.ts' },
    format: ['esm'],
    platform: 'browser',
    target: 'es2022',
    clean: false,
    sourcemap: false,
    external: ['react', '@react-three/fiber', 'three', /^three\//],
  },
]);
