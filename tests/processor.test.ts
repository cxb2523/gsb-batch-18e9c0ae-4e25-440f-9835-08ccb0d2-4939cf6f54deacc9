import './workletGlobals'; // must precede the processor import (installs globals)
import test from 'node:test';
import assert from 'node:assert/strict';
import { ModuleKind } from '../src/types/graph';
import type { Graph, ModuleDefinition } from '../src/types/graph';
import { ModularProcessor } from '../src/worklet/ModularProcessor';

/**
 * Exercises the processor's graph lifecycle directly. `AudioWorkletProcessor`
 * and friends are stubbed by ../workletGlobals so the class can be built in
 * Node.
 */

const mkProcessor = () => new ModularProcessor();

const mod = (
  id: string,
  kind: ModuleKind,
  params?: ModuleDefinition['params']
): ModuleDefinition => ({
  id,
  kind,
  params,
});
const graphOf = (modules: ModuleDefinition[], connections: Graph['connections']): Graph => ({
  modules,
  connections,
});

/** Runs one 128-sample block and returns the stereo output buffers. */
const runBlock = (processor: ModularProcessor): Float32Array[] => {
  const left = new Float32Array(128);
  const right = new Float32Array(128);
  // process() takes outputs as Float32Array[][] (one entry per output, each an
  // array of channel buffers).
  processor.process([[new Float32Array(128), new Float32Array(128)]], [[left, right]], {});
  return [left, right];
};

// `modules` is private; tests only read it, so view it through this shape.
const moduleMap = (
  processor: ModularProcessor
): Map<string, { params: { [k: string]: unknown } }> =>
  (processor as unknown as { modules: Map<string, { params: { [k: string]: unknown } }> }).modules;

const scopeIds = (processor: ModularProcessor): string[] => {
  const ids = new Set<string>();
  for (const message of processor.port.posted) {
    if (message.type !== 'scopeData') continue;
    for (const frame of message.frames as Array<{ id: string }>) ids.add(frame.id);
  }
  return [...ids];
};

test('loadGraph reports the generation it was given', () => {
  const processor = mkProcessor();
  processor.handleMsg({
    type: 'loadGraph',
    generation: 7,
    graph: graphOf([mod('out', ModuleKind.OUTPUT)], []),
  });

  const last = processor.port.posted.at(-1);
  assert.equal(last?.type, 'graphLoaded');
  assert.equal(last?.generation, 7);
});

test('rebuild drops the old module set so scope frames name only new modules', () => {
  const processor = mkProcessor();
  processor.handleMsg({
    type: 'loadGraph',
    generation: 1,
    graph: graphOf(
      [mod('vco', ModuleKind.VCO), mod('delay', ModuleKind.DELAY), mod('out', ModuleKind.OUTPUT)],
      [
        { from: { id: 'vco', port: 'out' }, to: { id: 'delay', port: 'in' } },
        { from: { id: 'delay', port: 'out' }, to: { id: 'out', port: 'in' } },
      ]
    ),
  });
  // Clear scope emitted by the first graph so only the second graph's frames
  // are inspected.
  processor.port.posted.length = 0;

  // New graph: the delay was bypassed away.
  processor.handleMsg({
    type: 'loadGraph',
    generation: 2,
    graph: graphOf(
      [mod('vco', ModuleKind.VCO), mod('out', ModuleKind.OUTPUT)],
      [{ from: { id: 'vco', port: 'out' }, to: { id: 'out', port: 'in' } }]
    ),
  });

  for (let i = 0; i < 12; i++) runBlock(processor);

  assert.ok(scopeIds(processor).length > 0, 'expected a scope batch');
  assert.equal(scopeIds(processor).includes('delay'), false);
});

test('scope frames are tagged with the current generation', () => {
  const processor = mkProcessor();
  processor.handleMsg({
    type: 'loadGraph',
    generation: 5,
    graph: graphOf([mod('vco', ModuleKind.VCO), mod('out', ModuleKind.OUTPUT)], []),
  });
  for (let i = 0; i < 12; i++) runBlock(processor);

  const scope = processor.port.posted.filter((m) => m.type === 'scopeData').at(-1);
  assert.ok(scope);
  assert.equal(scope?.generation, 5);
});

test('setParam reaches a module loaded by the new graph', () => {
  const processor = mkProcessor();
  processor.handleMsg({
    type: 'loadGraph',
    generation: 1,
    graph: graphOf([mod('vco', ModuleKind.VCO, { freq: 0 })], []),
  });
  processor.handleMsg({ type: 'setParam', id: 'vco', param: 'freq', value: 3 });
  assert.equal(moduleMap(processor).get('vco')?.params.freq, 3);
});

test('setParam for a deleted module is a silent no-op', () => {
  const processor = mkProcessor();
  processor.handleMsg({
    type: 'loadGraph',
    generation: 2,
    graph: graphOf([mod('out', ModuleKind.OUTPUT)], []),
  });
  assert.doesNotThrow(() =>
    processor.handleMsg({ type: 'setParam', id: 'delay', param: 'mix', value: 0.5 })
  );
  assert.equal(moduleMap(processor).has('delay'), false);
});

test('a generation-less loadGraph still advances the internal counter', () => {
  const processor = mkProcessor();
  processor.handleMsg({ type: 'loadGraph', graph: graphOf([mod('out', ModuleKind.OUTPUT)], []) });
  const first = processor.port.posted.at(-1)?.generation;
  processor.handleMsg({ type: 'loadGraph', graph: graphOf([mod('out', ModuleKind.OUTPUT)], []) });
  const second = processor.port.posted.at(-1)?.generation;
  assert.equal(typeof first, 'number');
  assert.equal((second as number) > (first as number), true);
});

test('bypassed graph keeps producing audio after a module is deleted', () => {
  // vco -> vca -> out, then delete the VCA the way the UI does, and confirm
  // the rebuilt engine still outputs tone through the bypass cable.
  const vco = mod('vco', ModuleKind.VCO, { freq: 2, vcoShape: 'sine' });
  const vca = mod('vca', ModuleKind.VCA);
  const out = mod('out', ModuleKind.OUTPUT, { drive: 1 });
  const processor = mkProcessor();
  processor.handleMsg({
    type: 'loadGraph',
    generation: 1,
    graph: graphOf(
      [vco, vca, out],
      [
        { from: { id: 'vco', port: 'out' }, to: { id: 'vca', port: 'in' } },
        { from: { id: 'vca', port: 'out' }, to: { id: 'out', port: 'in' } },
      ]
    ),
  });
  // Bypassed graph, as produced by model.deleteModule.
  processor.handleMsg({
    type: 'loadGraph',
    generation: 2,
    graph: graphOf(
      [vco, out],
      [{ from: { id: 'vco', port: 'out' }, to: { id: 'out', port: 'in' } }]
    ),
  });

  let peak = 0;
  for (let i = 0; i < 8; i++) {
    const [left] = runBlock(processor);
    for (const sample of left) peak = Math.max(peak, Math.abs(sample));
  }
  assert.ok(peak > 0.01, `expected audible output, got peak ${peak}`);
});
