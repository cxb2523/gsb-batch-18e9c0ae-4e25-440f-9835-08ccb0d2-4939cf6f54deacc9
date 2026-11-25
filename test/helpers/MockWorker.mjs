/**
 * Stand-in for the inlined worker module (`?worker&inline` imports).
 * Records all received messages and simulates termination.
 */
export default class MockWorker {

    /**
     * All created instances, for test access.
     * @type {MockWorker[]}
     */
    static instances = [];

    /**
     * If true, the next construction throws (simulates a failing worker setup).
     * @type {boolean}
     */
    static failNext = false;

    constructor() {

        if (MockWorker.failNext) {
            MockWorker.failNext = false;
            throw new Error('[MockWorker] construction failed (simulated)');
        }

        this.messages = [];
        this.terminated = false;
        MockWorker.instances.push(this);

    }

    /**
     * Records a message. Throws if the worker has been terminated,
     * so tests fail loudly on use-after-terminate.
     * @param {Object} message  The message to post.
     */
    postMessage(message) {

        if (this.terminated) throw new Error('[MockWorker] postMessage() on terminated worker');
        this.messages.push(message);

    }

    /**
     * Terminates the worker.
     */
    terminate() {

        this.terminated = true;

    }

}
