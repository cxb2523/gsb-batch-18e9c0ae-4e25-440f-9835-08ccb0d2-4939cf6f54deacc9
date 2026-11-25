import type { GizmoMode } from './protocol';

export interface ShortcutKey {
  key: string;
  mod: boolean;
  shift: boolean;
  preventDefault?: () => void;
}

export interface ShortcutActions {
  onGizmo: (mode: GizmoMode) => void;
  onUndo: () => void;
  onRedo: () => void;
  onFocus?: () => void;
}

/**
 * Handle studio keyboard shortcuts:
 * - Undo: Mod+Z
 * - Redo: Mod+Shift+Z or Mod+Y
 * - W / E / R: W = Translate, E / R = Rotate (R strictly means Rotate, never flips modes)
 * - G / S / F: Translate, Scale, Focus (when a node is selected)
 */
export function handleStudioKey(
  e: ShortcutKey,
  selectedId: string | null,
  actions: ShortcutActions,
): boolean {
  const k = e.key.toLowerCase();
  if (e.mod && k === 'z') {
    e.preventDefault?.();
    if (e.shift) actions.onRedo();
    else actions.onUndo();
    return true;
  }
  if (e.mod && k === 'y') {
    e.preventDefault?.();
    actions.onRedo();
    return true;
  }
  if (!e.mod) {
    if (k === 'w') {
      actions.onGizmo('translate');
      return true;
    }
    if (k === 'e' || k === 'r') {
      actions.onGizmo('rotate');
      return true;
    }
    if (selectedId) {
      if (k === 'g') {
        actions.onGizmo('translate');
        return true;
      }
      if (k === 's') {
        actions.onGizmo('scale');
        return true;
      }
      if (k === 'f' && actions.onFocus) {
        actions.onFocus();
        return true;
      }
    }
  }
  return false;
}
