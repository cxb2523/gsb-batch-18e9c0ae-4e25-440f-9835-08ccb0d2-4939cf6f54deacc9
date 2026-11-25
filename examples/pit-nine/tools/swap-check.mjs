// Reproducible checks for the atomic look swap (M greybox/models, L style) mid-round.
//
//   node tools/swap-check.mjs
//
// Exits 0 only when every acceptance check passes and the page logs no errors.
// It drives the game with ?manual frames through playwright-core + Chrome, like the other tools/.
// If http://localhost:4291 is not serving the game yet, this script starts `vite --port 4291`
// itself and stops only that process when it finishes. Set BROWSER_PATH to a chrome/chromium
// executable to override browser discovery; BASE_URL overrides the server address.
import { chromium } from 'playwright-core';
import { existsSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = process.env.BASE_URL || process.argv[2] || 'http://localhost:4291/';
const origin = new URL(BASE_URL).origin;

// ------------------------------------------------------------ server
async function isUp(url) {
  try { const r = await fetch(url); return r.ok; } catch { return false; }
}
let startedServer = null;
if (!(await isUp(BASE_URL))) {
  const viteBin = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  startedServer = spawn(process.execPath, [viteBin, '--port', '4291', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    await new Promise((r) => setTimeout(r, 300));
    if (await isUp(BASE_URL)) break;
  }
  if (!(await isUp(BASE_URL))) { console.error('could not start vite on 4291'); process.exit(2); }
}
const stopStartedServer = () => {
  if (!startedServer?.pid) return;
  const taskkill = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
  try { spawn(taskkill, ['/PID', String(startedServer.pid), '/T', '/F'], { stdio: 'ignore' }); }
  catch { try { startedServer.kill(); } catch {} }
};

// ------------------------------------------------------------ browser
function resolveExe() {
  if (process.env.BROWSER_PATH && existsSync(process.env.BROWSER_PATH)) return process.env.BROWSER_PATH;
  const roots = [
    'C:/Users/Administrator/AppData/Local/ms-playwright',
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'ms-playwright').replace(/\\/g, '/') : '',
  ].filter(Boolean);
  for (const root of roots) {
    let dirs = [];
    try { dirs = readdirSync(root).filter((d) => /^chromium(-headless-shell)?-\d+$/.test(d)).sort(); } catch { continue; }
    for (let i = dirs.length - 1; i >= 0; i--) {
      for (const sub of ['chrome-win64', 'chrome-win']) {
        const p = join(root, dirs[i], sub, 'chrome.exe');
        if (existsSync(p)) return p;
      }
      const hs = join(root, dirs[i], 'chrome-win64', 'headless_shell.exe');
      if (existsSync(hs)) return hs;
    }
  }
  return undefined; // fall back to the repo convention: installed Google Chrome channel
}
const exe = resolveExe();
const launchOpts = exe
  ? { executablePath: exe, headless: true, args: ['--enable-unsafe-swiftshader'] }
  : { channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'] };
const browser = await chromium.launch(launchOpts);

const results = [];
const record = (suite, assertions) => { for (const [name, pass, detail] of assertions) results.push({ suite, name, pass: !!pass, detail: String(detail ?? '') }); };

async function openPage(hash = '?manual&greybox') {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.__errors = errors;
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (/favicon|\.glb|Failed to load resource|404|net::ERR/i.test(text)) return; // missing optional GLBs fall back to greybox
    errors.push('console: ' + text);
  });
  await page.goto(`${origin}/${hash}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  await page.waitForTimeout(150);
  return page;
}

// The whole acceptance suite runs in one greybox page. Self-contained on purpose.
const CORE_FN = () => {
  const A = [];
  const ok = (name, pass, detail) => A.push([name, !!pass, detail]);
  let now = 0;
  const frames = (n) => { for (let i = 0; i < n; i++) { now += 1000 / 60; __frame(now); } };

  try {
    const g = __game;

    // ---------- 1. broken left cannon + armour survive a swap; attacks/core/hit tests stay consistent
    g.phase = 'boss';
    g.foreman.wake();
    frames(150);
    const f = g.foreman;
    const NAMES = ['left_cannon', 'right_cannon', 'missile_pod', 'armour_plate', 'core'];
    const centers0 = Object.fromEntries(NAMES.map((n) => [n, f.partCenter(n).clone()]));
    const probes = [];
    for (const n of NAMES) {
      const c = centers0[n];
      for (const [dx, dy, dz] of [[0, 0, 0], [0.6, 0, 0], [-0.6, 0, 0], [0, 0.6, 0], [0, -0.6, 0], [0, 0, 0.6], [0, 0, -0.6]])
        probes.push({ x: c.x + dx, y: c.y + dy, z: c.z + dz });
    }
    f.damagePart('left_cannon', 999, g); frames(4);
    f.damagePart('armour_plate', 999, g); frames(4);
    f.parts.right_cannon.invuln = 0.05;
    f.parts.core.invuln = 0.03;
    frames(1);
    const avail0 = JSON.stringify(f.available());
    const targets0 = JSON.stringify(NAMES.map((n) => f.isTarget(n)));
    const inv0 = JSON.stringify(NAMES.map((n) => +f.parts[n].invuln.toFixed(4)));
    const glow0 = JSON.stringify(f.view.glow);
    const classify = (p) => { const h = f.hitTest(p); return h?.part || (h?.blocked ? 'blocked' : null); };
    const hits0 = JSON.stringify(probes.map(classify));
    ok('left cannon + armour broken before swap', f.parts.left_cannon.broken && f.parts.armour_plate.broken);
    ok('remaining attacks are sweep + missiles (+stomp)', avail0 === JSON.stringify(['sweep', 'missiles']), avail0);

    g.swapViews();
    f.view.root.updateMatrixWorld(true);
    ok('available attack list unchanged by swap', JSON.stringify(f.available()) === avail0, `${avail0} -> ${JSON.stringify(f.available())}`);
    ok('targetable part list unchanged', JSON.stringify(NAMES.map((n) => f.isTarget(n))) === targets0);
    ok('part invulnerability timers preserved', JSON.stringify(NAMES.map((n) => +f.parts[n].invuln.toFixed(4))) === inv0);
    ok('part glow state carried to the new view', JSON.stringify(f.view.glow) === glow0);
    ok('hit spheres give identical results at the same world points', JSON.stringify(probes.map(classify)) === hits0);
    ok('broken parts are absent from the new view', !f.view.part('left_cannon') && !f.view.part('armour_plate'));
    ok('core view exists and is hittable after armour', !!f.view.part('core') && f.isTarget('core'));
    ok('core hit sphere resolves to core', classify(f.partCenter('core')) === 'core');
    frames(60);
    ok('available attacks stay consistent after 60 frames', JSON.stringify(f.available()) === avail0, JSON.stringify(f.available()));
    ok('broken parts never reappear / ghost-hit after frames', probes.map(classify).every((h) => h !== 'left_cannon' && h !== 'armour_plate')
      && !f.view.part('left_cannon') && !f.view.part('armour_plate'));
    ok('a bolt-position probe at the right cannon still hits right_cannon', classify(f.partCenter('right_cannon')) === 'right_cannon');

    // ---------- 2. open missile lid + warning circles survive with progress
    __restart();
    frames(5);
    const g2 = __game;
    g2.phase = 'boss';
    g2.foreman.wake();
    frames(140);
    const fm = g2.foreman;
    fm.setState('attack'); fm.attack = 'missiles'; fm.attackT = 1.0; fm.missilePlan = [];
    for (let i = 0; i < 20; i++) frames(1);
    const lid = fm.view.part('lid');
    const lidRx0 = lid ? +lid.rotation.x.toFixed(4) : null;
    ok('missile lid is open before swap', lidRx0 !== null && lidRx0 < -0.5, `rx=${lidRx0}`);
    const cfg = __FOREMAN.attacks.missiles;
    g2.placeMissile(2, 2, cfg); g2.placeMissile(-3, 1, cfg); g2.placeMissile(0, -4, cfg);
    ok('three warning circles placed', g2.markers.length === 3, `n=${g2.markers.length}`);
    g2.markers[0].t = 0.2; g2.markers[1].t = 0.6; g2.markers[2].t = 1.0;
    frames(2);
    const fills0 = g2.markers.map((m) => +m.fill.toFixed(4));
    const scales0 = g2.markers.map((m) => +m.marker.part('fill').scale.x.toFixed(4));
    const mpos0 = JSON.stringify(g2.markers.map((m) => [+m.x.toFixed(3), +m.z.toFixed(3)]));
    g2.swapViews();
    const lid2 = fm.view.part('lid');
    ok('lid stays present and open after swap', !!lid2 && Math.abs(+lid2.rotation.x.toFixed(4) - lidRx0) < 0.05, `${lidRx0} -> ${lid2 ? +lid2.rotation.x.toFixed(4) : 'n/a'}`);
    ok('warning circle count unchanged', g2.markers.length === 3);
    ok('warning circle positions unchanged', JSON.stringify(g2.markers.map((m) => [+m.x.toFixed(3), +m.z.toFixed(3)])) === mpos0);
    ok('warning progress data preserved', JSON.stringify(g2.markers.map((m) => +m.fill.toFixed(4))) === JSON.stringify(fills0));
    ok('warning fill restored on the new circle views', JSON.stringify(g2.markers.map((m) => +m.marker.part('fill').scale.x.toFixed(4))) === JSON.stringify(scales0));
    {
      const t0 = g2.markers.map((m) => m.t);
      frames(12);
      ok('warning circles keep progressing after swap', g2.markers.every((m, i) => m.t > t0[i]));
    }

    // ---------- 3 + 4. debris persistence and rapid-swap duplication
    __restart();
    frames(5);
    const g3 = __game;
    g3.phase = 'boss';
    g3.foreman.wake();
    frames(140);
    const f3 = g3.foreman;
    f3.damagePart('left_cannon', 999, g3); frames(3);
    f3.damagePart('missile_pod', 999, g3); frames(3);
    g3.spawnHound(0); frames(2);
    const h0 = g3.hounds[0];
    h0.damage(999, { x: 1, z: 0 }, g3); frames(3);
    const debris0 = g3.debris.length;
    const kits0 = g3.kits.length;
    ok('debris + boss kits exist for the test', debris0 >= 8 && kits0 >= 2, `debris=${debris0}, kits=${kits0}`);
    const dpos0 = JSON.stringify(g3.debris.map((d) => d.obj.position.toArray().map((v) => +v.toFixed(3))));
    for (let i = 0; i < 11; i++) g3.swapViews(); // continuous rapid swapping, same tick
    ok('rapid swaps make no duplicate debris', g3.debris.length === debris0, `${debris0} -> ${g3.debris.length}`);
    ok('rapid swaps make no duplicate repair kits', g3.kits.length === kits0, `${kits0} -> ${g3.kits.length}`);
    ok('debris transforms stay identical', JSON.stringify(g3.debris.map((d) => d.obj.position.toArray().map((v) => +v.toFixed(3)))) === dpos0);
    ok('all debris stays scene-owned', g3.debris.every((d) => d.obj.parent === g3.scene));
    const y0 = g3.debris.map((d) => d.obj.position.y);
    frames(45);
    ok('debris keeps falling/moving after swap', g3.debris.filter((d, i) => Math.abs(d.obj.position.y - y0[i]) > 0.001 || d.vel.lengthSq() > 0).length === g3.debris.length);
    ok('debris count stable while simulating', g3.debris.length === debris0, `n=${g3.debris.length}`);
    ok('still no duplicate kits after frames', g3.kits.length === kits0);

    // ---------- hound hit flash + current pose carry over
    g3.spawnHound(1); frames(40);
    const h = g3.hounds.find((x) => x.alive);
    h.hurtT = 0.5;
    h.view.flash(0.08);
    frames(1);
    h.pose['head.rx'] = 0.42;
    h.pose['front_left_leg.rx'] = -0.7;
    const flash0 = h.view.flashT;
    ok('hound is in the hurt look before swap', h.view.state === 'hurt', h.view.state);
    g3.swapViews();
    ok('hound hit flash carries to the new view', h.view.flashT > 0 && Math.abs(h.view.flashT - flash0) < 1e-6, `flashT=${h.view.flashT}`);
    ok('hound hurt visual state carries', h.view.state === 'hurt', h.view.state);
    ok('hound hinge pose is applied immediately', Math.abs(h.view.part('head').rotation.x - 0.42) < 1e-6, `head.rx=${h.view.part('head')?.rotation.x}`);
    frames(20);

    // a hound destroyed in the same tick before the end-of-step filter must not gain an orphan replacement view
    g3.spawnHound(2); frames(40);
    const hh = g3.hounds[g3.hounds.length - 1];
    const rootsNamedHound = () => g3.scene.children.filter((o) => o.name === 'hound').length;
    hh.damage(999, { x: 1, z: 0 }, g3);
    const nBefore = rootsNamedHound();
    g3.swapViews();
    ok('kill then immediate swap creates no orphan hound view', rootsNamedHound() === nBefore, `${nBefore} -> ${rootsNamedHound()}`);
    frames(5);
    ok('dead hound filtered, hound roots stay consistent', rootsNamedHound() === g3.hounds.filter((x) => x.alive).length);

    // ---------- in-flight shells / bolts keep their identity and settle
    g3.fireShell({ x: 0, y: 1, z: 0 }, { x: 6, z: 4 }, __FOREMAN.attacks.volley);
    frames(2);
    const s0 = g3.shells[0];
    const sp0 = s0.pos.toArray().join(',');
    g3.swapViews();
    ok('shell survives swap with its Body state', g3.shells.length >= 1 && g3.shells.includes(s0) && s0.pos.toArray().join(',') === sp0);
    ok('shell new view is attached to the scene', !!s0.view.root.parent);
    frames(30);

    return { assertions: A, error: null };
  } catch (e) {
    return { assertions: A, error: e.stack || String(e) };
  }
};

const page = await openPage('?manual&greybox');
const core = await page.evaluate(CORE_FN);
record('greybox', core.assertions);
if (core.error) results.push({ suite: 'greybox', name: 'scenario threw', pass: false, detail: core.error.slice(0, 500) });
record('greybox page', page.__errors.map((e) => ['no console/page errors', false, e]));
if (!page.__errors.length) results.push({ suite: 'greybox page', name: 'no console/page errors', pass: true });
await page.close();

// Real async M/L path (the same functions the keys and buttons call), boss parts pre-broken.
const page2 = await openPage('?manual&greybox');
const asyncRes = await page2.evaluate(async () => {
  const A = [];
  let now = 0;
  const frames = (n) => { for (let i = 0; i < n; i++) { now += 1000 / 60; __frame(now); } };
  try {
    const g = __game;
    g.phase = 'boss'; g.foreman.wake(); frames(150);
    g.foreman.damagePart('left_cannon', 999, g); frames(3);
    g.foreman.damagePart('armour_plate', 999, g); frames(3);
    const avail0 = JSON.stringify(g.foreman.available());
    const kits0 = g.kits.length, debris0 = g.debris.length;
    await __toggleModels(); frames(10);
    A.push(['M toggle keeps attacks/broken parts/core', JSON.stringify(g.foreman.available()) === avail0 && !g.foreman.view.part('left_cannon') && g.foreman.isTarget('core')]);
    await __switchStyle(); frames(10);
    A.push(['L style switch keeps attacks/broken parts/core', JSON.stringify(g.foreman.available()) === avail0 && !g.foreman.view.part('armour_plate') && g.foreman.isTarget('core')]);
    for (let i = 0; i < 5; i++) { await __toggleModels(); frames(2); }
    A.push(['repeated async toggles add no kits/debris', g.kits.length === kits0 && g.debris.length === debris0, `kits ${kits0}->${g.kits.length}, debris ${debris0}->${g.debris.length}`]);
    frames(30);
  } catch (e) { A.push(['async path threw', false, e.stack || String(e)]); }
  return A;
});
record('M/L async path', asyncRes);
record('M/L async page', page2.__errors.map((e) => ['no console/page errors', false, e]));
if (!page2.__errors.length) results.push({ suite: 'M/L async page', name: 'no console/page errors', pass: true });
await page2.close();

// Model-appearance code paths: flag registry views isModel (same PlaceholderView the GLB models use).
const page3 = await openPage('?manual&greybox');
const modelRes = await page3.evaluate(async () => {
  const A = [];
  try {
    for (const id of ['foreman', 'hound']) __registry.registerView(id, () => { const v = __registry.createView(id); v.isModel = true; return v; });
    __restart();
    let now = 0;
    const frames = (n) => { for (let i = 0; i < n; i++) { now += 1000 / 60; __frame(now); } };
    frames(5);
    const g = __game;
    g.phase = 'boss'; g.foreman.wake(); frames(150);
    const f = g.foreman;
    f.damagePart('left_cannon', 999, g); frames(3);
    f.damagePart('armour_plate', 999, g); frames(3);
    const avail0 = JSON.stringify(f.available()), glow0 = JSON.stringify(f.view.glow);
    g.swapViews();
    A.push(['model-flagged new view', f.view.isModel === true]);
    A.push(['model views: attacks unchanged', JSON.stringify(f.available()) === avail0]);
    A.push(['model views: glow carried', JSON.stringify(f.view.glow) === glow0]);
    A.push(['model views: broken parts absent, core targetable', !f.view.part('left_cannon') && !f.view.part('armour_plate') && f.isTarget('core')]);
    frames(40);
    g.spawnHound(0); frames(40);
    const h = g.hounds[0];
    h.hurtT = 0.4; h.view.flash(0.08); frames(1);
    const fl = h.view.flashT;
    g.swapViews();
    A.push(['model hound: flash + hurt state carried', h.view.flashT > 0 && Math.abs(h.view.flashT - fl) < 1e-6 && h.view.state === 'hurt', `flash=${h.view.flashT} state=${h.view.state}`]);
  } catch (e) { A.push(['model suite threw', false, e.stack || String(e)]); }
  return A;
});
record('model appearance', modelRes);
record('model page', page3.__errors.map((e) => ['no console/page errors', false, e]));
if (!page3.__errors.length) results.push({ suite: 'model page', name: 'no console/page errors', pass: true });
await page3.close();

// ------------------------------------------------------------ report
let failures = 0;
let lastSuite = '';
for (const r of results) {
  if (r.suite !== lastSuite) { console.log(`\n[${r.suite}]`); lastSuite = r.suite; }
  console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : `  -- ${r.detail}`}`);
  if (!r.pass) failures++;
}
console.log(`\n${results.length - failures}/${results.length} checks passed`);
await browser.close();
stopStartedServer();
process.exit(failures ? 1 : 0);
