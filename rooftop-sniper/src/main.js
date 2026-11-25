import './style.css';
import { Game } from './game.js';

function fail(msg) {
  document.getElementById('screen-loading')?.classList.remove('show');
  const s = document.getElementById('screen-error');
  const t = document.getElementById('error-text');
  if (t) t.textContent = msg;
  s?.classList.add('show');
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

// Give the loading screen a moment to paint before the (synchronous) city generation runs.
// (A plain timeout, not requestAnimationFrame, so a background tab still boots.)
setTimeout(() => {
  if (!webglAvailable()) {
    fail('This game needs WebGL. Enable hardware acceleration in your browser settings, or try Chrome / Edge / Firefox.');
    return;
  }
  try {
    const t0 = performance.now();
    new Game(document.getElementById('game'));
    console.info(`[rooftop-sniper] world built in ${Math.round(performance.now() - t0)} ms`);
  } catch (err) {
    console.error(err);
    fail(`Something went wrong while building the scene: ${err.message}`);
  }
}, 60);
