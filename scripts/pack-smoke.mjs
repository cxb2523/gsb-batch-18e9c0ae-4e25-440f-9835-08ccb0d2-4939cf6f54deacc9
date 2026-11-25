// Cold-start tarball test. Packs @prismbox/core and prismbox, installs them OUTSIDE this monorepo next to a fresh copy of
// examples/vite-hero (exactly like `npx prismbox` on a new machine), and drives the packed binary.
//
//   pnpm build && node scripts/pack-smoke.mjs        (add --keep to leave the temp folder for inspection)
//
// Needs network access for `npm install` (react, three, vite, ...). No Playwright, no browser: HTTP and stdio only.
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const keep = process.argv.includes('--keep');
const win = process.platform === 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n        ${String(detail).slice(0, 600)}`}`);
};
// pnpm, npm and .cmd shims need a shell on Windows; node and tar do not (and node's own path may contain spaces)
const run = (cmd, args, opts = {}) => {
  const shell = win && /^(pnpm|npm|npx)$|.cmd$/.test(cmd);
  const quote = (x) => (shell && /[s&()]/.test(x) ? `"${x}"` : x);
  return execFileSync(shell && /s/.test(cmd) ? `"${cmd}"` : cmd, args.map(quote), { encoding: 'utf8', shell, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
};
const kb = (n) => `${(n / 1024).toFixed(1)} kB`;

const work = mkdtempSync(path.join(os.tmpdir(), 'prismbox-pack-'));
if (path.relative(repo, work).startsWith('..') === false) throw new Error('temp folder must be outside the repository');
const tarballs = path.join(work, 'tarballs');
const tool = path.join(work, 'tool'); // where `npx` would put prismbox
const app = path.join(work, 'app'); // the user's project
const home = path.join(work, 'home'); // PRISMBOX_HOME
for (const d of [tarballs, tool, home]) mkdirSync(d, { recursive: true });
console.log(`work dir (outside the repo): ${work}\n`);

let proc = null;
const stop = async () => {
  if (proc && proc.exitCode === null) {
    if (win) {
      try {
        execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        /* already gone */
      }
    } else proc.kill('SIGTERM');
    await sleep(500);
  }
};

try {
  // ---------------- 1. pack ----------------
  for (const pkg of ['core', 'bridge']) {
    const dist = path.join(repo, 'packages', pkg, 'dist');
    if (!existsSync(path.join(dist, pkg === 'core' ? 'index.js' : 'cli.js'))) throw new Error(`packages/${pkg}/dist is missing: run pnpm build first`);
  }
  if (!existsSync(path.join(repo, 'packages', 'bridge', 'dist', 'studio', 'index.html'))) throw new Error('dist/studio is missing: run pnpm build (not just tsup)');
  const packed = {};
  for (const pkg of ['core', 'bridge']) {
    const dir = path.join(repo, 'packages', pkg);
    run('pnpm', ['pack', '--pack-destination', tarballs], { cwd: dir });
  }
  for (const f of readdirSync(tarballs)) packed[/^prismbox-\d/.test(f) ? 'bridge' : 'core'] = path.join(tarballs, f);
  check('packed @prismbox/core and prismbox with pnpm pack', !!packed.core && !!packed.bridge, JSON.stringify(packed));
  const sizes = {};
  for (const [k, f] of Object.entries(packed)) sizes[k] = statSync(f).size;
  console.log(`      @prismbox/core  ${path.basename(packed.core)}  ${kb(sizes.core)}`);
  console.log(`      prismbox        ${path.basename(packed.bridge)}  ${kb(sizes.bridge)}\n`);

  // contents: list with tar (bsdtar on Windows, GNU tar elsewhere)
  // relative names + cwd: GNU tar (Git Bash on Windows) reads `C:` in an absolute path as a remote host
  const tar = (args, f) => run('tar', [...args, path.basename(f)], { cwd: path.dirname(f) });
  const list = (f) => tar(['-tzf'], f).split(/\r?\n/).filter(Boolean).map((l) => l.replace(/^package\//, ''));
  const coreFiles = list(packed.core);
  const bridgeFiles = list(packed.bridge);
  check('core tarball ships dist, README, LICENSE, package.json and nothing else', coreFiles.every((f) => /^(dist\/|README\.md$|LICENSE$|package\.json$)/.test(f)) && coreFiles.includes('dist/index.js') && coreFiles.includes('dist/index.d.ts'), coreFiles.join(', '));
  check('prismbox tarball bundles the production Studio (dist/studio/index.html + sandbox.html + assets), the overlay and the CLI', ['dist/cli.js', 'dist/overlay.js', 'dist/studio/index.html', 'dist/studio/sandbox.html'].every((f) => bridgeFiles.includes(f)) && bridgeFiles.some((f) => /^dist\/studio\/assets\/.+\.js$/.test(f)), bridgeFiles.filter((f) => !f.includes('assets/')).join(', '));
  check('prismbox tarball has no sources, tests, maps, host config or monorepo paths', !bridgeFiles.some((f) => /^(src|test|scripts)\/|\.map$|_headers$|vercel\.json$/.test(f)), bridgeFiles.filter((f) => /^(src|test|scripts)\/|\.map$|_headers$/.test(f)).join(', '));
  const bridgeManifest = JSON.parse(run('tar', ['-xzOf', path.basename(packed.bridge), 'package/package.json'], { cwd: tarballs }));
  const coreManifest = JSON.parse(run('tar', ['-xzOf', path.basename(packed.core), 'package/package.json'], { cwd: tarballs }));
  check('manifests: version 0.1.0, MIT, node >=20, repository/homepage/bugs, bin', [bridgeManifest, coreManifest].every((m) => m.version === '0.1.0' && m.license === 'MIT' && m.engines?.node === '>=20' && m.repository?.url?.includes('Guten-Morgen1302/prismbox') && m.homepage && m.bugs?.url) && bridgeManifest.bin?.prismbox === './dist/cli.js', JSON.stringify({ b: bridgeManifest.version, c: coreManifest.version }));
  check('prismbox depends on @prismbox/core by a real version (no workspace: protocol leaked)', !JSON.stringify(bridgeManifest.dependencies).includes('workspace:') && bridgeManifest.dependencies['@prismbox/core'] === '0.1.0', JSON.stringify(bridgeManifest.dependencies));

  // ---------------- 2. a brand-new machine ----------------
  cpSync(path.join(repo, 'examples', 'vite-hero'), app, { recursive: true, filter: (s) => !/[\\/](node_modules|dist)([\\/]|$)/.test(s) });
  const appPkg = JSON.parse(readFileSync(path.join(app, 'package.json'), 'utf8'));
  check('the app copy has no prismbox dependency or config', !JSON.stringify(appPkg).includes('prismbox') && !readFileSync(path.join(app, 'vite.config.ts'), 'utf8').toLowerCase().includes('prism'));
  console.log('      installing the app (plain deps) ...');
  run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: app });
  const appFilesBefore = readdirSync(app).sort();
  const appPkgBefore = readFileSync(path.join(app, 'package.json'), 'utf8');
  console.log('      installing the packed tarballs into a separate tool dir (what npx does) ...');
  writeFileSync(path.join(tool, 'package.json'), '{"name":"npx-sim","private":true}');
  run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', packed.core, packed.bridge], { cwd: tool });
  const bin = path.join(tool, 'node_modules', 'prismbox', 'dist', 'cli.js');
  check('tarballs install cleanly from files, with @prismbox/core resolved', existsSync(bin) && existsSync(path.join(tool, 'node_modules', '@prismbox', 'core', 'dist', 'index.js')));
  const ver = run(process.execPath, [bin, '--version']).trim();
  check('the packed binary runs and reports 0.1.0', ver === '0.1.0', ver);
  const help = run(process.execPath, [bin, '--help']);
  check('--help mentions dev and mcp', /prismbox \[dev\]/.test(help) && /prismbox mcp/.test(help));
  const cfg = run(process.execPath, [bin, 'mcp', '--print-config', '--root', app]);
  check('mcp --print-config prints external npx commands and no source-checkout variant', /claude mcp add prismbox -- (cmd \/c )?npx -y prismbox mcp --root/.test(cfg) && !/source checkout/.test(cfg) && /"mcpServers"/.test(cfg), cfg.slice(0, 300));

  // ---------------- 3. launch ----------------
  let out = '';
  proc = spawn(process.execPath, [bin, '--root', app, '--no-open', '--port', '4195'], { cwd: work, env: { ...process.env, PRISMBOX_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', (d) => (out += d));
  proc.stderr.on('data', (d) => (out += d));
  let urls = null;
  for (let i = 0; i < 400 && !urls; i++) {
    await sleep(150);
    const studio = /studio\s+(http:\/\/\S+)/.exec(out)?.[1];
    const page = /your page\s+(http:\/\/\S+)/.exec(out)?.[1];
    if (studio && page) urls = { studio, page };
    if (proc.exitCode !== null) break;
  }
  check('the packed prismbox starts against the isolated app', !!urls, out);
  if (urls) {
    const studioOrigin = new URL(urls.studio).origin;
    const pageOrigin = new URL(urls.page).origin;
    const get = async (url, init) => {
      const r = await fetch(url, init).catch((e) => { throw new Error(`fetch ${url} failed: ${e.cause?.code ?? e.cause?.message ?? e.message}`); });
      return { status: r.status, text: await r.text(), type: r.headers.get('content-type') ?? '', cors: r.headers.get('access-control-allow-origin') };
    };

    // the user's real page, served by their own Vite with the plugin attached
    const page = await get(`${pageOrigin}/`);
    check('your page: HTTP 200 and the HTML shell', page.status === 200 && /<div id="root">/.test(page.text), page.status);
    const main = await get(`${pageOrigin}/src/main.tsx`);
    const heroSrc = await get(`${pageOrigin}/src/Hero3D.tsx`);
    check('your page: modules are served and the hero is instrumented (userData-prism + overlay import)', main.status === 200 && heroSrc.status === 200 && /userData-prism/.test(heroSrc.text) && /virtual:prism-overlay/.test(heroSrc.text), `${main.status}/${heroSrc.status}`);
    const overlayMod = await get(`${pageOrigin}/@id/__x00__virtual:prism-overlay`);
    check('your page: the overlay virtual module loads and points at the daemon', overlayMod.status === 200 && overlayMod.text.includes(studioOrigin), overlayMod.status);
    // every module the page imports resolves (zero missing assets)
    const missing = [];
    const seen = new Set();
    const crawl = async (rel, depth = 0) => {
      if (seen.has(rel) || depth > 3) return;
      seen.add(rel);
      const r = await get(`${pageOrigin}${rel}`);
      if (r.status !== 200) return missing.push(`${rel} -> ${r.status}`);
      for (const m of r.text.matchAll(/(?:from|import)\s*\(?\s*["'](\/[^"']+)["']/g)) if (!/^\/@vite\/client|^\/@react-refresh/.test(m[1])) await crawl(m[1], depth + 1);
    };
    await crawl('/src/main.tsx');
    check(`your page: ${seen.size} imported modules all resolve (0 missing)`, missing.length === 0 && seen.size >= 4, missing.join(', '));
    const deps = [...(page.text + main.text + heroSrc.text).matchAll(/["'](\/node_modules\/\.vite\/deps\/[^"'?]+\?v=\w+)["']/g)].map((m) => m[1]);
    for (const d of new Set(deps)) {
      const r = await get(`${pageOrigin}${d}`);
      if (r.status !== 200) missing.push(`${d} -> ${r.status}`);
    }
    check('your page: pre-bundled dependencies resolve from the APP (react, three, fiber: one copy each)', missing.length === 0, missing.join(', '));

    // Studio from the tarball
    const idx = await get(`${studioOrigin}/`);
    check('Studio: HTTP 200 index.html from the tarball', idx.status === 200 && /<div id="root">/.test(idx.text) && idx.type.includes('text/html'), idx.status);
    const sandbox = await get(`${studioOrigin}/sandbox.html`);
    const assets = [...new Set([...idx.text.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g), ...sandbox.text.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]))];
    const bad = [];
    for (const a of assets) {
      const r = await get(`${studioOrigin}${a}`, { headers: { Origin: 'null' } });
      if (r.status !== 200 || r.cors !== '*') bad.push(`${a} -> ${r.status} cors=${r.cors}`);
    }
    check(`Studio: sandbox.html and ${assets.length} assets all 200 with CORS for the opaque-origin iframe`, sandbox.status === 200 && assets.length >= 3 && bad.length === 0, bad.join(', '));
    const session = await get(`${studioOrigin}/__prism/session`);
    check('Studio: the daemon identifies itself so Studio runs in Local mode', session.status === 200 && JSON.parse(session.text).prismbox === true);
    check('Studio: serves the local-mode marker in index.html', /name="prismbox-local"/.test(idx.text));
    const bad404 = await get(`${studioOrigin}/assets/definitely-missing.js`);
    check('Studio: a missing asset is a 404 (not the SPA shell)', bad404.status === 404);
    // fetch() cannot override Host, so use a raw request (DNS rebinding: the Host names another site)
    const rebind = await new Promise((resolve) => {
      const u = new URL(studioOrigin);
      http.get({ host: u.hostname, port: u.port, path: '/', headers: { Host: 'evil.example' } }, (r) => resolve(r.statusCode)).on('error', () => resolve(0));
    });
    check('daemon: refuses a spoofed Host header (421)', rebind === 421, rebind);

    // session registry outside both folders
    const sess = existsSync(path.join(home, 'sessions')) ? readdirSync(path.join(home, 'sessions')) : [];
    check('session descriptor written to PRISMBOX_HOME/sessions, not into the app', sess.length === 1 && !existsSync(path.join(app, '.prismbox')));

    // ---------------- 4. MCP over stdio from the tarball (raw JSON-RPC) ----------------
    const mcp = spawn(process.execPath, [bin, 'mcp', '--root', app], { env: { ...process.env, PRISMBOX_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] });
    let mcpOut = '';
    let mcpErr = '';
    mcp.stdout.on('data', (d) => (mcpOut += d));
    mcp.stderr.on('data', (d) => (mcpErr += d));
    const send = (m) => mcp.stdin.write(`${JSON.stringify(m)}\n`);
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'pack-smoke', version: '0' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'prism_lint', arguments: {} } });
    send({ jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: 'prismbox://guide' } });
    send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'prism_get_scene', arguments: { file: 'src/Hero3D.tsx' } } });
    send({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'prism_get_selection', arguments: {} } });
    for (let i = 0; i < 200 && mcpOut.split('\n').filter(Boolean).length < 6; i++) await sleep(100);
    mcp.stdin.end();
    const frames = mcpOut.split('\n').filter(Boolean);
    let parsedOk = true;
    const byId = {};
    for (const l of frames) {
      try {
        const m = JSON.parse(l);
        if (m.jsonrpc !== '2.0') parsedOk = false;
        if (m.id !== undefined) byId[m.id] = m;
      } catch {
        parsedOk = false;
      }
    }
    check('prismbox mcp: stdout is only JSON-RPC frames (6 frames, all valid)', parsedOk && frames.length === 6, `${frames.length} frames; first non-JSON: ${frames.find((l) => { try { JSON.parse(l); return false; } catch { return true; } })}`);
    check('prismbox mcp: 6 tools listed', byId[2]?.result?.tools?.length === 6, JSON.stringify(byId[2]).slice(0, 200));
    const lint = JSON.parse(byId[3]?.result?.content?.[0]?.text ?? '{}');
    check('prism_lint works from the tarball', lint.ok === true && lint.editableCoverage >= 0.9 && lint.files?.some((f) => f.file === 'src/Hero3D.tsx'), JSON.stringify(lint).slice(0, 200));
    check('prismbox://guide is served', /Prism subset/.test(byId[4]?.result?.contents?.[0]?.text ?? ''), JSON.stringify(byId[4]).slice(0, 200));
    const scene = JSON.parse(byId[5]?.result?.content?.[0]?.text ?? '{}');
    check('prism_get_scene works (and sees the knot)', scene.files?.[0]?.nodes?.some((n) => n.name === 'knot'), JSON.stringify(scene).slice(0, 200));
    const sel = JSON.parse(byId[6]?.result?.content?.[0]?.text ?? '{}');
    check('prism_get_selection with the daemon running: "nothing selected" (not an error)', sel.ok === true && sel.selected === false, JSON.stringify(sel).slice(0, 200));
    check('prismbox mcp: startup note went to stderr', /ready for/.test(mcpErr) && !mcpOut.includes('ready for'));
  }

  await stop();
  proc = null;
  await sleep(500);

  // ---------------- 5. production build of the user's app ----------------
  const buildOut = run(path.join(app, 'node_modules', '.bin', win ? 'vite.cmd' : 'vite'), ['build'], { cwd: app });
  const distDir = path.join(app, 'dist');
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  let bytes = 0;
  const hits = {};
  for (const f of walk(distDir)) {
    const t = readFileSync(f, 'utf8');
    bytes += t.length;
    for (const s of ['__PrismOverlay', 'userData-prism', 'virtual:prism', 'prism-overlay', '__prismDebug', '__PRISMBOX_DAEMON__', '/__prism/', 'prismbox', 'Prismbox']) if (t.includes(s)) hits[s] = (hits[s] ?? 0) + 1;
  }
  check('vite build in the app: dist/ has 0 Prismbox bytes', Object.keys(hits).length === 0 && bytes > 100000, JSON.stringify({ hits, bytes, tail: buildOut.slice(-200) }));
  const appFilesAfter = readdirSync(app).filter((f) => f !== 'dist').sort();
  check('the app folder was never modified (same files, same package.json, no .prismbox)', JSON.stringify(appFilesAfter) === JSON.stringify(appFilesBefore) && readFileSync(path.join(app, 'package.json'), 'utf8') === appPkgBefore && !existsSync(path.join(app, '.prismbox')), appFilesAfter.join());
  // A graceful exit removes the descriptor. Windows has no catchable SIGTERM for a child, so there the stop above is a hard kill:
  // the descriptor is left behind and must be pruned (and reported as offline) by the next reader.
  const sessDir = path.join(home, 'sessions');
  const left = () => (existsSync(sessDir) ? readdirSync(sessDir) : []);
  if (!win) check('the session file was removed when prismbox exited (SIGTERM)', left().length === 0, left().join());
  const late = spawn(process.execPath, [bin, 'mcp', '--root', app], { env: { ...process.env, PRISMBOX_HOME: home }, stdio: ['pipe', 'pipe', 'ignore'] });
  let lateOut = '';
  late.stdout.on('data', (d) => (lateOut += d));
  const EOL = String.fromCharCode(10);
  const lateSend = (m) => late.stdin.write(JSON.stringify(m) + EOL);
  const lateFrames = () => lateOut.split(EOL).filter(Boolean);
  lateSend({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '0' } } });
  lateSend({ jsonrpc: '2.0', method: 'notifications/initialized' });
  lateSend({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'prism_get_selection', arguments: {} } });
  for (let i = 0; i < 100 && lateFrames().length < 2; i++) await sleep(100);
  late.stdin.end();
  const offline = JSON.parse(JSON.parse(lateFrames()[1] ?? '{}').result?.content?.[0]?.text ?? '{}');
  check('after prismbox is gone the agent gets a graceful DAEMON_OFFLINE and the stale descriptor is pruned', offline.code === 'DAEMON_OFFLINE' && left().length === 0, JSON.stringify({ offline, left: left() }));
} catch (e) {
  check('pack-smoke completed', false, e instanceof Error ? `${e.message}\n${e.stderr ?? ''}` : String(e));
} finally {
  await stop();
  if (!keep) rmSync(work, { recursive: true, force: true });
  else console.log(`\nkept ${work}`);
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
