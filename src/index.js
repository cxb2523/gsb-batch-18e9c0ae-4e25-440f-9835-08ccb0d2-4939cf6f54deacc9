import UISVG from './ui.svg';
import UICSS from './ui.css';

export default class GLBench {

  /** GLBench constructor
   * @param { WebGLRenderingContext | WebGL2RenderingContext } gl context
   * @param { Object | undefined } settings additional settings
   */
  constructor(gl, settings = {}) {
    this.css = UICSS;
    this.svg = UISVG;
    this.paramLogger = () => {};
    this.chartLogger = () => {};
    this.chartLen = 20;
    this.chartHz = 20;

    this.names = [];
    this.cpuAccums = [];
    this.gpuAccums = [];
    this.activeAccums = [];
    this.chart = new Array(this.chartLen);
    this.now = () => (typeof performance !== 'undefined' && performance && performance.now) ? performance.now() : Date.now();
    this.updateUI = () => {
      [].forEach.call(this.nodes['gl-gpu-svg'], node => {
        node.style.display = this.trackGPU ? 'inline' : 'none';
      })
    }

    Object.assign(this, settings);
    this.detected = 0;
    // Probes of the current stats window. At a window switch this list is
    // rotated (not cleared through an old Promise), see nextFrame().
    this.finished = [];
    this.isFramebuffer = 0;
    this.frameId = 0;

    // 120hz device detection
    let rafId, n = 0, t0;
    let loop = (t) => {
      if (++n < 20) {
        rafId = requestAnimationFrame(loop);
      } else {
        this.detected = Math.ceil(1e3 * n / (t - t0) / 70);
        cancelAnimationFrame(rafId);
      }
      if (!t0) t0 = t;
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(loop);

    // attach gpu profilers
    if (gl) {
      // The promise resolves only after the delayed gl.getError() probe has
      // finished and its dt was added to the accumulators of the stats window
      // that initiated the draw.
      const glFinish = (t, activeAccums, windowGpuAccums) =>
        new Promise(resolve => {
          setTimeout(() => {
            gl.getError();
            const dt = this.now() - t;
            activeAccums.forEach((active, i) => {
              if (active) windowGpuAccums[i] += dt;
            });
            resolve();
          }, 0);
        });

      const addProfiler = (fn, self, target) => function() {
        const t = self.now();
        fn.apply(target, arguments);
        if (self.trackGPU) {
          // Capture both the measurements active right now and the current
          // stats window accumulators: later begin/end toggles and window
          // switches must not re-route this probe.
          const activeAccums = self.activeAccums.slice(0);
          const windowGpuAccums = self.gpuAccums;
          self.finished.push(glFinish(t, activeAccums, windowGpuAccums));
        }
      };

      ['drawArrays', 'drawElements', 'drawArraysInstanced',
        'drawBuffers', 'drawElementsInstanced', 'drawRangeElements']
        .forEach(fn => { if (gl[fn]) gl[fn] = addProfiler(gl[fn], this, gl) });

      gl.getExtension = ((fn, self) => function() {
        let ext = fn ? fn.apply(gl, arguments) : undefined;
        if (ext) {
          ['drawElementsInstancedANGLE', 'drawBuffersWEBGL']
            .forEach(fn => { if (ext[fn]) ext[fn] = addProfiler(ext[fn], self, ext) });
        }
        return ext;
      })(gl.getExtension, this);
    }

    // init ui and ui loggers
    if (!this.withoutUI) {
      if (!this.dom) this.dom = document.body;
      let elm = document.createElement('div');
      elm.id = 'gl-bench';
      this.dom.appendChild(elm);
      this.dom.insertAdjacentHTML('afterbegin', '<style id="gl-bench-style">' + this.css + '</style>');
      this.dom = elm;
      this.dom.addEventListener('click', () => {
        this.trackGPU = !this.trackGPU;
        this.updateUI();
      });

      this.paramLogger = ((logger, dom, names) => {
        const classes = ['gl-cpu', 'gl-gpu', 'gl-mem', 'gl-fps', 'gl-gpu-svg', 'gl-chart'];
        const nodes = Object.assign({}, classes);
        classes.forEach(c => nodes[c] = dom.getElementsByClassName(c));
        this.nodes = nodes;
        return (i, cpu, gpu, mem, fps, totalTime, frameId) => {
          nodes['gl-cpu'][i].style.strokeDasharray = (cpu * 0.27).toFixed(0) + ' 100';
          nodes['gl-gpu'][i].style.strokeDasharray = (gpu * 0.27).toFixed(0) + ' 100';
          nodes['gl-mem'][i].innerHTML = names[i] ? names[i] : (mem ? 'mem: ' + mem.toFixed(0) + 'mb' : '');
          nodes['gl-fps'][i].innerHTML = fps.toFixed(0) + ' FPS';
          logger(names[i], cpu, gpu, mem, fps, totalTime, frameId);
        }
      })(this.paramLogger, this.dom, this.names);

      this.chartLogger = ((logger, dom) => {
        let nodes = { 'gl-chart': dom.getElementsByClassName('gl-chart') };
        return (i, chart, circularId) => {
          let points = '';
          let len = chart.length;
          for (let i = 0; i < len; i++) {
            let id = (circularId + i + 1) % len;
            if (chart[id] != undefined) {
              points = points + ' ' + (55 * i / (len - 1)).toFixed(1) + ','
                + (45 - chart[id] * 22 / 60 / this.detected).toFixed(1);
            }
          }
          nodes['gl-chart'][i].setAttribute('points', points);
          logger(this.names[i], chart, circularId);
        }
      })(this.chartLogger, this.dom);
    }
  }

  /**
   * Explicit UI add
   * @param { string | undefined } name 
   */
  addUI(name) {
    if (this.names.indexOf(name) == -1) {
      this.names.push(name);
      if (this.dom) {
        this.dom.insertAdjacentHTML('beforeend', this.svg);
        this.updateUI();
      }
      this.cpuAccums.push(0);
      this.gpuAccums.push(0);
      this.activeAccums.push(false);
    }
  }

  /**
   * Increase frameID
   * @param { number | undefined } now
   */
  nextFrame(now) {
    this.frameId++;
    const t = (now !== undefined && now !== null) ? now : this.now();

    // params
    if (this.frameId <= 1) {
      this.paramFrame = this.frameId;
      this.paramTime = t;
    } else {
      let duration = t - this.paramTime;
      if (duration >= 1e3) {
        const frameCount = this.frameId - this.paramFrame;
        const fps = frameCount / duration * 1e3;
        // Report the closing window exactly as before and while
        // this.gpuAccums/this.finished still point at that window.
        for (let i = 0; i < this.names.length; i++) {
          const cpu = this.cpuAccums[i] / duration * 100,
            gpu = this.gpuAccums[i] / duration * 100,
            mem = (typeof performance !== 'undefined' && performance.memory) ? performance.memory.usedJSHeapSize / (1 << 20) : 0;
          this.paramLogger(i, cpu, gpu, mem, fps, duration, frameCount);
          this.cpuAccums[i] = 0;
        }
        // Open a fresh stats window. In-flight probes already captured the
        // previous gpuAccums/finished references, so they settle inside the
        // old window and can neither write the new gpuAccums nor clear the
        // new finished list.
        this.gpuAccums = new Array(this.names.length).fill(0);
        this.finished = [];
        this.paramFrame = this.frameId;
        this.paramTime = t;
      }
    }

    // chart
    if (!this.detected || !this.chartFrame) {
      this.chartFrame = this.frameId;
      this.chartTime = t;
      this.circularId = 0;
    } else {
      let timespan = t - this.chartTime;
      let hz = this.chartHz * timespan / 1e3;
      while (--hz > 0 && this.detected) {
        const frameCount = this.frameId - this.chartFrame;
        const fps = frameCount / timespan * 1e3;
        this.chart[this.circularId % this.chartLen] = fps;
        for (let i = 0; i < this.names.length; i++) {
          this.chartLogger(i, this.chart, this.circularId);
        }
        this.circularId++;
        this.chartFrame = this.frameId;
        this.chartTime = t;
      }
    }
  }

  /**
   * Begin named measurement
   * @param { string | undefined } name
   */
  begin(name) {
    this.updateAccums(name);
  }

  /**
   * End named measure
   * @param { string | undefined } name
   */
  end(name) {
    this.updateAccums(name);
  }

  updateAccums(name) {
    let nameId = this.names.indexOf(name);
    if (nameId == -1) {
      nameId = this.names.length;
      this.addUI(name);
    }

    const t = this.now();
    const dt = t - this.t0;
    for (let i = 0; i < nameId + 1; i++) {
      if (this.activeAccums[i]) {
        this.cpuAccums[i] += dt;
      }
    };
    this.activeAccums[nameId] = !this.activeAccums[nameId];
    this.t0 = t;
  }

}
