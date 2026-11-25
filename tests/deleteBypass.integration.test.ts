import test from 'node:test';
import assert from 'node:assert/strict';
import { ModuleKind } from '../src/types/graph';
import type { Graph } from '../src/types/graph';
import { deleteModule, toEngineGraph } from '../src/model/graph';
import {
  diffParams,
  mergeScopeFrames,
  pruneScopeData,
  seedParamCache,
} from '../src/model/engineSync';
import { PRESETS } from '../src/presets';

/** Mirrors what useAudioEngine does after a graph change, so the pieces are
 * verified together: send the new graph, reseed the param cache from the new
 * module set, and prune scope traces for modules that are gone. */
function syncAfterChange(graph: Graph, scope: Record<string, number[]>) {
  const engineGraph = toEngineGraph(graph);
  const cache = seedParamCache(engineGraph.modules);
  return {
    engineGraph,
    cache,
    scope: pruneScopeData(scope, engineGraph.modules),
  };
}

const modulesOfKind = (graph: Graph, kind: ModuleKind) =>
  graph.modules.filter((m) => m.kind === kind);

/** Every cable endpoint must resolve to a live module. */
function assertConsistent(graph: Graph) {
  const ids = new Set(graph.modules.map((m) => m.id));
  for (const c of graph.connections) {
    assert.ok(ids.has(c.from.id), `dangling source ${c.from.id}`);
    assert.ok(ids.has(c.to.id), `dangling target ${c.to.id}`);
  }
}

test('deleting the mid-chain delay in a preset keeps sound and rewires to Output', () => {
  const preset = PRESETS.find((p) => p.name === 'Strange Attractor');
  assert.ok(preset);
  const original = structuredClone(preset.graph);

  const delay = modulesOfKind(original, ModuleKind.DELAY)[0];
  assert.ok(delay, 'preset should have a delay');

  // The delay feeds pan.in; pan feeds out.inL and out.inR.
  const after = deleteModule(original, delay.id);

  assert.equal(
    after.modules.some((m) => m.id === delay.id),
    false
  );
  assertConsistent(after);

  // The source feeding the delay (the VCA) now also reaches both Output
  // channels directly.
  const vca = modulesOfKind(original, ModuleKind.VCA)[0];
  const out = modulesOfKind(original, ModuleKind.OUTPUT)[0];
  const bypassed = after.connections.filter((c) => c.from.id === vca.id && c.to.id === out.id);
  assert.deepEqual(
    bypassed.map((c) => c.to.port).sort(),
    ['inL', 'inR'],
    'bypass should hit both Output channels'
  );

  // The pan chain the delay fed is still intact.
  assert.equal(
    after.connections.some((c) => c.to.id === out.id && c.to.port === 'inL'),
    true
  );
});

test('after a bypass rebuild the param cache tracks only surviving modules', () => {
  const graph: Graph = {
    modules: [
      { id: 'vco', kind: ModuleKind.VCO, params: { freq: 1 } },
      { id: 'vca', kind: ModuleKind.VCA },
      { id: 'out', kind: ModuleKind.OUTPUT, params: { drive: 0.2 } },
    ],
    connections: [
      { from: { id: 'vco', port: 'out' }, to: { id: 'vca', port: 'in' } },
      { from: { id: 'vca', port: 'out' }, to: { id: 'out', port: 'in' } },
    ],
  };

  const after = deleteModule(graph, 'vca');
  const sync = syncAfterChange(after, { vco: [1, 2], vca: [3, 4], out: [5] });

  assert.deepEqual([...sync.cache.keys()].sort(), ['out', 'vco']);
  assert.deepEqual(Object.keys(sync.scope).sort(), ['out', 'vco']);
  // The deleted VCA left a bypass cable: vco now reaches out.in.
  assert.deepEqual(
    sync.engineGraph.connections.map((c) => `${c.from.id}.${c.from.port}->${c.to.id}.${c.to.port}`),
    ['vco.out->out.in']
  );
  // A stale scope batch from the pre-rebuild generation is dropped.
  const stale = mergeScopeFrames(
    sync.scope,
    { type: 'scopeData', generation: 1, frames: [{ id: 'vca', samples: [9] }] },
    2
  );
  assert.equal(stale, sync.scope);
});

test('a param change on a surviving module after rebuild produces a focused setParam', () => {
  const graph: Graph = {
    modules: [
      { id: 'vco', kind: ModuleKind.VCO, params: { freq: 1 } },
      { id: 'atten', kind: ModuleKind.ATTEN, params: { gain: 0.5 } },
      { id: 'out', kind: ModuleKind.OUTPUT },
    ],
    connections: [
      { from: { id: 'vco', port: 'out' }, to: { id: 'atten', port: 'in' } },
      { from: { id: 'atten', port: 'out' }, to: { id: 'out', port: 'in' } },
    ],
  };

  const afterDelete = deleteModule(graph, 'atten');
  const sync = syncAfterChange(afterDelete, {});

  // Now the user nudges the oscillator.
  const edited: Graph = {
    ...afterDelete,
    modules: afterDelete.modules.map((m) =>
      m.id === 'vco' ? { ...m, params: { ...m.params, freq: 2 } } : m
    ),
  };
  const messages = diffParams(sync.cache, toEngineGraph(edited).modules);

  assert.deepEqual(messages, [{ type: 'setParam', id: 'vco', param: 'freq', value: 2 }]);
});
