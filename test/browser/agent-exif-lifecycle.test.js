import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  Compressor,
  compress,
  loadImageAsBlob,
  TEST_IMAGE,
  TEST_IMAGE_PNG,
  utilities,
  buildJpeg,
  jpegSegment,
  exifPayload,
} from './helpers.js';

const { getExif } = utilities;

function readExifLength(blob) {
  return blob.arrayBuffer().then((arrayBuffer) => getExif(arrayBuffer).length);
}

function flush(ms = 30) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Stub `canvas.toBlob` inside `drew` to emit the given blob (async, like the
 * real API) instead of the actual canvas encoding.
 */
function emitBlobInDrew(outputBlob) {
  return {
    drew(context, canvas) {
      canvas.toBlob = (callback) => {
        setTimeout(() => callback(outputBlob), 0);
      };
    },
  };
}

describe('EXIF lifecycle consistency', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('retainExif: true', () => {
    it('keeps the original EXIF segment on normal JPEG output', async () => {
      const image = await loadImageAsBlob(TEST_IMAGE);
      const originalExifLength = await readExifLength(image);
      const { result } = await compress(image, { retainExif: true });

      expect(result.type).toBe('image/jpeg');
      const exifLength = await readExifLength(result);

      expect(exifLength).toBeGreaterThan(0);
      expect(exifLength).toBe(originalExifLength);
    });

    it('does not let strict return the original when retainExif is true', async () => {
      const image = await loadImageAsBlob(TEST_IMAGE);
      const oversized = new Blob(
        [new Uint8Array(image.size + 1000)],
        { type: 'image/jpeg' },
      );

      const { result } = await compress(image, {
        retainExif: true,
        ...emitBlobInDrew(oversized),
      });

      // The documented strict exception keeps the (EXIF-inserted) compressed
      // output instead of falling back to the original file.
      expect(result).not.toBe(image);
      expect(result).toBeInstanceOf(File);
      expect(result.type).toBe('image/jpeg');
    });

    it('keeps EXIF when the canvas produces no output', async () => {
      const image = await loadImageAsBlob(TEST_IMAGE);
      const { result } = await compress(image, {
        retainExif: true,
        drew(context, canvas) {
          canvas.toBlob = (callback) => callback(null);
        },
      });

      expect(result.type).toBe('image/jpeg');
      expect(await readExifLength(result)).toBeGreaterThan(0);
    });
  });

  describe('retainExif: false', () => {
    it('strips EXIF through a naturally triggered strict fallback', async () => {
      const image = await loadImageAsBlob(TEST_IMAGE);
      const { result } = await compress(image, { quality: 1 });

      expect(result.type).toBe('image/jpeg');
      expect(result.size).toBeLessThanOrEqual(image.size);
      expect(await readExifLength(result)).toBe(0);
    });

    it('strips EXIF through the strict fallback branch', async () => {
      const image = await loadImageAsBlob(TEST_IMAGE);
      const oversized = new Blob(
        [new Uint8Array(image.size + 1000)],
        { type: 'image/jpeg' },
      );

      const { result } = await compress(image, {
        ...emitBlobInDrew(oversized),
      });

      expect(result.type).toBe('image/jpeg');
      expect(result.size).toBeLessThan(image.size);
      expect(await readExifLength(result)).toBe(0);
    });

    it('strips EXIF from the strict fallback using the FileReader path', async () => {
      const image = await loadImageAsBlob(TEST_IMAGE);

      // Force the non-`Blob#arrayBuffer` read strategy.
      Object.defineProperty(image, 'arrayBuffer', {
        value: undefined,
        configurable: true,
      });

      const oversized = new Blob(
        [new Uint8Array(image.size + 1000)],
        { type: 'image/jpeg' },
      );

      const { result } = await compress(image, {
        ...emitBlobInDrew(oversized),
      });

      expect(result.type).toBe('image/jpeg');
      expect(await readExifLength(result)).toBe(0);
    });

    it('strips EXIF when the canvas produces no output', async () => {
      const image = await loadImageAsBlob(TEST_IMAGE);
      const { result } = await compress(image, {
        drew(context, canvas) {
          canvas.toBlob = (callback) => callback(null);
        },
      });

      expect(result.type).toBe('image/jpeg');
      expect(await readExifLength(result)).toBe(0);
    });

    it('strips APP1/EXIF from JPEG produced via convertTypes', async () => {
      const image = await loadImageAsBlob(TEST_IMAGE_PNG);

      // Simulate an encoder (e.g. WebKit preserving source metadata) that
      // emitted an EXIF-bearing JPEG after PNG -> JPEG conversion.
      const jpegWithExif = new Blob(
        [buildJpeg([jpegSegment(0xE1, exifPayload(1))])],
        { type: 'image/jpeg' },
      );

      expect(await readExifLength(jpegWithExif)).toBeGreaterThan(0);

      const { result } = await compress(image, {
        convertTypes: ['image/png'],
        convertSize: 0,
        ...emitBlobInDrew(jpegWithExif),
      });

      expect(result.type).toBe('image/jpeg');
      expect(await readExifLength(result)).toBe(0);
    });
  });

  describe('abort during asynchronous EXIF processing', () => {
    function deferred() {
      let resolve;
      let reject;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });

      return { promise, resolve, reject };
    }

    it('does not settle again after abort during EXIF insertion', async () => {
      const image = await loadImageAsBlob(TEST_IMAGE);
      const d = deferred();
      const arrayBufferSpy = vi
        .spyOn(Blob.prototype, 'arrayBuffer')
        .mockReturnValue(d.promise);
      const success = vi.fn();
      const error = vi.fn();

      const compressor = new Compressor(image, {
        retainExif: true,
        success,
        error,
      });

      await vi.waitFor(() => expect(arrayBufferSpy).toHaveBeenCalled());
      compressor.abort();

      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0][0].message).toBe(
        'The compression process has been aborted.',
      );
      expect(success).not.toHaveBeenCalled();

      // Let the pending read resolve afterwards; no late settlement allowed.
      d.resolve(new ArrayBuffer(8));
      await flush();

      expect(success).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledTimes(1);
    });

    it('does not settle again after abort during EXIF stripping', async () => {
      const image = await loadImageAsBlob(TEST_IMAGE);
      const d = deferred();
      const arrayBufferSpy = vi
        .spyOn(Blob.prototype, 'arrayBuffer')
        .mockReturnValue(d.promise);
      const success = vi.fn();
      const error = vi.fn();

      const compressor = new Compressor(image, {
        success,
        error,
      });

      await vi.waitFor(() => expect(arrayBufferSpy).toHaveBeenCalled());
      compressor.abort();

      expect(error).toHaveBeenCalledTimes(1);
      expect(success).not.toHaveBeenCalled();

      d.resolve(new ArrayBuffer(8));
      await flush();

      expect(success).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledTimes(1);
    });

    it('does not succeed after abort during strict-fallback EXIF stripping', async () => {
      const image = await loadImageAsBlob(TEST_IMAGE);
      const originalBuffer = await image.arrayBuffer();
      const d = deferred();
      const arrayBufferSpy = vi
        .spyOn(Blob.prototype, 'arrayBuffer')
        .mockReturnValue(d.promise);
      const success = vi.fn();
      const error = vi.fn();
      const oversized = new Blob(
        [new Uint8Array(image.size + 1000)],
        { type: 'image/jpeg' },
      );

      const compressor = new Compressor(image, {
        ...emitBlobInDrew(oversized),
        success,
        error,
      });

      await vi.waitFor(() => expect(arrayBufferSpy).toHaveBeenCalled());
      compressor.abort();

      expect(error).toHaveBeenCalledTimes(1);
      expect(success).not.toHaveBeenCalled();

      d.resolve(originalBuffer);
      await flush();

      expect(success).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledTimes(1);
    });

    it('ignores abort after success without emitting an error', async () => {
      const image = await loadImageAsBlob(TEST_IMAGE);
      const error = vi.fn();

      const { compressor } = await compress(image, {
        error,
        success() {
          this.abort();
        },
      });

      await flush();

      expect(compressor.aborted).toBe(true);
      expect(error).not.toHaveBeenCalled();
    });
  });

  describe('terminal guards and read fallbacks', () => {
    function bareCompressor(options = {}) {
      const compressor = Object.create(Compressor.prototype);

      compressor.options = { success: vi.fn(), error: vi.fn(), ...options };
      compressor.aborted = false;
      compressor.settled = false;
      compressor.reader = null;
      compressor.url = null;
      compressor.result = null;
      return compressor;
    }

    it('delivers `success` at most once', () => {
      const compressor = bareCompressor();

      compressor.succeed('first');
      compressor.succeed('second');

      expect(compressor.options.success).toHaveBeenCalledTimes(1);
      expect(compressor.options.success).toHaveBeenCalledWith('first');
      expect(compressor.result).toBe('first');
    });

    it('delivers `error` at most once', () => {
      const compressor = bareCompressor();
      const err = new Error('boom');

      compressor.fail(err);
      compressor.fail(new Error('again'));

      expect(compressor.options.error).toHaveBeenCalledTimes(1);
      expect(compressor.options.error).toHaveBeenCalledWith(err);
    });

    it('reports a rejected compressed-blob read once, via the deferred path', async () => {
      const compressor = bareCompressor();

      vi.spyOn(Blob.prototype, 'arrayBuffer')
        .mockRejectedValue(new Error('read failed'));

      compressor.readBlobAsArrayBuffer(new Blob(['x']), () => {});
      await flush();

      expect(compressor.options.error).toHaveBeenCalledTimes(1);
      expect(compressor.options.error.mock.calls[0][0].message)
        .toBe('Failed to read the compressed image with `Blob.arrayBuffer()`.');
    });

    it('reads compressed output through FileReader when `Blob#arrayBuffer` is unavailable', async () => {
      const compressor = bareCompressor();
      const blob = new Blob(['abc']);

      Object.defineProperty(blob, 'arrayBuffer', {
        value: undefined,
        configurable: true,
      });

      const data = await new Promise((resolve) => {
        compressor.readBlobAsArrayBuffer(blob, resolve);
      });

      await flush();

      expect(data).toBeInstanceOf(ArrayBuffer);
      expect(compressor.reader).toBeNull();
    });

    it('routes exceptions thrown by read handlers through `fail()`', async () => {
      const compressor = bareCompressor();
      const boom = new Error('handler failed');

      compressor.readAsArrayBuffer(new Blob(['x']), {
        subject: 'test',
        onData() {
          throw boom;
        },
      });

      await flush();

      expect(compressor.options.error).toHaveBeenCalledTimes(1);
      expect(compressor.options.error).toHaveBeenCalledWith(boom);
    });

    it('surfaces original-file FileReader errors to the tolerant fallback', async () => {
      const compressor = bareCompressor();
      const blob = new Blob(['x']);
      const onData = vi.fn();
      const onError = vi.fn();

      Object.defineProperty(blob, 'arrayBuffer', {
        value: undefined,
        configurable: true,
      });

      vi.spyOn(FileReader.prototype, 'readAsArrayBuffer').mockImplementation(function read() {
        this.onerror(new Event('error'));
      });

      compressor.readOriginalAsArrayBuffer(blob, onData, onError);
      await flush();

      expect(onData).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0].message)
        .toBe('Failed to read the original file with FileReader.');
    });
  });
});
