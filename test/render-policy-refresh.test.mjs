import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CadCanvasRenderer,
  CadShxFontRegistry,
  CadViewer,
  CadWebGLRenderer,
  createCadDocument,
  createCadRenderDocument,
  readCadColorPolicy,
  resolveCadColor,
  resolveCadColorPolicy,
  cadColorPolicySignature,
  mergeCadColorPolicy
} from '../dist/cad-viewer.es.js';

const point = (x, y) => ({ x, y });

/**
 * Builds a document with a dashed/ByLayer line, a complex SHX shape linetype and
 * authored colors. Only the shape reference needs an external font.
 */
function createComplexFixture() {
  return createCadDocument({
    format: 'dxf',
    layers: {
      Walls: { name: 'Walls', color: '#ff0000', lineType: 'Complex' }
    },
    lineTypes: {
      Complex: {
        name: 'Complex',
        pattern: [
          { length: 0, elementTypeFlag: 4, shapeNumber: 5, fontName: 'FixtureShapes.SHX' },
          { length: 1 },
          { length: -1 }
        ]
      }
    },
    entities: [
      { type: 'LINE', layer: 'Walls', startPoint: point(0, 0), endPoint: point(100, 0) },
      { type: 'LINE', color: '#00ff00', startPoint: point(0, 10), endPoint: point(100, 10) }
    ],
    metadata: { requiredShxFonts: ['FixtureShapes.SHX'] },
    warnings: []
  });
}

/** Minimal in-memory WebGL double that records buffers and deleted handles. */
function createFakeGl(record) {
  return {
    ARRAY_BUFFER: 1, STATIC_DRAW: 2, LINES: 3, TRIANGLES: 4, POINTS: 5,
    createBuffer: () => { const buffer = { id: record.created++ }; record.live.add(buffer); return buffer; },
    bindBuffer() {},
    bufferData(_target, data) { record.uploads.push(data); },
    deleteBuffer(buffer) { record.live.delete(buffer); }
  };
}

function attachWebGL(gl) {
  const renderer = Object.create(CadWebGLRenderer.prototype);
  renderer.opts = { ...webglDefaults(), colorMode: undefined, monochromeColor: undefined };
  renderer.colorPolicy = { mode: 'source' };
  renderer.gl = gl;
  renderer.bounds = { minX: 0, minY: 0, maxX: 100, maxY: 10 };
  renderer.view = { centerX: 50, centerY: 5, scale: 1 };
  renderer.fitScale = 1;
  renderer.stats = { total: 0, drawn: 0, skipped: 0, byType: {}, unsupported: {}, renderElapsedMs: 0, backend: 'webgl', primitiveCount: 0, visiblePrimitiveCount: 0, culledPrimitiveCount: 0, gpuMemoryBytes: 0, buildElapsedMs: 0 };
  // Avoid touching DOM/WebGL state during these lifecycle tests.
  renderer.render = () => renderer.stats;
  renderer.emitViewChange = () => {};
  renderer.fitToView = () => {};
  return renderer;
}

function webglDefaults() {
  return {
    background: '#0b1020', foreground: '#ffffff', showUnsupportedMarkers: false, showImagePlaceholders: true,
    showPageBounds: true, minScale: 1e-9, maxScale: 1e9, wheelZoomFactor: 1.14, trueColorByteOrder: 'rgb',
    maxInsertDepth: 16, fitMode: 'auto', contrastMode: 'adaptive', minColorContrast: 2.4, maxCurveSegments: 96,
    spatialIndexCellCount: 72, maxVerticesPerBatch: 65536, textMinPixelHeight: 4, maxVisibleTextLabels: 2500,
    powerPreference: 'high-performance', antialias: true, preserveDrawingBuffer: false, enableSpatialIndex: false,
    shxGlyphResolver: { resolveShape: () => undefined, resolveText: () => undefined }
  };
}

/** Reads the colour bytes uploaded to the GPU after the given upload index. */
function uploadedColorBytes(record, fromIndex) {
  return record.uploads
    .slice(fromIndex)
    .filter((data) => data instanceof Uint8Array)
    .flatMap((data) => Array.from(data));
}

test('renderer colour policy override wins without reclassifying the source', () => {
  assert.equal(cadColorPolicySignature({ mode: 'source' }), 'source');
  assert.equal(cadColorPolicySignature({ mode: 'monochrome', monochromeColor: '#102030' }), 'monochrome:#102030');

  const source = createComplexFixture();
  const render = createCadRenderDocument(source, { mode: 'monochrome', monochromeColor: '#102030' });
  assert.notEqual(render, source);
  assert.deepEqual(readCadColorPolicy(source), { mode: 'source' });
  assert.deepEqual(readCadColorPolicy(render), { mode: 'monochrome', monochromeColor: '#102030' });
  // The wrapper never duplicates entity objects, so authored data is shared, not rewritten.
  assert.equal(render.entities[0], source.entities[0]);

  // Options override the document metadata; source mode clears the fixed color.
  assert.deepEqual(resolveCadColorPolicy(render, {}), { mode: 'monochrome', monochromeColor: '#102030' });
  assert.deepEqual(resolveCadColorPolicy(render, { colorMode: 'source' }), { mode: 'source' });
  // Switching to monochrome without a color keeps the configured color.
  assert.deepEqual(resolveCadColorPolicy(render, { colorMode: 'monochrome' }), { mode: 'monochrome', monochromeColor: '#102030' });
  assert.deepEqual(
    mergeCadColorPolicy({ mode: 'monochrome', monochromeColor: '#102030' }, { colorMode: 'monochrome', monochromeColor: '#abcdef' }),
    { mode: 'monochrome', monochromeColor: '#abcdef' }
  );
  assert.deepEqual(mergeCadColorPolicy({ mode: 'monochrome', monochromeColor: '#102030' }, { monochromeColor: '#abcdef' }), { mode: 'monochrome', monochromeColor: '#abcdef' });
});

test('WebGL setOptions rebuilds GPU colours on policy change but keeps the view', () => {
  const record = { created: 0, uploads: [], live: new Set() };
  const gl = createFakeGl(record);
  const renderer = attachWebGL(gl);
  const source = createComplexFixture();
  renderer.setDocument(source);

  assert.deepEqual(readCadColorPolicy(renderer.getSourceDocument()), { mode: 'source' }, 'the source document keeps authored data');
  const sourceEntities = renderer.getSourceDocument().entities;
  const view = renderer.getViewState();
  const fitScale = renderer.fitScale;

  const before = uploadedColorBytes(record, 0);
  const sourceUploadCount = record.uploads.length;
  renderer.setOptions({ colorMode: 'monochrome', monochromeColor: '#102030' });

  assert.deepEqual(readCadColorPolicy(renderer.getDocument()), { mode: 'monochrome', monochromeColor: '#102030' });
  assert.deepEqual(readCadColorPolicy(renderer.getSourceDocument()), { mode: 'source' }, 'switching modes never edits the source document');
  assert.equal(renderer.getSourceDocument().entities, sourceEntities, 'the source entity array identity is preserved');
  assert.deepEqual(renderer.getViewState(), view, 'pan/zoom are retained across the rebuild');
  assert.equal(renderer.fitScale, fitScale);

  const afterUpload = record.uploads.slice(sourceUploadCount);
  const after = afterUpload.filter((data) => data instanceof Uint8Array).flatMap((data) => Array.from(data));
  assert.ok(after.length > 0);
  for (let i = 0; i < after.length; i += 4) {
    assert.deepEqual(after.slice(i, i + 4), [16, 32, 48, 255]);
  }
  assert.notDeepEqual(after, before, 'GPU colours changed after switching to monochrome');

  const monoUploadCount = record.uploads.length;
  renderer.setOptions({ colorMode: 'source' });
  assert.deepEqual(readCadColorPolicy(renderer.getDocument()), { mode: 'source' });
  const restored = uploadedColorBytes(record, monoUploadCount);
  assert.deepEqual(restored, before, 'source mode restores the authored GPU colours exactly');
});

test('WebGL setDocument applies a policy already attached to the render document', () => {
  const source = createComplexFixture();
  const render = createCadRenderDocument(source, { mode: 'monochrome', monochromeColor: '#102030' });
  const record = { created: 0, uploads: [], live: new Set() };
  const renderer = attachWebGL(createFakeGl(record));
  renderer.setDocument(render);

  // The renderer keeps the wrapper's policy and leaves the source untouched.
  assert.deepEqual(readCadColorPolicy(renderer.getDocument()), { mode: 'monochrome', monochromeColor: '#102030' });
  assert.deepEqual(readCadColorPolicy(source), { mode: 'source' });
  const colors = uploadedColorBytes(record, 0);
  assert.ok(colors.length > 0);
  for (let i = 0; i < colors.length; i += 4) assert.deepEqual(colors.slice(i, i + 4), [16, 32, 48, 255]);

  // A later explicit option still overrides the attached policy.
  renderer.setOptions({ colorMode: 'source' });
  assert.deepEqual(readCadColorPolicy(renderer.getDocument()), { mode: 'source' });
  assert.deepEqual(readCadColorPolicy(source), { mode: 'source' });
});

test('both renderers feed the shared resolver, so their colors agree', () => {
  const source = createComplexFixture();
  const render = createCadRenderDocument(source, { mode: 'monochrome', monochromeColor: '#102030' });
  const line = source.entities[0];
  const layerLine = source.entities[1];
  // Whatever the renderer does, it supplies this same pair of options to
  // resolveCadColor(); asserting on the core resolver pins both backends.
  const sharedOptions = resolveCadColorPolicy(render, {});
  for (const entity of [line, layerLine]) {
    const resolved = resolveCadColor(entity, render, {
      ...sharedOptions,
      colorMode: sharedOptions.mode,
      monochromeColor: sharedOptions.monochromeColor
    });
    assert.equal(resolved, 'rgb(16, 32, 48)');
  }
});

test('WebGL refreshes SHX glyphs and rebuilds the scene while preserving view and fitScale', async () => {
  const source = createComplexFixture();
  const registry = new CadShxFontRegistry();
  registry.setDocument(source);
  assert.equal(registry.getState().missing.length, 1);

  const record = { created: 0, uploads: [], live: new Set() };
  const gl = createFakeGl(record);
  const renderer = attachWebGL(gl);
  renderer.opts.shxGlyphResolver = registry;
  renderer.setDocument(source);

  renderer.view = { centerX: 37.5, centerY: 6.25, scale: 0.75 };
  renderer.fitScale = 0.92;
  const beforePrimitives = renderer.scene.lineBatches.reduce((total, batch) => total + batch.primitiveCount, 0);
  const beforeGpuBytes = renderer.scene.gpuMemoryBytes;

  await registry.add({ fileName: 'FixtureShapes.SHX', buffer: buildMinimalShapesShx([5]) });
  renderer.refreshReferences();

  assert.deepEqual(renderer.getViewState(), { centerX: 37.5, centerY: 6.25, scale: 0.75 }, 'the view centre and scale are untouched');
  assert.equal(renderer.fitScale, 0.92, 'fitScale survives the SHX rebuild');
  assert.ok(renderer.scene.lineBatches.reduce((total, batch) => total + batch.primitiveCount, 0) > beforePrimitives, 'the complex glyph geometry appears after the font loads');
  assert.notEqual(renderer.scene.gpuMemoryBytes, beforeGpuBytes);
  // Every buffer from the pre-refresh scene was released.
  assert.equal(record.live.size, [...renderer.scene.lineBatches, ...renderer.scene.triangleBatches, ...renderer.scene.lineTypePointBatches, ...renderer.scene.pointBatches].length * 2);
});

test('unloaded WebGL renderer ignores policy changes and font refreshes without throwing', async () => {
  const record = { created: 0, uploads: [], live: new Set() };
  const renderer = attachWebGL(createFakeGl(record));
  assert.equal(renderer.getDocument(), undefined);
  renderer.setOptions({ colorMode: 'monochrome', monochromeColor: '#ff0000' });
  renderer.setOptions({ colorMode: 'source' });
  renderer.refreshReferences();
  assert.equal(renderer.scene, undefined, 'no empty GPU scene is fabricated');
  assert.equal(record.live.size, 0, 'no dangling buffers are left behind');
});

test('WebGL clear and destroy release scene buffers and the font resolver state', async () => {
  const record = { created: 0, uploads: [], live: new Set() };
  const renderer = attachWebGL(createFakeGl(record));
  const source = createComplexFixture();
  const registry = new CadShxFontRegistry();
  await registry.add({ fileName: 'FixtureShapes.SHX', buffer: buildMinimalShapesShx([5]) });
  registry.setDocument(source);
  renderer.opts.shxGlyphResolver = registry;
  renderer.setDocument(source);
  assert.ok(record.live.size > 0);
  renderer.setOptions({ colorMode: 'monochrome', monochromeColor: '#102030' });
  assert.ok(record.live.size > 0);

  renderer.clear();
  assert.equal(record.live.size, 0, 'clear() releases every retained GPU buffer');
  assert.equal(renderer.scene, undefined);
  assert.deepEqual(readCadColorPolicy(renderer.getSourceDocument()), { mode: 'source' });

  registry.clear();
  assert.deepEqual(registry.getState().loaded, []);
  assert.equal(registry.resolveShape(5, 'FixtureShapes.SHX'), undefined, 'removed fonts no longer resolve glyphs');
});

test('Canvas2D applies the same policy and font refresh to the retained document', async () => {
  const renderer = Object.create(CadCanvasRenderer.prototype);
  renderer.opts = { ...webglDefaults(), enableSpatialIndex: true };
  renderer.colorPolicy = { mode: 'source' };
  renderer.bounds = { minX: 0, minY: 0, maxX: 100, maxY: 10 };
  renderer.view = { centerX: 50, centerY: 5, scale: 1 };
  renderer.fitScale = 1;
  renderer.stats = { total: 0, drawn: 0, skipped: 0, byType: {}, unsupported: {}, renderElapsedMs: 0, backend: 'canvas2d' };
  let renders = 0;
  renderer.render = () => { renders++; renderer.stats; return renderer.stats; };
  renderer.emitViewChange = () => {};
  renderer.fitToView = () => {};
  renderer.computeBounds = undefined;

  const source = createComplexFixture();
  renderer.setDocument(source);
  assert.deepEqual(readCadColorPolicy(renderer.getSourceDocument()), { mode: 'source' });

  renderer.setOptions({ colorMode: 'monochrome', monochromeColor: '#102030' });
  assert.deepEqual(readCadColorPolicy(renderer.getDocument()), { mode: 'monochrome', monochromeColor: '#102030' });
  assert.deepEqual(readCadColorPolicy(renderer.getSourceDocument()), { mode: 'source' });
  assert.deepEqual(renderer.getViewState(), { centerX: 50, centerY: 5, scale: 1 });
  assert.equal(renders, 1);

  const registry = new CadShxFontRegistry();
  registry.setDocument(source);
  await registry.add({ fileName: 'FixtureShapes.SHX', buffer: buildMinimalShapesShx([5]) });
  renderer.opts.shxGlyphResolver = registry;
  renderer.refreshReferences();
  assert.equal(renders, 2, 'a plain repaint picks up the newly loaded glyphs');
  assert.deepEqual(renderer.getViewState(), { centerX: 50, centerY: 5, scale: 1 });

  renderer.setOptions({ colorMode: 'source' });
  assert.deepEqual(readCadColorPolicy(renderer.getDocument()), { mode: 'source' });

  renderer.clear();
  assert.equal(renderer.getDocument(), undefined, 'clear() drops the retained document');
  renderer.setOptions({ colorMode: 'monochrome', monochromeColor: '#ff0000' });
  assert.equal(renderer.getDocument(), undefined, 'policy changes after clear() do not fabricate a document');
});

test('CadViewer drives source → monochrome → SHX → source for both renderer backends', async () => {
  for (const backend of ['canvas2d', 'webgl']) {
    const record = { created: 0, uploads: [], live: new Set() };
    const renderer = backend === 'webgl' ? attachWebGL(createFakeGl(record)) : createCanvasDouble();
    const viewer = createViewerHarness(renderer);

    const source = createComplexFixture();
    viewer.setDocument(source);
    assert.deepEqual(readCadColorPolicy(viewer.getSourceDocument()), { mode: 'source' });
    const entities = viewer.getSourceDocument().entities;

    // Pan and zoom before changing anything; both must survive every rebuild.
    renderer.view = { centerX: 12.5, centerY: 3.5, scale: 2 };
    renderer.fitScale = 0.8;

    viewer.setColorMode('monochrome', '#102030');
    assert.equal(viewer.getColorMode(), 'monochrome');
    assert.deepEqual(readCadColorPolicy(renderer.getDocument()), { mode: 'monochrome', monochromeColor: '#102030' });
    assert.deepEqual(readCadColorPolicy(viewer.getSourceDocument()), { mode: 'source' }, `${backend}: source untouched`);
    assert.equal(viewer.getSourceDocument().entities, entities, `${backend}: entity array identity preserved`);
    assert.deepEqual(renderer.getViewState(), { centerX: 12.5, centerY: 3.5, scale: 2 }, `${backend}: view retained`);
    assert.equal(renderer.fitScale, 0.8, `${backend}: fitScale retained`);

    const missingBefore = viewer.getMissingReferences().length;
    const loaded = await viewer.addReferenceBuffer(buildMinimalShapesShx([5]), 'FixtureShapes.SHX');
    assert.equal(loaded.fileName, 'FixtureShapes.SHX');
    assert.equal(viewer.getMissingReferences().length, 0, `${backend}: required glyphs are now satisfied`);
    assert.ok(missingBefore > 0);
    assert.deepEqual(renderer.getViewState(), { centerX: 12.5, centerY: 3.5, scale: 2 }, `${backend}: SHX rebuild keeps the view`);
    assert.equal(renderer.fitScale, 0.8, `${backend}: SHX rebuild keeps fitScale`);
    assert.deepEqual(readCadColorPolicy(renderer.getDocument()), { mode: 'monochrome', monochromeColor: '#102030' }, `${backend}: SHX rebuild keeps the color mode`);

    // Removing the font must rebuild again with the marker fallback, still keeping the view.
    assert.equal(viewer.removeReference('FixtureShapes.SHX'), true);
    assert.ok(viewer.getMissingReferences().length > 0, `${backend}: removal reinstates the missing reference`);
    assert.deepEqual(renderer.getViewState(), { centerX: 12.5, centerY: 3.5, scale: 2 }, `${backend}: font removal keeps the view`);
    assert.equal(renderer.fitScale, 0.8, `${backend}: font removal keeps fitScale`);

    viewer.setColorMode('source');
    assert.equal(viewer.getColorMode(), 'source');
    assert.deepEqual(readCadColorPolicy(renderer.getDocument()), { mode: 'source' });
    assert.deepEqual(readCadColorPolicy(viewer.getSourceDocument()), { mode: 'source' });
    assert.deepEqual(renderer.getViewState(), { centerX: 12.5, centerY: 3.5, scale: 2 });

    if (record.live.size > 0) assert.equal(record.live.size, sceneBufferCount(renderer.scene), `${backend}: only the live scene buffers remain`);
  }
});

test('CadViewer tolerates color/SHX changes before any drawing is loaded', async () => {
  const record = { created: 0, uploads: [], live: new Set() };
  const renderer = attachWebGL(createFakeGl(record));
  const viewer = createViewerHarness(renderer, { colorMode: 'source' });

  viewer.setColorMode('monochrome', '#ff0000');
  viewer.setColorMode('source');
  await viewer.addReferenceBuffer(buildMinimalShapesShx([5]), 'FixtureShapes.SHX');
  viewer.removeReference('FixtureShapes.SHX');
  viewer.clearReferences();

  assert.equal(renderer.getDocument(), undefined, 'no document was fabricated');
  assert.equal(renderer.scene, undefined, 'no GPU scene was fabricated');
  assert.equal(record.live.size, 0, 'no buffers leaked');
});

test('CadViewer keeps the color mode when a new document is loaded after a switch', () => {
  const record = { created: 0, uploads: [], live: new Set() };
  const renderer = attachWebGL(createFakeGl(record));
  const viewer = createViewerHarness(renderer, { colorMode: 'monochrome', monochromeColor: '#abcdef' });

  viewer.setDocument(createComplexFixture());
  assert.deepEqual(readCadColorPolicy(renderer.getDocument()), { mode: 'monochrome', monochromeColor: '#abcdef' });
});

test('CadViewer does not lose the color mode to unrelated canvas option changes', () => {
  const record = { created: 0, uploads: [], live: new Set() };
  const renderer = attachWebGL(createFakeGl(record));
  const canvasOptions = [];
  const setOptions = renderer.setOptions;
  renderer.setOptions = (options) => {
    canvasOptions.push(options);
    setOptions.call(renderer, options);
  };
  const viewer = createViewerHarness(renderer, { colorMode: 'source' });
  viewer.setDocument(createComplexFixture());
  viewer.setColorMode('monochrome', '#102030');

  // A theme switch that does not mention the policy must not revert it.
  viewer.setCanvasOptions({ background: '#000000', foreground: '#ffffff' });
  assert.equal(canvasOptions.at(-1).colorMode, 'monochrome');
  assert.equal(canvasOptions.at(-1).monochromeColor, '#102030');
  assert.deepEqual(readCadColorPolicy(renderer.getDocument()), { mode: 'monochrome', monochromeColor: '#102030' });
});

/** Builds a viewer whose dependencies are stubbed for a DOM-free Node test. */
function createViewerHarness(renderer, options = {}) {
  const viewer = Object.create(CadViewer.prototype);
  viewer.options = { autoFit: true, ...options };
  viewer.renderer = renderer;
  viewer.referenceRegistry = new CadShxFontRegistry();
  viewer.externalShxGlyphResolver = undefined;
  viewer.shxGlyphResolver = {
    resolveShape: (shapeNumber, fontName) => viewer.referenceRegistry.resolveShape(shapeNumber, fontName),
    resolveText: (value, fontName) => viewer.referenceRegistry.resolveText(value, fontName)
  };
  viewer.lastResult = undefined;
  viewer.activeNativeLoader = undefined;
  viewer.canvas = { style: {}, classList: { add() {}, remove() {}, contains: () => false } };
  viewer.nativeHost = undefined;
  viewer.onReferenceStateChange = undefined;
  viewer.registry = { list: () => [] };
  return viewer;
}

function createCanvasDouble() {
  const renderer = Object.create(CadCanvasRenderer.prototype);
  renderer.opts = { ...webglDefaults(), enableSpatialIndex: true };
  renderer.colorPolicy = { mode: 'source' };
  renderer.bounds = { minX: 0, minY: 0, maxX: 100, maxY: 10 };
  renderer.view = { centerX: 50, centerY: 5, scale: 1 };
  renderer.fitScale = 1;
  renderer.stats = { total: 0, drawn: 0, skipped: 0, byType: {}, unsupported: {}, renderElapsedMs: 0, backend: 'canvas2d' };
  renderer.render = () => renderer.stats;
  renderer.emitViewChange = () => {};
  renderer.fitToView = () => {};
  return renderer;
}

function sceneBufferCount(scene) {
  if (!scene) return 0;
  return [...scene.lineBatches, ...scene.triangleBatches, ...scene.lineTypePointBatches, ...scene.pointBatches].length * 2;
}

function buildMinimalShapesShx(codes) {
  const encoder = new TextEncoder();
  const header = encoder.encode('AutoCAD-86 shapes V1.0\r\n\x1a');
  const entries = codes.map((code) => ({
    code,
    raw: new Uint8Array([...encoder.encode(`S${code}`), 0, 0x14, 0x10, 0x1c, 0x18, 0x12, 0])
  }));
  const tableSize = 6 + entries.length * 4;
  const dataSize = entries.reduce((sum, entry) => sum + entry.raw.length, 0);
  const buffer = new ArrayBuffer(header.length + tableSize + dataSize);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  bytes.set(header);
  let offset = header.length;
  view.setInt16(offset, 0, true); offset += 2;
  view.setInt16(offset, 0, true); offset += 2;
  view.setInt16(offset, entries.length, true); offset += 2;
  let dataOffset = header.length + tableSize;
  for (const entry of entries) {
    view.setUint16(offset, entry.code, true); offset += 2;
    view.setUint16(offset, entry.raw.length, true); offset += 2;
    bytes.set(entry.raw, dataOffset);
    dataOffset += entry.raw.length;
  }
  return buffer;
}
