import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import path from 'node:path';
import type { Io } from '../run';
import { createMcpServer } from './server';

export function mcpHelp(): string {
  return [
    'Usage: prismbox mcp [--root <dir>] [--print-config]',
    '',
    'Runs the Prismbox MCP server on stdio for a coding agent (Claude Code, Cursor, Windsurf, Codex).',
    'stdout carries only MCP messages; logs go to stderr. It never modifies any config or project file.',
    '',
    '  --root <dir>     Project folder (default: the current directory)',
    '  --print-config   Print copy-paste setup for your agent and exit',
    '',
  ].join('\n');
}

/** Setup snippets only: nothing is written anywhere. */
export function printConfig(root: string, cliPath: string, platform: NodeJS.Platform = process.platform): string {
  const abs = path.resolve(root);
  const q = (s: string) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);
  const npxArgs = ['-y', 'prismbox', 'mcp', '--root', abs];
  // Windows launches MCP servers without a shell, so `npx` (a .cmd) must go through cmd /c
  const [cmd, args] = platform === 'win32' ? ['cmd', ['/c', 'npx', ...npxArgs]] : ['npx', npxArgs];
  const claude = `claude mcp add prismbox -- ${[cmd, ...args].map(q).join(' ')}`;
  const json = JSON.stringify({ mcpServers: { prismbox: { command: cmd, args } } }, null, 2);
  const lines = [
    '# Claude Code (run once):',
    claude,
    '',
    '# Cursor (.cursor/mcp.json) or Windsurf (~/.codeium/windsurf/mcp_config.json): add this entry',
    json,
    '',
  ];
  if (!/[\\/]node_modules[\\/]/.test(cliPath)) {
    lines.push('# Running from a source checkout instead of npm:', `claude mcp add prismbox -- node ${[cliPath, 'mcp', '--root', abs].map(q).join(' ')}`, '');
  }
  lines.push('Then start prismbox in that project (`npx prismbox`), open your page, click an object, and tell the agent to edit "this".', '');
  return lines.join('\n');
}

/**
 * `prismbox mcp`. Strict stdio hygiene: from here on, anything that would print to stdout is routed to stderr, so the only
 * bytes on stdout are MCP JSON-RPC frames written by the transport.
 */
export async function runMcp(argv: readonly string[], io: Io, version: string): Promise<number> {
  let root = process.cwd();
  let print = false;
  const rest = [...argv];
  while (rest.length) {
    const a = rest.shift() as string;
    if (a === '--print-config') print = true;
    else if (a === '--root') {
      const v = rest.shift();
      if (!v) {
        io.err('prismbox mcp: --root needs a value.\n');
        return 2;
      }
      root = v;
    } else if (a === '-h' || a === '--help') {
      io.out(mcpHelp());
      return 0;
    } else {
      io.err(`prismbox mcp: unknown argument "${a}".\n`);
      return 2;
    }
  }
  if (print) {
    io.out(printConfig(root, process.argv[1] ?? 'prismbox'));
    return 0;
  }
  const toErr = (...a: unknown[]) => process.stderr.write(`${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}\n`);
  console.log = toErr;
  console.info = toErr;
  console.debug = toErr;
  const server = createMcpServer({ root: path.resolve(root), version });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`prismbox mcp ${version} ready for ${path.resolve(root)}\n`);
  await new Promise<void>((resolve) => {
    process.stdin.once('end', resolve);
    process.stdin.once('close', resolve);
  });
  await server.close().catch(() => undefined);
  return 0;
}
