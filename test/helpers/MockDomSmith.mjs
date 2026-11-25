import { createMockCanvas, createMockElement } from './mocks.mjs';

/**
 * Minimal stand-in for lib/dom/DomSmith: builds mock elements from a node
 * definition and exposes `_ref` entries directly on the instance.
 * The loader redirects every DomSmith import to this module.
 */
export default class MockDomSmith {

    /**
     * All created instances, for test access.
     * @type {MockDomSmith[]}
     */
    static instances = [];

    /**
     * Creates a new MockDomSmith instance.
     * @param {Object} nodeDef  The node definition (subset of the real DomSmith format).
     * @param {Object} parent   The parent element the tree would be mounted to.
     */
    constructor(nodeDef, parent) {

        this.parent = parent;
        this.destroyed = false;

        const build = def => {
            const ele = def._tag === 'canvas' ? createMockCanvas() : createMockElement(def._tag ?? 'div');
            if (def.className) ele.classList.add(...def.className.split(/\s+/));
            if (def._ref) this[def._ref] = ele;
            (def._nodes ?? []).forEach(child => ele.appendChild(build(child)));
            return ele;
        };

        build(nodeDef);
        MockDomSmith.instances.push(this);

    }

    /**
     * Marks this instance as destroyed.
     */
    destroy() {

        this.destroyed = true;

    }

}
