// Orchestrates a browser smoke test: build (optional), serve dist, run the CDP
// checks, then tear down only the preview process tree we started.
// Usage: node scripts/run-e2e.mjs [--no-build]
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const skipBuild = process.argv.includes('--no-build');
const viteBin = join(root, 'node_modules', 'vite', 'bin', 'vite.js');

const port =
  Number(process.env.E2E_PORT) ||
  (await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port: freePort } = server.address();
      server.close(() => resolve(freePort));
    });
  }));
const url = `http://localhost:${port}/`;

function run(command, args, options = {}) {
  return spawn(command, args, { stdio: 'inherit', shell: false, ...options });
}

// Run vite through the current Node binary; spawning `vite.cmd` directly hits
// EINVAL on Windows without a shell.
function vite(args, options = {}) {
  return run(process.execPath, [viteBin, ...args], options);
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync(join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'taskkill.exe'), [
      '/PID',
      String(child.pid),
      '/T',
      '/F',
    ], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

async function waitForServer(timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`vite preview never answered on ${url}`);
}

let preview;

try {
  if (!skipBuild) {
    const build = vite(['build'], { cwd: root });
    const [code] = await once(build, 'exit');
    if (code !== 0) throw new Error(`vite build exited with ${code}`);
  }

  preview = vite(['preview', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
  preview.on('error', (error) => console.error('preview failed to start:', error.message));

  await waitForServer();
  console.log(`preview ready at ${url}`);

  const check = run(process.execPath, [join(root, 'scripts', 'e2e-check.mjs'), url], { cwd: root });
  const [code] = await once(check, 'exit');
  killTree(preview);
  process.exit(code);
} catch (error) {
  console.error(error.message);
  killTree(preview);
  process.exit(1);
}
