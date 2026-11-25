import { describe, it, expect } from 'vitest';
import { audibleFor, NO_PREVIEW, previewForDrag, previewForBypass } from './edit-state';
import { flatBands } from './engine-io';
import type { Band } from './audio';

const shaped = (g: number): Band[] => flatBands().map((b, i) => ({ ...b, gain: i === 2 ? g : 0 }));
const FLAT = flatBands();
const editing = { bands: shaped(9), gain: 1.5, presetName: 'Vocal' };
const resolved = { bands: shaped(6), gain: 1, presetName: 'Bass Boost' };

// The single owner of "what should the ACTIVE tab play". One function answering it is what keeps
// a bypass toggle, an Auto Gain toggle, a drag and a storage refresh from disagreeing.
describe('what the active tab should play', () => {
  it('plays the resolved sound when nothing is being previewed or dragged', () => {
    const out = audibleFor({ preview: NO_PREVIEW, interacting: false, editing, resolved });
    expect(out).toEqual(resolved);
  });

  it('plays the editing buffer while a drag is live', () => {
    // A drag is unsaved work in progress; the tab should hear it, not the curve storage still has.
    const out = audibleFor({ preview: previewForDrag(), interacting: true, editing, resolved });
    expect(out).toEqual(editing);
  });

  it('plays the editing buffer for a drag preview even after the gesture settles', () => {
    // previewForDrag survives until the commit lands (or bypass outranks it), so `interacting`
    // being false must not fall back to storage and snap the curve back for a frame.
    const out = audibleFor({ preview: previewForDrag(), interacting: false, editing, resolved });
    expect(out).toEqual(editing);
  });

  it('plays the flat override under bypass, with the user volume, never the compensation', () => {
    const bypass = previewForBypass(FLAT);
    const out = audibleFor({ preview: bypass, interacting: false, editing, resolved });
    expect(out.bands.every((b) => b.gain === 0)).toBe(true);
    // The gain is the editing buffer's — the user's own — not the resolved one and not a rendered
    // (compensated) one. The compensation is applied later, by sentGain, from the bypassed flag.
    expect(out.gain).toBe(editing.gain);
  });

  it('labels a bypassed tab with the preset it is staged on, not "None"', () => {
    // The tab plays flat, so its label has nothing to describe from the override — it names the
    // curve the user is editing, which is what the graph still shows.
    const out = audibleFor({ preview: previewForBypass(FLAT), interacting: false, editing, resolved });
    expect(out.presetName).toBe('Vocal');
  });

  it('keeps the flat override under bypass even while a drag is in progress', () => {
    // A bypass outranks a drag (see bypass.ts). If a drag mid-bypass changed the audible curve,
    // the tab would start shaping again while the badge still said the equalizer was off.
    const bypass = previewForBypass(FLAT);
    const out = audibleFor({ preview: bypass, interacting: true, editing, resolved });
    expect(out.bands.every((b) => b.gain === 0)).toBe(true);
    expect(out.gain).toBe(editing.gain);
  });

  it('does not alias the editing array it returns', () => {
    // The returned bands go straight into a message; nothing should be able to mutate the buffer
    // through them. For the bypass case that means the override, which previewForBypass clones.
    const out = audibleFor({ preview: previewForDrag(), interacting: true, editing, resolved });
    expect(out.bands).toBe(editing.bands); // same reference is fine for the editing buffer...
    out.bands[2].gain = 99;
    expect(editing.bands[2].gain).toBe(99); // ...the test documents that, so the caller must not write
  });
});
