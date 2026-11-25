import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDaemon } from './daemon/server';
import type { Daemon } from './daemon/server';
import { compatWarnings, detect, loadUserVite } from './detect';
import { prismboxPlugin } from './plugin';
import { prismHome, removeSession, writeSession } from './session-file';

export interface LaunchOptions {
  root: string;
  port?: number;
  entry?: string;
  open?: boolean;
  version: string;
  log: (line: string) => void;
}

export interface Running {
  daemon: Daemon;
  studioUrl: string;
  pageUrl: string;
  close(): Promise<void>;
}

function studioDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const p of [path.join(here, 'studio'), path.join(here, '..', 'dist', 'studio')]) if (existsSync(path.join(p, 'index.html'))) return p;
  return null;
}

function openBrowser(url: string): void {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(cmd[0] as string, cmd[1] as string[], { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* printing the URL is enough */
  }
}

/**
 * `prismbox dev`: start the daemon, start the USER's own Vite dev server in this process with the Prismbox plugin
 * injected inline (their vite.config, package.json and imports are never touched), and serve Studio.
 */
export async function launch(opts: LaunchOptions): Promise<Running> {
  const project = detect(opts.root);
  const token = randomBytes(24).toString('base64url');
  const daemon = createDaemon({ root: project.root, token, port: opts.port ?? 4173, version: opts.version, studioDir: studioDir(), ...(opts.entry ? { entry: opts.entry } : {}) });
  const { port, origin } = await daemon.listen();
  // The session descriptor lives in ~/.prismbox (never in the project), so `prismbox mcp` can find this daemon.
  const home = prismHome();
  writeSession(home, { port, token, pid: process.pid, root: project.root, startedAt: new Date().toISOString(), version: opts.version });
  const dropSession = () => removeSession(home, project.root, process.pid);
  process.once('exit', dropSession);

  const vite = await loadUserVite(project.root);
  let server: Awaited<ReturnType<typeof vite.createServer>>;
  try {
    server = await vite.createServer({ root: project.root, clearScreen: false, plugins: [prismboxPlugin({ daemonOrigin: origin }) as never] });
    await server.listen();
  } catch (e) {
    dropSession();
    await daemon.close();
    throw e;
  }
  // the page origins that may reach the daemon: the dev server's own addresses
  const vitePort = server.config.server.port ?? 5173;
  const actual = (server.httpServer?.address() as { port: number } | null)?.port ?? vitePort;
  for (const host of ['localhost', '127.0.0.1', '[::1]']) daemon.allowPageOrigin(`http://${host}:${actual}`);
  for (const u of [...(server.resolvedUrls?.local ?? []), ...(server.resolvedUrls?.network ?? [])]) daemon.allowPageOrigin(u.replace(/\/$/, ''));

  const pageUrl = server.resolvedUrls?.local[0] ?? `http://localhost:${actual}/`;
  daemon.setPageUrl(pageUrl);
  const studioUrl = `${origin}/#token=${token}`;
  opts.log(`prismbox ${opts.version}`);
  opts.log(`  project   ${project.root}`);
  opts.log(`  vite      ${project.versions.vite}   react ${project.versions.react}   r3f ${project.versions.fiber}   three ${project.versions.three ?? '?'}`);
  opts.log(`  your page ${pageUrl}`);
  opts.log(`  studio    ${studioUrl}`);
  for (const w of compatWarnings(project.versions)) opts.log(`warning: ${w}`);
  opts.log('Studio opens disarmed. Arm it to edit from the page. Nothing in your project was changed to run this.');
  if (opts.open) {
    openBrowser(studioUrl);
    openBrowser(pageUrl);
  }
  void port;
  return {
    daemon,
    studioUrl,
    pageUrl,
    async close() {
      dropSession();
      await Promise.allSettled([server.close(), daemon.close()]);
    },
  };
}
