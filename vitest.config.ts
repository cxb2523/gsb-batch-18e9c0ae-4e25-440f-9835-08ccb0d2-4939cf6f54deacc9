import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Mirror tsconfig.json "baseUrl": "src" — every top-level folder and file under
// src is a bare-specifier alias (e.g. `import { AudioX } from 'audio'`).
// String aliases keep Vite's normalized module ids, which `vi.mock` relies on.
const srcRoot = fileURLToPath(new URL('./src', import.meta.url));
const alias: Array<{ find: string; replacement: string }> = [];
for (const entry of readdirSync(srcRoot, { withFileTypes: true })) {
  if (entry.isDirectory()) {
    alias.push({
      find: entry.name,
      replacement: fileURLToPath(new URL(`./src/${entry.name}`, import.meta.url)),
    });
  } else if (entry.name.endsWith('.ts')) {
    alias.push({
      find: entry.name.slice(0, -3),
      replacement: fileURLToPath(new URL(`./src/${entry.name}`, import.meta.url)),
    });
  }
}

export default defineConfig({
  resolve: { alias },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['test/**/*.test.ts'],
    clearMocks: true,
  },
});
