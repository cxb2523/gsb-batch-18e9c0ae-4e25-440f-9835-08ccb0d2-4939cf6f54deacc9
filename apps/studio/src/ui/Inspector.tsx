import type { PropValue, SceneNode } from '@prismbox/core';
import { buildInspector, toDisplay, vec3Commit } from '../inspector-model';
import type { Field, Target } from '../inspector-model';
import { ColorField, NumberField, Slider, Toggle } from './controls';

export interface InspectorProps {
  node: SceneNode | null;
  edit: 'editable' | 'partial' | 'read-only' | null;
  file: string;
  /** Local mode: this selection is also what the connected AI agent sees. */
  agentSelected?: boolean;
  /** Live (uncommitted) preview of a value inside the sandbox. */
  onLive: (tag: string, target: Target, value: PropValue) => void;
  /** Commit one edit to the source. */
  onCommit: (node: SceneNode, target: Target, value: PropValue) => void;
}

const AXES = ['x', 'y', 'z'] as const;

function FieldRow({ node, file, field, onLive, onCommit }: { node: SceneNode; file: string; field: Field; onLive: InspectorProps['onLive']; onCommit: InspectorProps['onCommit'] }) {
  const tag = `${file}:${node.line}:${node.col}`;
  if (field.state === 'locked') {
    return (
      <div className="field locked" title={field.reason}>
        <div className="field-label">{field.label}</div>
        <div className="field-body">
          <code className="locked-text">{field.text || 'read-only'}</code>
          <span className="lock" aria-label="read-only">🔒</span>
        </div>
        <div className="field-reason">{field.reason}</div>
      </div>
    );
  }
  const dim = field.state === 'absent';
  const hint = dim ? `will add ${field.label}={…} on first edit` : undefined;

  if (field.type === 'vec3') {
    const prop = field.prop;
    const target: Target = { kind: 'prop', prop };
    return (
      <div className="field" title={hint}>
        <div className="field-label">{field.label}{field.unit === 'deg' && <em>deg</em>}</div>
        <div className="vec3">
          {AXES.map((axis, i) => (
            <NumberField
              key={axis}
              axis={axis}
              dim={dim}
              step={field.step}
              value={toDisplay(field, field.value[i] as number)}
              onLive={(v) => onLive(tag, target, vec3Commit(field, i, v))}
              onCommit={(v) => onCommit(node, target, vec3Commit(field, i, v))}
            />
          ))}
        </div>
      </div>
    );
  }
  if (field.type === 'number') {
    const t = field.target;
    return (
      <div className="field">
        <div className="field-label">{field.label}</div>
        <div className="field-body">
          {field.slider && <Slider value={field.value} min={field.min} max={field.max} step={field.step} onLive={(v) => onLive(tag, t, v)} onCommit={(v) => onCommit(node, t, v)} />}
          <NumberField value={field.value} step={field.step} onLive={(v) => onLive(tag, t, v)} onCommit={(v) => onCommit(node, t, v)} />
        </div>
      </div>
    );
  }
  if (field.type === 'bool') {
    return (
      <div className="field row">
        <div className="field-label">{field.label}</div>
        <Toggle value={field.value} onChange={(v) => onCommit(node, field.target, v)} />
      </div>
    );
  }
  if (field.type === 'color') {
    return (
      <div className="field">
        <div className="field-label">{field.label}</div>
        <ColorField value={field.value} onLive={(v) => onLive(tag, field.target, v)} onCommit={(v) => onCommit(node, field.target, v)} />
      </div>
    );
  }
  if (field.type === 'vec') {
    return (
      <div className="field">
        <div className="field-label">{field.label}</div>
        <div className="vec">
          {field.value.map((n, i) => (
            <NumberField
              key={i}
              label={String(i)}
              step={field.step}
              value={n}
              onLive={(v) => onLive(tag, field.target, field.value.map((x, j) => (j === i ? v : x)))}
              onCommit={(v) => onCommit(node, field.target, field.value.map((x, j) => (j === i ? v : x)))}
            />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="field">
      <div className="field-label">{field.label}</div>
      <code className="locked-text">{field.value}</code>
    </div>
  );
}

const EDIT_LABEL = { editable: 'Editable', partial: 'Partly editable', 'read-only': 'Read-only' } as const;

export function Inspector({ node, edit, file, agentSelected, onLive, onCommit }: InspectorProps) {
  if (!node) {
    return (
      <aside className="panel inspector">
        <div className="panel-head"><span>Inspector</span></div>
        <div className="empty">
          <div className="empty-title">Nothing selected</div>
          <p>Click an object in the viewport or pick a node in the scene tree. Its literal props become controls here.</p>
        </div>
      </aside>
    );
  }
  const sections = buildInspector(node);
  return (
    <aside className="panel inspector">
      <div className="panel-head"><span>Inspector</span></div>
      <div className="inspector-body">
        <div className="node-head">
          <div className="node-title">
            <span className="node-name">{node.name ?? node.tag}</span>
            <code className="node-tag">&lt;{node.tag}&gt;</code>
          </div>
          <div className="node-meta">
            <code>{file}:{node.line}</code>
            {edit && <span className={`badge ${edit}`}>{EDIT_LABEL[edit]}</span>}
            {agentSelected && <span className="badge agent" title="Visible to the AI agent via prism_get_selection">agent sees this</span>}
          </div>
          {node.reasons.length > 0 && edit !== 'editable' && <ul className="reasons">{node.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
        </div>
        {sections.length === 0 && <div className="empty small"><p>No editable props on this node.</p></div>}
        {sections.map((s) => (
          <section key={s.title} className="section">
            <h3>{s.title}</h3>
            {s.fields.map((f) => <FieldRow key={f.id} node={node} file={file} field={f} onLive={onLive} onCommit={onCommit} />)}
          </section>
        ))}
      </div>
    </aside>
  );
}
