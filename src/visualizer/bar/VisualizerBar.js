import AnalyserAudio from './../AnalyserAudio.js';
import DomSmith from '../../../lib/dom/DomSmith';
import render from './VisualizerBarRender.js';
import supportsWorkerModules from '../../../lib/util/supportsWorkerModules.js';
import BarWorker from './VisualizerBarWorker.js?worker&inline';

/**
 * The VisualizerBar component displays a real-time mirrored bar visualization of audio signals.
 * It extends the base AnalyserAudio class and renders a symmetric set of vertical bars based on frequency data using an HTML5 Canvas element.
 * This component is useful for compact audio-only UIs or background visualizations.
 * @exports module:src/visualizer/bar/VisualizerBar
 * @requires lib/dom/DomSmith
 * @requires lib/util/supportsWorkerModules
 * @requires src/visualizer/bar/VisualizerBarRender
 * @requires src/visualizer/bar/VisualizerBarWorker
 * @augments module:src/visualizer/AnalyserAudio
 * @author   Frank Kudermann - alphanull
 * @version  1.0.0
 * @license  MIT
 */
export default class VisualizerBar extends AnalyserAudio {

    /**
     * Configuration options for the VisualizerBar component, seperated from the superclass config.
     * @property {number} [bands=7]     Number of EQ bands to displayed as mirrored bars.
     * @property {number} [channels=1]  Number of audio channels.
     * @property {number} [hiPass=0]    High-pass filter value.
     * @property {number} [loPass=0]    Low-pass filter value.
     * @property {number} [fftSize=32]  FFT size specific to VisualizerBar.
     */
    #config;

    /**
     * Reference to the main player instance.
     * @type {module:src/core/Player}
     */
    #player;

    /**
     * Holds tokens of subscriptions (for this subclass only).
     * @type {number[]}
     */
    #subscriptions;

    /**
     * Secret key only known to the player instance and initialized components.
     * Used to be able to restrict access to API methods in conjunction with secure mode.
     * @type {symbol}
     */
    #apiKey;

    /**
     * DOM elements for the visualizer.
     * @type {module:lib/dom/DomSmith}
     */
    #dom;

    /**
     * Canvas element and its drawing context.
     * @property {HTMLCanvasElement}        ele  Canvas element.
     * @property {CanvasRenderingContext2D} ctx  2D drawing context.
     */
    #canvas;

    /**
     * Flag indicating if the visualizer should use a worker.
     * @type {boolean}
     */
    #useWorker = false;

    /**
     * Optional worker which renders the canvas offscreen.
     * @type {module:src/visualizer/bar/VisualizerBarWorker}
     */
    #worker;

    /**
     * Flag indicating if the render path (worker or main thread) has finished initializing.
     * Rendering and resizing are skipped until this is true.
     * @type {boolean}
     */
    #isReady = false;

    /**
     * Flag indicating if this component has been destroyed.
     * Guards the async worker init and all render callbacks against use-after-destroy.
     * @type {boolean}
     */
    #destroyed = false;

    /**
     * The most recently rendered (reduced) frequency data, kept so the canvas can be
     * repainted after a resize (resizing a canvas clears its contents).
     * @type {number[]|null}
     */
    #lastData = null;

    /**
     * Creates an instance of the VisualizerBar component.
     * @param {module:src/core/Player}     player            Reference to the main player instance.
     * @param {module:src/util/AudioChain} parent            Reference to the parent instance.
     * @param {Object}                     [options]         Additional options.
     * @param {symbol}                     [options.apiKey]  Token for extended access to the player API.
     */
    constructor(player, parent, { apiKey }) {

        const config = player.initConfig('visualizerBar', {
            bands: 7,
            channels: 2,
            hiPass: 0,
            loPass: 0,
            fftSize: 32
        });

        if (super(player, config, apiKey)[0] === false) return [false];

        this.#config = config;
        this.#player = player;
        this.#apiKey = apiKey;

        this.#dom = new DomSmith({
            _ref: 'wrapper',
            className: 'vip-visualizer vip-visualizer-audio vip-visualizer-bar',
            ariaHidden: true,
            _nodes: [{
                _ref: 'canvas',
                _tag: 'canvas',
                className: 'vip-visualizer-audio-canvas'
            }]
        }, player.dom.getElement(apiKey));

        this.#subscriptions = [
            player.subscribe('ui/resize', this.#resize)
        ];

        this.#initWorker();

    }

    /**
     * Initializes the worker for offloading rendering, if supported.
     * If workers are not supported, sets up local canvas rendering.
     * Since the support detection is asynchronous, the component may have been
     * destroyed in the meantime - in this case, initialization is aborted silently.
     */
    async #initWorker() {

        const { canvas } = this.#dom,
              workerSupported = await supportsWorkerModules();

        if (this.#destroyed) return; // destroyed while the async detection was pending

        if (workerSupported && typeof canvas.transferControlToOffscreen === 'function') {

            const offscreen = canvas.transferControlToOffscreen();

            try {
                this.#worker = new BarWorker();
                this.#worker.postMessage({ type: 'init', offscreenCanvas: offscreen, config: this.#config }, [offscreen]);
                this.#useWorker = true;
            } catch (error) {
                // The canvas control has already been transferred to the offscreen canvas, so falling back
                // to main-thread rendering is not possible anymore - disable rendering instead of drawing twice.
                // eslint-disable-next-line no-console
                console.warn('[VisualizerBar] Worker initialization failed, rendering is disabled.', error);
                this.#worker = null;
                return;
            }

        } else {
            this.#canvas = {
                ele: canvas,
                ctx: canvas.getContext('2d')
            };
        }

        this.#isReady = true;
        this.#resize();

    }

    /**
     * Starts the audio analysis loop.
     * @listens module:src/core/Media#media/play
     */
    startLoop() {

        this.#resize();
        super.startLoop();

    }

    /**
     * Performs one iteration of the analysis loop and calls the rendering routine.
     * This method overrides the parent's analyseLoop.
     * @override
     */
    analyseLoop() {

        if (!this.#isReady || this.#destroyed) return;

        const { frequencyData } = super.analyseLoop(),
              reduced = AnalyserAudio.reduceFrequencies(frequencyData[0], this.#config.bands);

        this.#lastData = reduced;
        this.#renderFrame(reduced);

    }

    /**
     * Resets the render state when a new track starts.
     * Clears the canvas (on the worker or main thread) so no bars from the previous track remain visible.
     * @override
     */
    reset() {

        super.reset();
        this.#lastData = null;

        if (!this.#isReady || this.#destroyed) return;

        if (this.#useWorker) this.#worker.postMessage({ type: 'clear' });
        else if (this.#canvas) this.#canvas.ctx.clearRect(0, 0, this.#canvas.ele.width, this.#canvas.ele.height);

    }

    /**
     * Renders a single frame, either by posting the data to the worker or by drawing directly on the canvas.
     * @param {number[]} frequencyData  The reduced frequency data to render.
     */
    #renderFrame(frequencyData) {

        if (this.#useWorker) this.#worker.postMessage({ type: 'render', frequencyData }, {});
        else if (this.#canvas) render(frequencyData, this.#canvas, this.#canvas.ctx, this.#config);

    }

    /**
     * Resizes the canvas based on UI changes.
     * Since resizing a canvas clears its contents, a repaint with the most recent data is triggered afterwards.
     * Safely skipped if the render path is not initialized yet or the container has no audio analyser state.
     * @listens module:src/ui/UI#ui/resize
     */
    #resize = () => {

        if (this.#destroyed || !this.#isReady) return;

        const playerEle = this.#player.dom.getElement(this.#apiKey);

        if (!playerEle || !playerEle.classList.contains('has-audio-analyser')) return;

        const ele = this.#dom.canvas,
              deviceRatio = window.devicePixelRatio ?? 1,
              { width, height } = ele.getBoundingClientRect();

        if (this.#useWorker) this.#worker.postMessage({ type: 'resize', width: width * deviceRatio, height: height * deviceRatio });
        else {
            ele.width = this.#canvas.width = width * deviceRatio;
            ele.height = this.#canvas.height = height * deviceRatio;
        }

        // resizing clears the canvas, so repaint the current frame
        this.#renderFrame(this.#lastData ?? new Array(this.#config.bands).fill(0));

    };

    /**
     * Cleans up all events, subscriptions, and DOM nodes created by this component.
     * Terminates the worker and guarantees no render callbacks occur afterwards.
     */
    destroy() {

        this.#destroyed = true;
        this.#isReady = false;

        if (this.#worker) {
            this.#worker.terminate();
            this.#worker = null;
        }

        this.#player.unsubscribe(this.#subscriptions);
        this.#dom.destroy();
        this.#dom = this.#player = this.#apiKey = this.#canvas = this.#lastData = null;
        super.destroy();

    }

}
