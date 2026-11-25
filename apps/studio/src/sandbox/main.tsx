import * as drei from '@react-three/drei';
import * as fiber from '@react-three/fiber';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import * as jsxRuntime from 'react/jsx-runtime';
import * as THREE from 'three';
import { parseToSandbox } from '../protocol';
import type { FromSandbox } from '../protocol';
import { bus } from './bus';
import { evaluate } from './evaluate';
import * as overlay from './overlay';

/**
 * The sandboxed preview. It runs in an iframe with `sandbox="allow-scripts"` and no `allow-same-origin`, so it has an
 * opaque origin: it cannot read Studio's storage or reach its DOM, and its only channel out is postMessage.
 */
const post = (m: FromSandbox) => window.parent.postMessage(m, '*');
bus.post = post;

const builtins = {
  react: React,
  'react/jsx-runtime': jsxRuntime,
  three: THREE,
  '@react-three/fiber': fiber,
  '@react-three/drei': drei,
  'virtual:prism-overlay': overlay,
};

// Shader compile errors are only logged by three.js; surface them to Studio.
const consoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  consoleError(...args);
  const text = args.map(String).join(' ');
  if (/WebGLProgram|shader/i.test(text)) post({ type: 'error', message: text.slice(0, 1200) });
};
// The iframe has its own focus: forward shortcuts so undo, redo and the gizmo keys work after clicking the scene.
window.addEventListener('keydown', (e) => post({ type: 'key', key: e.key, mod: e.ctrlKey || e.metaKey, shift: e.shiftKey }));
window.addEventListener('error', (e) => post({ type: 'error', message: e.message }));

class Boundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: Error) {
    post({ type: 'error', message: error.message });
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

const root = createRoot(document.getElementById('root') as HTMLElement);
let generation = 0;

function load(files: Record<string, string>, entry: string, selected: string | null) {
  try {
    bus.selected = selected;
    const Entry = (evaluate(files, entry, builtins).default ?? null) as React.ComponentType | null;
    if (!Entry) throw new Error(`${entry} has no default export`);
    generation++;
    root.render(
      <Boundary key={generation}>
        <Entry />
      </Boundary>,
    );
    requestAnimationFrame(() => requestAnimationFrame(() => post({ type: 'loaded' })));
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}

window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  const m = parseToSandbox(event.data);
  if (!m) return;
  if (m.type === 'load') load(m.files, m.entry, m.selected);
  else if (m.type === 'arm') {
    bus.armed = m.value;
    bus.handler?.(m);
  } else if (m.type === 'view') {
    bus.view = m.mode;
    bus.handler?.(m);
  } else if (m.type === 'gizmo') {
    bus.gizmo = m.mode;
    bus.handler?.(m);
  } else if (m.type === 'snap') {
    bus.snap = m.enabled;
    bus.handler?.(m);
  } else bus.handler?.(m);
});

post({ type: 'ready' });
