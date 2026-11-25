import type { RefObject } from 'react';
import type { GizmoMode, ViewMode } from '../protocol';

export interface ViewportProps {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  status: 'booting' | 'loading' | 'ready' | 'error';
  error: string | null;
  frozen: boolean;
  armed: boolean;
  view: ViewMode;
  gizmo: GizmoMode;
  snap: boolean;
  onArm: (v: boolean) => void;
  onView: (v: ViewMode) => void;
  onGizmo: (g: GizmoMode) => void;
  onResetCamera: () => void;
  onSnap: (s: boolean) => void;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string; title?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" title={o.title} className={o.id === value ? 'on' : ''} aria-pressed={o.id === value} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Viewport({ iframeRef, status, error, frozen, armed, view, gizmo, snap, onArm, onView, onGizmo, onSnap, onResetCamera }: ViewportProps) {
  return (
    <main className="viewport" aria-label="Preview">
      <iframe
        ref={iframeRef}
        title="Scene preview"
        className="sandbox"
        src="/sandbox.html"
        // d2: scene code runs in an opaque origin. No allow-same-origin: it cannot read Studio's storage or DOM.
        sandbox="allow-scripts"
        allow=""
      />
      <div className="vp-toolbar">
        <Segmented label="Mode" value={armed ? 'edit' : 'preview'} onChange={(v) => onArm(v === 'edit')} options={[{ id: 'edit', label: 'Edit', title: 'Pick and move objects. Your scene’s own pointer handlers are paused.' }, { id: 'preview', label: 'Preview', title: 'Run the scene as your visitors see it.' }]} />
        <Segmented
          label="Camera"
          value={view}
          onChange={(v) => (v === 'reset' ? onResetCamera() : onView(v))}
          options={[
            { id: 'scene', label: 'Scene cam', title: 'The camera your file ships' },
            { id: 'free', label: 'Free view', title: 'Orbit around without changing your file' },
            { id: 'reset', label: 'Reset', title: 'Reset camera view' },
          ]}
        />
        <Segmented label="Gizmo" value={gizmo} onChange={onGizmo} options={[{ id: 'translate', label: 'Move', title: 'Move (G)' }, { id: 'rotate', label: 'Rotate', title: 'Rotate (R)' }, { id: 'scale', label: 'Scale', title: 'Scale (S)' }]} />
        <button
          type="button"
          className={`vp-btn ${snap ? 'on' : ''}`}
          aria-pressed={snap}
          onClick={() => onSnap(!snap)}
          title="Snap to grid (0.1 units, 15°, 0.1 scale)"
        >
          Snap
        </button>
      </div>
      {armed && frozen && <div className="chip paused">Paused while you edit</div>}
      {!armed && <div className="chip live">Preview: the scene is live</div>}
      {status !== 'ready' && status !== 'error' && (
        <div className="overlay loading" role="status">
          <div className="spinner" />
          <span>{status === 'booting' ? 'Starting the sandbox…' : 'Compiling the scene…'}</span>
        </div>
      )}
      {status === 'error' && (
        <div className="overlay error" role="alert">
          <div className="error-title">The scene did not run</div>
          <pre>{error}</pre>
          <p>Undo your last edit, or reset the template from the top bar.</p>
        </div>
      )}
      <div className="vp-hint">{armed ? 'Click an object to select it. Drag a gizmo handle to move it. Edits land in Hero.tsx.' : 'Move the pointer over the scene.'}</div>
    </main>
  );
}
