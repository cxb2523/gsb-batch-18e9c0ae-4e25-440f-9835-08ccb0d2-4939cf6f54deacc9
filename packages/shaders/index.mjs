import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('./glsl/', import.meta.url));

/** Names of the available GLSL blocks (file names without `.glsl`). */
export function listBlocks() {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.glsl'))
    .map((f) => f.slice(0, -5))
    .sort();
}

/** The source of one block. Throws for an unknown name. */
export function readBlock(name) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`invalid block name "${name}"`);
  return readFileSync(`${dir}${name}.glsl`, 'utf8').trimEnd();
}

/**
 * Expand `//@include <block>` lines (valid GLSL comments, so unexpanded source still compiles) into the
 * block source. Used by the template build step; the output is plain GLSL with no Prismbox reference.
 */
export function expandIncludes(text) {
  return text.replace(/^([ \t]*)\/\/@include ([a-z0-9-]+)[ \t]*$/gm, (_m, indent, name) =>
    readBlock(name)
      .split('\n')
      .map((l) => (l ? indent + l : l))
      .join('\n'),
  );
}
