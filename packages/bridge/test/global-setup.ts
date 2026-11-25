import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * The MCP tests spawn the real CLI (`node dist/cli.js mcp`) so stdout can be inspected byte for byte. CI runs `pnpm test`
 * before `pnpm build`, so build what the CLI needs here: core (its runtime dependency) and the bridge bundle.
 * A plain `tsup` does not clean, so dist/studio from a full build survives.
 */
export default function setup(): void {
  const bridge = fileURLToPath(new URL('..', import.meta.url));
  const core = fileURLToPath(new URL('../../core', import.meta.url));
  execSync('pnpm exec tsup', { cwd: core, stdio: 'ignore' });
  execSync('pnpm exec tsup', { cwd: bridge, stdio: 'ignore' });
}
