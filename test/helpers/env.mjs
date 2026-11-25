/**
 * Test environment setup: installs browser-like globals needed by the visualizer
 * components (requestAnimationFrame, window) and provides helpers to drive frames.
 * Import this module FIRST in every test file, before importing any component.
 */

const rafQueue = new Map();
let rafId = 0;

globalThis.requestAnimationFrame = callback => {
    rafId += 1;
    rafQueue.set(rafId, callback);
    return rafId;
};

globalThis.cancelAnimationFrame = id => {
    rafQueue.delete(id);
};

globalThis.window = globalThis.window ?? { devicePixelRatio: 1 };

/**
 * Runs all currently queued animation frames, `count` times.
 * @param {number} [count=1]  How many frame rounds to execute.
 */
export function stepFrames(count = 1) {

    for (let i = 0; i < count; i += 1) {
        const callbacks = [...rafQueue.values()];
        rafQueue.clear();
        callbacks.forEach(callback => callback(performance.now()));
    }

}

/**
 * Returns the number of currently queued animation frames.
 * @returns {number} The amount of pending animation frames.
 */
export function pendingFrames() {

    return rafQueue.size;

}

/**
 * Lets pending microtasks/promises settle (e.g. the async worker detection).
 * @param {number} [rounds=5]  How many event loop turns to await.
 */
export async function flushAsync(rounds = 5) {

    for (let i = 0; i < rounds; i += 1) await new Promise(resolve => setImmediate(resolve));

}

/**
 * Waits for the given amount of milliseconds (real timers).
 * @param {number} ms  The delay in milliseconds.
 */
export function delay(ms) {

    return new Promise(resolve => setTimeout(resolve, ms));

}
