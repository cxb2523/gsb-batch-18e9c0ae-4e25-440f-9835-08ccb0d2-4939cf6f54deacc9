// Copies the built Studio (apps/studio/dist) into dist/studio so the published package can serve it.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const from = fileURLToPath(new URL('../../../apps/studio/dist', import.meta.url));
const to = fileURLToPath(new URL('../dist/studio', import.meta.url));
if (!existsSync(`${from}/index.html`)) {
  console.error('apps/studio/dist is missing: build @prismbox/studio first (pnpm build does this in order).');
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true, filter: (src) => !src.endsWith('_headers') }); // static-host config is for the hosted Playground only
console.log('studio copied into dist/studio');
