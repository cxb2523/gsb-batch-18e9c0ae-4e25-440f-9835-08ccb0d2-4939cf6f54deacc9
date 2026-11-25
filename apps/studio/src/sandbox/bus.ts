import type { FromSandbox, GizmoMode, ToSandbox, ViewMode } from '../protocol';

/** Shared state between the sandbox shell (main.tsx) and the overlay that lives inside the user's Canvas. */
export const bus: {
  post: (m: FromSandbox) => void;
  armed: boolean;
  selected: string | null;
  view: ViewMode;
  gizmo: GizmoMode;
  snap: boolean;
  /** Set by the overlay while mounted; the shell forwards messages to it. */
  handler: ((m: ToSandbox) => void) | null;
} = {
  post: () => undefined,
  armed: true,
  selected: null,
  view: 'scene',
  gizmo: 'translate',
  snap: false,
  handler: null,
};
