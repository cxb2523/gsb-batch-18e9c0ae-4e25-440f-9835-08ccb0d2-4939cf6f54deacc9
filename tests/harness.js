"use strict";

/**
 * Minimal harness that loads MMM-Videoplayer.js outside of MagicMirror².
 *
 * It provides a fake `Module.register`, a fake `document.createElement` and a
 * fake `<video>` element whose `play`/`pause`/`load` methods update state and
 * dispatch the same events a real browser would. That is enough to exercise the
 * module's state machine in plain Node.js.
 */

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class FakeVideo {
	constructor() {
		this.paused = true;
		this.ended = false;
		this.currentTime = 0;
		this.autoplay = false;
		this.muted = false;
		this.loop = false;
		this.controls = false;
		this.preload = "auto";
		this.id = "";
		this.attributes = {};
		this.listeners = {};
		this.playCalls = [];
		this.pauseCalls = 0;
		this.loadCalls = 0;
		// Set to a string to make play() reject, emulating a blocked autoplay.
		this.playRejection = null;
	}

	setAttribute (name, value) {
		this.attributes[name] = value;
		if (name === "src") {
			this.src = value;
		}
	}

	getAttribute (name) {
		return Object.prototype.hasOwnProperty.call(this.attributes, name)
			? this.attributes[name]
			: null;
	}

	addEventListener (type, listener) {
		if (!this.listeners[type]) {
			this.listeners[type] = [];
		}
		this.listeners[type].push(listener);
	}

	removeEventListener (type, listener) {
		if (!this.listeners[type]) {
			return;
		}
		this.listeners[type] = this.listeners[type].filter((entry) => entry !== listener);
	}

	dispatch (type) {
		const listeners = this.listeners[type] || [];
		listeners.forEach((listener) => listener.call(this, {type}));
	}

	load () {
		this.loadCalls += 1;
		this.paused = true;
		this.ended = false;
		this.currentTime = 0;
	}

	play () {
		this.playCalls.push(this.src);
		if (this.playRejection) {
			return Promise.reject(new Error(this.playRejection));
		}
		if (this.paused) {
			this.paused = false;
			this.ended = false;
			this.dispatch("play");
		}
		return Promise.resolve();
	}

	pause () {
		this.pauseCalls += 1;
		if (!this.paused) {
			this.paused = true;
			this.dispatch("pause");
		}
	}

	// Test helper: emulate the media reaching its end. Browsers fire "pause"
	// just before "ended" for a non-looping element, so mirror that ordering.
	finish () {
		this.paused = true;
		this.ended = true;
		this.dispatch("pause");
		this.dispatch("ended");
	}
}

function loadModule () {
	const file = path.join(__dirname, "..", "MMM-Videoplayer.js");
	const source = fs.readFileSync(file, "utf8");

	let definition = null;
	const Module = {
		register (name, moduleDefinition) {
			definition = moduleDefinition;
		}
	};
	const document = {
		createElement (tag) {
			if (tag === "video") {
				return new FakeVideo();
			}
			return {
				children: [],
				appendChild (child) {
					this.children.push(child);
					return child;
				}
			};
		}
	};

	const sandbox = {Module, document, console};
	vm.createContext(sandbox);
	vm.runInContext(source, sandbox, {filename: file});

	return {definition, FakeVideo};
}

/**
 * Creates a module instance with the defaults merged with `config`.
 * `identifier` and a no-op `hide` are provided like MagicMirror² would.
 */
function createInstance (config) {
	const {definition} = loadModule();
	const instance = Object.create(definition);
	instance.identifier = "module_1_test";
	instance.config = Object.assign({}, definition.defaults, config);
	instance.hide = () => {};
	instance.stateInitialized = false;
	instance.ensureState();
	return instance;
}

/**
 * Walks the full MagicMirror² lifecycle up to a playing first video.
 */
function started (config) {
	const instance = createInstance(config);
	instance.getDom();
	return instance;
}

module.exports = {
	FakeVideo,
	loadModule,
	createInstance,
	started
};
