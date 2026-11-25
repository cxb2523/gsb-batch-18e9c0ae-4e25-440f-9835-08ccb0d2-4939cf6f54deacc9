// Smoke test for the BUILT packages (run after `pnpm build`).
// Plain Node, no dev tooling, so it also proves the published runtime floor (Node 20).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const bridgePkg = JSON.parse(readFileSync(`${root}packages/bridge/package.json`, 'utf8'));

// CLI
const cli = `${root}packages/bridge/dist/cli.js`;
const version = execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).trim();
assert.equal(version, bridgePkg.version);
assert.match(execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8' }), /Usage:/);

// core
const core = await import(pathToFileURL(`${root}packages/core/dist/index.js`).href);
const src = [
  'import { Canvas } from "@react-three/fiber";',
  'export default function Hero() {',
  '  return <Canvas><mesh name="orb" position={[0, 0, 0]} /></Canvas>;',
  '}',
  '',
].join('\n');
const scene = core.readScene(src);
assert.equal(scene.summary.hostNodes, 1);
assert.equal(scene.summary.coverage, 1);
const r = core.setProp(src, { op: 'setProp', node: 'orb', prop: 'position', value: [0.4, 0.1, 0] });
assert.equal(r.source, src.replace('[0, 0, 0]', '[0.4, 0.1, 0]'));
assert.equal(core.applyOps(src, []).source, src);

console.log(`smoke ok (node ${process.version}, prismbox ${version})`);
