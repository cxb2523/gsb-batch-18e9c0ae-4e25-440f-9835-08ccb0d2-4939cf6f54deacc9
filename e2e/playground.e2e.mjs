// The static Playground, as a public visitor sees it: the production build served by a tiny static host that applies
// apps/studio/public/_headers (so the header file itself is under test), all seven templates, zero console errors, and no
// local-mode clutter. Run: pnpm build && pnpm e2e
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = path.join(repo, 'apps', 'studio', 'dist');
const SHOTS = process.env.E2E_SHOTS ? path.resolve(process.env.E2E_SHOTS) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
if (!existsSync(path.join(dist, 'index.html'))) {
  console.error('apps/studio/dist is missing: run pnpm build first');
  process.exit(2);
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'ok ' : 'XX '} ${name}${ok ? '' : `\n      -> ${String(detail).slice(0, 400)}`}`);
};

// ---- a minimal Cloudflare-Pages-style host: serve dist/, apply _headers rules, SPA fallback for extensionless paths ----
function parseHeaders(text) {
  const rules = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      cur = { pattern: raw.trim(), headers: {} };
      rules.push(cur);
    } else if (cur) {
      const i = raw.indexOf(':');
      cur.headers[raw.slice(0, i).trim()] = raw.slice(i + 1).trim();
    }
  }
  return rules;
}
const rules = parseHeaders(readFileSync(path.join(dist, '_headers'), 'utf8'));
const matches = (pattern, p) => (pattern.endsWith('/*') ? p.startsWith(pattern.slice(0, -1)) || (pattern === '/*' && true) : pattern === p);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.map': 'application/json' };

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(dist, p === '/' ? 'index.html' : p);
  const headers = {};
  for (const r of rules) if (matches(r.pattern, p)) Object.assign(headers, r.headers);
  let status = 200;
  if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) {
    if (path.extname(p)) {
      res.writeHead(404, headers);
      return res.end('not found');
    }
    file = path.join(dist, 'index.html'); // SPA fallback
  }
  if (p === '/_headers') {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(status, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', ...headers });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(4182, '127.0.0.1', r));
const base = 'http://127.0.0.1:4182';

const ids = ['liquid-glass-orb', 'glass-card', 'glowing-globe', 'gradient-mesh', 'iridescent-knot', 'aurora-ribbon', 'liquid-chrome-blob'];
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  // ---- headers as served ----
  const idx = await fetch(`${base}/`);
  const csp = idx.headers.get('content-security-policy') ?? '';
  check('the host applies _headers: Studio CSP (frame-ancestors none, no inline script)', /frame-ancestors 'none'/.test(csp) && /script-src 'self'/.test(csp) && !/script-src[^;]*unsafe/.test(csp), csp);
  check('... and nosniff, referrer and permissions policy', idx.headers.get('x-content-type-options') === 'nosniff' && !!idx.headers.get('referrer-policy') && !!idx.headers.get('permissions-policy'));
  const html = await idx.text();
  const asset = /\/assets\/[^"]+\.js/.exec(html)?.[0] ?? '';
  const a = await fetch(`${base}${asset}`, { headers: { Origin: 'null' } });
  check('assets carry Access-Control-Allow-Origin: * and immutable caching (the sandbox iframe has an opaque origin)', a.headers.get('access-control-allow-origin') === '*' && /immutable/.test(a.headers.get('cache-control') ?? ''), JSON.stringify([...a.headers]));
  const sb = await fetch(`${base}/sandbox.html`);
  check('sandbox.html is framable by Studio only and not covered by the Studio CSP', /frame-ancestors 'self'/.test(sb.headers.get('content-security-policy') ?? '') && !/default-src 'self'; script-src/.test(sb.headers.get('content-security-policy') ?? ''));
  check('the host config file itself is not served', (await fetch(`${base}/_headers`)).status === 404);
  check('deep links fall back to the SPA, missing assets 404', (await fetch(`${base}/some/deep/link`)).status === 200 && (await fetch(`${base}/assets/nope.js`)).status === 404);

  // ---- every template, as a visitor ----
  for (const id of ids) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await ctx.newPage();
    const bad = [];
    page.on('console', (m) => (m.type() === 'error' || (m.type() === 'warning' && /Content Security Policy|blocked|CORS/i.test(m.text()))) && bad.push(`${m.type()}: ${m.text().slice(0, 200)}`));
    page.on('pageerror', (e) => bad.push(`pageerror: ${String(e).slice(0, 200)}`));
    page.on('requestfailed', (r) => bad.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
    page.on('response', (r) => r.status() >= 400 && bad.push(`http ${r.status()}: ${r.url()}`));
    await page.goto(`${base}/?template=${id}`);
    await page.waitForFunction(() => !document.querySelector('.overlay.loading'), null, { timeout: 90000 });
    await page.waitForTimeout(1500);
    const errored = await page.$('.overlay.error');
    const shot = await page.locator('.viewport').screenshot();
    // non-blank: some pixels differ from the first one
    const { PNG } = await import('pngjs');
    const png = PNG.sync.read(shot);
    let lit = 0;
    for (let i = 0; i < png.data.length; i += 16) if (0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2] > 14) lit++;
    const litPct = (100 * lit) / (png.data.length / 16);
    const text = (await page.textContent('body')) ?? '';
    check(`${id}: loads under the production build + headers, renders, zero console errors / failed requests`, !errored && litPct > 5 && bad.length === 0, JSON.stringify({ errored: !!errored, litPct, bad }));
    check(`${id}: no daemon or local-mode UI on the static Playground`, !/daemon|disconnected|waiting for your page|Arm\b/i.test(text) && (await page.locator('.banner, .conn, button.arm').count()) === 0, text.slice(0, 200));
    if (id === 'iridescent-knot') {
      // header links and the Run locally popover
      const gh = await page.locator('a.gh').getAttribute('href');
      check('header has a GitHub link', gh === 'https://github.com/Guten-Morgen1302/prismbox', gh);
      await page.click('.runlocal > button');
      check('"Run locally" opens a popover with the command', (await page.locator('.pop code').textContent()) === 'npx prismbox');
      await page.click('.pop .cmd button');
      check('... and the copy button copies `npx prismbox`', (await page.evaluate(() => navigator.clipboard.readText())) === 'npx prismbox' && /Copied/.test(await page.locator('.pop .cmd button').textContent()));
      await page.keyboard.press('Escape');
      check('... Escape closes it', (await page.locator('.pop').count()) === 0);
      // an edit works and Copy .tsx exports plain R3F
      await page.locator('.tree-row .tree-name', { hasText: /^knot$/ }).click();
      const x = page.locator('.inspector .vec3').first().locator('input').first();
      await x.fill('0.5');
      await x.press('Enter');
      await page.waitForSelector('.diff-row');
      await page.click('text=Copy .tsx');
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      check('edit + Copy .tsx: plain R3F, no Prismbox trace', /position=\{\[0\.5/.test(copied) && !/userData-prism|__PrismOverlay|virtual:prism|prismbox/i.test(copied));
      await page.waitForFunction(() => !document.querySelector('.overlay.loading'), null, { timeout: 60000 });
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'playground-static.png') });
      check('no console errors after editing either', bad.length === 0, bad.join(' | '));
    }
    await ctx.close();
  }
} catch (e) {
  check('run completed', false, e instanceof Error ? e.stack : String(e));
} finally {
  await browser.close();
  server.close();
}
writeFileSync(path.join(repo, '.gstack', 'tmp', 'playground-e2e.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
