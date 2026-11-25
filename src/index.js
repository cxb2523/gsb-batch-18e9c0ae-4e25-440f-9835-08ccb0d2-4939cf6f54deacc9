import DEFAULTS from './defaults.js';
import {
  WINDOW,
} from './constants.js';
import {
  getAdjustedSizes,
  imageTypeToExtension,
  isCanvasReliable,
  isImageType,
  isPositiveNumber,
  normalizeDecimalNumber,
  resetOrientation,
  getExif,
  insertExif,
  stripExif,
  uint8ArrayToBlob,
} from './utilities.js';

const { ArrayBuffer, FileReader } = WINDOW;
const URL = WINDOW.URL || WINDOW.webkitURL;
const REGEXP_EXTENSION = /\.\w+$/;

/**
 * Wrap a blob as the output file.
 * @param {Blob} blob - The blob to wrap.
 * @param {string} name - The name of the output file.
 * @param {string} type - The mime type of the output file.
 * @param {number} [lastModified] - The modification time to stamp on the file.
 * @returns {File} The output file.
 */
function toFile(blob, name, type, lastModified = Date.now()) {
  return new File([blob], name, {
    type,
    lastModified,
  });
}

/**
 * Creates a new image compressor.
 * @class
 */
export default class Compressor {
  /**
   * The constructor of Compressor.
   * @param {File|Blob} file - The target image file for compressing.
   * @param {Object} [options] - The options for compressing.
   */
  constructor(file, options) {
    this.file = file;
    this.exif = [];
    this.image = new Image();
    this.options = {
      ...DEFAULTS,
      ...options,
    };
    this.mimeTypeSet = options && options.mimeType && isImageType(options.mimeType);
    this.aborted = false;

    // Set once `success`/`error` has been delivered (or `fail` starts
    // throwing), so no late EXIF read/insert callback can settle twice.
    this.settled = false;
    this.canvasFallback = false;
    this.result = null;
    this.url = null;
    this.init();
  }

  init() {
    const { file, options } = this;

    if (!(file instanceof Blob)) {
      this.fail(new Error('The first argument must be a File or Blob object.'));
      return;
    }

    const mimeType = file.type;

    if (!isImageType(mimeType)) {
      this.fail(new Error('The first argument must be an image File or Blob object.'));
      return;
    }

    if (!URL || !FileReader) {
      this.fail(new Error('The current browser does not support image compression.'));
      return;
    }

    if (!ArrayBuffer) {
      options.retainExif = false;
    }

    if (!isCanvasReliable()) {
      // Canvas is unreliable (e.g., Firefox fingerprinting resistance)—
      // bypass canvas to avoid corrupted output
      console.warn('Compressor.js Next: Canvas data is unreliable (e.g., due to browser fingerprinting resistance)—compression, resizing, and format conversion are unavailable');
      this.canvasFallback = true;
      if (mimeType === 'image/jpeg' && !options.retainExif) {
        // Strip EXIF data directly from the binary to preserve privacy
        this.readAsArrayBuffer(file, {
          subject: 'image',
          onData: (arrayBuffer) => {
            let blob;

            try {
              blob = uint8ArrayToBlob(stripExif(arrayBuffer), mimeType);
            } catch {
              this.fail(new Error('Failed to process the image data.'));
              return;
            }

            this.succeed(toFile(blob, file.name || '', mimeType));
          },
        });
      } else {
        // Non-JPEG: No EXIF to strip, return as-is
        // Defer callback to match the normal async flow
        Promise.resolve().then(() => {
          if (this.aborted) return;
          this.succeed(file);
        });
      }

      return;
    }

    const isJPEGImage = mimeType === 'image/jpeg';
    const retainExif = isJPEGImage && options.retainExif;

    if (!retainExif) {
      this.url = URL.createObjectURL(file);
      this.load({
        url: this.url,
      });
    } else {
      this.readAsArrayBuffer(file, {
        subject: 'image',
        onData: (arrayBuffer) => {
          // Normalize EXIF orientation to 1 before extracting, since the browser
          // handles rotation natively via `image-orientation: from-image`
          resetOrientation(arrayBuffer);
          this.exif = getExif(arrayBuffer);
          this.url = URL.createObjectURL(file);
          this.load({
            url: this.url,
          });
        },
      });
    }
  }

  load(data) {
    const { file, image } = this;

    image.onload = () => {
      this.draw({
        ...data,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
      });
    };
    image.onabort = () => {
      this.fail(new Error('Aborted to load the image.'));
    };
    image.onerror = () => {
      this.fail(new Error('Failed to load the image.'));
    };

    // Match all browsers that use WebKit as the layout engine in iOS devices,
    // such as Safari for iOS, Chrome for iOS, and in-app browsers
    if (WINDOW.navigator && /(?:iPad|iPhone|iPod).*?AppleWebKit/i.test(WINDOW.navigator.userAgent)) {
      // Fix the `The operation is insecure` error (#57)
      image.crossOrigin = 'anonymous';
    }

    image.alt = file.name;
    image.src = data.url;
  }

  draw({ naturalWidth, naturalHeight }) {
    const { file, image, options } = this;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const resizable = (options.resize === 'contain' || options.resize === 'cover') && isPositiveNumber(options.width) && isPositiveNumber(options.height);
    let maxWidth = Math.max(options.maxWidth, 0) || Infinity;
    let maxHeight = Math.max(options.maxHeight, 0) || Infinity;
    let minWidth = Math.max(options.minWidth, 0) || 0;
    let minHeight = Math.max(options.minHeight, 0) || 0;
    let aspectRatio = naturalWidth / naturalHeight;
    let { width, height } = options;

    if (resizable) {
      aspectRatio = width / height;
    }

    ({ width: maxWidth, height: maxHeight } = getAdjustedSizes({
      aspectRatio,
      width: maxWidth,
      height: maxHeight,
    }, 'contain'));
    ({ width: minWidth, height: minHeight } = getAdjustedSizes({
      aspectRatio,
      width: minWidth,
      height: minHeight,
    }, 'cover'));

    if (resizable) {
      ({ width, height } = getAdjustedSizes({
        aspectRatio,
        width,
        height,
      }, options.resize));
    } else {
      ({ width = naturalWidth, height = naturalHeight } = getAdjustedSizes({
        aspectRatio,
        width,
        height,
      }));
    }

    width = Math.floor(normalizeDecimalNumber(Math.min(Math.max(width, minWidth), maxWidth)));
    height = Math.floor(normalizeDecimalNumber(Math.min(Math.max(height, minHeight), maxHeight)));

    const params = [];

    if (resizable) {
      const { width: srcWidth, height: srcHeight } = getAdjustedSizes({
        aspectRatio,
        width: naturalWidth,
        height: naturalHeight,
      }, {
        contain: 'cover',
        cover: 'contain',
      }[options.resize]);
      const srcX = (naturalWidth - srcWidth) / 2;
      const srcY = (naturalHeight - srcHeight) / 2;

      params.push(srcX, srcY, srcWidth, srcHeight);
    }

    params.push(0, 0, width, height);

    canvas.width = width;
    canvas.height = height;

    if (!isImageType(options.mimeType)) {
      options.mimeType = file.type;
    }

    let fillStyle = 'transparent';

    // Converts files over the `convertSize` to JPEG,
    // unless the user explicitly set a `mimeType`.
    if (!this.mimeTypeSet && file.size > options.convertSize
      && options.convertTypes.indexOf(options.mimeType) >= 0) {
      options.mimeType = 'image/jpeg';
    }

    const isJPEGImage = options.mimeType === 'image/jpeg';

    if (isJPEGImage) {
      fillStyle = '#fff';
    }

    // Override the default fill color (`#000`, black)
    context.fillStyle = fillStyle;
    context.fillRect(0, 0, width, height);

    if (options.beforeDraw) {
      options.beforeDraw.call(this, context, canvas);
    }

    if (this.aborted) {
      return;
    }

    context.drawImage(image, ...params);

    if (options.drew) {
      options.drew.call(this, context, canvas);
    }

    if (this.aborted) {
      return;
    }

    // Hand the raw canvas output to `done()`; all EXIF retention/stripping is
    // applied once there, after fallback decisions and based on the final
    // output type, so every output path shares the same data flow.
    canvas.toBlob((blob) => {
      if (this.aborted || this.settled) {
        return;
      }

      this.done({
        naturalWidth,
        naturalHeight,
        result: blob,
      });
    }, options.mimeType, options.quality);
  }

  done({
    naturalWidth,
    naturalHeight,
    result,
  }) {
    const { file, options } = this;

    if (this.aborted || this.settled) {
      return;
    }

    this.revokeUrl();

    // Decide only which bytes to deliver: the canvas output or the original
    // file (strict fallback, or when the canvas produced no output). EXIF
    // policy is applied afterwards by `output()` for every path alike.
    let fallbackToOriginal = !result;

    if (
      result

      // Returns original file if the result is greater than it and without
      // size-related options. Strict stays disabled while EXIF retention is
      // requested, matching the documented contract; `output()` still applies
      // the retain/strip policy uniformly to every fallback path.
      && options.strict
      && !options.retainExif
      && result.size > file.size
      && options.mimeType === file.type
      && !(
        options.width > naturalWidth
        || options.height > naturalHeight
        || options.minWidth > naturalWidth
        || options.minHeight > naturalHeight
        || options.maxWidth < naturalWidth
        || options.maxHeight < naturalHeight
      )
    ) {
      fallbackToOriginal = true;
    }

    if (fallbackToOriginal) {
      if (!result) {
        // Returns original file if the result is null in some cases
        console.warn('Compressor.js Next: Canvas produced no output—returning the original image');
      }

      this.output(file, {
        name: file.name || '',
        type: file.type,
        lastModified: file.lastModified ?? Date.now(),
        original: file,
      });
      return;
    }

    let name = file.name || '';
    const { type } = result;

    // Convert the extension to match its type
    if (name && type !== file.type) {
      name = name.replace(
        REGEXP_EXTENSION,
        imageTypeToExtension(type),
      );
    }

    this.output(result, {
      name,
      type,
    });
  }

  /**
   * Apply the single EXIF policy for the final output and deliver it.
   *
   * When `retainExif` is `true`, JPEG output carries the original APP1/EXIF
   * segment: freshly encoded canvas blobs have the extracted segment inserted,
   * while an original-file fallback already contains it and passes through.
   *
   * When `retainExif` is `false`, every JPEG output—including the strict and
   * no-output fallbacks to the original file—is stripped of APP1/EXIF.
   *
   * All asynchronous reads stop once `abort()` was called, and delivery is
   * guarded against settling more than once.
   * @param {Blob} blob - The final image bytes.
   * @param {Object} [meta] - Output metadata.
   * @param {string} [meta.name] - The output file name.
   * @param {string} [meta.type] - The output MIME type.
   * @param {number} [meta.lastModified] - The output modification timestamp.
   * @param {File} [meta.original] - The source file for fallback paths,
   *   returned untouched when no byte transformation is required.
   * @returns {void}
   */
  output(blob, {
    name = '',
    type = blob.type,
    lastModified,
    original = null,
  } = {}) {
    const { options } = this;
    const mimeType = isImageType(type) ? type : options.mimeType;

    // Only JPEG data carries an APP1/EXIF segment.
    if (mimeType !== 'image/jpeg') {
      this.succeed(original || toFile(blob, name, mimeType, lastModified));
      return;
    }

    if (options.retainExif) {
      // An original-file fallback already carries its EXIF segment. For
      // canvas output, insert the segment extracted during initialization.
      if (original || !this.exif || this.exif.length === 0) {
        this.succeed(original || toFile(blob, name, mimeType, lastModified));
        return;
      }

      this.readBlobAsArrayBuffer(blob, (arrayBuffer) => {
        if (this.aborted || this.settled) {
          return;
        }

        let output;

        try {
          output = uint8ArrayToBlob(insertExif(arrayBuffer, this.exif), mimeType);
        } catch (err) {
          this.fail(err);
          return;
        }

        this.succeed(toFile(output, name, mimeType));
      });
      return;
    }

    // `retainExif: false`: ensure no APP1/EXIF survives in any JPEG output,
    // including fallbacks that return the original file.
    const strip = (arrayBuffer) => {
      if (this.aborted || this.settled) {
        return;
      }

      let output;

      try {
        output = uint8ArrayToBlob(stripExif(arrayBuffer), mimeType);
      } catch (err) {
        if (original) {
          this.warnStripExifFailure(err);
          this.succeed(original);
        } else {
          this.fail(err);
        }
        return;
      }

      this.succeed(toFile(output, name, mimeType, lastModified));
    };

    if (original) {
      // Preserve the tolerant behavior for the original fallback: if its EXIF
      // cannot be stripped, warn and return the original instead of failing.
      this.readOriginalAsArrayBuffer(original, strip, (err) => {
        if (this.aborted || this.settled) {
          return;
        }

        this.warnStripExifFailure(err);
        this.succeed(original);
      });
    } else {
      this.readBlobAsArrayBuffer(blob, strip);
    }
  }

  /**
   * Warn that stripping EXIF from the original fallback file failed.
   * @param {Error} [err] - The underlying error, if any.
   * @returns {void}
   */
  warnStripExifFailure(err) {
    const { file } = this;

    console.warn(
      `Compressor.js Next: Failed to strip EXIF from original file—returning original with EXIF intact${file.name ? ` [${file.name}]` : ''}${err?.message ? `: ${err.message}` : ''}`,
    );
  }

  /**
   * Read the original fallback file as an array buffer without routing
   * failures through `fail()`, so callers can fall back gracefully.
   * @param {Blob} file - The original image file.
   * @param {Function} onData - Receives the array buffer.
   * @param {Function} onError - Receives the failure cause.
   * @returns {void}
   */
  readOriginalAsArrayBuffer(file, onData, onError) {
    if (file.arrayBuffer) {
      // Use separate fulfillment/rejection handlers so an exception thrown by
      // `onData` (e.g. a user `success` hook) is not mistaken for a read error
      // and routed through the tolerant fallback twice.
      file.arrayBuffer().then((arrayBuffer) => {
        if (this.aborted || this.settled) {
          return;
        }

        try {
          onData(arrayBuffer);
        } catch (err) {
          this.fail(err);
        }
      }, (err) => {
        if (this.aborted || this.settled) {
          return;
        }

        onError(err);
      });
    } else {
      this.readAsArrayBuffer(file, {
        subject: 'original file',
        onData,
        onError: () => {
          onError(new Error('Failed to read the original file with FileReader.'));
        },
      });
    }
  }

  /**
   * Read a blob as an array buffer, routing reader failures through `fail()`.
   * @param {Blob} blob - The blob to read.
   * @param {Object} handlers - The read handlers.
   * @param {string} handlers.subject - Names the blob in error messages.
   * @param {Function} handlers.onData - Receives the array buffer.
   * @param {Function} [handlers.onError] - Overrides the default read failure.
   */
  readAsArrayBuffer(blob, { subject, onData, onError }) {
    const reader = new FileReader();

    this.reader = reader;
    reader.onload = ({ target }) => {
      if (this.aborted) return;

      try {
        onData(target.result);
      } catch (err) {
        this.fail(err);
      }
    };
    reader.onabort = () => {
      this.fail(new Error(`Aborted to read the ${subject} with FileReader.`));
    };
    reader.onerror = onError || (() => {
      this.fail(new Error(`Failed to read the ${subject} with FileReader.`));
    });
    reader.onloadend = () => {
      this.reader = null;
    };
    reader.readAsArrayBuffer(blob);
  }

  readBlobAsArrayBuffer(blob, next) {
    if (blob.arrayBuffer) {
      blob.arrayBuffer().then(next).catch(() => {
        // Defer to a macrotask so any `abort()` scheduled via `setTimeout()`
        // in a `drew()` hook has a chance to set `this.aborted` first
        setTimeout(() => {
          if (this.aborted || this.settled) return;
          this.fail(new Error('Failed to read the compressed image with `Blob.arrayBuffer()`.'));
        }, 0);
      });
    } else {
      this.readAsArrayBuffer(blob, {
        subject: 'compressed image',
        onData: next,
      });
    }
  }

  succeed(result) {
    // Never settle twice (e.g. a late EXIF read resolving after `abort()`
    // already reported the abort, or after a previous success).
    if (this.settled) {
      return;
    }

    this.settled = true;
    this.result = result;

    if (this.options.success) {
      this.options.success.call(this, result);
    }
  }

  fail(err) {
    if (this.settled) {
      return;
    }

    this.settled = true;

    const { options } = this;

    this.revokeUrl();

    if (options.error) {
      options.error.call(this, err);
    } else {
      throw err;
    }
  }

  revokeUrl() {
    if (URL && this.url) {
      URL.revokeObjectURL(this.url);
      this.url = null;
    }
  }

  abort() {
    if (this.aborted) {
      return;
    }

    this.aborted = true;

    // Completion was already delivered (or failed): record the abort request
    // but never emit a second terminal notification.
    if (this.settled) {
      return;
    }

    if (this.reader) {
      this.reader.abort();
    } else if (!this.image.complete) {
      this.image.onload = null;
      this.image.onerror = null;
      this.image.onabort = null;
      this.fail(new Error('Aborted to load the image.'));
    } else {
      this.fail(new Error('The compression process has been aborted.'));
    }
  }

  /**
   * Change the default options.
   * @param {Object} options - The new default options.
   */
  static setDefaults(options) {
    Object.assign(DEFAULTS, options);
  }
}
