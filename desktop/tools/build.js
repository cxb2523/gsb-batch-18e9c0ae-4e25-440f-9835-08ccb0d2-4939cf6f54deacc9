'use strict';
// Builds the desktop app.   node tools/build.js win     ->  out/TTAnywhere-win32-x64/TTAnywhere.exe   (then tools/make_zip.py makes the update zip)
//                           node tools/build.js linux   ->  out/TTAnywhere-<version>-x86_64.AppImage
// The version number is the repository's VERSION file (one number for every platform).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const version = fs.readFileSync(path.join(root, '..', 'VERSION'), 'utf8').trim();
const pkgFile = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
pkg.version = version;
fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status || 1);
}

const target = process.argv[2];
if (target === 'win') {
  const out = path.join(root, 'out');
  fs.rmSync(out, { recursive: true, force: true });
  const mod = require('@electron/packager');
  const pack = typeof mod === 'function' ? mod : (mod.packager || mod.default);
  pack({
    dir: root, name: 'TTAnywhere', platform: 'win32', arch: 'x64', out, overwrite: true, asar: true,
    icon: path.join(root, 'assets', 'tta.ico'), appVersion: version,
    win32metadata: { ProductName: 'Toontown: Anywhere', FileDescription: 'Toontown: Anywhere', CompanyName: 'Toontown: Anywhere' },
    ignore: [/^\/out($|\/)/, /^\/tools($|\/)/, /^\/build($|\/)/, /^\/dist($|\/)/, /^\/release($|\/)/],
  }).then(() => {
    fs.writeFileSync(path.join(out, 'TTAnywhere-win32-x64', 'VERSION.txt'), version + '\n');     // Setup reads it for the app list entry
    console.log('built version ' + version + ' for win');
  }).catch((e) => { console.error(e); process.exit(1); });
  return;
} else if (target === 'linux') {
  run('npx', ['--no-install', 'electron-builder', '--linux', 'AppImage', '--publish', 'never']);
} else {
  console.error('usage: node tools/build.js win|linux');
  process.exit(2);
}
console.log('built version ' + version + ' for ' + target);
