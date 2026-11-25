// Puppeteer helpers: every launch is fully isolated (own temp profile, pipe
// transport), so several tools / agents can run Chrome at the same time.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// On Windows the agent shell can put a non-executable `taskkill.exe` shim ahead
// of System32. Puppeteer only ever kills the specific browser PID it launched
// (`taskkill /PID <pid> /T /F`), which is exactly the permitted, PID-scoped
// cleanup — make sure that resolves to the real system binary.
if (process.platform === 'win32') {
  const sys32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  if (fs.existsSync(path.join(sys32, 'taskkill.exe')) && !process.env.PATH.split(path.delimiter).includes(sys32)) {
    process.env.PATH = `${sys32}${path.delimiter}${process.env.PATH}`;
  }
}

const exeName = (base) => (process.platform === 'win32' ? `${base}.exe` : base);

/** Find a puppeteer-cache browser (chrome-headless-shell preferred) if one is installed. */
function cachedBrowser() {
  const root = process.env.PUPPETEER_CACHE_DIR || path.join(os.homedir(), '.cache', 'puppeteer');
  const plat = process.platform === 'win32' ? 'win64' : process.platform === 'darwin' ? 'mac' : 'linux64';
  const kinds = ['chrome-headless-shell', 'chrome'];
  for (const kind of kinds) {
    const dir = path.join(root, kind);
    let revs = [];
    try { revs = fs.readdirSync(dir).filter((r) => r.startsWith(`${plat}-`)).sort(); } catch { continue; }
    for (const rev of revs.reverse()) {
      const leaf = kind === 'chrome-headless-shell' ? `chrome-headless-shell-${plat}` : `chrome-${plat}`;
      const exe = path.join(dir, rev, leaf, exeName(kind === 'chrome-headless-shell' ? 'chrome-headless-shell' : 'chrome'));
      if (fs.existsSync(exe)) return exe;
      // some layouts use the bare version directory name
      const alt = path.join(dir, rev, exeName(kind));
      if (fs.existsSync(alt)) return alt;
    }
  }
  return null;
}

function resolveChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  if (process.platform === 'darwin') return MAC_CHROME;   // unchanged reference setup
  const cached = cachedBrowser();
  if (cached) return cached;
  const home = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const candidates = process.platform === 'win32'
    ? [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(home, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ]
    : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return candidates.find((p) => fs.existsSync(p)) || MAC_CHROME;
}

export const CHROME = resolveChrome();

export async function launch({ width = 1920, height = 1080 } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pelican-chrome-'));
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    pipe: true,
    userDataDir: profile,
    defaultViewport: { width, height, deviceScaleFactor: 1 },
    timeout: 120000,
    protocolTimeout: 600000,
    args: [
      ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []),
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--autoplay-policy=no-user-gesture-required',
      `--window-size=${width},${height}`,
    ],
  });
  const close = async () => {
    try { await browser.close(); } catch {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  };
  return { browser, close };
}

// Open a page, forward console errors, and wait for window.__ready.
export async function openPage(browser, url, { timeout = 300000, verbose = false } = {}) {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => {
    const type = m.type();
    if (type === 'error' || verbose) {
      const text = m.text();
      if (type === 'error') errors.push(text);
      console.log(`[page ${type}] ${text}`);
    }
  });
  page.on('pageerror', (e) => {
    errors.push(String(e));
    console.log('[pageerror]', e.message);
  });
  await page.goto(url, { waitUntil: 'load', timeout });
  await page.waitForFunction('window.__ready === true || !!window.__fatal', { timeout, polling: 100 });
  const fatal = await page.evaluate(() => window.__fatal || null);
  if (fatal) throw new Error('page failed to initialise: ' + fatal);
  return { page, errors };
}
