'use strict';
// Updates of the app itself (the window around the game): rare, because the game's code and files update on their own through the website.
// Releases are published on GitHub: every release carries windows.json / linux.json (version, file, url, size, sha256) and a matching .sig, an
// Ed25519 signature made with the release key; the public half is built into the app (updatekey.js). Nothing is installed unless the
// signature and the file's hash match. The update downloads in the background and takes effect the next time the app starts.
const { app, net } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const PUBLIC_KEY_HEX = require('./updatekey');

const PLATFORM_FILE = process.platform === 'win32' ? 'windows.json' : 'linux.json';
const DEFAULT_BASE = 'https://github.com/lPuffyy/toontown-anywhere/releases/latest/download/';

function updateBase() {
  const b = process.env.TTA_UPDATE_BASE || DEFAULT_BASE;
  return b.endsWith('/') ? b : b + '/';
}

function parseVersion(v) {
  return String(v).split('.').map((p) => parseInt(p.replace(/\D/g, '') || '0', 10));
}
function newer(a, b) {            // is version a newer than b
  const x = parseVersion(a), y = parseVersion(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

async function fetchBytes(url) {
  const r = await net.fetch(url, { headers: { 'User-Agent': 'TTAnywhere-desktop' } });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
  return Buffer.from(await r.arrayBuffer());
}

function verify(data, sigHex, pubHex) {
  try {
    const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(pubHex || PUBLIC_KEY_HEX, 'hex')]);
    const key = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
    return crypto.verify(null, data, key, Buffer.from(sigHex.trim(), 'hex'));
  } catch (e) { return false; }
}

async function download(url, dest, size, sha256) {
  const r = await net.fetch(url, { headers: { 'User-Agent': 'TTAnywhere-desktop' } });
  if (!r.ok || !r.body) throw new Error('HTTP ' + r.status + ' for ' + url);
  const h = crypto.createHash('sha256');
  const part = dest + '.part';
  const source = Readable.fromWeb(r.body);
  source.on('data', (c) => h.update(c));
  await pipeline(source, fs.createWriteStream(part));
  if (h.digest('hex') !== sha256 || fs.statSync(part).size !== size) {
    fs.rmSync(part, { force: true });
    throw new Error('the downloaded update does not match its signed description');
  }
  fs.renameSync(part, dest);
}

function applyWindows(dataRoot, zipFile) {
  const stage = path.join(dataRoot, 'update', 'staged');
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  let r = spawnSync('tar', ['-xf', zipFile, '-C', stage], { windowsHide: true });
  if (r.status !== 0) {
    r = spawnSync('powershell', ['-NoProfile', '-Command', 'Expand-Archive -LiteralPath "' + zipFile + '" -DestinationPath "' + stage + '" -Force'], { windowsHide: true });
    if (r.status !== 0) throw new Error('could not unpack the update');
  }
  fs.rmSync(zipFile, { force: true });
  const src = path.join(stage, 'TTAnywhere');
  if (!fs.existsSync(path.join(src, 'TTAnywhere.exe'))) throw new Error('the update has no program in it');
  const appDir = path.dirname(process.execPath);
  const bat = path.join(dataRoot, 'update', 'apply.bat');
  fs.writeFileSync(bat,
    '@echo off\r\n' +
    'powershell -NoProfile -Command "try { Wait-Process -Id ' + process.pid + ' -Timeout 90 } catch {}"\r\n' +
    'robocopy "' + src + '" "' + appDir + '" /E /R:20 /W:1 /NFL /NDL /NJH /NJS /NP >nul\r\n' +
    'rmdir /S /Q "' + stage + '" >nul 2>&1\r\n');
  // the files are swapped in once this program has closed, so the next start is the new version
  app.once('will-quit', () => {
    try { spawn('cmd', ['/c', bat], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch (e) { /* next start tries again */ }
  });
}

function applyLinux(file) {
  const target = process.env.APPIMAGE;
  const tmp = target + '.new';
  fs.copyFileSync(file, tmp);
  fs.chmodSync(tmp, 0o755);
  fs.renameSync(tmp, target);                 // replacing the file under a running AppImage is fine: this run keeps the old one open
  fs.rmSync(file, { force: true });
}

async function check(dataRoot, log) {
  if (!app.isPackaged && !process.env.TTA_FORCE_SHELL_UPDATE) return;       // running from source: nothing to replace
  if (process.platform === 'linux' && !process.env.APPIMAGE) return;        // only the AppImage can replace itself
  const base = updateBase();
  const data = await fetchBytes(base + PLATFORM_FILE);
  const sig = (await fetchBytes(base + PLATFORM_FILE + '.sig')).toString('ascii');
  if (!verify(data, sig)) throw new Error("the update list's signature is not valid");
  const m = JSON.parse(data.toString('utf8'));
  if (!newer(m.version, app.getVersion())) return;
  const url = m.url || base + m.file;
  if (!url.startsWith('https://')) throw new Error('the update address is not secure');
  log('downloading ' + m.version);
  const dir = path.join(dataRoot, 'update');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, path.basename(m.file));
  await download(url, file, Number(m.size), m.sha256);
  if (process.platform === 'win32') applyWindows(dataRoot, file); else applyLinux(file);
  log('version ' + m.version + ' will start next time');
}

module.exports = { check, verify, newer };
