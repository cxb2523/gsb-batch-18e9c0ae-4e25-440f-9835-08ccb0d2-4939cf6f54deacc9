/**
 * Test-only ESM shim that re-exports @tonejs/midi's CommonJS build as proper
 * ESM named exports. Node's static CJS named-export detector cannot see the
 * package's `exports.Midi = ...` assignments, so the engine's
 * `import { Midi } from '@tonejs/midi'` fails under a headless Node test.
 * Vite performs the same interop in the browser.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cjs = require('@tonejs/midi');

export default cjs;
export const Header = cjs.Header;
export const Track = cjs.Track;
export const Midi = cjs.Midi;
