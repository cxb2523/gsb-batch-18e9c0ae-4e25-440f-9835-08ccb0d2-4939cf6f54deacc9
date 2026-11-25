import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'node20',
  sourcemap: false, // sources are not shipped, so maps would point at nothing
});
