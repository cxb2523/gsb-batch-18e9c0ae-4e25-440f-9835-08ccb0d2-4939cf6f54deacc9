#!/usr/bin/env node
// Local lifecycle + seam-sharing samples (runs the REAL Film in a real browser).
//
// Covers the two scenarios called out in the task:
//   A. one scene requested concurrently  -> init() runs exactly once
//   B. unload by distance, then re-enter -> dispose() ran, init() runs again, ready
// Plus:
//   C. rendering never reaches a released bake after unload
//   D. the two panels at a seam share one rider state / pose and one camera
//
// Usage: node tools/lifecycle-check.mjs
//   CHROME_PATH=... node tools/lifecycle-check.mjs   (point at any Chrome/headless-shell)
import { startServer } from './server.mjs';
import { launch, openPage } from './lib/browser.mjs';

const srv = await startServer(0);
const L = await launch();
let failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) console.log('  ✓ ' + name);
  else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
};
try {
  const { page } = await openPage(L.browser, `${srv.url}/film.html`, { timeout: 300000 });
  const report = await page.evaluate(async () => {
    const log = [];
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const F = window.film;
    const K = window.K;
    const out = { A: {}, B: {}, C: {}, D: {}, E: {}, fatal: null };
    try {
      // ------------------------------------------------ A: concurrent init once
      const idx = 900;
      let initCalls = 0, disposeCalls = 0;
      let releaseInit = null;
      const gate = new Promise((r) => { releaseInit = r; });
      F.scenes[idx] = {
        id: 'probeA',
        async init() { initCalls++; log.push('initA#' + initCalls); await gate; },
        dispose() { disposeCalls++; },
      };
      const p1 = F.initScene(idx);
      const p2 = F.initScene(idx);
      const p3 = F.initScene(idx);
      out.A.callsSync = initCalls;   // before any await/microtask flush
      await sleep(20); // let all three reach the guard
      out.A.callsWhileInFlight = initCalls;
      releaseInit();
      await Promise.all([p1, p2, p3]);
      out.A.initCalls = initCalls;
      out.A.initedAfter = F.inited.has(idx);
      out.A.samePromise = p1 === p2 && p2 === p3;

      // ------------------------------------------------ B: unload then re-enter
      F.unloadFar(0); // |idx - 0| > 3  -> probeA unloaded
      out.B.initedAfterUnload = F.inited.has(idx);
      out.B.disposeCalls = disposeCalls;
      await F.initScene(idx);
      out.B.initCallsAfterReenter = initCalls;
      out.B.initedAfterReenter = F.inited.has(idx);

      // ------------------------------------------------ C: released bake not reused
      const pre = K.bakeBytes();
      const fb1 = K.bake('probeC:layer', 16, 16, (k, w, h) => { background(255, 0, 0); });
      let removed = false;
      const origRemove = fb1.remove.bind(fb1);
      fb1.remove = () => { removed = true; try { origRemove(); } catch {} };
      out.C.bytesGrew = K.bakeBytes() > pre;
      K.dropBakes('probeC');
      out.C.removeCalled = removed;
      const fb2 = K.bake('probeC:layer', 16, 16, () => {});
      out.C.freshBake = fb2 !== fb1;
      // Film must not consider an unloaded scene renderable
      const idx2 = 901;
      F.scenes[idx2] = { id: 'probeD', init() {}, dispose() {} };
      await F.initScene(idx2);
      F.unloadScene ? F.unloadScene(idx2) : F.unloadFar(0);
      out.C.unloadedSceneSkipped = !F.inited.has(idx2);

      // ------------------------------------------------ D: seam shares rider + camera
      const TL = window.TL;
      const i = 4;
      const t = TL.sceneStart(i);
      const R = F.rider(t);
      const left = F.riderFor(i - 1, R);
      const right = F.riderFor(i, R);
      out.D.sameState = left.state === R.st && right.state === R.st;
      out.D.samePose = left.pose === R.P && right.pose === R.P;
      out.D.sameMods = left.mods === R.mods && right.mods === R.mods;
      // world x of the bottom bracket through either panel's coordinates
      const wxLeft = left.place.x + F.leftOf(i - 1);
      const wxRight = right.place.x + F.leftOf(i);
      out.D.wxLeft = +wxLeft.toFixed(4);
      out.D.wxRight = +wxRight.toFixed(4);
      out.D.worldAligned = Math.abs(wxLeft - wxRight) < 1e-6;
      out.D.atCrossing = Math.abs(R.st.wx - TL.crossingX(i)) < 0.05;
      // frame state helper, if present, must be memoised per call-time
      if (typeof F.frameState === 'function') {
        const a = F.frameState(t), b = F.frameState(t);
        out.D.frameStateMemo = a && b && a.rider === b.rider && a.cam === b.cam;
      }

      // ------------------------------------------------ E: unload mid-init + re-enter
      const idxE = 902;
      let eCalls = 0, eActive = 0, eMaxActive = 0, eDispose = 0;
      let releaseE;
      const gateE = new Promise((r) => { releaseE = r; });
      F.scenes[idxE] = {
        id: 'probeE',
        async init() { eCalls++; eActive++; eMaxActive = Math.max(eMaxActive, eActive); await gateE; eActive--; },
        dispose() { eDispose++; },
      };
      const pe1 = F.initScene(idxE);
      await sleep(20);
      out.E = { callsWhileBlocked: eCalls, initedBeforeUnload: F.inited.has(idxE) };
      F.unloadScene(idxE);              // invalidate the generation mid-flight
      const pe2 = F.initScene(idxE);    // immediate re-entry must queue, not overlap
      out.E.initedAfterUnload = F.inited.has(idxE);
      releaseE();
      await Promise.all([pe1, pe2]);
      await sleep(20);
      out.E.callsTotal = eCalls;
      out.E.maxConcurrentInits = eMaxActive;
      out.E.activeLeft = eActive;
      out.E.disposeCalls = eDispose;
      out.E.initedFinal = F.inited.has(idxE);
    } catch (e) {
      out.fatal = String(e && e.stack || e);
    }
    return out;
  });

  if (report.fatal) { failed++; console.log('  ✗ in-page exception:\n' + report.fatal); }

  console.log('A. concurrent init (same scene requested 3x at once)');
  check('init starts synchronously and exactly once', report.A.callsSync === 1, `calls=${report.A.callsSync}`);
  check('init ran exactly once while in flight', report.A.callsWhileInFlight === 1, `calls=${report.A.callsWhileInFlight}`);
  check('init ran exactly once in total', report.A.initCalls === 1, `calls=${report.A.initCalls}`);
  check('all callers shared one init promise', report.A.samePromise === true);
  check('scene marked inited after resolution', report.A.initedAfter === true);

  console.log('B. distance unload then re-enter');
  check('cleared from inited after unload', report.B.initedAfterUnload === false);
  check('dispose() called once on unload', report.B.disposeCalls === 1, `dispose=${report.B.disposeCalls}`);
  check('init runs again after re-entry', report.B.initCallsAfterReenter === 2, `calls=${report.B.initCallsAfterReenter}`);
  check('ready (inited) again after re-entry', report.B.initedAfterReenter === true);

  console.log('C. released bake cache safety');
  check('bake cache accounts for the layer bytes', report.C.bytesGrew === true);
  check('dropBakes removes the GPU target', report.C.removeCalled === true);
  check('re-bake after drop creates a fresh target', report.C.freshBake === true);
  check('unloaded scene is skipped by the renderer', report.C.unloadedSceneSkipped === true);

  console.log('D. seam sharing');
  check('both panels reference the same rider state', report.D.sameState === true);
  check('both panels reference the same pose', report.D.samePose === true);
  check('both panels reference the same mods', report.D.sameMods === true);
  check('bottom bracket world x agrees across the seam', report.D.worldAligned === true, `${report.D.wxLeft} vs ${report.D.wxRight}`);
  check('rider sits on the crossing midline', report.D.atCrossing === true);
  if ('frameStateMemo' in report.D) check('frameState(t) is memoised per time', report.D.frameStateMemo === true);

  console.log('E. unload DURING async init, then immediately re-enter');
  check('first init was the single blocked run', report.E.callsWhileBlocked === 1, `calls=${report.E.callsWhileBlocked}`);
  check('unload clears readiness immediately', report.E.initedAfterUnload === false);
  check('re-entry re-initialises after the stale run settles', report.E.callsTotal === 2, `calls=${report.E.callsTotal}`);
  check('init runs never overlap for one scene', report.E.maxConcurrentInits === 1, `max concurrent=${report.E.maxConcurrentInits}`);
  check('no init remains active', report.E.activeLeft === 0);
  check('stale generation released via dispose()', report.E.disposeCalls >= 1, `dispose=${report.E.disposeCalls}`);
  check('scene ends ready for the new generation', report.E.initedFinal === true);
} catch (e) {
  failed++;
  console.log('  ✗ harness error:', e && e.message || e);
} finally {
  await L.close();
  await srv.close();
}
console.log(failed ? `LIFECYCLE CHECK FAILED (${failed})` : 'LIFECYCLE CHECK PASSED');
process.exit(failed ? 1 : 0);
