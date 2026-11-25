import { findNodeByTag, outline, readScene } from '@prismbox/core';
import type { PropValue, Scene, SceneNode } from '@prismbox/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Target } from '../inspector-model';
import type { GizmoMode, ViewMode } from '../protocol';
import { DiffStrip } from '../ui/DiffStrip';
import { Inspector } from '../ui/Inspector';
import { Tree } from '../ui/Tree';
import { Segmented } from '../ui/Viewport';
import { useDaemon } from './useDaemon';

function parseScene(path: string, source: string): { scene: Scene | null; error: string | null } {
  try {
    return { scene: readScene(source, path), error: null };
  } catch (e) {
    return { scene: null, error: e instanceof Error ? e.message : String(e) };
  }
}

const tagFile = (tag: string): string => tag.replace(/:\d+:\d+$/, '');

declare global {
  interface Window {
    __prismStudio?: { raw: (m: unknown) => void; hash: () => string | null };
  }
}

export function LocalApp() {
  const d = useDaemon();
  const s = d.state;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('scene');
  const [gizmo, setGizmo] = useState<GizmoMode>('translate');

  const file = s.file;
  const parsed = useMemo(() => (file ? parseScene(file.path, file.source) : { scene: null, error: null }), [file]);
  const scene = parsed.scene;
  const entries = useMemo(() => (scene ? outline(scene) : []), [scene]);
  const selectedEntry = entries.find((e) => e.node.id === selectedId) ?? null;
  const selected: SceneNode | null = selectedEntry?.node ?? null;
  const selectedTag = selected && file ? `${file.path}:${selected.line}:${selected.col}` : null;

  // test hook: a stale write must be refused (compare-and-set), so the e2e test needs a way to send one
  useEffect(() => {
    window.__prismStudio = { raw: d.raw, hash: () => file?.hash ?? null };
  }, [d.raw, file]);

  // a pick on the real page selects the node here (opening its file first if needed)
  useEffect(() => {
    const tag = s.pickedTag;
    if (!tag) {
      setSelectedId(null);
      return;
    }
    if (file && tagFile(tag) === file.path && scene) setSelectedId(findNodeByTag(scene, tag)?.id ?? null);
    else if (tagFile(tag) !== file?.path) d.open(tagFile(tag));
  }, [s.pickedTag, file?.path, scene]);

  // keep the page's selection in step with ours, including after edits shift line numbers
  useEffect(() => {
    if (s.conn === 'connected') d.select(selectedTag);
  }, [selectedTag, s.conn, s.rev]);

  const commit = useCallback(
    (node: SceneNode, target: Target, value: PropValue) => {
      void d.edit(target.kind === 'prop' ? { kind: 'prop', node: node.id, prop: target.prop, value } : { kind: 'uniform', node: node.id, uniform: target.uniform, value });
    },
    [d],
  );
  const live = useCallback(
    (tag: string, target: Target, value: PropValue) => d.live(tag, target.kind === 'prop' ? target.prop : target.uniform, value, target.kind === 'uniform'),
    [d],
  );

  const disconnected = s.conn === 'disconnected';
  const modeLabel = disconnected ? 'Daemon disconnected' : s.armed ? 'Armed' : 'Disarmed';
  const rootName = s.root.split(/[\\/]/).filter(Boolean).pop() ?? '';

  return (
    <div className={`app local${disconnected ? ' offline' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <svg width="18" height="18" viewBox="0 0 32 32" aria-hidden><path d="M16 3 29 26H3z" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" /><path d="M16 3v23M16 14l13 12" fill="none" stroke="currentColor" strokeWidth="1.6" opacity=".55" /></svg>
          <span className="brand-name">prismbox</span>
          <span className="tag">Local</span>
        </div>
        <div className="file">
          <code title={s.root}>{rootName}</code>
          <span className="sep">/</span>
          <select aria-label="File" value={file?.path ?? ''} onChange={(e) => d.open(e.target.value)} disabled={disconnected || s.files.length === 0}>
            {s.files.length === 0 && <option value="">no scene files</option>}
            {s.files.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div className="spacer" />
        {selected && file && (
          <span className="agent-sel" data-testid="agent-selection" title="This is what an AI agent means by &quot;this&quot; when it calls prism_get_selection">
            <i /> Selected for agent · {file.path.split('/').pop()}:{selected.line}
          </span>
        )}
        <span className={`conn ${s.conn}`} data-testid="conn">
          <i /> {s.conn === 'connected' ? (s.page ? 'page connected' : 'waiting for your page') : s.conn === 'connecting' ? 'connecting' : 'daemon disconnected'}
        </span>
        <button
          type="button"
          className={`arm ${s.armed ? 'on' : ''}`}
          aria-pressed={s.armed}
          disabled={disconnected}
          onClick={() => d.arm(!s.armed)}
          title={s.armed ? 'Disarm: stop accepting edits from the page and give the 3D scene its pointer back' : 'Arm: let the gizmo on your page write to your files. The 3D scene ignores your pointer handlers while armed.'}
        >
          <span className="arm-dot" />
          {s.armed ? 'Armed' : 'Arm'}
        </button>
      </header>

      {(s.banner || disconnected) && (
        <div className={`banner ${disconnected ? 'offline' : s.banner?.kind}`} role="alert">
          <strong>{disconnected ? 'Daemon disconnected' : s.banner?.kind === 'external' ? 'File reloaded' : s.banner?.kind === 'conflict' ? 'Conflict' : s.banner?.kind === 'rejected' ? 'Edit refused' : 'Error'}</strong>
          <span>{disconnected ? 'Lost the connection to prismbox. Trying to reconnect; if you stopped it, start `prismbox` again.' : s.banner?.text}</span>
          {!disconnected && <button type="button" className="btn ghost" onClick={d.dismiss}>Dismiss</button>}
        </div>
      )}

      <Tree entries={entries} selectedId={selectedId} onSelect={setSelectedId} />

      <main className="viewport live-panel" aria-label="Live page">
        <div className="live-card">
          <div className={`state-pill ${disconnected ? 'offline' : s.armed ? 'armed' : 'disarmed'}`} data-testid="mode">{modeLabel}</div>
          <h2>{s.page ? 'Your page is connected' : 'Open your page'}</h2>
          <p className="live-lede">
            {s.armed
              ? 'Drag the gizmo on your page. Each drag becomes one line in your file.'
              : 'Arm Studio, then click and drag objects directly on your real page.'}
          </p>
          {s.pageUrl && (
            <a className="page-link" href={s.pageUrl} target="_blank" rel="noreferrer">{s.pageUrl}</a>
          )}
          <ul className="live-steps">
            <li className={s.page ? 'done' : ''}>Your dev server is running with Prismbox attached.</li>
            <li className={s.armed ? 'done' : ''}>{s.armed ? 'Armed: the 3D scene ignores your pointer handlers while you edit.' : 'Disarmed: your page behaves exactly as it does in production.'}</li>
            <li className={selected ? 'done' : ''}>{selected ? `Selected ${selected.name ?? selected.tag} (line ${selected.line}).` : 'Click an object on your page, or pick a node in the tree.'}</li>
          </ul>
          <div className="live-controls">
            <Segmented label="Camera" value={view} onChange={(v) => { setView(v); d.view(v); }} options={[{ id: 'scene', label: 'Scene cam' }, { id: 'free', label: 'Free view' }]} />
            <Segmented label="Gizmo" value={gizmo} onChange={(g) => { setGizmo(g); d.gizmo(g); }} options={[{ id: 'translate', label: 'Move' }, { id: 'rotate', label: 'Rotate' }, { id: 'scale', label: 'Scale' }]} />
          </div>
          {s.armed && s.frozen && <div className="chip paused inline">Paused while you edit</div>}
          {parsed.error && <pre className="parse-error">{parsed.error}</pre>}
        </div>
      </main>

      <Inspector node={selected} edit={selectedEntry?.edit ?? null} file={file?.path ?? ''} agentSelected={s.conn === 'connected'} onLive={live} onCommit={commit} />

      <DiffStrip
        log={s.log.map((e) => ({ ...e }))}
        canUndo={s.undo.canUndo}
        canRedo={s.undo.canRedo}
        error={null}
        savedLabel="saved to disk"
        undoHint={s.undo.undoDepth > 0 && !s.undo.canUndo ? 'The file changed outside Prismbox since your last edit, so undo is paused.' : 'Undo (Ctrl+Z)'}
        onUndo={() => void d.undo()}
        onRedo={() => void d.redo()}
      />
    </div>
  );
}
