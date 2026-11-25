import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepFrames, delay } from './helpers/env.mjs';
import { createMockPlayer } from './helpers/mocks.mjs';
import AnalyserAudio from '../src/visualizer/AnalyserAudio.js';

/**
 * Test subclass which counts loop iterations.
 */
class TestAnalyser extends AnalyserAudio {

    frames = 0;

    analyseLoop() {

        this.frames += 1;
        return super.analyseLoop();

    }

}

test('track change resets frequency/waveform data and smoothing state', () => {

    const { player, emit, audioCtx } = createMockPlayer(),
          analyser = new TestAnalyser(player, { channels: 1, fftSize: 32, smoothingTime: 0.8 }, Symbol('api'));

    emit('data/ready', { mediaType: 'audio' });
    audioCtx.analysers[0].frequencyValue = 200;
    emit('media/play');
    stepFrames(3);

    const { frequencyData, waveformData } = analyser.analyseLoop();

    assert.ok(frequencyData[0].every(value => value === 200), 'frequency data should reflect the loud signal');

    // simulate a track change
    audioCtx.analysers[0].frequencyValue = 0;
    emit('data/ready', { mediaType: 'audio' });

    assert.ok(frequencyData[0].every(value => value === 0), 'frequency data must be cleared on track change');
    assert.ok(waveformData[0].every(value => value === 128), 'waveform data must be reset to the silence midpoint');
    assert.equal(audioCtx.analysers[0].smoothingTimeConstant, 0.8, 'smoothing constant must be restored after reset');

    analyser.destroy();

});

test('pause stops the loop after the delay, resume restarts it', async () => {

    const { player, emit } = createMockPlayer(),
          analyser = new TestAnalyser(player, { channels: 1, fftSize: 32, stopDelay: 30 }, Symbol('api'));

    emit('data/ready', { mediaType: 'audio' });
    emit('media/play');
    stepFrames(2);
    assert.ok(analyser.frames >= 2, 'loop should be running after play');

    emit('media/pause');
    stepFrames(2);
    const framesBeforeStop = analyser.frames;
    assert.ok(framesBeforeStop > 0, 'loop keeps cooling down during the stop delay');

    await delay(60); // let the stop delay expire
    stepFrames(3);
    assert.equal(analyser.frames, framesBeforeStop, 'loop must be stopped after the stop delay');

    emit('media/play');
    stepFrames(2);
    assert.ok(analyser.frames > framesBeforeStop, 'loop must resume after pause/play');

    analyser.destroy();

});

test('quick pause/resume within the stop delay never stops the loop', () => {

    const { player, emit } = createMockPlayer(),
          analyser = new TestAnalyser(player, { channels: 1, fftSize: 32, stopDelay: 1000 }, Symbol('api'));

    emit('data/ready', { mediaType: 'audio' });
    emit('media/play');
    stepFrames(1);
    emit('media/pause');
    emit('media/play'); // resume before the stop delay expires

    const frames = analyser.frames;
    stepFrames(3);

    assert.equal(analyser.frames, frames + 3, 'loop must continue seamlessly across a quick pause/resume');

    analyser.destroy();

});

test('no loop callbacks after destroy', async () => {

    const { player, emit } = createMockPlayer(),
          analyser = new TestAnalyser(player, { channels: 1, fftSize: 32, stopDelay: 10 }, Symbol('api'));

    emit('data/ready', { mediaType: 'audio' });
    emit('media/play');
    stepFrames(2);
    analyser.destroy();

    const frames = analyser.frames;

    stepFrames(5);
    await delay(30);
    stepFrames(5);
    assert.doesNotThrow(() => emit('media/play'));
    stepFrames(5);

    assert.equal(analyser.frames, frames, 'no analyse callbacks must fire after destroy');

});
