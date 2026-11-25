/**
 * Mock factories for DOM elements, canvases, the Web Audio API and the player instance.
 * These mocks are just rich enough to exercise the visualizer lifecycle in Node.js.
 */

/**
 * Creates a minimal mock of a DOM element.
 * @param {string} [tag='div']  The tag name of the element.
 * @returns {Object} The mock element.
 */
export function createMockElement(tag = 'div') {

    const classes = new Set(),
          ele = {
              tagName: tag.toUpperCase(),
              children: [],
              classList: {
                  add: (...names) => names.forEach(name => classes.add(name)),
                  remove: (...names) => names.forEach(name => classes.delete(name)),
                  toggle(name, force) {
                      const shouldHave = typeof force === 'boolean' ? force : !classes.has(name);
                      if (shouldHave) classes.add(name); else classes.delete(name);
                      return shouldHave;
                  },
                  contains: name => classes.has(name)
              },
              appendChild(child) {
                  ele.children.push(child);
                  return child;
              },
              remove() {},
              getBoundingClientRect: () => ele._rect ?? { width: 300, height: 150 },
              setRect(width, height) {
                  ele._rect = { width, height };
              }
          };

    return ele;

}

/**
 * Creates a mock 2D rendering context which only counts draw calls.
 * @param {Object} stats  Shared counter object for draw calls.
 * @returns {Object} The mock 2D context.
 */
export function createMockContext2d(stats) {

    return {
        fillStyle: '',
        clearRect: () => { stats.clearRect += 1; },
        beginPath: () => { stats.beginPath += 1; },
        roundRect: () => { stats.roundRect += 1; },
        fill: () => { stats.fill += 1; }
    };

}

/**
 * Creates a mock canvas element. `getContext` throws once control has been
 * transferred to an offscreen canvas, mimicking real browser behavior.
 * @returns {Object} The mock canvas element.
 */
export function createMockCanvas() {

    const canvas = createMockElement('canvas');

    canvas.width = 0;
    canvas.height = 0;
    canvas.transferred = false;
    canvas.drawStats = { clearRect: 0, beginPath: 0, roundRect: 0, fill: 0 };
    canvas.getContext = () => {
        if (canvas.transferred) throw new Error('[MockCanvas] getContext() called after transferControlToOffscreen()');
        return createMockContext2d(canvas.drawStats);
    };
    canvas.transferControlToOffscreen = () => {
        canvas.transferred = true;
        return {
            width: 0,
            height: 0,
            getContext: () => createMockContext2d(canvas.drawStats)
        };
    };

    return canvas;

}

/**
 * Creates a mock AudioContext producing controllable analyser nodes.
 * @returns {Object} The mock audio context.
 */
export function createMockAudioContext() {

    const analysers = [];

    return {
        analysers,
        createChannelSplitter: () => ({
            connect() {},
            disconnect() {}
        }),
        createAnalyser: () => {
            const analyser = {
                fftSize: 512,
                minDecibels: -120,
                maxDecibels: 0,
                smoothingTimeConstant: 0.8,
                frequencyValue: 0, // tests set this to simulate signal energy
                get frequencyBinCount() { return this.fftSize / 2; },
                getByteFrequencyData(arr) { arr.fill(this.frequencyValue); },
                getByteTimeDomainData(arr) { arr.fill(128); },
                connect() {},
                disconnect() {}
            };
            analysers.push(analyser);
            return analyser;
        }
    };

}

/**
 * Creates a mock player instance with a simple event system.
 * @param {Object} [options]                Options.
 * @param {Object} [options.config]         Config overrides returned by initConfig.
 * @returns {{player: Object, emit: Function, container: Object, audioCtx: Object}} The mock player and helpers.
 */
export function createMockPlayer({ config = {} } = {}) {

    const container = createMockElement('div'),
          audioCtx = createMockAudioContext(),
          listeners = new Map();

    let token = 0;

    const player = {
        initConfig: (key, defaults) => ({ ...defaults, ...config }),
        subscribe(event, callback) {
            token += 1;
            if (!listeners.has(event)) listeners.set(event, new Map());
            listeners.get(event).set(token, callback);
            return token;
        },
        unsubscribe(tokens) {
            (Array.isArray(tokens) ? tokens : [tokens]).forEach(t => listeners.forEach(map => map.delete(t)));
        },
        dom: { getElement: () => container },
        audio: {
            getContext: () => audioCtx,
            addNode() {},
            removeNode() {}
        }
    };

    const emit = (event, payload) => {
        (listeners.get(event) ?? new Map()).forEach(callback => callback(payload));
    };

    return { player, emit, container, audioCtx };

}
