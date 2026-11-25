// End-to-end smoke check driven through the Chrome DevTools Protocol.
// Verifies, against the real page (WebGL running headless):
//   1. coin pickup persists immediately to localStorage
//   2. restart resets the run layer / clears islands but keeps the archive
//   3. refresh keeps banked coins
//   4. shield absorbs a hit (shield--, combo reset, HUD updated), next hit ends the run
//
// Usage: node scripts/e2e-check.mjs [url] [chromePath]
// `url` defaults to PREVIEW_URL or http://localhost:4173/.
// `chromePath` defaults to CHROME_PATH, then common Chrome/Edge install paths.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] ?? process.env.PREVIEW_URL ?? 'http://localhost:4173/';

const candidates = [
  process.argv[3],
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const chromePath = candidates.find((path) => existsSync(path));

if (!chromePath) {
  console.error('Could not find Chrome/Edge. Pass its path as the second argument or set CHROME_PATH.');
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const userDataDir = await mkdtemp(join(tmpdir(), 'void-runner-e2e-'));

// Ask the OS for a free port so we never attach to some other browser's CDP.
const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port: freePort } = server.address();
    server.close(() => resolve(freePort));
  });
});

const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--enable-unsafe-swiftshader',
    '--window-size=1280,800',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const cleanup = async () => {
  const pid = chrome.pid;
  try {
    chrome.kill();
  } catch {
    /* already gone */
  }
  // On Windows the browser forks helper processes; kill only this run's tree
  // (PID-scoped, never an image-name-wide kill).
  if (process.platform === 'win32' && pid) {
    spawnSync(join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'taskkill.exe'), [
      '/PID',
      String(pid),
      '/T',
      '/F',
    ], { stdio: 'ignore' });
  }
  await sleep(400);
  await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
};

async function json(path) {
  for (let i = 0; i < 60; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      if (response.ok) return await response.json();
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error(`CDP endpoint ${path} never answered`);
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    socket.addEventListener('open', () => resolve(socket));
    socket.addEventListener('error', reject);
  });
}

function makeClient(socket) {
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      id += 1;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate failed');
    }
    return result.result.value;
  };
  // Poll instead of racing the load event: module scripts boot after `load` and
  // rAF-driven state needs a frame or two before assertions read it.
  const waitFor = async (expression, timeout = 20000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        if (await evaluate(expression)) return;
      } catch {
        /* context may be mid-navigation */
      }
      await sleep(150);
    }
    throw new Error(`condition never became true: ${expression}`);
  };
  return { send, evaluate, waitFor };
}

const results = [];
const check = (name, fn) => {
  results.push({ name, fn });
};

let socket;
let client;

check('page boots and exposes the debug hook', async () => {
  await client.waitFor('typeof window.__voidRunner === "object"');
  const counts = await client.evaluate('window.__voidRunner.getSceneCounts()');
  assert.ok(counts.islands > 0, 'initial islands exist');
});

check('coin pickup writes the archive to localStorage immediately', async () => {
  await client.evaluate(`(() => {
    localStorage.setItem('void-runner-coins', '4');
    localStorage.setItem('void-runner-best', '321');
  })()`);
  await client.evaluate('location.reload()');
  await sleep(400);
  await client.waitFor('typeof window.__voidRunner === "object" && window.__voidRunner.getArchive().coins === 4');

  await client.evaluate('window.__voidRunner.startRun()');
  await sleep(80);
  // Place a coin right on the runner so the very next frame collects it.
  await client.waitFor(`(() => {
    const r = window.__voidRunner;
    const s = r.getState();
    r.spawnPickup('coin', { lane: s.lane, z: 1.2, y: 0.9 });
    return true;
  })()`);
  await client.waitFor('window.__voidRunner.getState().sessionCoins >= 1');

  const state = await client.evaluate('window.__voidRunner.getState()');
  const stored = await client.evaluate(`localStorage.getItem('void-runner-coins')`);
  assert.equal(stored, String(4 + state.sessionCoins));
  results.archiveAfterPickup = { sessionCoins: state.sessionCoins, stored };
});

check('restart clears run objects and resets run state, keeping the archive', async () => {
  // Force surplus scene objects so the assertion does not depend on spawn luck
  // or on requestAnimationFrame being unthrottled in headless mode.
  await client.evaluate(`(() => {
    const r = window.__voidRunner;
    r.startRun();
    for (let i = 0; i < 5; i += 1) r.spawnIsland(-40 - i * 5);
    r.spawnPickup('coin', { lane: 2, z: -30 });
    r.spawnPickup('shield', { lane: 0, z: -30 });
  })()`);
  const before = await client.evaluate('window.__voidRunner.getSceneCounts()');
  assert.equal(before.islands, 13, 'surplus islands present before restart');

  // Capture state in the same synchronous turn as the restart: once the next
  // animation frame runs, the fresh run legitimately starts accruing score.
  const { after, state } = await client.evaluate(`(() => {
    window.__voidRunner.startRun();
    return {
      after: window.__voidRunner.getSceneCounts(),
      state: window.__voidRunner.getState(),
    };
  })()`);

  assert.equal(after.islands, 8, 'islands rebuilt to the fresh-run set');
  assert.ok(after.sceneChildren < before.sceneChildren, 'old scene objects were removed, not leaked');
  assert.equal(after.obstacles, 0, 'obstacles cleared');
  assert.equal(after.pickups, 0, 'pickups cleared');
  assert.equal(after.particles, 0, 'particles cleared');
  assert.equal(state.sessionCoins, 0);
  assert.equal(state.score, 0);
  assert.equal(state.combo, 1);
  assert.equal(state.shield, 0);
  assert.equal(state.lane, 1);
  assert.equal(state.sliding, false);
  assert.equal(state.jumpVelocity, 0);
  assert.equal(state.over, false);
  assert.equal(state.running, true);

  const archive = await client.evaluate('window.__voidRunner.getArchive()');
  assert.equal(archive.best >= 321, true, 'best score preserved');
  assert.equal(archive.coins, Number(results.archiveAfterPickup.stored), 'coins preserved');
});

check('refresh keeps banked coins', async () => {
  const before = await client.evaluate('window.__voidRunner.getArchive()');
  await client.evaluate('location.reload()');
  await sleep(400);
  await client.waitFor('typeof window.__voidRunner === "object"');
  const after = await client.evaluate('window.__voidRunner.getArchive()');
  assert.deepEqual(after, before);
  assert.equal(await client.evaluate(`document.querySelector('#coins').textContent`), String(after.coins).padStart(3, '0'));
});

check('shield absorbs first hit, then a bare hit ends the run', async () => {
  await client.evaluate('window.__voidRunner.startRun()');
  await sleep(80);
  // Build a combo first so "combo reset on shield break" is actually observed.
  await client.evaluate(`window.__voidRunner.spawnPickup('coin', { lane: 1, z: 1.2, y: 0.9 })`);
  await client.waitFor('window.__voidRunner.getState().combo >= 2');
  await client.evaluate(`window.__voidRunner.spawnPickup('shield', { lane: 1, z: 1.2, y: 0.9 })`);
  await client.waitFor('window.__voidRunner.getState().shield === 1');

  let state = await client.evaluate('window.__voidRunner.getState()');
  assert.ok(state.combo >= 2, 'combo built before the hit');
  assert.equal(await client.evaluate(`document.querySelector('#shield').textContent`), '1');

  await client.evaluate('window.__voidRunner.hitObstacle()');
  await sleep(120);
  state = await client.evaluate('window.__voidRunner.getState()');
  assert.equal(state.shield, 0, 'shield consumed');
  assert.equal(state.combo, 1, 'combo reset');
  assert.equal(state.over, false, 'run continues');
  assert.equal(await client.evaluate(`document.querySelector('#shield').textContent`), '0', 'HUD reflects break');

  await client.evaluate('window.__voidRunner.hitObstacle()');
  await sleep(120);
  state = await client.evaluate('window.__voidRunner.getState()');
  assert.equal(state.over, true, 'second hit ends the run');
  assert.equal(state.running, false);
  assert.equal(await client.evaluate(`document.querySelector('#message-title').textContent.length > 0`), true);
});

try {
  console.log(`using browser: ${chromePath}`);
  await json('/json/version');
  const target = await json('/json/list');
  const page = target.find((entry) => entry.type === 'page');
  socket = await connect(page.webSocketDebuggerUrl);
  client = makeClient(socket);
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Page.navigate', { url });
  await sleep(500);
  await client.waitFor('typeof window.__voidRunner === "object"', 30000);

  for (const { name, fn } of results) {
    await fn();
    console.log(`ok - ${name}`);
  }
  console.log(`\n${results.length} e2e checks passed`);
  await cleanup();
  process.exit(0);
} catch (error) {
  console.error('e2e check failed:', error.message);
  await cleanup();
  process.exit(1);
}
