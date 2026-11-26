import util from '../gl-utils';
import DrawParticleGraph from '../shaderGraph/DrawParticleGraph';
import makeUpdatePositionProgram from './updatePositionProgram';
import { encodeFloatRGBA } from '../utils/floatPacking.js';
import config from '../config';
import createAudioProgram from './audioProgram';

/**
 * This program manages particles life-cycle. It updates particles positions
 * and initiates drawing them on screen.
 * 
 * @param {Object} ctx rendering context. Holds WebGL state
 * @param {Object=} options. `onCodeUpdated` is invoked after the vector field
 * code was successfully applied, so that owners of the accumulated screen
 * history (see `screenProgram`) can drop it.
 */
export default function drawParticlesProgram(ctx, options) {
  var gl = ctx.gl;
  var onCodeUpdated = (options && options.onCodeUpdated) || function() {};

  var particleStateResolution, particleIndexBuffer;
  var numParticles;

  var currentVectorField = '';
  var updatePositionProgram = makeUpdatePositionProgram(ctx);
  var audioProgram;
  var disposed = false;

  var drawProgram;
  initPrograms();

  return {
    updateParticlesCount,
    updateParticlesPositions,
    drawParticles,
    updateCode,
    updateColorMode,
    dispose
  }

  function initPrograms() {
    // need to update the draw graph because color mode shader has changed.
    replaceDrawProgram();

    if (config.isAudioEnabled) {
      if (audioProgram) audioProgram.dispose();
      audioProgram = createAudioProgram(ctx);
    }
  }

  /**
   * Compiles the draw program for the current state, then swaps it in. The
   * previous program is released only after the replacement is known to be
   * valid, so a shader compilation error can never leave us rendering with a
   * deleted program.
   */
  function replaceDrawProgram() {
    setDrawProgram(createDrawProgram(currentVectorField));
  }

  function createDrawProgram(vectorFieldCode) {
    const drawGraph = new DrawParticleGraph(ctx);
    const vertexShaderCode = drawGraph.getVertexShader(vectorFieldCode);
    return util.createProgram(gl, vertexShaderCode, drawGraph.getFragmentShader());
  }

  function setDrawProgram(nextDrawProgram) {
    if (disposed) {
      if (nextDrawProgram) nextDrawProgram.unload();
      return;
    }

    var prevDrawProgram = drawProgram;
    drawProgram = nextDrawProgram;
    if (prevDrawProgram) prevDrawProgram.unload();
  }

  function updateParticlesPositions() {
    if (disposed) return;
    if (!currentVectorField) return;

    ctx.frame += 1
    ctx.frameSeed = Math.random();

    // TODO: Remove this.
    if (audioProgram) audioProgram.updateTextures();

    updatePositionProgram.updateParticlesPositions();
  }

  function updateColorMode() {
    if (disposed) return;
    replaceDrawProgram();
  }

  function updateCode(vfCode) {
    if (disposed) return;

    // Build both programs before touching any existing state. If either of the
    // shaders fails to compile, the error propagates to the editor and the
    // previous, fully functional programs remain in use.
    var nextUpdateProgram = updatePositionProgram.createProgram(vfCode);
    var nextDrawProgram;
    try {
      nextDrawProgram = createDrawProgram(vfCode);
    } catch (e) {
      nextUpdateProgram.unload();
      throw e;
    }

    ctx.frame = 0;
    currentVectorField = vfCode;

    updatePositionProgram.setProgram(nextUpdateProgram);
    setDrawProgram(nextDrawProgram);

    // Traces accumulated for the previous field no longer describe anything
    // meaningful - let the screen owner clear them before the next frame.
    onCodeUpdated();
  }

  function updateParticlesCount() {
    if (disposed) return;

    particleStateResolution = ctx.particleStateResolution;
    numParticles = particleStateResolution * particleStateResolution;
    var particleIndices = new Float32Array(numParticles);
    var particleStateX = new Uint8Array(numParticles * 4);
    var particleStateY = new Uint8Array(numParticles * 4);

    var minX = ctx.bbox.minX; var minY = ctx.bbox.minY;
    var width = ctx.bbox.maxX - minX;
    var height = ctx.bbox.maxY - minY;
    for (var i = 0; i < numParticles; i++) {
      encodeFloatRGBA((Math.random()) * width + minX, particleStateX, i * 4); // randomize the initial particle positions
      encodeFloatRGBA((Math.random()) * height + minY, particleStateY, i * 4); // randomize the initial particle positions

      particleIndices[i] = i;
    }

    if (particleIndexBuffer) gl.deleteBuffer(particleIndexBuffer);
    particleIndexBuffer = util.createBuffer(gl, particleIndices);

    updatePositionProgram.updateParticlesCount(particleStateX, particleStateY);
  }

  function drawParticles() {
    if (disposed) return;
    if (!currentVectorField) return;

    var program = drawProgram;
    if (!program) return;

    gl.useProgram(program.program);

    util.bindAttribute(gl, particleIndexBuffer, program.a_index, 1);

    updatePositionProgram.prepareToDraw(program);
    ctx.inputs.updateBindings(program);

    gl.uniform1f(program.u_h, ctx.integrationTimeStep);
    gl.uniform1f(program.frame, ctx.frame);
    gl.uniform1f(program.u_particles_res, particleStateResolution);
    var bbox = ctx.bbox;
    gl.uniform2f(program.u_min, bbox.minX, bbox.minY);
    gl.uniform2f(program.u_max, bbox.maxX, bbox.maxY);

    var cursor = ctx.cursor;
    gl.uniform4f(program.cursor, cursor.clickX, cursor.clickY, cursor.hoverX, cursor.hoverY);
    gl.drawArrays(gl.POINTS, 0, numParticles);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;

    updatePositionProgram.dispose();

    if (drawProgram) {
      drawProgram.unload();
      drawProgram = null;
    }
    if (particleIndexBuffer) {
      gl.deleteBuffer(particleIndexBuffer);
      particleIndexBuffer = null;
    }
    if (audioProgram) {
      audioProgram.dispose();
      audioProgram = null;
    }
  }
}
