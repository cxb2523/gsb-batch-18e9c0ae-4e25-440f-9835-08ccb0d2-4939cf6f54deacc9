'use strict';

// Lightweight test runner. Each suite is a standalone ESM file under test/ that
// prints its own summary and exits non-zero on failure, so this stays
// dependency-free and works before `npm install`.

const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const testDir = path.join(root, 'test');
const suites = fs.existsSync(testDir)
  ? fs.readdirSync(testDir).filter((name) => name.endsWith('.test.mjs')).sort()
  : [];

if (!suites.length) {
  console.error('no test suites found under test/');
  process.exit(1);
}

let failed = 0;
for (const suite of suites) {
  const file = path.join(testDir, suite);
  const args = [];
  // The renderer suite imports a CSS file, which needs the module hook.
  if (suite.startsWith('movy-subtitle-layer')) args.push('--import', pathToFileURL(path.join(testDir, 'register-css.mjs')).href);
  args.push(file);
  const proc = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: '' },
  });
  if (proc.status !== 0) failed += 1;
}

if (failed) {
  console.error(`\n${failed} suite(s) failed`);
  process.exit(1);
}
console.log('\nall suites passed');
