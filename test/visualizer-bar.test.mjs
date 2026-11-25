import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepFrames, flushAsync, delay } from './helpers/env.mjs';
import { createMockPlayer } from './helpers/mocks.mjs';
import MockWorker from './helpers/MockWorker.mjs';
import MockDomSmith from './helpers/MockDomSmith.mjs';
import { state as workerSupport } from './helpers/MockSupportsWorkerModules.mjs';
import VisualizerBar from '../src/visualizer/bar/VisualizerBar.js';

/**
 * Creates a VisualizerBar with fresh mock state and waits for the async init.
 * @param {Object} [options]         Options.
 * @param {boolean} [options.worker] Whether worker modules are "supported".
 * @param {Object}  [options.config] Config overrides for the component.
 * @returns {Object} The created instances and helpers.
 */
async function setup({ worker = true, config = {} } = {}) {

    workerSupport.supported = worker;
    MockWorker.instances.length = 0;
    MockDomSmith.instances.length = 0;

    const { player, emit, container, audioCtx } = createMockPlayer({ config }),
          viz = new VisualizerBar(player, null, { apiKey: Symbol('api') });

    await flushAsync();

    return { viz, emit, container, audioCtx, dom: MockDomSmith.instances[0], worker: MockWorker.instances[0] };

}

test('worker path: init, resize on activation, render frames, clear on track change', async () => {

    const { viz, emit, audioCtx, worker } = await setup({ worker: true });

    assert.ok(worker, 'a worker must be created when supported');
    assert.ok(worker.messages.some(msg => msg.type === 'init'), 'worker must receive the init message');
    assert.ok(!worker.messages.some(msg => msg.type === 'resize'), 'no resize before the analyser state is active');

    emit('data/ready', { mediaType: 'audio' });
    audioCtx.analysers[0].frequencyValue = 200;
    emit('media/play');
    stepFrames(3);

    assert.ok(worker.messages.some(msg => msg.type === 'resize'), 'resize must be sent once the analyser is active');

    const renders = worker.messages.filter(msg => msg.type === 'render');
    assert.ok(renders.length >= 3, 'frames must be rendered through the worker');
    assert.equal(renders.at(-1).frequencyData.length, 7, 'frequency data must be reduced to the band count');
    assert.ok(renders.at(-1).frequencyData.every(value => value === 200), 'render data must reflect the current signal');

    // track change: old data must be cleared, new data must not contain old values
    audioCtx.analysers[0].frequencyValue = 100;
    emit('data/ready', { mediaType: 'audio' });
    assert.ok(worker.messages.some(msg => msg.type === 'clear'), 'a clear message must be sent on track change');

    stepFrames(2);
    const afterSwitch = worker.messages.filter(msg => msg.type === 'render').at(-1);
    assert.ok(afterSwitch.frequencyData.every(value => value === 100), 'no stale frequency data after a track change');

    viz.destroy();
    assert.ok(worker.terminated, 'worker must be terminated on destroy');

});

test('worker path: resize triggers a repaint with the last data', async () => {

    const { viz, emit, audioCtx, worker } = await setup({ worker: true });

    emit('data/ready', { mediaType: 'audio' });
    audioCtx.analysers[0].frequencyValue = 150;
    emit('media/play');
    stepFrames(2);

    const resizeCount = worker.messages.filter(msg => msg.type === 'resize').length,
          renderCount = worker.messages.filter(msg => msg.type === 'render').length;

    emit('ui/resize');

    assert.equal(worker.messages.filter(msg => msg.type === 'resize').length, resizeCount + 1, 'resize must be forwarded to the worker');
    assert.equal(worker.messages.filter(msg => msg.type === 'render').length, renderCount + 1, 'a repaint must be triggered after resize');

    viz.destroy();

});

test('fallback path: renders on the main thread when workers are unavailable', async () => {

    const { viz, emit, audioCtx, dom } = await setup({ worker: false });

    assert.equal(MockWorker.instances.length, 0, 'no worker must be created in fallback mode');

    emit('data/ready', { mediaType: 'audio' });
    audioCtx.analysers[0].frequencyValue = 200;
    emit('media/play');
    stepFrames(3);

    assert.ok(dom.canvas.drawStats.fill > 0, 'bars must be drawn on the main thread canvas');

    // resize updates the canvas size and triggers a repaint
    dom.canvas.setRect(640, 360);
    const clears = dom.canvas.drawStats.clearRect;
    emit('ui/resize');

    assert.equal(dom.canvas.width, 640, 'canvas width must follow the container size');
    assert.equal(dom.canvas.height, 360, 'canvas height must follow the container size');
    assert.ok(dom.canvas.drawStats.clearRect > clears, 'a repaint must be triggered after resize');

    // track change clears the main thread canvas
    emit('data/ready', { mediaType: 'audio' });
    assert.ok(dom.canvas.drawStats.clearRect > clears + 1, 'canvas must be cleared on track change');

    viz.destroy();

});

test('pause/resume reconnects the render loop instead of freezing on an old frame', async () => {

    const { viz, emit, dom } = await setup({ worker: false, config: { stopDelay: 30 } });

    emit('data/ready', { mediaType: 'audio' });
    emit('media/play');
    stepFrames(2);

    emit('media/pause');
    await delay(60); // let the stop delay expire, loop is now stopped
    const fills = dom.canvas.drawStats.fill;
    stepFrames(3);
    assert.equal(dom.canvas.drawStats.fill, fills, 'no rendering while paused');

    emit('media/play');
    stepFrames(2);
    assert.ok(dom.canvas.drawStats.fill > fills, 'rendering must resume after play');

    viz.destroy();

});

test('destroy during async worker init creates no worker and no callbacks', async () => {

    workerSupport.supported = true;
    MockWorker.instances.length = 0;
    MockDomSmith.instances.length = 0;

    const { player, emit } = createMockPlayer(),
          viz = new VisualizerBar(player, null, { apiKey: Symbol('api') });

    viz.destroy(); // destroy before the async init has finished
    await flushAsync();

    assert.equal(MockWorker.instances.length, 0, 'no worker must be created after destroy');
    assert.doesNotThrow(() => {
        emit('data/ready', { mediaType: 'audio' });
        emit('media/play');
        emit('ui/resize');
        stepFrames(3);
    }, 'no render callbacks may fire after destroy');

});

test('no main-thread fallback after transferControlToOffscreen when worker construction fails', async () => {

    workerSupport.supported = true;
    MockWorker.instances.length = 0;
    MockDomSmith.instances.length = 0;
    MockWorker.failNext = true;

    const { player, emit } = createMockPlayer(),
          viz = new VisualizerBar(player, null, { apiKey: Symbol('api') });

    await flushAsync();

    const { canvas } = MockDomSmith.instances[0];
    assert.ok(canvas.transferred, 'canvas control was transferred before the failure');

    // The mock canvas throws if getContext() is called after the transfer,
    // so any main-thread fallback attempt would fail loudly here.
    assert.doesNotThrow(() => {
        emit('data/ready', { mediaType: 'audio' });
        emit('media/play');
        stepFrames(3);
        emit('ui/resize');
    }, 'rendering must be skipped instead of falling back to the transferred canvas');

    viz.destroy();

});

test('no render callbacks or worker messages after destroy', async () => {

    const { viz, emit, worker } = await setup({ worker: true, config: { stopDelay: 10 } });

    emit('data/ready', { mediaType: 'audio' });
    emit('media/play');
    stepFrames(2);
    viz.destroy();

    const messageCount = worker.messages.length;

    stepFrames(5);
    await delay(30); // let any pending stop-delay timer expire
    stepFrames(5);
    emit('media/play');
    emit('ui/resize');
    stepFrames(5);

    assert.equal(worker.messages.length, messageCount, 'no messages may be posted to the terminated worker');

});

test('resize is safely skipped while the container has no audio analyser state', async () => {

    const { viz, emit, dom } = await setup({ worker: false });

    assert.doesNotThrow(() => emit('ui/resize'), 'resize without analyser state must not throw');
    assert.equal(dom.canvas.width, 0, 'canvas size must stay untouched');
    assert.equal(dom.canvas.drawStats.clearRect, 0, 'no repaint without analyser state');

    viz.destroy();

});
