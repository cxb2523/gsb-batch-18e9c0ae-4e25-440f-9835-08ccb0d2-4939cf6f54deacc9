'use strict';

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSkin, LIMITS, emptySkin } from './skin.js';
import { backgroundAt } from './background.js';
import { buildLineText, fitArea, autoTextColor } from './label.js';

// Skin selection lifecycle for the tape deck.
//
// The documented contract: "TRAX reads skin.json each time a skin is chosen."
// Pressing up/down in the Tape deck and coming back must therefore pick up an
// edited file. There is deliberately no cached phase on a skin: when a skin is
// chosen its background is evaluated from the CURRENT playback position on the
// next frame, so switching away and back never restarts the cycle at zero.

export class SkinLibrary {
  /**
   * @param {string} skinsDir absolute path of the SKINS folder
   * @param {(path:string)=>Promise<string|Buffer>} [readFileFn] injected for tests
   * @param {(path:string)=>Promise<import('node:fs').Dirent[]>} [listFn] injected for tests
   */
  constructor(skinsDir, readFileFn = readFile, listFn = (p) => readdir(p, { withFileTypes: true })) {
    this.skinsDir = skinsDir;
    this.readFileFn = readFileFn;
    this.listFn = listFn;
    this.names = []; // folder names, in directory order
    this.index = -1; // selected skin, -1 when none
    this.skin = null; // parsed skin.json content of the selected skin
  }

  /** Enumerate skin folders (each entry containing a picture is a skin). */
  async discover() {
    let entries;
    try {
      entries = await this.listFn(this.skinsDir);
    } catch {
      this.names = [];
      this.index = -1;
      return this.names;
    }
    this.names = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
    if (this.names.length > 0 && this.index < 0) this.index = 0;
    return this.names;
  }

  get selectedName() {
    return this.index >= 0 ? this.names[this.index] : null;
  }

  /**
   * Select a skin by folder name and (re)read its skin.json from disk.
   * A missing or broken file still selects the skin: it just gets the empty
   * skin (no text, black background).
   */
  async select(name) {
    const idx = this.names.indexOf(name);
    if (idx < 0) throw new Error(`unknown skin: ${name}`);
    this.index = idx;
    this.skin = await this.loadSkinJson(name);
    return this.skin;
  }

  /** Step to the next/previous skin, re-reading the chosen one from disk. */
  async step(direction) {
    if (this.names.length === 0) return null;
    const delta = direction === 'prev' ? -1 : 1;
    this.index = (this.index + delta + this.names.length) % this.names.length;
    this.skin = await this.loadSkinJson(this.selectedName);
    return this.skin;
  }

  /** Re-read the currently selected skin (up/down then back, or file changed). */
  async reload() {
    if (this.selectedName === null) {
      this.skin = emptySkin();
      return this.skin;
    }
    this.skin = await this.loadSkinJson(this.selectedName);
    return this.skin;
  }

  async loadSkinJson(name) {
    const path = join(this.skinsDir, name, 'skin.json');
    let bytes;
    try {
      bytes = await this.readFileFn(path);
    } catch {
      return emptySkin(); // optional file: skin works, just no text
    }
    if (bytes.length > LIMITS.FILE_BYTES) {
      // The engine stops reading at 32 KB. Parse the readable prefix: a JSON
      // document cut mid-way is invalid JSON, which already means no text and
      // a black background, so the documented failure mode is preserved.
      bytes = bytes.subarray(0, LIMITS.FILE_BYTES);
    }
    return parseSkin(bytes);
  }
}

/**
 * Build one tape-deck frame from a playback snapshot and the selected skin.
 *
 * Pure function: same (skin, playback) always yields the same frame. Nothing
 * here remembers a previous color or a previous phase, which is what makes the
 * background track pause, seek, track change and skin switch automatically.
 */
export function renderDeckFrame(library, playback, options = {}) {
  const skin = library.skin ?? emptySkin();
  const bg = backgroundAt(skin.background, playback);

  const measure = options.measure ?? defaultMeasure;
  const pixelSampler = options.pixelSampler ?? (() => []);
  const queueInfo = options.queueInfo ?? null;

  const areas = skin.areas.map((area) => {
    const lineTexts = area.lines.map((pieces) =>
      buildLineText(pieces, playback.track, queueInfo),
    );
    const fitted = fitArea(area, lineTexts, measure);
    const color = area.color ?? autoTextColor(() => pixelSampler(area.rect));
    return { ...fitted, color };
  });

  return {
    skinName: library.selectedName,
    background: bg,
    areas,
    playback: { ...playback },
  };
}

// A stand-in for the PSP system-font metric: width scales with the pixel
// size, proportional to character count. Real builds pass a font-table measure.
function defaultMeasure(text, sizePx) {
  return text.length * sizePx * 0.6;
}
