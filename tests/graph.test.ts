import test from 'node:test';
import assert from 'node:assert/strict';
import { ModuleKind } from '../src/types/graph';
import type { Connection, Graph, ModuleDefinition } from '../src/types/graph';
import { deleteModule } from '../src/model/graph';

const mod = (id: string, kind: ModuleKind): ModuleDefinition => ({ id, kind });
const conn = (fromId: string, fromPort: string, toId: string, toPort: string): Connection => ({
  from: { id: fromId, port: fromPort },
  to: { id: toId, port: toPort },
});

const graph = (modules: ModuleDefinition[], connections: Connection[]): Graph => ({
  modules,
  connections,
});

const key = (c: Connection) => `${c.from.id}.${c.from.port}->${c.to.id}.${c.to.port}`;
const keys = (g: Graph) => g.connections.map(key).sort();

/** A graph must never keep a cable pointing at a module that no longer exists. */
const assertNoDangling = (g: Graph) => {
  const ids = new Set(g.modules.map((m) => m.id));
  for (const c of g.connections) {
    assert.ok(ids.has(c.from.id), `dangling source ${c.from.id}`);
    assert.ok(ids.has(c.to.id), `dangling target ${c.to.id}`);
  }
};

test('direct source -> module -> Output is bypassed to the same Output port', () => {
  const g = graph(
    [mod('vco', ModuleKind.VCO), mod('vca', ModuleKind.VCA), mod('out', ModuleKind.OUTPUT)],
    [conn('vco', 'out', 'vca', 'in'), conn('vca', 'out', 'out', 'in')]
  );

  const result = deleteModule(g, 'vca');

  assert.deepEqual(
    result.modules.map((m) => m.id),
    ['vco', 'out']
  );
  assert.deepEqual(keys(result), ['vco.out->out.in']);
  assertNoDangling(result);
});

test('multi-hop chain bypasses the upstream source to every reachable Output port', () => {
  // vco -> delay -> pan -> out (inL + inR); delete the delay in the middle.
  const g = graph(
    [
      mod('vco', ModuleKind.VCO),
      mod('delay', ModuleKind.DELAY),
      mod('pan', ModuleKind.PAN),
      mod('out', ModuleKind.OUTPUT),
    ],
    [
      conn('vco', 'out', 'delay', 'in'),
      conn('delay', 'out', 'pan', 'in'),
      conn('pan', 'outL', 'out', 'inL'),
      conn('pan', 'outR', 'out', 'inR'),
    ]
  );

  const result = deleteModule(g, 'delay');

  // The downstream pan chain survives, and the oscillator now also reaches the
  // Output directly on both channels.
  assert.deepEqual(keys(result), [
    'pan.outL->out.inL',
    'pan.outR->out.inR',
    'vco.out->out.inL',
    'vco.out->out.inR',
  ]);
  assertNoDangling(result);
});

test('deleting a stereo stage keeps left/right semantics on both Output inputs', () => {
  const g = graph(
    [mod('vco', ModuleKind.VCO), mod('pan', ModuleKind.PAN), mod('out', ModuleKind.OUTPUT)],
    [
      conn('vco', 'out', 'pan', 'in'),
      conn('pan', 'outL', 'out', 'inL'),
      conn('pan', 'outR', 'out', 'inR'),
    ]
  );

  const result = deleteModule(g, 'pan');

  // A mono source reaches both channels rather than collapsing to one.
  assert.deepEqual(keys(result), ['vco.out->out.inL', 'vco.out->out.inR']);
  assertNoDangling(result);
});

test('deleting Atten between source and Output bypasses it', () => {
  const g = graph(
    [mod('lfo', ModuleKind.LFO), mod('atten', ModuleKind.ATTEN), mod('out', ModuleKind.OUTPUT)],
    [conn('lfo', 'out', 'atten', 'in'), conn('atten', 'out', 'out', 'in')]
  );

  const result = deleteModule(g, 'atten');

  assert.deepEqual(keys(result), ['lfo.out->out.in']);
  assertNoDangling(result);
});

test('banana-stacked sources are all bypassed', () => {
  const g = graph(
    [
      mod('a', ModuleKind.VCO),
      mod('b', ModuleKind.LFO),
      mod('vca', ModuleKind.VCA),
      mod('out', ModuleKind.OUTPUT),
    ],
    [conn('a', 'out', 'vca', 'in'), conn('b', 'out', 'vca', 'in'), conn('vca', 'out', 'out', 'in')]
  );

  const result = deleteModule(g, 'vca');

  assert.deepEqual(keys(result), ['a.out->out.in', 'b.out->out.in']);
  assertNoDangling(result);
});

test('a module with no bypassable input only loses its cables', () => {
  // A VCO has no source-input to forward; deleting it must not invent cables.
  const g = graph(
    [mod('vco', ModuleKind.VCO), mod('vca', ModuleKind.VCA), mod('out', ModuleKind.OUTPUT)],
    [conn('vco', 'out', 'vca', 'in'), conn('vca', 'out', 'out', 'in')]
  );

  const result = deleteModule(g, 'vco');

  assert.deepEqual(keys(result), ['vca.out->out.in']);
  assertNoDangling(result);
});

test('a bypassable module with no path to Output produces no dangling cable', () => {
  const g = graph(
    [mod('vco', ModuleKind.VCO), mod('atten', ModuleKind.ATTEN), mod('vca', ModuleKind.VCA)],
    [conn('vco', 'out', 'atten', 'in'), conn('atten', 'out', 'vca', 'in')]
  );

  const result = deleteModule(g, 'atten');

  assert.deepEqual(result.connections, []);
  assertNoDangling(result);
});

test('a modulator feeding only a CV port is not spliced into the Output', () => {
  // lfo -> atten -> vca.cv ; the VCA's audio comes from the VCO and goes to out.
  // Deleting the attenuverter removes a control cable, not an audio path, so it
  // must not route the LFO to the speakers.
  const g = graph(
    [
      mod('vco', ModuleKind.VCO),
      mod('lfo', ModuleKind.LFO),
      mod('atten', ModuleKind.ATTEN),
      mod('vca', ModuleKind.VCA),
      mod('out', ModuleKind.OUTPUT),
    ],
    [
      conn('lfo', 'out', 'atten', 'in'),
      conn('atten', 'out', 'vca', 'cv'),
      conn('vco', 'out', 'vca', 'in'),
      conn('vca', 'out', 'out', 'in'),
    ]
  );

  const result = deleteModule(g, 'atten');

  assert.deepEqual(keys(result), ['vca.out->out.in', 'vco.out->vca.in']);
  assertNoDangling(result);
});

test('multi-hop bypass follows audio inputs but ignores modulation branches', () => {
  // vco -> delay.in ; delay.out -> pan.in ; pan.outL/outR -> out.inL/inR,
  // plus delay.out -> pan.pan (a CV branch that must not become audio).
  const g = graph(
    [
      mod('vco', ModuleKind.VCO),
      mod('delay', ModuleKind.DELAY),
      mod('pan', ModuleKind.PAN),
      mod('out', ModuleKind.OUTPUT),
    ],
    [
      conn('vco', 'out', 'delay', 'in'),
      conn('delay', 'out', 'pan', 'in'),
      conn('delay', 'out', 'pan', 'pan'),
      conn('pan', 'outL', 'out', 'inL'),
      conn('pan', 'outR', 'out', 'inR'),
    ]
  );

  const result = deleteModule(g, 'delay');

  // The delay fed both pan.in (audio) and pan.pan (CV). Only the audio path
  // survives downstream: pan still feeds the Output on both channels, and the
  // bypass adds the source directly to them too. No pan.in source is invented.
  assert.deepEqual(keys(result), [
    'pan.outL->out.inL',
    'pan.outR->out.inR',
    'vco.out->out.inL',
    'vco.out->out.inR',
  ]);
  assert.equal(
    result.connections.some((c) => c.to.id === 'pan' && c.to.port === 'in'),
    false,
    'the deleted delay must not leave a cable into pan.in'
  );
  assertNoDangling(result);
});

test('bypass never duplicates an existing connection', () => {
  const g = graph(
    [mod('vco', ModuleKind.VCO), mod('vca', ModuleKind.VCA), mod('out', ModuleKind.OUTPUT)],
    [
      conn('vco', 'out', 'vca', 'in'),
      conn('vca', 'out', 'out', 'in'),
      conn('vco', 'out', 'out', 'in'), // already patched straight through
    ]
  );

  const result = deleteModule(g, 'vca');

  assert.deepEqual(keys(result), ['vco.out->out.in']);
});

test('feedback loops downstream are traversed once and do not hang', () => {
  const g = graph(
    [mod('vco', ModuleKind.VCO), mod('vca', ModuleKind.VCA), mod('out', ModuleKind.OUTPUT)],
    [
      conn('vco', 'out', 'vca', 'in'),
      conn('vca', 'out', 'vco', 'fm'),
      conn('vca', 'out', 'out', 'in'),
    ]
  );

  const result = deleteModule(g, 'vca');

  assert.deepEqual(keys(result), ['vco.out->out.in']);
  assertNoDangling(result);
});

test('a self-patch through the deleted module is not resurrected', () => {
  const g = graph(
    [mod('vca', ModuleKind.VCA), mod('out', ModuleKind.OUTPUT)],
    [conn('vca', 'out', 'vca', 'in'), conn('vca', 'out', 'out', 'in')]
  );

  const result = deleteModule(g, 'vca');

  assert.deepEqual(result.connections, []);
  assertNoDangling(result);
});

test('deleting an unknown id is a no-op', () => {
  const g = graph([mod('out', ModuleKind.OUTPUT)], []);
  assert.equal(deleteModule(g, 'missing'), g);
});
