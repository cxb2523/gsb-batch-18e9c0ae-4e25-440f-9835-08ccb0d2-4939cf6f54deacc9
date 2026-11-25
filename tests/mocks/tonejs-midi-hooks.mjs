/**
 * Test-only ESM resolve hook. Registered from register-hooks.cjs.
 *
 * Rewrites the bare specifier '@tonejs/midi' to the on-disk ESM shim
 * (tonejs-midi-shim.mjs), which re-exports the package's CommonJS build as
 * proper named exports. Node's static CJS named-export detector cannot see
 * the package's `exports.Midi = ...` assignments, so the engine's
 * `import { Midi } from '@tonejs/midi'` would otherwise fail headlessly.
 * Vite performs the same interop in the browser.
 *
 * Only that one specifier is intercepted; everything else is delegated.
 */
const SHIM_URL = new URL('./tonejs-midi-shim.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@tonejs/midi') {
    return { url: SHIM_URL, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
