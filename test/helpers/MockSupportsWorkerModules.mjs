/**
 * Controllable stand-in for lib/util/supportsWorkerModules.
 * Tests toggle `state.supported` to exercise both render paths.
 */

/**
 * Shared state: whether worker modules are "supported".
 * @type {{supported: boolean}}
 */
export const state = { supported: true };

/**
 * Mocked support detection.
 * @returns {Promise<boolean>} Resolves to the current support flag.
 */
export default function supportsWorkerModules() {

    return Promise.resolve(state.supported);

}
