/**
 * Test-only module registration (used via `node --import`).
 * Registers the @tonejs/midi ESM interop hooks from tonejs-midi-hooks.mjs.
 */
const { register } = require('node:module');
const { pathToFileURL } = require('node:url');

register(
  pathToFileURL(`${__dirname}/tonejs-midi-hooks.mjs`).href,
  pathToFileURL(__filename).href,
);
