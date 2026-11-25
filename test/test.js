import GLBench from '../dist/gl-bench.module.js';
import { test } from 'https://cdn.jsdelivr.net/npm/zora@3.0.3/dist/bundle/module.js';

function drawTriangle(canvas, gl) {
  gl.viewport(0,0,canvas.width,canvas.height);
  const vertShader = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vertShader, 'attribute vec3 c;void main(void){gl_Position=vec4(c, 1.0);}');
  gl.compileShader(vertShader);
  const fragShader = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fragShader, 'void main(void){gl_FragColor=vec4(0,1,1,1);}');
  gl.compileShader(fragShader);
  const prog = gl.createProgram();
  gl.attachShader(prog, vertShader);
  gl.attachShader(prog, fragShader);
  gl.linkProgram(prog);
  gl.useProgram(prog);
  gl.clearColor(1, 0, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const vertexBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([ -0.5,0.5,0.0,  -0.5,-0.5,0.0,  0.5,-0.5,0.0 ]), gl.STATIC_DRAW);
  const coord = gl.getAttribLocation(prog, "c");
  gl.vertexAttribPointer(coord, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(coord);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

test('CPU', async (t) => {
  let tfps = null, tcpu = null;
  const bench = new GLBench(null, {
    withoutUI: true,
    paramLogger: (i, cpu, gpu, mem, fps) => {
      tfps = fps;
      tcpu = cpu;
    }
  });
  for(let frameId = 0; frameId < 25; frameId++) {
    bench.nextFrame();
    bench.begin();
    await new Promise(resolve => setTimeout(resolve, 100));
    bench.end();
  }
  t.ok(tfps != null, 'fps = ' + (tfps != null ? tfps.toFixed(1) : 'null'));
  t.ok(tcpu != null, 'cpu = ' + (tcpu != null ? tcpu.toFixed(1) : 'null'));
});

test('Memory', async (t) => {
  let tmem = null;
  const bench = new GLBench(null, {
    withoutUI: true,
    paramLogger: (i, cpu, gpu, mem, fps) => {
      tmem = mem;
    }
  });
  for(let frameId = 0; frameId < 25; frameId++) {
    bench.nextFrame();
    bench.begin();
    await new Promise(resolve => setTimeout(resolve, 100));
    bench.end();
  }
  t.ok(tmem != null, 'mem = ' + (tmem != null ? tmem.toFixed(1) : 'null'));
});

test('WebGL1', async (t) => {
  let tfps = null, tcpu = null, tgpu = null;
  const canvas = document.querySelector('canvas');
  const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  const bench = new GLBench(gl, {
    trackGPU: true,
    withoutUI: true,
    paramLogger: (i, cpu, gpu, mem, fps) => {
      tfps = fps;
      tcpu = cpu;
      tgpu = gpu;
    }
  });
  for(let frameId = 0; frameId < 100; frameId++) {
    bench.nextFrame();
    bench.begin();
    drawTriangle(canvas, gl);
    await new Promise(resolve => setTimeout(resolve, 30));
    bench.end();
  }
  t.ok(tfps != null, 'fps = ' + (tfps != null ? tfps.toFixed(1) : 'null'));
  t.ok(tcpu != null, 'cpu = ' + (tcpu != null ? tcpu.toFixed(1) : 'null'));
  t.ok(tgpu != null, 'gpu = ' + (tgpu != null ? tgpu.toFixed(1) : 'null'));
});

test('WebGL2', async (t) => {
  let tfps = null, tcpu = null, tgpu = null;
  const canvas = document.querySelectorAll('canvas')[1];
  const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  const bench = new GLBench(gl, {
    trackGPU: true,
    withoutUI: true,
    paramLogger: (i, cpu, gpu, mem, fps) => {
      tfps = fps;
      tcpu = cpu;
      tgpu = gpu;
    }
  });
  for(let frameId = 0; frameId < 100; frameId++) {
    bench.nextFrame();
    bench.begin();
    drawTriangle(canvas, gl);
    await new Promise(resolve => setTimeout(resolve, 30));
    bench.end();
  }
  t.ok(tfps != null, 'fps = ' + (tfps != null ? tfps.toFixed(1) : 'null'));
  t.ok(tcpu != null, 'cpu = ' + (tcpu != null ? tcpu.toFixed(1) : 'null'));
  t.ok(tgpu != null, 'gpu = ' + (tgpu != null ? tgpu.toFixed(1) : 'null'));
});
  
test('UI', async (t) => {
  let tfps = null, tcpu = null, tgpu = null, tmem = null;
  const canvas = document.querySelectorAll('canvas')[2];
  const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  const bench = new GLBench(gl, {
    trackGPU: true,
    paramLogger: (i, cpu, gpu, mem, fps) => {
      tfps = fps;
      tcpu = cpu;
      tgpu = gpu;
      tmem = mem;
    }
  });
  for(let frameId = 0; frameId < 100; frameId++) {
    bench.nextFrame();
    bench.begin();
    drawTriangle(canvas, gl);
    await new Promise(resolve => setTimeout(resolve, 30));
    bench.end();
  }
  let fpsUI = null, cpuUI = null, gpuUI = null, memUI = null;
  const benchNode = document.querySelector('#gl-bench');
  if (benchNode) fpsUI = benchNode.querySelector('.gl-fps');
  if (benchNode) cpuUI = benchNode.querySelector('.gl-cpu');
  if (benchNode) gpuUI = benchNode.querySelector('.gl-gpu');
  if (benchNode) memUI = benchNode.querySelector('.gl-mem');
  if (fpsUI) fpsUI = fpsUI.innerHTML;
  if (cpuUI) cpuUI = cpuUI.style.strokeDasharray;
  if (gpuUI) gpuUI = gpuUI.style.strokeDasharray;
  if (memUI) memUI = memUI.innerHTML;
  t.ok(fpsUI != null, 'fps ui = ' + fpsUI);
  t.ok(cpuUI != null, 'cpu ui = ' + cpuUI);
  t.ok(gpuUI != null, 'gpu ui = ' + gpuUI);
  t.ok(memUI != null, 'mem ui = ' + memUI);
  t.ok(tfps != null, 'fps = ' + (tfps != null ? tfps.toFixed(1) : 'null'));
  t.ok(tcpu != null, 'cpu = ' + (tcpu != null ? tcpu.toFixed(1) : 'null'));
  t.ok(tgpu != null, 'gpu = ' + (tgpu != null ? tgpu.toFixed(1) : 'null'));
  t.ok(tmem != null, 'mem = ' + (tmem != null ? tmem.toFixed(1) : 'null'));
});

// ---------------------------------------------------------------------------
// Deterministic GPU attribution / stats-window isolation tests.
// They only use a fake gl.getError and an injectable fake `now`, so they are
// reproducible locally without a real GPU. Every probe promise resolves after
// its delayed gl.getError() measurement, so `await Promise.all(finished)` is
// enough to observe the settled accumulators.
// ---------------------------------------------------------------------------

const nextTick = () => new Promise(resolve => setTimeout(resolve, 0));

function createFakeGL() {
  return {
    errorCount: 0,
    getError() { this.errorCount++; return 0; },
    drawArrays() {},
    drawElements() {},
  };
}

test('GPU attribution: each draw only counts active measurements', async (t) => {
  let clock = 0;
  const gl = createFakeGL();
  const bench = new GLBench(gl, {
    withoutUI: true,
    trackGPU: true,
    now: () => clock,
  });
  bench.addUI('A');
  bench.addUI('B');

  // Sequential measurements: one draw inside each region.
  bench.begin('A');
  gl.drawArrays(gl.TRIANGLES, 0, 1);
  bench.end('A');

  bench.begin('B');
  gl.drawArrays(gl.TRIANGLES, 0, 1);
  bench.end('B');

  // Complete both delayed probes at the same controlled instant.
  clock = 50;
  await Promise.all(bench.finished);
  await nextTick();

  t.ok(bench.gpuAccums[0] === 50, 'A gets its own probe dt, got ' + bench.gpuAccums[0]);
  t.ok(bench.gpuAccums[1] === 50, 'B gets its own probe dt, got ' + bench.gpuAccums[1]);
  t.ok(gl.errorCount === 2, 'gl.getError called once per draw probe, got ' + gl.errorCount);

  // Overlapping/nested measurements: the shared draw belongs to both active
  // items, the second draw only to the still-active outer item.
  let clock2 = 0;
  const gl2 = createFakeGL();
  const bench2 = new GLBench(gl2, { withoutUI: true, trackGPU: true, now: () => clock2 });
  bench2.addUI('A');
  bench2.addUI('B');
  bench2.begin('A');
  bench2.begin('B');
  gl2.drawArrays(); // both A and B active
  bench2.end('B');
  gl2.drawArrays(); // only A active
  bench2.end('A');
  clock2 = 40;
  await Promise.all(bench2.finished);
  await nextTick();

  t.ok(bench2.gpuAccums[0] === 80, 'A receives both probes (40+40), got ' + bench2.gpuAccums[0]);
  t.ok(bench2.gpuAccums[1] === 40, 'B only receives the shared probe, got ' + bench2.gpuAccums[1]);
});

test('GPU windows: old in-flight probes never pollute the new window', async (t) => {
  let clock = 1000;
  const gpuLogs = [];
  const gl = createFakeGL();
  const bench = new GLBench(gl, {
    withoutUI: true,
    trackGPU: true,
    now: () => clock,
    paramLogger: (i, cpu, gpu) => gpuLogs.push([i, gpu]),
  });
  bench.addUI('A');
  bench.addUI('B');

  bench.nextFrame(); // frame 1 opens the first param window at t=1000

  // Old-window draw/probe, still pending because we do not yield yet.
  bench.begin('A');
  gl.drawArrays();
  bench.end('A');
  const oldFinished = bench.finished.slice();
  const oldGpuAccums = bench.gpuAccums;

  // Cross the 1s boundary while the old probe is in flight.
  clock = 2000;
  bench.nextFrame();
  t.ok(gpuLogs.length === 2, 'paramLogger still fires once per item on switch, got ' + gpuLogs.length);
  t.ok(bench.finished.length === 0, 'the new window starts with an empty finished list');
  t.ok(bench.gpuAccums !== oldGpuAccums, 'the new window owns a fresh gpuAccums array');
  t.ok(bench.gpuAccums[0] === 0 && bench.gpuAccums[1] === 0, 'new gpuAccums start zeroed');

  // A probe produced by the new window.
  bench.begin('B');
  gl.drawArrays();
  bench.end('B');
  const newFinished = bench.finished;
  t.ok(newFinished.length === 1, 'new window tracks its own probe, got ' + newFinished.length);

  // Resolve everything at a controlled instant.
  clock = 2070;
  await Promise.all(oldFinished);
  await Promise.all(newFinished);
  await nextTick();

  // Old probe dt = 2070 - 1000 = 1070, settled into the old window only.
  t.ok(oldGpuAccums[0] === 1070, 'old probe settles in old window A, got ' + oldGpuAccums[0]);
  t.ok(oldGpuAccums[1] === 0, 'old window B stays zero, got ' + oldGpuAccums[1]);
  // New probe dt = 2070 - 2000 = 70 and no old dt leaked across.
  t.ok(bench.gpuAccums[0] === 0, 'new window A is not polluted, got ' + bench.gpuAccums[0]);
  t.ok(bench.gpuAccums[1] === 70, 'new window B only has its own dt, got ' + bench.gpuAccums[1]);
  t.ok(bench.finished === newFinished, 'old Promise must not replace the new finished list');
  t.ok(bench.finished.length === 1, 'old Promise must not clear new finished probes, got ' + bench.finished.length);

  // The next boundary reports only the new window's own GPU share.
  clock = 3000;
  bench.nextFrame();
  const lastTwo = gpuLogs.slice(-2).map(entry => [entry[0], Math.round(entry[1] * 1000) / 1000]);
  t.ok(lastTwo[0][0] === 0 && lastTwo[0][1] === 0, 'second window reports A gpu=0, got ' + lastTwo[0]);
  t.ok(lastTwo[1][0] === 1 && Math.abs(lastTwo[1][1] - 7) < 1e-6,
    'second window reports B gpu=7%, got ' + lastTwo[1]);
});

test('GPU trackGPU toggle: no new probes, in-flight ones stay attributed', async (t) => {
  let clock = 0;
  const gl = createFakeGL();
  const bench = new GLBench(gl, { withoutUI: true, trackGPU: true, now: () => clock });
  bench.addUI('A');

  bench.begin('A');
  gl.drawArrays();
  bench.end('A');
  t.ok(bench.finished.length === 1, 'one probe while tracking is on');

  // Same state change as a UI click.
  bench.trackGPU = false;
  gl.drawArrays();
  t.ok(bench.finished.length === 1, 'disabling tracking creates no new probe');

  clock = 30;
  await Promise.all(bench.finished);
  await nextTick();
  t.ok(bench.gpuAccums[0] === 30, 'the in-flight probe still lands on A, got ' + bench.gpuAccums[0]);
  t.ok(gl.errorCount === 1, 'getError only ran for the in-flight probe, got ' + gl.errorCount);

  // Toggling back on resumes probing.
  bench.trackGPU = true;
  gl.drawArrays();
  t.ok(bench.finished.length === 2, 're-enabling tracking creates probes again');

  // Disable across a window boundary: old in-flight probe still reaches its
  // owning window and never the new one.
  let clock2 = 5000;
  const gl2 = createFakeGL();
  const bench2 = new GLBench(gl2, { withoutUI: true, trackGPU: true, now: () => clock2 });
  bench2.addUI('A');
  bench2.nextFrame();
  bench2.begin('A');
  gl2.drawArrays();
  bench2.end('A');
  const oldFinished2 = bench2.finished.slice();
  const oldGpu2 = bench2.gpuAccums;
  bench2.trackGPU = false;
  clock2 = 6000;
  bench2.nextFrame();
  gl2.drawArrays();
  clock2 = 6050;
  await Promise.all(oldFinished2);
  await nextTick();
  t.ok(oldGpu2[0] === 1050, 'old probe settles in its origin window, got ' + oldGpu2[0]);
  t.ok(bench2.gpuAccums[0] === 0, 'new window stays clean after toggle, got ' + bench2.gpuAccums[0]);
  t.ok(bench2.finished.length === 0, 'no new-window probes while disabled');
});

test('GPU UI click toggles trackGPU and probing', async (t) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let clock = 0;
  const gl = createFakeGL();
  const bench = new GLBench(gl, { dom: host, trackGPU: true, now: () => clock });
  try {
    const node = host.querySelector('#gl-bench');
    t.ok(!!node, 'bench UI root is rendered into the custom dom');
    t.ok(bench.trackGPU === true, 'trackGPU starts true');

    node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    t.ok(bench.trackGPU === false, 'clicking UI flips trackGPU to false');
    gl.drawArrays();
    t.ok(bench.finished.length === 0, 'no probe pushed after UI disable');

    node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    t.ok(bench.trackGPU === true, 'clicking UI again flips trackGPU back to true');
    gl.drawArrays();
    t.ok(bench.finished.length === 1, 'probe pushed again after UI re-enable');

    clock = 10;
    await Promise.all(bench.finished);
    t.ok(bench.gpuAccums[0] === 10 || bench.gpuAccums.length === 0,
      'UI probe settles without error');
  } finally {
    host.remove();
  }
});
