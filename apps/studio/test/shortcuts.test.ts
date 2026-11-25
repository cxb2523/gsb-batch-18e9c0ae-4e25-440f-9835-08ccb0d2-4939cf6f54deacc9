import { describe, expect, it } from 'vitest';
import { handleStudioKey } from '../src/shortcuts';

describe('handleStudioKey (Issue #2)', () => {
  it('switches to translate on G, rotate on R, scale on S when a node is selected', () => {
    let mode: string | null = null;
    const actions = {
      onGizmo: (m: 'translate' | 'rotate' | 'scale') => { mode = m; },
      onUndo: () => {},
      onRedo: () => {},
    };

    handleStudioKey({ key: 'g', mod: false, shift: false }, 'mesh-1', actions);
    expect(mode).toBe('translate');

    handleStudioKey({ key: 'r', mod: false, shift: false }, 'mesh-1', actions);
    expect(mode).toBe('rotate');

    handleStudioKey({ key: 's', mod: false, shift: false }, 'mesh-1', actions);
    expect(mode).toBe('scale');
  });

  it('keeps W and E as aliases for Translate and Rotate, and R strictly means Rotate with nothing selected', () => {
    let mode: string | null = null;
    const actions = {
      onGizmo: (m: 'translate' | 'rotate' | 'scale') => { mode = m; },
      onUndo: () => {},
      onRedo: () => {},
    };

    handleStudioKey({ key: 'w', mod: false, shift: false }, null, actions);
    expect(mode).toBe('translate');

    handleStudioKey({ key: 'e', mod: false, shift: false }, null, actions);
    expect(mode).toBe('rotate');

    // R strictly means Rotate whether selected or not (never flips to Scale)
    handleStudioKey({ key: 'r', mod: false, shift: false }, null, actions);
    expect(mode).toBe('rotate');
  });

  it('G and S do nothing when nothing is selected', () => {
    let called = false;
    const actions = {
      onGizmo: () => { called = true; },
      onUndo: () => {},
      onRedo: () => {},
    };

    handleStudioKey({ key: 'g', mod: false, shift: false }, null, actions);
    handleStudioKey({ key: 's', mod: false, shift: false }, null, actions);
    expect(called).toBe(false);
  });

  it('does not trigger scale when Cmd/Ctrl+S is pressed', () => {
    let mode: string | null = null;
    const actions = {
      onGizmo: (m: 'translate' | 'rotate' | 'scale') => { mode = m; },
      onUndo: () => {},
      onRedo: () => {},
    };

    handleStudioKey({ key: 's', mod: true, shift: false }, 'mesh-1', actions);
    expect(mode).toBeNull();
  });

  it('handles undo and redo with mod keys', () => {
    let undoCalls = 0;
    let redoCalls = 0;
    const actions = {
      onGizmo: () => {},
      onUndo: () => { undoCalls++; },
      onRedo: () => { redoCalls++; },
    };

    handleStudioKey({ key: 'z', mod: true, shift: false }, 'mesh-1', actions);
    expect(undoCalls).toBe(1);

    handleStudioKey({ key: 'z', mod: true, shift: true }, 'mesh-1', actions);
    expect(redoCalls).toBe(1);

    handleStudioKey({ key: 'y', mod: true, shift: false }, 'mesh-1', actions);
    expect(redoCalls).toBe(2);
  });
});
