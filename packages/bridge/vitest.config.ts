import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@prismbox/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)) } },
  test: { include: ['test/**/*.test.ts'], testTimeout: 30000, globalSetup: ['./test/global-setup.ts'] },
});
