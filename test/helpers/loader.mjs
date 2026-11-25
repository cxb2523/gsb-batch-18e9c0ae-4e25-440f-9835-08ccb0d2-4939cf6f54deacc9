/**
 * ESM loader hooks for the visualizer tests.
 * Redirects browser/build-specific imports (inlined workers, DomSmith,
 * worker support detection) to test doubles and resolves extensionless
 * relative imports (which Vite tolerates, but Node does not).
 */

/**
 * Resolve hook.
 * @param {string}   specifier  The import specifier.
 * @param {Object}   context    The resolution context.
 * @param {Function} next       The next resolve hook in the chain.
 * @returns {Object} The resolution result.
 */
export async function resolve(specifier, context, next) {

    if (specifier.includes('?worker&inline')) {
        return { url: new URL('./MockWorker.mjs', import.meta.url).href, shortCircuit: true };
    }

    if (/\/lib\/dom\/DomSmith(\.js)?$/.test(specifier)) {
        return { url: new URL('./MockDomSmith.mjs', import.meta.url).href, shortCircuit: true };
    }

    if (/\/lib\/util\/supportsWorkerModules(\.js)?$/.test(specifier)) {
        return { url: new URL('./MockSupportsWorkerModules.mjs', import.meta.url).href, shortCircuit: true };
    }

    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z0-9]+$/i.test(specifier)) {
        return next(`${specifier}.js`, context);
    }

    return next(specifier);

}
