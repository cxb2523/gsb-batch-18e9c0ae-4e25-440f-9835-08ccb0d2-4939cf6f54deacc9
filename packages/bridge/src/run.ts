import { readFileSync } from 'node:fs';
import { DetectError } from './detect';

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
  /** True when attached to a terminal (decides whether to open the browser). */
  tty?: boolean;
}

/** The version in this package's own package.json (works from `src/` and from the built `dist/`). */
export function version(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return pkg.version;
}

export function helpText(): string {
  return [
    `prismbox ${version()}`,
    'Agent-native visual editor for React Three Fiber (early development).',
    '',
    'Usage:',
    '  prismbox [dev] [file] [options]   Start Studio and your Vite dev server, side by side',
    '  prismbox mcp [--root <dir>]       MCP server for your coding agent (see `prismbox mcp --help`)',
    '',
    'Options:',
    '  --root <dir>   Project folder (default: the current directory)',
    '  --port <n>     Studio port (default: 4173, next free port if busy)',
    '  --no-open      Do not open the browser',
    '  -v, --version  Print the version',
    '  -h, --help     Show this help',
    '',
    'Run it in a Vite + React 19 + React Three Fiber 9 project. Nothing in the project is modified:',
    'your Vite config, package.json and imports stay exactly as they are.',
    'Progress: https://github.com/Guten-Morgen1302/prismbox',
    '',
  ].join('\n');
}

export interface Parsed {
  command: 'dev' | 'help' | 'version';
  root: string;
  port: number | undefined;
  entry: string | undefined;
  open: boolean | undefined;
}

export function parseArgs(argv: readonly string[]): Parsed | { error: string } {
  const p: Parsed = { command: 'dev', root: process.cwd(), port: undefined, entry: undefined, open: undefined };
  const rest = [...argv];
  if (rest[0] === 'dev') rest.shift();
  while (rest.length) {
    const a = rest.shift() as string;
    if (a === '-v' || a === '--version') return { ...p, command: 'version' };
    if (a === '-h' || a === '--help') return { ...p, command: 'help' };
    if (a === '--no-open') p.open = false;
    else if (a === '--open') p.open = true;
    else if (a === '--root' || a === '--port') {
      const v = rest.shift();
      if (!v) return { error: `${a} needs a value.` };
      if (a === '--root') p.root = v;
      else {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 0 || n > 65535) return { error: `--port must be a port number, got "${v}".` };
        p.port = n;
      }
    } else if (a.startsWith('-')) return { error: `unknown option "${a}".` };
    else if (!p.entry) p.entry = a;
    else return { error: `unexpected argument "${a}".` };
  }
  return p;
}

/** Run the CLI and return the process exit code. `dev` resolves only when the servers stop. */
export async function run(argv: readonly string[], io: Io, onReady?: (stop: () => Promise<void>) => void): Promise<number> {
  if (argv[0] === 'mcp') {
    const { runMcp } = await import('./mcp/run');
    return runMcp(argv.slice(1), io, version());
  }
  const p = parseArgs(argv);
  if ('error' in p) {
    io.err(`prismbox: ${p.error} Run \`prismbox --help\`.\n`);
    return 2;
  }
  if (p.command === 'version') {
    io.out(`${version()}\n`);
    return 0;
  }
  if (p.command === 'help') {
    io.out(helpText());
    return 0;
  }
  try {
    const { launch } = await import('./launch');
    const running = await launch({ root: p.root, version: version(), log: (l) => io.out(`${l}\n`), open: p.open ?? Boolean(io.tty), ...(p.port === undefined ? {} : { port: p.port }), ...(p.entry ? { entry: p.entry } : {}) });
    await new Promise<void>((resolve) => {
      let stopping = false;
      const stop = async () => {
        if (stopping) return;
        stopping = true;
        await running.close();
        resolve();
      };
      onReady?.(stop);
      process.once('SIGINT', () => void stop());
      process.once('SIGTERM', () => void stop());
    });
    return 0;
  } catch (e) {
    if (e instanceof DetectError) {
      io.err(`prismbox: ${e.message}\n`);
      return 1;
    }
    io.err(`prismbox: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}
