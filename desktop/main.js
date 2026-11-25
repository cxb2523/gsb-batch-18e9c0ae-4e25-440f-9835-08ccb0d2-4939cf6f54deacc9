'use strict';
// Toontown: Anywhere for Windows and Linux: nothing but the website's own WASM build in a full-screen-capable window. It opens the same page the
// phone apps and the Home Screen app open, and the page downloads and caches the game files itself. Nothing about the game lives here, so a fix to
// the website is a fix to this app. The only things this program does on its own are the window, opening links in the browser, and keeping
// itself up to date (updater.js).
const { app, BrowserWindow, Menu, screen, session, shell, powerSaveBlocker } = require('electron');
const fs = require('fs');
const path = require('path');

app.setName('TTAnywhere');

const DEFAULT_SERVER = 'https://toontown.puffsco.com';
const argv = process.argv.slice(1);
function argValue(name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
}
const SERVER = (argValue('--server') || process.env.TTA_SERVER || DEFAULT_SERVER).replace(/\/+$/, '');
const PAGE_URL = SERVER + '/play/?install=0';        // install=0: no "Add to Home Screen" card, this already is an app
let SERVER_HOST = 'toontown.puffsco.com';
try { SERVER_HOST = new URL(SERVER).hostname; } catch (e) { /* keep the default */ }

const IS_WIN = process.platform === 'win32';
const SELFTEST = argv.includes('--selftest');         // CI: load the page, report, quit
const UNINSTALL = IS_WIN && argv.includes('--uninstall');

// Where this app keeps its files: the browser profile (the page's own file cache lives in it) and the update download.
const DATA = IS_WIN ? path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'TTAnywhere') : path.join(app.getPath('appData'), 'TTAnywhere');
app.setPath('userData', path.join(DATA, 'web'));

if (process.platform === 'linux') {
  // (the AppImage is built to start with --no-sandbox, see tools/afterpack.js: it cannot ship the setuid helper, and the app only ever shows the game's own site)
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');     // Wayland when there is one (Steam Deck's game mode, newer desktops)
}
app.commandLine.appendSwitch('ignore-gpu-blocklist');             // the game's 3D needs WebGL even on drivers Chromium is cautious about
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function isOurs(u) {
  try {
    const p = new URL(u);
    if (p.protocol === 'about:' || p.protocol === 'blob:' || p.protocol === 'data:') return true;
    if (p.protocol !== 'https:' && p.protocol !== 'http:') return false;
    return p.hostname === SERVER_HOST || p.hostname.endsWith('.puffsco.com') || p.hostname === 'puffsco.com';
  } catch (e) { return false; }
}

function openOutside(u) {
  try {
    const p = new URL(u);
    if (p.protocol === 'https:' || p.protocol === 'http:') shell.openExternal(u);
  } catch (e) { /* not a link */ }
}

// ---- window size and position, remembered between runs ----
const STATE_FILE = path.join(DATA, 'web', 'window-state.json');
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { return {}; }
}
function saveState(win) {
  try {
    const b = win.getNormalBounds();
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized(), fullscreen: win.isFullScreen() }));
  } catch (e) { /* not worth failing for */ }
}
function onSomeScreen(s) {
  if (typeof s.x !== 'number' || typeof s.y !== 'number') return false;
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return s.x + 100 < a.x + a.width && s.x + s.width - 100 > a.x && s.y + 50 < a.y + a.height && s.y + s.height - 50 > a.y;
  });
}

const OFFLINE_PAGE = 'data:text/html;charset=utf-8,' + encodeURIComponent(
  '<!doctype html><meta charset="utf-8"><title>Toontown: Anywhere</title>' +
  '<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#5a9ef2;color:#fff;' +
  'font:600 22px system-ui,Segoe UI,sans-serif;text-align:center">No connection. Trying again...</body>');

let mainWindow = null;

function createWindow() {
  const st = loadState();
  const opts = { width: 1280, height: 720 };
  if (typeof st.width === 'number' && typeof st.height === 'number' && st.width >= 640 && st.height >= 360 && onSomeScreen(st)) {
    Object.assign(opts, { x: st.x, y: st.y, width: st.width, height: st.height });
  }
  const iconFile = path.join(__dirname, 'assets', 'icon.png');
  const win = new BrowserWindow(Object.assign(opts, {
    minWidth: 640, minHeight: 360,
    title: 'Toontown: Anywhere',
    backgroundColor: '#5a9ef2',
    autoHideMenuBar: true,
    show: false,
    icon: fs.existsSync(iconFile) ? iconFile : undefined,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, spellcheck: false },
  }));
  mainWindow = win;
  win.on('page-title-updated', (e) => e.preventDefault());           // keep the app's own title

  win.once('ready-to-show', () => {
    if (!SELFTEST) {
      if (st.maximized) win.maximize();
      if (st.fullscreen) win.setFullScreen(true);
    }
    win.show();
  });
  if (!SELFTEST) win.on('close', () => saveState(win));

  // F11 or Alt+Enter: full screen (the page itself may also ask for it)
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.alt && input.key === 'Enter')) {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    }
  });

  // links to other sites open in the browser; the window only ever shows the game's own site
  win.webContents.setWindowOpenHandler(({ url }) => { openOutside(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!isOurs(url)) { e.preventDefault(); openOutside(url); } });

  // no connection: show a plain note and try again
  let retry = null;
  win.webContents.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;                          // -3: the load was replaced by another one
    if (url && url.startsWith('data:')) return;
    win.loadURL(OFFLINE_PAGE).catch(() => {});
    clearTimeout(retry);
    retry = setTimeout(() => win.loadURL(PAGE_URL).catch(() => {}), 4000);
  });

  // the system ended the page's process (nearly always memory or a graphics reset): start the game page again instead of leaving a blank window
  let crashes = [];
  win.webContents.on('render-process-gone', (e, details) => {
    console.log('TTAnywhere: page process ended: ' + details.reason);
    const now = Date.now();
    crashes = crashes.filter((t) => now - t < 60000).concat(now);
    setTimeout(() => { try { win.loadURL(PAGE_URL).catch(() => {}); } catch (err) { /* window closed */ } }, crashes.length > 4 ? 15000 : 1000);
  });

  if (SELFTEST) runSelfTest(win);
  win.loadURL(PAGE_URL).catch(() => {});
  return win;
}

// CI check: the window opens, the site loads, the page has a canvas and answers. Writes the result to TTA_SELFTEST_OUT (a GUI program prints nothing).
function runSelfTest(win) {
  const out = process.env.TTA_SELFTEST_OUT;
  const finish = (ok, text) => {
    const line = (ok ? 'SELFTEST OK ' : 'SELFTEST FAILED ') + text;
    console.log(line);
    try { if (out) fs.writeFileSync(out, line + '\n'); } catch (e) { /* ignore */ }
    app.exit(ok ? 0 : 1);
  };
  const timer = setTimeout(() => finish(false, 'timed out waiting for ' + PAGE_URL), 90000);
  win.webContents.on('did-finish-load', async () => {
    const url = win.webContents.getURL();
    if (!url.startsWith(SERVER)) return;
    try {
      await new Promise((r) => setTimeout(r, 4000));
      const info = await win.webContents.executeJavaScript(
        '({title: document.title, canvases: document.querySelectorAll("canvas").length, ' +
        'webgl: !!(function(){try{return document.createElement("canvas").getContext("webgl2")||document.createElement("canvas").getContext("webgl")}catch(e){return null}})(), ' +
        'ua: navigator.userAgent})');
      clearTimeout(timer);
      finish(true, JSON.stringify(info) + ' version=' + app.getVersion());
    } catch (e) {
      clearTimeout(timer);
      finish(false, String(e));
    }
  });
}

// the first run of this app over an older, Python-and-Panda3D install: that program's files are no longer used, so remove them (they are a few
// hundred MB, and the game files it downloaded about 1 GB)
function removeOldInstallLeftovers() {
  if (!app.isPackaged || !IS_WIN) return;
  const targets = [path.join(path.dirname(process.execPath), '_internal'), path.join(DATA, 'game')];
  for (const t of targets) fs.rm(t, { recursive: true, force: true }, () => {});
}

function startNormally() {
  if (!SELFTEST && !app.requestSingleInstanceLock()) { app.quit(); return; }
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    session.defaultSession.setUserAgent(session.defaultSession.getUserAgent() + ' TTAWebWrap/1');
    const allowed = new Set(['fullscreen', 'pointerLock', 'clipboard-sanitized-write', 'keyboardLock']);
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(allowed.has(permission)));
    session.defaultSession.setPermissionCheckHandler((wc, permission) => allowed.has(permission));
    if (!SELFTEST) powerSaveBlocker.start('prevent-display-sleep');
    createWindow();
    if (!SELFTEST) {
      removeOldInstallLeftovers();
      setTimeout(() => {
        require('./updater').check(DATA, (m) => console.log('TTAnywhere update: ' + m)).catch((e) => console.log('TTAnywhere update check failed: ' + e));
      }, 15000);
    }
  });
  app.on('window-all-closed', () => app.quit());
}

if (UNINSTALL) {
  app.whenReady().then(() => require('./uninstall').run(argv.includes('--silent'), DATA));
} else {
  startNormally();
}
