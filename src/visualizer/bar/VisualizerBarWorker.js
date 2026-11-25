/**
 * This worker processes frequency data for the VisualizerFrequency component.
 * It receives messages from the main thread to initialize the worker,
 * resize the offscreen canvas, render frequency data or clear the canvas (e.g. on track change).
 * @exports module:src/visualizer/bar/VisualizerBarWorker
 * @requires lib/util/math
 * @requires src/visualizer/bar/VisualizerBarRender
 * @author   Frank Kudermann - alphanull
 * @version  1.0.0
 * @license  MIT
 */

let renderCanvas, ctx, conf;

import render from './VisualizerBarRender.js';

/**
 * Global message handler for the worker.
 * Processes messages from the main thread based on the message type.
 * @param {MessageEvent} event  The message event from the main thread.
 * @listens MessageEvent
 */
onmessage = event => {

    const { type, frequencyData, offscreenCanvas, config, width, height } = event.data;

    switch (type) {
        case 'init':
            renderCanvas = offscreenCanvas;
            ctx = renderCanvas.getContext('2d');
            conf = config;
            break;
        case 'resize':
            if (!renderCanvas) break;
            renderCanvas.width = width;
            renderCanvas.height = height;
            break;
        case 'render':
            if (!ctx) break;
            render(frequencyData, renderCanvas, ctx, conf);
            break;
        case 'clear':
            if (!ctx) break;
            ctx.clearRect(0, 0, renderCanvas.width, renderCanvas.height);
            break;
        default:
            // eslint-disable-next-line no-console
            console.warn('[VisWorker] unknown event type', event.type, event);
    }
};
