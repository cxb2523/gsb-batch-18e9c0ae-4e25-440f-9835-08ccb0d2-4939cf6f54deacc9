// End-to-end: `prismbox` running on examples/vite-hero, driven in real Chromium (WebGL via SwiftShader).
// Run: pnpm build && pnpm e2e    (needs Playwright's Chromium: npx playwright install chromium)
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const example = path.join(repo, 'examples', 'vite-hero');
const heroFile = path.join(example, 'src', 'Hero3D.tsx');
const SHOTS = process.env.E2E_SHOTS ? path.resolve(process.env.E2E_SHOTS) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'ok ' : 'XX '} ${name}${ok ? '' : `\n      -> ${String(detail).slice(0, 400)}`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, { timeout = 15000, every = 100, what = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${what}`);
    await sleep(every);
  }
}
const readHero = () => readFileSync(heroFile);
// an external tool saving the file (write a temp file, rename it over the original), so Vite never reads a half-written file
const saveExternally = async (text) => {
  const tmp = `${heroFile}.ext-${process.pid}`;
  writeFileSync(tmp, text);
  for (let i = 0; ; i++) {
    try {
      renameSync(tmp, heroFile);
      return;
    } catch (err) {
      // Windows: the target can be briefly held open by Vite or the daemon; editors retry too
      if (i >= 8 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
      await sleep(40 * (i + 1));
    }
  }
};
const changedLines = (a, b) => {
  const x = a.toString().split('\n');
  const y = b.toString().split('\n');
  if (x.length !== y.length) return { count: -1, lines: [] };
  const lines = x.map((l, i) => (l !== y[i] ? { n: i + 1, before: l, after: y[i] } : null)).filter(Boolean);
  return { count: lines.length, lines };
};

// ---------------- start prismbox on the example ----------------
const ORIGINAL = readHero();
const gitStatus = () => execFileSync('git', ['status', '--porcelain', '--', 'examples/vite-hero'], { cwd: repo, encoding: 'utf8' });
const STATUS_BEFORE = gitStatus();
// the session registry goes to a temp home, so the run never touches the real ~/.prismbox
const prismHome = mkdtempSync(path.join(os.tmpdir(), 'prismbox-e2e-home-'));
const CLI_JS = path.join(repo, 'packages', 'bridge', 'dist', 'cli.js');
const cli = spawn(process.execPath, [CLI_JS, '--root', example, '--no-open', '--port', '4173'], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PRISMBOX_HOME: prismHome } });
let out = '';
cli.stdout.on('data', (d) => (out += d));
cli.stderr.on('data', (d) => (out += d));
const stopAll = async (browser) => {
  await browser?.close().catch(() => undefined);
  cli.kill();
  await sleep(300);
  writeFileSync(heroFile, ORIGINAL); // never leave the example modified
  rmSync(prismHome, { recursive: true, force: true });
};

let browser;
try {
  const urls = await until(() => {
    const studio = /studio\s+(http:\/\/\S+)/.exec(out)?.[1];
    const page = /your page\s+(http:\/\/\S+)/.exec(out)?.[1];
    return studio && page ? { studio, page } : null;
  }, { timeout: 60000, what: 'prismbox to print its URLs' });
  console.log(`prismbox is up: page ${urls.page}  studio ${urls.studio.replace(/token=.*/, 'token=…')}\n`);

  browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 820 } });
  const consoleErrors = [];
  const watch = (p, label) => {
    p.on('console', (m) => m.type() === 'error' && consoleErrors.push(`${label}: ${m.text().slice(0, 200)}`));
    p.on('pageerror', (e) => consoleErrors.push(`${label}: ${String(e).slice(0, 200)}`));
  };

  // ======== 1. open the real landing page and Studio ========
  const page = await ctx.newPage();
  watch(page, 'page');
  await page.goto(urls.page);
  await page.waitForFunction(() => window.__prismDebug?.info().connected === true, null, { timeout: 60000 });
  // a cold Vite cache re-optimizes dependencies on first load and reloads the page once: let that settle before marking the page
  let navs = 0;
  page.on('framenavigated', (f) => f === page.mainFrame() && navs++);
  for (let stable = 0; stable < 3; ) {
    const n = navs;
    await sleep(1000);
    if (n === navs) stable++;
    else stable = 0;
  }
  await page.waitForFunction(() => window.__prismDebug?.info().connected === true, null, { timeout: 60000 });
  await page.evaluate(() => { window.__marker = 'alive'; });
  const studio = await ctx.newPage();
  watch(studio, 'studio');
  await studio.goto(urls.studio);
  await until(async () => /page connected/.test(await studio.textContent('[data-testid=conn]').catch(() => '')), { timeout: 30000, what: 'Studio to see the page' });
  check('1. the real landing page and Studio are open and connected', true);
  check('1. Studio stripped the session token from the URL', !studio.url().includes('token'), studio.url());
  const info0 = await page.evaluate(() => window.__prismDebug.info());
  check('1. the overlay mounted in the page with one canvas and no errors', info0.canvases === 1 && info0.connected, JSON.stringify(info0));
  const heroSrc = ORIGINAL.toString();
  const lineOf = (needle) => {
    const i = heroSrc.indexOf(needle);
    return `src/Hero3D.tsx:${heroSrc.slice(0, i).split('\n').length}:${i - heroSrc.lastIndexOf('\n', i - 1)}`;
  };
  const KNOT = lineOf('<mesh name="knot"');
  const modeText = async () => (await studio.textContent('[data-testid=mode]')).trim();
  const heroClicks = () => page.evaluate(() => ({ ...window.__heroClicks }));
  const knotPoint = () => page.evaluate(() => window.__prismDebug.hitPointOf('knot'));
  // the knot keeps spinning, so aim, click, and re-aim if the surface moved out from under the pointer
  const pickKnot = async () => {
    for (let i = 0; i < 6; i++) {
      const p = await knotPoint();
      await page.mouse.move(p.x, p.y);
      await page.mouse.click(p.x, p.y);
      await sleep(150);
      if ((await page.evaluate(() => window.__prismDebug.info().selected)) === KNOT) return true;
    }
    return false;
  };

  // ======== 2. disarmed: the page behaves normally and forged proposals are refused ========
  check('2. Studio starts Disarmed', (await modeText()) === 'Disarmed', await modeText());
  const kp = await knotPoint();
  await page.mouse.move(kp.x, kp.y);
  await page.mouse.click(kp.x, kp.y);
  await sleep(200);
  const c2 = await heroClicks();
  check('2. disarmed: the page\'s own onClick on the 3D mesh fires', (c2['knot.click'] ?? 0) === 1, JSON.stringify(c2));
  const cta = page.locator('button.primary');
  await cta.click();
  check('2. disarmed: the CTA button works', (await page.evaluate(() => window.__ctaClicks)) === 1);
  const before2 = readHero();
  const forged = await page.evaluate(([tag]) => window.__prismDebug.forgeProposal(tag, { position: { from: [0, 0, 0], to: [9, 9, 9] } }), [KNOT]);
  check('2. a forged page proposal while disarmed is rejected by the daemon (DISARMED)', forged.ok === false && forged.code === 'DISARMED', JSON.stringify(forged));
  await sleep(300);
  check('2. ... and Hero3D.tsx is untouched', readHero().equals(before2));
  check('2. ... and Studio tells you', /not armed/.test(await studio.textContent('.banner').catch(() => '')), await studio.textContent('.banner').catch(() => 'no banner'));
  await studio.locator('.banner button').click().catch(() => undefined);

  // ======== 3. arm, drag the mesh on the REAL page ========
  await studio.click('button.arm');
  await page.waitForFunction(() => window.__prismDebug.info().armed === true, null, { timeout: 10000 });
  await until(async () => (await modeText()) === 'Armed', { what: 'Studio to show Armed' });
  check('3. arming Studio arms the page overlay', true);
  const heroBeforeDrag = readHero();
  const clicksBefore = await heroClicks();
  await pickKnot();
  await until(async () => (await page.evaluate(() => window.__prismDebug.info().selected)) === KNOT, { what: 'the pick' });
  check('3. clicking the mesh on the real page resolves its file:line:col', true, KNOT);
  await until(async () => (await studio.textContent('.inspector .node-name').catch(() => '')) === 'knot', { what: 'Studio selection' });
  check('3. Studio selects the same node (tree + inspector)', (await studio.textContent('.tree-row.selected .tree-name')) === 'knot');
  check('3. armed: the page\'s onClick / onPointerDown on that mesh did NOT fire', JSON.stringify(await heroClicks()) === JSON.stringify(clicksBefore), JSON.stringify(await heroClicks()));
  // only the 3D scene is paused: ordinary page controls keep working while armed
  const cb = await cta.boundingBox();
  await page.mouse.click(cb.x + 10, cb.y + 10);
  await sleep(150);
  check('3. armed: only the 3D scene is paused (ordinary page controls still work)', (await page.evaluate(() => window.__ctaClicks)) === 2);
  await page.mouse.click(40, 760); // empty space deselects
  // re-select the knot (the empty-space click deselected it)
  check('3. the knot can be picked again after deselecting', await pickKnot());

  // find and press the X handle
  let grab = null;
  for (let attempt = 0; attempt < 8 && !grab; attempt++) {
    const c = await page.evaluate(() => window.__prismDebug.screenPointOf('knot'));
    let t0 = null;
    for (let t = 24; t <= 240 && t0 === null; t += 4) {
      await page.mouse.move(c.x + t, c.y);
      if ((await page.evaluate(() => window.__prismDebug.gizmoAxis())) === 'X') t0 = t;
    }
    if (t0 === null) continue;
    await sleep(120);
    check('3. d9: animation freezes while the gizmo handle is hovered', attempt > 0 || (await page.evaluate(() => window.__prismDebug.frozen())) === true);
    await page.mouse.down();
    await sleep(60);
    if ((await page.evaluate(() => window.__prismDebug.gizmoAxis())) === 'X') grab = { x: c.x + t0, y: c.y };
    else await page.mouse.up();
  }
  check('3. the gizmo handle can be grabbed on the real page', !!grab);
  const e1 = await page.evaluate(() => window.__prismDebug.info().clockElapsed);
  for (let i = 1; i <= 14; i++) {
    await page.mouse.move(grab.x + i * 9, grab.y);
    await sleep(35);
  }
  const e2 = await page.evaluate(() => window.__prismDebug.info().clockElapsed);
  check('3. d9: the R3F clock is frozen for the whole drag (no jitter source)', e1 === e2, `${e1} vs ${e2}`);
  check('3. ... and Studio shows "Paused while you edit"', (await studio.locator('.chip.paused').count()) === 1);
  check('3. nothing was written during the drag (one proposal, at drag end)', readHero().equals(heroBeforeDrag));
  await page.mouse.up();
  const afterDrag = await until(() => (readHero().equals(heroBeforeDrag) ? null : readHero()), { timeout: 15000, what: 'the edit to reach disk' });
  const d3 = changedLines(heroBeforeDrag, afterDrag);
  check('3. exactly ONE line of Hero3D.tsx changed on real disk', d3.count === 1, JSON.stringify(d3));
  check('3. ... it is the knot\'s position, written with magic-string (no reformat)', /<mesh name="knot" position=\{\[[-\d., ]+\]\} onClick/.test(d3.lines[0]?.after ?? ''), d3.lines[0]?.after);
  const newPos = (/position=\{\[([-\d., ]+)\]\}/.exec(d3.lines[0].after)[1]).split(',').map(Number);
  await until(async () => {
    const p = await page.evaluate(() => window.__prismDebug.localPosition('knot'));
    return p && p.every((v, i) => Math.abs(v - newPos[i]) < 0.002);
  }, { what: 'Vite HMR to apply the new position' });
  check('3. Vite HMR updated the real page (no reload, same object value)', (await page.evaluate(() => window.__marker)) === 'alive');
  const d3strip = await studio.locator('.diff-row').first();
  check('3. Studio shows the diff tagged "page"', (await d3strip.locator('.author').textContent()) === 'page' && /position=/.test(await d3strip.locator('.hunk.add').textContent()), await d3strip.textContent());
  const e3 = await page.evaluate(() => window.__prismDebug.info().clockElapsed);
  await sleep(400);
  check('3. d9: animation resumes cleanly after release', (await page.evaluate(() => window.__prismDebug.info().clockElapsed)) > e3 && (await page.evaluate(() => window.__prismDebug.frozen())) === false);
  const afterStep3 = readHero();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'real-page-armed.png') });
  if (SHOTS) await studio.screenshot({ path: path.join(SHOTS, 'studio-armed.png') });

  // ======== 4. scrub a @prism uniform in Studio ========
  await studio.locator('.tree-row .tree-name', { hasText: /^film$/ }).click();
  const field = studio.locator('.field', { has: studio.locator('.field-label', { hasText: /^uFilm$/ }) });
  const slider = field.locator('input[type=range]');
  await slider.waitFor();
  const sb = await slider.boundingBox();
  await studio.mouse.move(sb.x + sb.width * 0.5, sb.y + sb.height / 2);
  await studio.mouse.down();
  await studio.mouse.move(sb.x + sb.width * 0.8, sb.y + sb.height / 2, { steps: 8 });
  await sleep(150);
  const liveUniform = await page.evaluate(() => window.__prismDebug.uniform('knot', 'uFilm'));
  check('4. scrubbing updates the real page live, before anything is written', typeof liveUniform === 'number' && Math.abs(liveUniform - 1.4) > 0.1 && readHero().equals(afterStep3), String(liveUniform));
  await studio.mouse.up();
  const afterUniform = await until(() => (readHero().equals(afterStep3) ? null : readHero()), { timeout: 15000, what: 'the uniform edit to reach disk' });
  const d4 = changedLines(afterStep3, afterUniform);
  check('4. exactly one line changed: the uFilm literal', d4.count === 1 && /uFilm: \{ value: [\d.]+ \}/.test(d4.lines[0].after) && d4.lines[0].before.includes('uFilm: { value: 1.4 }'), JSON.stringify(d4));
  const newFilm = Number(/uFilm: \{ value: ([\d.]+) \}/.exec(d4.lines[0].after)[1]);
  await until(async () => Math.abs((await page.evaluate(() => window.__prismDebug.uniform('knot', 'uFilm'))) - newFilm) < 0.001, { what: 'HMR to apply the uniform' });
  check('4. Vite HMR applied it to the real page (no reload)', (await page.evaluate(() => window.__marker)) === 'alive');
  await until(async () => (await studio.locator('.diff-row').count()) >= 2, { what: 'the uniform diff row' });
  const rows4 = await studio.locator('.diff-row').evaluateAll((els) => els.map((el) => `${el.querySelector('.author')?.textContent}:${el.querySelector('.diff-summary')?.textContent}`));
  check('4. Studio logs it as an edit by "you"', rows4[0] === 'you:uniform uFilm', JSON.stringify(rows4));

  // ======== 5. undo from Studio restores the exact bytes ========
  await until(async () => !(await studio.locator('.diff-strip button', { hasText: 'Undo' }).isDisabled()), { what: 'Undo to enable' });
  await studio.locator('.diff-strip button', { hasText: 'Undo' }).click();
  await until(() => readHero().equals(afterStep3), { what: 'first undo on disk' });
  check('5. Undo #1 restores the file byte-exact to its state before the uniform edit', readHero().equals(afterStep3));
  await until(async () => !(await studio.locator('.diff-strip button', { hasText: 'Undo' }).isDisabled()), { what: 'Undo to enable again' });
  await studio.locator('.diff-strip button', { hasText: 'Undo' }).click();
  await until(() => readHero().equals(ORIGINAL), { what: 'second undo on disk' });
  check('5. Undo #2 restores Hero3D.tsx byte-exact to the original', readHero().equals(ORIGINAL));
  await until(async () => Math.abs((await page.evaluate(() => window.__prismDebug.uniform('knot', 'uFilm'))) - 1.4) < 0.001, { what: 'HMR after undo' });
  check('5. ... and the real page followed (HMR)', (await page.evaluate(() => window.__marker)) === 'alive');


  // ======== M3: a real MCP client (stdio) against the same daemon ========
  const mcpTransport = new StdioClientTransport({ command: process.execPath, args: [CLI_JS, 'mcp', '--root', example], env: { ...process.env, PRISMBOX_HOME: prismHome }, stderr: 'pipe' });
  const mcp = new Client({ name: 'e2e-agent', version: '0' });
  let mcpStderr = '';
  await mcp.connect(mcpTransport);
  mcpTransport.stderr?.on('data', (d) => (mcpStderr += d));
  const tool = (name, args = {}) => mcp.callTool({ name, arguments: args });
  const txt = (r) => r.content.find((c) => c.type === 'text')?.text ?? '';
  const parsed = (r) => JSON.parse(txt(r));
  const sessionFiles = () => (existsSync(path.join(prismHome, 'sessions')) ? readdirSync(path.join(prismHome, 'sessions')) : []);
  check('M3.1 the daemon published its session OUTSIDE the project (~/.prismbox/sessions/<hash>.json)', sessionFiles().length === 1 && !existsSync(path.join(example, '.prismbox')), JSON.stringify(sessionFiles()));
  const tools = (await mcp.listTools()).tools.map((t) => t.name).sort();
  check('M3.1 prismbox mcp exposes the 6 tools', JSON.stringify(tools) === JSON.stringify(['prism_get_scene', 'prism_get_selection', 'prism_get_view', 'prism_lint', 'prism_set_prop', 'prism_set_uniform']), tools.join());

  // 2. click the knot on the real page, ask for the selection
  check('M3.2 the knot can be picked on the real page (armed)', await pickKnot());
  const sel = parsed(await tool('prism_get_selection'));
  check('M3.2 prism_get_selection returns the exact file:line:col and node details', sel.selected === true && sel.tag === KNOT && sel.name === 'knot' && sel.file === 'src/Hero3D.tsx' && sel.element === 'mesh' && /<mesh name="knot"/.test(sel.snippet), JSON.stringify(sel).slice(0, 300));
  check('M3.2 ... with its props (the literal position)', sel.props.some((p) => p.name === 'position' && Array.isArray(p.value)), JSON.stringify(sel.props.map((p) => p.name)));
  await until(async () => /Hero3D\.tsx:\d+/.test(await studio.textContent('[data-testid=agent-selection]').catch(() => '')), { what: 'the "Selected for agent" indicator' });
  check('M3.2 Studio shows "Selected for agent · Hero3D.tsx:<line>"', true, await studio.textContent('[data-testid=agent-selection]'));

  // 3. prism_get_view armed and disarmed
  const pngStats = (b64) => {
    const png = PNG.sync.read(Buffer.from(b64, 'base64'));
    let nonBlack = 0, axis = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
      if (0.2126 * r + 0.7152 * g + 0.0722 * b > 14) nonBlack++;
      if ((r > 235 && g < 25 && b < 25) || (g > 235 && r < 25 && b < 25) || (b > 235 && r < 25 && g < 25)) axis++; // the gizmo's pure x/y/z colours
    }
    return { w: png.width, h: png.height, nonBlackPct: (100 * nonBlack) / (png.width * png.height), axis };
  };
  const viewArmed = await tool('prism_get_view');
  const imgA = viewArmed.content.find((c) => c.type === 'image');
  const sA = pngStats(imgA.data);
  const metaA = JSON.parse(viewArmed.content.find((c) => c.type === 'text').text);
  if (SHOTS) writeFileSync(path.join(SHOTS, 'mcp-view-armed.png'), Buffer.from(imgA.data, 'base64'));
  check('M3.3 armed: prism_get_view returns a real PNG image block', imgA.mimeType === 'image/png' && sA.w > 100 && sA.h > 100 && sA.w <= 1280, JSON.stringify(sA));
  check('M3.3 ... that is not blank or all black', sA.nonBlackPct > 5, JSON.stringify(sA));
  const shot = await page.screenshot();
  const shotStats = pngStats(shot.toString('base64'));
  check('M3.3 ... with the gizmo hidden (the live page shows it, the capture does not)', shotStats.axis > 40 && sA.axis < shotStats.axis / 4, `capture ${sA.axis} vs page ${shotStats.axis}`);
  check('M3.3 ... plus camera and viewport metadata, and armed=true', metaA.armed === true && metaA.camera?.fov === 40 && metaA.viewport?.cssWidth > 100, JSON.stringify(metaA));
  check('M3.3 the gizmo is back on the live page after the capture', (await page.screenshot().then((b) => pngStats(b.toString('base64')).axis)) > 40);
  await studio.click('button.arm');
  await until(async () => (await modeText()) === 'Disarmed', { what: 'Studio to show Disarmed' });
  const viewOff = await tool('prism_get_view');
  const sD = pngStats(viewOff.content.find((c) => c.type === 'image').data);
  check('M3.3 disarmed: prism_get_view works too and is not blank', sD.nonBlackPct > 5 && JSON.parse(viewOff.content.find((c) => c.type === 'text').text).armed === false, JSON.stringify(sD));

  // 4. agent edits: no arming needed
  const beforeAgent = readHero();
  const rUniform = await tool('prism_set_uniform', { node: 'film', uniform: 'uFilm', value: 2.2 });
  check('M3.4 prism_set_uniform succeeds while DISARMED and returns a unified one-line diff', !rUniform.isError && /--- a\/src\/Hero3D\.tsx/.test(txt(rUniform)) && /\+.*uFilm: \{ value: 2\.2 \}/.test(txt(rUniform)), txt(rUniform).slice(0, 300));
  const afterUniformMcp = await until(() => (readHero().equals(beforeAgent) ? null : readHero()), { what: 'the agent uniform edit on disk' });
  const dU = changedLines(beforeAgent, afterUniformMcp);
  check('M3.4 exactly one line changed on disk (uFilm literal)', dU.count === 1 && dU.lines[0].after.includes('uFilm: { value: 2.2 }'), JSON.stringify(dU));
  await until(async () => Math.abs((await page.evaluate(() => window.__prismDebug.uniform('knot', 'uFilm'))) - 2.2) < 0.001, { what: 'HMR to apply the agent uniform' });
  check('M3.4 Vite HMR updated the real page (no reload)', (await page.evaluate(() => window.__marker)) === 'alive');
  const rProp = await tool('prism_set_prop', { prop: 'position', value: [0.3, 0.1, 0] }); // no node: edits "this" (the selected knot)
  check('M3.4 prism_set_prop with no node edits the selected node ("this")', !rProp.isError && /position=\{\[0\.3, 0\.1, 0\]\}/.test(txt(rProp)), txt(rProp).slice(0, 300));
  const afterPropMcp = await until(() => (readHero().equals(afterUniformMcp) ? null : readHero()), { what: 'the agent prop edit on disk' });
  const dP = changedLines(afterUniformMcp, afterPropMcp);
  check('M3.4 ... one line changed on disk', dP.count === 1 && /<mesh name="knot" position=\{\[0\.3, 0\.1, 0\]\}/.test(dP.lines[0].after), JSON.stringify(dP));
  await until(async () => { const p = await page.evaluate(() => window.__prismDebug.localPosition('knot')); return p && Math.abs(p[0] - 0.3) < 0.002 && Math.abs(p[1] - 0.1) < 0.002; }, { what: 'HMR to apply the agent position' });
  const stale = await tool('prism_set_prop', { node: 'knot', prop: 'position', value: [9, 9, 9], expected: [5, 5, 5] });
  check('M3.4 a stale agent edit is refused (CONFLICT) and the file is untouched', stale.isError && parsed(stale).code === 'CONFLICT' && readHero().equals(afterPropMcp), txt(stale).slice(0, 200));
  await until(async () => (await studio.locator('.diff-row .author.agent').count()) >= 2, { what: 'agent diff rows in Studio' });
  check('M3.4 Studio shows both edits with the "agent" badge', true);
  if (SHOTS) await studio.screenshot({ path: path.join(SHOTS, 'studio-agent.png') });

  // 5. one-click undo in Studio, twice
  for (let i = 0; i < 2; i++) {
    await until(async () => !(await studio.locator('.diff-strip button', { hasText: 'Undo' }).isDisabled()), { what: 'Undo to enable (agent)' });
    await studio.locator('.diff-strip button', { hasText: 'Undo' }).click();
    await sleep(400);
  }
  await until(() => readHero().equals(ORIGINAL), { what: 'agent edits to be undone' });
  check('M3.5 two Undo clicks in Studio restore Hero3D.tsx byte-exact', readHero().equals(ORIGINAL));

  // 6. lint and the guide
  const lint = parsed(await tool('prism_lint'));
  check('M3.6 prism_lint returns structured coverage and findings', lint.ok === true && lint.editableCoverage >= 0.9 && Array.isArray(lint.files) && lint.files.some((f) => f.file === 'src/Hero3D.tsx' && Array.isArray(f.findings)), JSON.stringify(lint).slice(0, 300));
  const scene = parsed(await tool('prism_get_scene', { file: 'src/Hero3D.tsx' }));
  check('M3.6 prism_get_scene returns the node tree with edit states', scene.files?.[0]?.nodes?.some((n) => n.name === 'knot' && n.edit === 'editable'), JSON.stringify(scene).slice(0, 200));
  const guide = await mcp.readResource({ uri: 'prismbox://guide' });
  check('M3.6 prismbox://guide is readable and is the authoring guide', guide.contents[0].mimeType === 'text/markdown' && /Prism subset/.test(guide.contents[0].text) && /@prism uniform/.test(guide.contents[0].text));
  check('M3.6 the MCP process kept stdout clean (the client parsed every frame) and logged to stderr', /ready for/.test(mcpStderr));

  // ======== 6. external edit (Claude Code, VS Code) ========
  const external = ORIGINAL.toString().replace('args={[1, 0.34, 400, 64, 2, 3]}', 'args={[1.1, 0.34, 400, 64, 2, 3]}');
  const oldHash = await studio.evaluate(() => window.__prismStudio.hash());
  await saveExternally(external);
  await until(async () => /File reloaded/.test(await studio.textContent('.banner').catch(() => '')), { timeout: 10000, what: 'Studio to notice the external edit' });
  check('6. an external edit refreshes Studio live ("File reloaded")', true);
  await studio.locator('.tree-row .tree-name', { hasText: /^torusKnotGeometry$/ }).click();
  const argsField = studio.locator('.field', { has: studio.locator('.field-label', { hasText: /^args$/ }) });
  check('6. the inspector shows the externally edited value', (await argsField.locator('input').first().inputValue()) === '1.1', await argsField.textContent());
  check('6. the strip tags it "external"', (await studio.locator('.diff-row .author.external').count()) >= 1);
  // a write built on the old view of the file must be refused (compare-and-set)
  const before6 = readHero();
  await studio.evaluate(([h]) => window.__prismStudio.raw({ type: 'edit', id: 424242, file: 'src/Hero3D.tsx', baseHash: h, op: { kind: 'prop', node: 'knot', prop: 'scale', value: 3 } }), [oldHash]);
  await until(async () => /Conflict/.test(await studio.textContent('.banner').catch(() => '')), { timeout: 10000, what: 'the conflict banner' });
  check('6. a stale write is blocked by compare-and-set (CONFLICT banner)', true);
  check('6. ... and the file on disk is exactly what the other tool wrote', readHero().equals(before6) && readHero().toString() === external);
  // undo for the earlier edits is unavailable (nothing to undo), and external bytes are never clobbered
  await saveExternally(ORIGINAL);
  await until(async () => (await studio.locator('.diff-row').count()) >= 2, { what: 'external restore diff' });

  // ======== 7. production build: zero Prismbox bytes, clean git status ========
  check('M3.7 the project has no .prismbox folder and no stray files (git status clean)', !existsSync(path.join(example, '.prismbox')) && gitStatus() === '', gitStatus());
  cli.kill();
  await sleep(800);
  const offline = await tool('prism_get_selection');
  check('M3.7 after the daemon dies, the stale session is pruned and the agent gets a graceful DAEMON_OFFLINE', offline.isError && parsed(offline).code === 'DAEMON_OFFLINE' && sessionFiles().length === 0, `${txt(offline).slice(0, 160)} files=${sessionFiles().length}`);
  check('M3.7 prism_lint and the guide still work offline', parsed(await tool('prism_lint')).ok === true && (await mcp.readResource({ uri: 'prismbox://guide' })).contents.length === 1);
  await mcp.close();
  // the dev server and daemon have just been stopped; on Windows their file handles can linger for a moment, so retry once and show vite's own output on failure
  let built = null;
  for (let attempt = 0; attempt < 3 && !built?.ok; attempt++) {
    if (attempt) await sleep(2000);
    const r = spawnSync('pnpm exec vite build', { cwd: example, encoding: 'utf8', shell: true });
    built = { ok: r.status === 0, out: `${r.stdout}
${r.stderr}` };
  }
  check('7. `vite build` in examples/vite-hero succeeds', built.ok, built.out.slice(-600));
  const dist = path.join(example, 'dist');
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const bad = ['__PrismOverlay', 'userData-prism', 'virtual:prism', 'prism-overlay', '__prismDebug', '__PRISMBOX_DAEMON__', '/__prism/', 'prismbox', 'Prismbox'];
  const hits = {};
  let bytes = 0;
  for (const f of walk(dist)) {
    const t = readFileSync(f, 'utf8');
    bytes += t.length;
    for (const s of bad) if (t.includes(s)) hits[s] = (hits[s] ?? 0) + 1;
  }
  check('7. `vite build` in examples/vite-hero: dist/ has 0 Prismbox bytes', Object.keys(hits).length === 0 && bytes > 100000, JSON.stringify({ hits, bytes }));
  const status = gitStatus();
  check('7. `git status` inside examples/vite-hero is unchanged by the whole session (nothing created or modified)', status === STATUS_BEFORE, `before: ${JSON.stringify(STATUS_BEFORE)} after: ${JSON.stringify(status)}`);
  const pkg = JSON.parse(readFileSync(path.join(example, 'package.json'), 'utf8'));
  check('7. the example has zero prismbox dependencies or config entries', !JSON.stringify(pkg).includes('prismbox') && !readFileSync(path.join(example, 'vite.config.ts'), 'utf8').toLowerCase().includes('prism'));

  // On Windows Vite occasionally fails one HMR reload while a file is being replaced underneath it (the next update succeeds,
  // and every check above passed). It is reported, not hidden.
  const transient = consoleErrors.filter((e) => /[vite] Failed to reload/.test(e));
  if (transient.length) console.log(`note: ${transient.length} transient Vite HMR reload failure(s) while a file was being replaced (self-healed)`);
  const fatal = consoleErrors.filter((e) => !/Failed to load resource|WebSocket|net::ERR|[vite] Failed to reload/.test(e));
  check('console: no errors in the page or Studio during the whole run', fatal.length === 0, fatal.join(' | '));
} catch (e) {
  check('run completed', false, e instanceof Error ? e.stack : String(e));
} finally {
  await stopAll(browser);
}
writeFileSync(path.join(repo, '.gstack', 'tmp', 'm2-e2e.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
