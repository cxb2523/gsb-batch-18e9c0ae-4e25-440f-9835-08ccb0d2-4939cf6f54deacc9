/**
 * Renders computed state onto the screen.
 *
 * The program owns two full-screen textures that alternate every frame. One of
 * them holds the accumulated particle traces of the previous frames, the other
 * one receives the faded copy plus the particles of the current frame. When the
 * view changes (pan/zoom) the old traces are resampled so that they stay
 * aligned with the particles that are drawn with the new bounding box.
 */
import glUtils from '../gl-utils';

const NO_TRANSFORM = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };

export default function makeScreenProgram(ctx) {
  var {gl, canvasRect} = ctx;

  var screenTexture, backgroundTexture;
  var textureWidth = 0;
  var textureHeight = 0;
  var screenProgram;
  var lastRenderedBoundingBox = null;

  // When true the accumulated screen history cannot be reused anymore (e.g. the
  // vector field code has changed) and has to be dropped before the next frame
  // is drawn. Clearing is deferred to the next frame so textures are never
  // modified in the middle of a frame - or right before a resize replaces them.
  var pendingReset = false;
  var disposed = false;

  // TODO: Allow customization? Last time I tried, I didn't like it too much.
  // It was very easy to screw up the design, and the tool looked ugly :-/
  let backgroundColor = { r: 19/255, g: 41/255, b: 79/255, a: 1 };

  screenProgram = glUtils.createProgram(gl, getScreenVertexShader(), getScreenFragmentShader());

  var api = {
    fadeOutLastFrame,
    renderCurrentScreen,
    updateScreenTextures,
    resetScreen,
    dispose,

    boundingBoxUpdated: false
  };

  // Allocate the first pair of textures without any history.
  updateScreenTextures();

  return api;

  /**
   * Marks the accumulated screen history as invalid. The actual clearing
   * happens at the beginning of the next frame, so the caller can safely invoke
   * this from anywhere (including from inside a shader rebuild).
   */
  function resetScreen() {
    if (disposed) return;
    pendingReset = true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;

    if (screenTexture) {
      gl.deleteTexture(screenTexture);
      screenTexture = null;
    }
    if (backgroundTexture) {
      gl.deleteTexture(backgroundTexture);
      backgroundTexture = null;
    }
    if (screenProgram) {
      screenProgram.unload();
      screenProgram = null;
    }

    lastRenderedBoundingBox = null;
    pendingReset = false;
  }

  function fadeOutLastFrame() {
    if (disposed) return;

    // The canvas rectangle is owned by `scene`. Follow it lazily so that even
    // several resize events between two frames can never leave the screen
    // textures at a size that disagrees with the viewport.
    ensureTextureSize();

    var textureTransform = NO_TRANSFORM;
    var shouldReset = pendingReset;
    pendingReset = false;

    if (shouldReset) {
      // Nothing from the previous frames may survive.
      lastRenderedBoundingBox = null;
      api.boundingBoxUpdated = false;
    } else if (api.boundingBoxUpdated) {
      textureTransform = getTextureTransform();
    }

    glUtils.bindFramebuffer(gl, ctx.framebuffer, screenTexture);
    gl.viewport(0, 0, textureWidth, textureHeight);

    // Always clear the destination: when the resampled history does not cover
    // the whole screen (e.g. zoomed out) the uncovered pixels must be empty,
    // not a stale frame from two frames ago.
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (!shouldReset) {
      drawTexture(backgroundTexture, ctx.fadeOpacity, textureTransform);
    }
  }

  function renderCurrentScreen() {
    if (disposed) return;

    glUtils.bindFramebuffer(gl, null);
    gl.viewport(0, 0, textureWidth, textureHeight);

    saveLastBbox();

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(backgroundColor.r, backgroundColor.g, backgroundColor.b, backgroundColor.a);
    gl.clear(gl.COLOR_BUFFER_BIT);
    drawTexture(screenTexture, 1.0, NO_TRANSFORM);
    gl.disable(gl.BLEND);

    var temp = backgroundTexture;
    backgroundTexture = screenTexture;
    screenTexture = temp;

    api.boundingBoxUpdated = false;
    if (window.audioTexture) {
      drawTexture(window.audioTexture, 1.0, NO_TRANSFORM);
    }
  }

  /**
   * Recreates the screen textures to match the current canvas rectangle. Any
   * accumulated history is intentionally discarded: it was produced for a
   * different texture geometry and cannot be reused.
   */
  function updateScreenTextures() {
    if (disposed) return;

    var width = getTextureWidth();
    var height = getTextureHeight();
    var emptyPixels = new Uint8Array(width * height * 4);

    if (screenTexture) {
      gl.deleteTexture(screenTexture);
    }
    if (backgroundTexture) {
      gl.deleteTexture(backgroundTexture);
    }

    screenTexture = glUtils.createTexture(gl, gl.NEAREST, emptyPixels, width, height);
    backgroundTexture = glUtils.createTexture(gl, gl.NEAREST, emptyPixels, width, height);
    textureWidth = width;
    textureHeight = height;

    // Fresh textures have no history, so there is nothing to compensate and
    // nothing that needs to be cleared on the next frame.
    lastRenderedBoundingBox = null;
    pendingReset = false;
    api.boundingBoxUpdated = false;
  }

  function ensureTextureSize() {
    if (textureWidth !== getTextureWidth() || textureHeight !== getTextureHeight()) {
      updateScreenTextures();
    }
  }

  function getTextureWidth() {
    return Math.max(1, Math.round(canvasRect.width));
  }

  function getTextureHeight() {
    return Math.max(1, Math.round(canvasRect.height));
  }

  /**
   * Computes the mapping from the current view to the view the history was
   * rendered with, in texture coordinates (u grows to the right, v grows
   * upwards; see the particle shader for the exact convention):
   *
   *   previous = current * scale + offset
   *
   * The mapping is derived from the two bounding boxes - exactly the projection
   * used by the particle shaders - so traces stay aligned under pan and zoom.
   */
  function getTextureTransform() {
    if (!canCompensate(lastRenderedBoundingBox)) return NO_TRANSFORM;

    var currentWidth = ctx.bbox.maxX - ctx.bbox.minX;
    // The Y axis of the bounding box is stored "flipped" (minY is positive), so
    // the positive texture height is `minY - maxY`.
    var currentHeight = ctx.bbox.minY - ctx.bbox.maxY;
    var previousWidth = lastRenderedBoundingBox.maxX - lastRenderedBoundingBox.minX;
    var previousHeight = lastRenderedBoundingBox.minY - lastRenderedBoundingBox.maxY;

    return {
      scaleX: currentWidth / previousWidth,
      scaleY: currentHeight / previousHeight,
      // Texture v = 0 corresponds to the bounding box maxY (the bottom edge).
      offsetX: (ctx.bbox.minX - lastRenderedBoundingBox.minX) / previousWidth,
      offsetY: (ctx.bbox.maxY - lastRenderedBoundingBox.maxY) / previousHeight,
    };
  }

  function canCompensate(boundingBox) {
    if (!boundingBox) return false;

    var currentWidth = ctx.bbox.maxX - ctx.bbox.minX;
    var currentHeight = ctx.bbox.minY - ctx.bbox.maxY;
    var previousWidth = boundingBox.maxX - boundingBox.minX;
    var previousHeight = boundingBox.minY - boundingBox.maxY;

    return isPositiveFinite(currentWidth) && isPositiveFinite(currentHeight) &&
      isPositiveFinite(previousWidth) && isPositiveFinite(previousHeight) &&
      isFinite(ctx.bbox.minX) && isFinite(ctx.bbox.maxY) &&
      isFinite(boundingBox.minX) && isFinite(boundingBox.maxY);
  }

  function saveLastBbox() {
    if (!lastRenderedBoundingBox) {
      lastRenderedBoundingBox = {
        minX: ctx.bbox.minX,
        minY: ctx.bbox.minY,
        maxX: ctx.bbox.maxX,
        maxY: ctx.bbox.maxY
      }

      return;
    }

    lastRenderedBoundingBox.minX = ctx.bbox.minX;
    lastRenderedBoundingBox.minY = ctx.bbox.minY;
    lastRenderedBoundingBox.maxX = ctx.bbox.maxX;
    lastRenderedBoundingBox.maxY = ctx.bbox.maxY;
  }

  function drawTexture(texture, opacity, textureTransform) {
    if (!texture || !screenProgram) return;

    var program = screenProgram;
    gl.useProgram(program.program);
    glUtils.bindAttribute(gl, ctx.quadBuffer, program.a_pos, 2);

    // TODO: This index is very fragile. I need to find a way
    glUtils.bindTexture(gl, texture, ctx.screenTextureUnit);
    gl.uniform1i(program.u_screen, ctx.screenTextureUnit);

    gl.uniform1f(program.u_opacity, opacity);
    gl.uniform1f(program.u_scale_x, textureTransform.scaleX);
    gl.uniform1f(program.u_scale_y, textureTransform.scaleY);
    gl.uniform1f(program.u_offset_x, textureTransform.offsetX);
    gl.uniform1f(program.u_offset_y, textureTransform.offsetY);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}

function isPositiveFinite(x) {
  return Number.isFinite(x) && x > 0;
}

function getScreenVertexShader() {
  return `// screen program
precision highp float;

attribute vec2 a_pos;
varying vec2 v_screen_pos;

void main() {
    // The quad covers the whole screen. a_pos is (0,0) at the bottom-left and
    // (1,1) at the top-right; the fragment shader remaps it through the
    // bounding box change.
    v_screen_pos = a_pos;
    gl_Position = vec4(2.0 * a_pos.x - 1.0, 2.0 * a_pos.y - 1.0, 0, 1);
}`
}

function getScreenFragmentShader() {
  return `precision highp float;
uniform sampler2D u_screen;
uniform float u_opacity;
uniform float u_scale_x;
uniform float u_scale_y;
uniform float u_offset_x;
uniform float u_offset_y;

varying vec2 v_screen_pos;

void main() {
  // Remap the current screen position back into the view the history was
  // rendered with (both go from the bounding box min to max).
  vec2 previous = vec2(
    v_screen_pos.x * u_scale_x + u_offset_x,
    v_screen_pos.y * u_scale_y + u_offset_y
  );

  if (previous.x < 0.0 || previous.x > 1.0 || previous.y < 0.0 || previous.y > 1.0) {
    // The history does not cover this part of the screen.
    gl_FragColor = vec4(0.);
    return;
  }

  vec4 color = texture2D(u_screen, previous);

  // opacity fade out even with a value close to 0.0
  gl_FragColor = vec4(floor(255.0 * color * u_opacity) / 255.0);
}`
}
