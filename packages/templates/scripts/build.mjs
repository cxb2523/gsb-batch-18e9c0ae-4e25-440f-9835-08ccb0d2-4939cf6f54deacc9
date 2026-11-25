// Expands `//@include <block>` lines in source/*.tsx with the GLSL blocks from @prismbox/shaders and writes the
// plain, dependency-free templates to templates/*.tsx. `--check` fails if the committed output is stale.
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expandIncludes } from '../../shaders/index.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const check = process.argv.includes('--check');
mkdirSync(`${root}templates`, { recursive: true });

let stale = 0;
for (const file of readdirSync(`${root}source`).filter((f) => f.endsWith('.tsx')).sort()) {
  const out = expandIncludes(readFileSync(`${root}source/${file}`, 'utf8'));
  const target = `${root}templates/${file}`;
  if (check) {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== out) {
      console.error(`stale: templates/${file} (run \`pnpm --filter @prismbox/templates gen\`)`);
      stale++;
    }
  } else {
    writeFileSync(target, out);
  }
}
if (check && stale) process.exit(1);
console.log(check ? 'templates are up to date' : 'templates generated');
