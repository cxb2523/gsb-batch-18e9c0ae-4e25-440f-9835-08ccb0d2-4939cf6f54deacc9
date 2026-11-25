/**
 * Test runner.
 *
 * The source tree uses TypeScript enums and extensionless ESM imports, which
 * Node's type stripping can't execute directly. esbuild (already present as a
 * Vite dependency) bundles each `tests/*.test.ts` into a plain ES module, and
 * `node --test` runs the bundles. Keeping this in one script means `npm test`
 * behaves the same on Windows cmd and POSIX shells (no shell glob expansion).
 */
import { build } from 'esbuild';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '.build');

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const entries = (await readdir(here)).filter((name) => name.endsWith('.test.ts'));
if (entries.length === 0) {
  console.error('No test files found in tests/.');
  process.exit(1);
}

await build({
  entryPoints: entries.map((name) => join(here, name)),
  outdir: outDir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: 'inline',
  outExtension: { '.js': '.mjs' },
  logLevel: 'warning',
});

const outFiles = entries.map((name) => join(outDir, name.replace(/\.ts$/, '.mjs')));

const result = spawnSync(process.execPath, ['--test', ...outFiles], { stdio: 'inherit' });
process.exit(result.status ?? 1);
