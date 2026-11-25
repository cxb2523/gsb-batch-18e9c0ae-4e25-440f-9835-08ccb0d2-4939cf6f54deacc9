import { findNodeByTag, outline, readScene } from '@prismbox/core';
import type { PropValue, Scene, SceneNode } from '@prismbox/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadSaved, MemoryFs, save } from './fs';
import type { Target } from './inspector-model';
import { parseFromSandbox } from './protocol';
import type { GizmoMode, ToSandbox, ViewMode } from './protocol';
import { applyEdit, createSession, FILE_NAME, redo, reset, sanitizePropValue, undo } from './session';
import type { EditOp, Session } from './session';
import { handleStudioKey } from './shortcuts';
import { TEMPLATES } from './templates';
import { DiffStrip } from './ui/DiffStrip';
import { Inspector } from './ui/Inspector';
import { TopBar } from './ui/TopBar';
import { Tree } from './ui/Tree';
import { Viewport } from './ui/Viewport';

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

function startSession(id: string): Session {
  const t = TEMPLATES.find((x) => x.id === id) ?? (TEMPLATES[0] as (typeof TEMPLATES)[number]);
  return createSession(t.id, t.source, loadSaved(storage(), t.id));
}

function parseScene(source: string): { scene: Scene | null; error: string | null } {
  try {
    return { scene: readScene(source, FILE_NAME), error: null };
  } catch (e) {
    return { scene: null, error: e instanceof Error ? e.message : String(e) };
  }
}

const isTyping = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

export function App() {
  const initial = new URLSearchParams(window.location.search).get('template') ?? TEMPLATES[0]?.id ?? '';
  const [session, setSession] = useState<Session>(() => startSession(initial));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [armed, setArmed] = useState(true);
  const [view, setView] = useState<ViewMode>('scene');
  const [gizmo, setGizmo] = useState<GizmoMode>('translate');
  const [snap, setSnap] = useState(false);
  const [status, setStatus] = useState<'booting' | 'loading' | 'ready' | 'error'>('booting');
  const [sandboxError, setSandboxError] = useState<string | null>(null);
  const [frozen, setFrozen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const sandboxReady = useRef(false);
  const handleKey = useRef<(e: { key: string; mod: boolean; shift: boolean; preventDefault: () => void }) => void>(() => undefined);

  const fs = useMemo(() => new MemoryFs({ [FILE_NAME]: session.source }), [session.templateId]);
  fs.write(FILE_NAME, session.source);

  const parsed = useMemo(() => parseScene(session.source), [session.source]);
  const scene = parsed.scene;
  const entries = useMemo(() => (scene ? outline(scene) : []), [scene]);
  const selectedEntry = entries.find((e) => e.node.id === selectedId) ?? null;
  const selected: SceneNode | null = selectedEntry?.node ?? null;
  const selectedTag = selected ? `${FILE_NAME}:${selected.line}:${selected.col}` : null;

  const post = useCallback((m: ToSandbox) => {
    iframeRef.current?.contentWindow?.postMessage(m, '*');
  }, []);

  // keep the latest values reachable from the (stable) message listener
  const latest = useRef({ scene, selectedTag, session, selectedId, snap });
  latest.current = { scene, selectedTag, session, selectedId, snap };

  const commit = useCallback((op: EditOp) => setSession((s) => applyEdit(s, op)), []);

  const edit = useCallback(
    (node: SceneNode, target: Target, value: PropValue) => {
      commit(target.kind === 'prop' ? { kind: 'prop', node: node.id, prop: target.prop, value } : { kind: 'uniform', node: node.id, uniform: target.uniform, value });
    },
    [commit],
  );

  const live = useCallback((tag: string, target: Target, value: PropValue) => {
    post({ type: 'live', tag, prop: target.kind === 'prop' ? target.prop : target.uniform, value, uniform: target.kind === 'uniform' });
  }, [post]);

  // messages from the sandbox (untrusted: validated, and only from our own iframe)
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const m = parseFromSandbox(event.data);
      if (!m) return;
      const { scene: sc, session: s } = latest.current;
      switch (m.type) {
        case 'ready':
          sandboxReady.current = true;
          setStatus('loading');
          post({ type: 'load', files: { [FILE_NAME]: s.source }, entry: FILE_NAME, selected: latest.current.selectedTag });
          break;
        case 'loaded':
          sandboxReady.current = true;
          setStatus('ready');
          setSandboxError(null);
          break;
        case 'error':
          setStatus('error');
          setSandboxError(m.message);
          break;
        case 'frozen':
          setFrozen(m.value);
          break;
        case 'key':
          handleKey.current({ key: m.key, mod: m.mod, shift: m.shift, preventDefault: () => undefined });
          break;
        case 'pick': {
          const node = m.tag && sc ? findNodeByTag(sc, m.tag) : undefined;
          setSelectedId(node ? node.id : null);
          break;
        }
        case 'transform': {
          const node = sc ? findNodeByTag(sc, m.tag) : undefined;
          if (!node) break;
          for (const [prop, change] of Object.entries(m.changes)) {
            const value = latest.current.snap ? sanitizePropValue(change.to) : change.to;
            commit({ kind: 'prop', node: node.id, prop, value });
          }
          break;
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [post, commit]);

  // the sandbox may finish booting before this listener exists, so keep offering the file until it answers
  useEffect(() => {
    let tries = 0;
    const id = window.setInterval(() => {
      if (sandboxReady.current || ++tries > 40) return window.clearInterval(id);
      iframeRef.current?.contentWindow?.postMessage({ type: 'load', files: { [FILE_NAME]: latest.current.session.source }, entry: FILE_NAME, selected: null }, '*');
    }, 500);
    return () => window.clearInterval(id);
  }, []);

  // push the source into the sandbox whenever it changes
  useEffect(() => {
    if (!sandboxReady.current) return;
    setStatus('loading');
    post({ type: 'load', files: fs.snapshot(), entry: FILE_NAME, selected: latest.current.selectedTag });
  }, [session.source, post, fs]);

  useEffect(() => {
    const t = TEMPLATES.find((x) => x.id === session.templateId);
    if (t) save(storage(), t.id, session.source, t.source);
  }, [session.source, session.templateId]);

  // selection from the tree goes to the gizmo
  useEffect(() => {
    if (sandboxReady.current) post({ type: 'select', tag: selectedTag });
  }, [selectedTag, post]);

  const onArm = useCallback((v: boolean) => { setArmed(v); post({ type: 'arm', value: v }); }, [post]);
  const onView = useCallback((v: ViewMode) => { setView(v); post({ type: 'view', mode: v }); }, [post]);
  const onGizmo = useCallback((g: GizmoMode) => { setGizmo(g); post({ type: 'gizmo', mode: g }); }, [post]);
  const onSnap = useCallback((s: boolean) => { setSnap(s); post({ type: 'snap', enabled: s }); }, [post]);
  const onResetCamera = useCallback(() => { post({ type: 'resetCamera' }); }, [post]);

  const onTemplate = useCallback((id: string) => {
    setSelectedId(null);
    setStatus('loading');
    setSession(startSession(id));
    const url = new URL(window.location.href);
    url.searchParams.set('template', id);
    window.history.replaceState(null, '', url);
  }, []);

  const flash = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast((t) => (t === text ? null : t)), 2400);
  }, []);

  const onCopy = useCallback(async () => {
    const text = latest.current.session.source;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    flash(`Copied ${FILE_NAME} (${(text.length / 1024).toFixed(1)} KB)`);
  }, [flash]);

  handleKey.current = (e) => {
    handleStudioKey(e, latest.current.selectedId, {
      onGizmo,
      onUndo: () => setSession((s) => undo(s)),
      onRedo: () => setSession((s) => redo(s)),
      onFocus: () => post({ type: 'focus' }),
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      handleKey.current({ key: e.key, mod: e.ctrlKey || e.metaKey, shift: e.shiftKey, preventDefault: () => e.preventDefault() });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const modified = session.source !== session.original;

  return (
    <div className="app">
      <TopBar
        templates={TEMPLATES}
        templateId={session.templateId}
        onTemplate={onTemplate}
        modified={modified}
        onReset={() => setSession((s) => reset(s))}
        onCopy={onCopy}
        toast={toast}
      />
      <Tree entries={entries} selectedId={selectedId} onSelect={setSelectedId} />
      <Viewport
        iframeRef={iframeRef}
        status={parsed.error ? 'error' : status}
        error={parsed.error ?? sandboxError}
        frozen={frozen}
        armed={armed}
        view={view}
        gizmo={gizmo}
        snap={snap}
        onArm={onArm}
        onView={onView}
        onGizmo={onGizmo}
        onSnap={onSnap}
        onResetCamera={onResetCamera}
      />
      <Inspector node={selected} edit={selectedEntry?.edit ?? null} file={FILE_NAME} onLive={live} onCommit={edit} />
      <DiffStrip
        log={session.log}
        canUndo={session.undoStack.length > 0}
        canRedo={session.redoStack.length > 0}
        error={session.error}
        onUndo={() => setSession((s) => undo(s))}
        onRedo={() => setSession((s) => redo(s))}
      />
    </div>
  );
}
