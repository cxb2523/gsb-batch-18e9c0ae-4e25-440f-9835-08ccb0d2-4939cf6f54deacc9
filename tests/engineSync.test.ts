import test from 'node:test';
import assert from 'node:assert/strict';
import { ModuleKind } from '../src/types/graph';
import type { ModuleDefinition } from '../src/types/graph';
import {
  diffParams,
  mergeScopeFrames,
  pruneScopeData,
  seedParamCache,
} from '../src/model/engineSync';

const mod = (
  id: string,
  kind: ModuleKind,
  params?: ModuleDefinition['params']
): ModuleDefinition => ({
  id,
  kind,
  params,
});

test('seeding the cache from a graph compares surviving modules against new params', () => {
  const after = [
    mod('vco', ModuleKind.VCO, { freq: 1 }),
    mod('out', ModuleKind.OUTPUT, { drive: 0.2 }),
  ];
  // Simulate a rebuild: the delay that was in the old graph is gone.
  const cache = seedParamCache(after);

  assert.equal(cache.has('delay'), false);
  // Refreshing the same module set produces no churn.
  assert.deepEqual(diffParams(cache, after), []);
});

test('a param edit after a rebuild diffs against the rebuilt module set, not the old one', () => {
  const after = [mod('vco', ModuleKind.VCO, { freq: 2 }), mod('out', ModuleKind.OUTPUT)];

  // The rebuild reseeds the cache: the deleted atten is no longer tracked.
  const cache = seedParamCache(after);
  assert.equal(cache.has('atten'), false);

  // A subsequent edit to a surviving module diffs against the rebuilt cache,
  // and nothing references the removed module.
  const edited = [mod('vco', ModuleKind.VCO, { freq: 3 }), mod('out', ModuleKind.OUTPUT)];
  const messages = diffParams(cache, edited);
  assert.deepEqual(messages, [{ type: 'setParam', id: 'vco', param: 'freq', value: 3 }]);
  assert.equal(
    messages.some((m) => m.id === 'atten'),
    false
  );
});

test('diffParams emits only changed parameters', () => {
  const modules = [
    mod('vco', ModuleKind.VCO, { freq: 2, vcoShape: 'sine' }),
    mod('out', ModuleKind.OUTPUT, { drive: 0.2 }),
  ];
  const cache = seedParamCache([
    mod('vco', ModuleKind.VCO, { freq: 1, vcoShape: 'sine' }),
    mod('out', ModuleKind.OUTPUT, { drive: 0.2 }),
  ]);

  assert.deepEqual(diffParams(cache, modules), [
    { type: 'setParam', id: 'vco', param: 'freq', value: 2 },
  ]);
});

test('diffParams compares a brand-new module against an empty baseline', () => {
  const cache = seedParamCache([]);
  const messages = diffParams(cache, [mod('vco', ModuleKind.VCO, { freq: 3 })]);
  assert.deepEqual(messages, [{ type: 'setParam', id: 'vco', param: 'freq', value: 3 }]);
});

test('pruneScopeData drops frames for modules that are gone and keeps the rest', () => {
  const scope = { vco: [1, 2], delay: [3], out: [4] };
  const modules = [mod('vco', ModuleKind.VCO), mod('out', ModuleKind.OUTPUT)];

  const pruned = pruneScopeData(scope, modules);
  assert.deepEqual(Object.keys(pruned).sort(), ['out', 'vco']);
  assert.deepEqual(pruned.vco, [1, 2]);
});

test('pruneScopeData returns the same object when nothing is stale', () => {
  const scope = { vco: [1] };
  assert.equal(pruneScopeData(scope, [mod('vco', ModuleKind.VCO)]), scope);
});

test('stale scope frames from a superseded generation are ignored', () => {
  const current = { vco: [1] };
  const stale = {
    type: 'scopeData' as const,
    generation: 3,
    frames: [{ id: 'delay', samples: [9] }],
  };

  const merged = mergeScopeFrames(current, stale, 4);
  assert.equal(merged, current);
});

test('scope frames from the current generation are merged', () => {
  const current = { vco: [1] };
  const fresh = {
    type: 'scopeData' as const,
    generation: 4,
    frames: [
      { id: 'vco', samples: [7] },
      { id: 'out', samples: [8] },
    ],
  };

  const merged = mergeScopeFrames(current, fresh, 4);
  assert.deepEqual(merged, { vco: [7], out: [8] });
});

test('untagged scope frames are merged for backwards compatibility', () => {
  const current = {};
  const legacy = { type: 'scopeData' as const, frames: [{ id: 'vco', samples: [5] }] };
  assert.deepEqual(mergeScopeFrames(current, legacy, 0), { vco: [5] });
});
