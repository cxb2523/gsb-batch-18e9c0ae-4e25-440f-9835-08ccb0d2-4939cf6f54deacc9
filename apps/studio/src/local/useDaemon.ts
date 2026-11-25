import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { DiffWire, EditOpWire, FileSnap, ToStudio, UndoState } from '../../../../packages/bridge/src/protocol';

export type Conn = 'connecting' | 'connected' | 'disconnected';

export interface Banner {
  kind: 'external' | 'conflict' | 'rejected' | 'error';
  text: string;
}

export interface LocalState {
  conn: Conn;
  root: string;
  pageUrl: string | null;
  files: string[];
  file: FileSnap | null;
  armed: boolean;
  page: boolean;
  frozen: boolean;
  undo: UndoState;
  log: DiffWire[];
  banner: Banner | null;
  pickedTag: string | null;
  /** Bumped on every file update from the daemon, so the UI can tell "same file, new bytes". */
  rev: number;
}

const EMPTY_UNDO: UndoState = { undoDepth: 0, redoDepth: 0, canUndo: false, canRedo: false };
const INITIAL: LocalState = { conn: 'connecting', root: '', pageUrl: null, files: [], file: null, armed: false, page: false, frozen: false, undo: EMPTY_UNDO, log: [], banner: null, pickedTag: null, rev: 0 };

type Action = { type: 'conn'; conn: Conn } | { type: 'msg'; msg: ToStudio } | { type: 'dismiss' } | { type: 'banner'; banner: Banner };

function reducer(s: LocalState, a: Action): LocalState {
  if (a.type === 'conn') return { ...s, conn: a.conn, ...(a.conn === 'disconnected' ? { page: false, armed: false, frozen: false } : {}) };
  if (a.type === 'dismiss') return { ...s, banner: null };
  if (a.type === 'banner') return { ...s, banner: a.banner };
  const m = a.msg;
  switch (m.type) {
    case 'ready':
      return { ...s, conn: 'connected', root: m.root, pageUrl: m.pageUrl, files: m.files, file: m.file ?? s.file, armed: m.armed, page: m.page, undo: m.undo, rev: s.rev + 1, banner: null };
    case 'file': {
      const banner: Banner | null =
        m.cause === 'external' ? { kind: 'external', text: `${m.file.path} was changed outside Prismbox and reloaded.` } : s.banner;
      return { ...s, file: m.file, rev: s.rev + 1, banner };
    }
    case 'files':
      return { ...s, files: m.files };
    case 'diff':
      return { ...s, log: [m.entry, ...s.log].slice(0, 200) };
    case 'armed':
      return { ...s, armed: m.value, ...(m.value ? {} : { frozen: false }) };
    case 'page':
      return { ...s, page: m.connected };
    case 'pick':
      return { ...s, pickedTag: m.tag };
    case 'frozen':
      return { ...s, frozen: m.value };
    case 'undo':
      return { ...s, undo: m.state };
    case 'rejected':
      return { ...s, banner: { kind: m.code === 'CONFLICT' || m.code === 'UNDO_CONFLICT' ? 'conflict' : 'rejected', text: m.message } };
    case 'result':
      if (!m.ok) {
        const conflict = m.code === 'CONFLICT' || m.code === 'UNDO_CONFLICT';
        return { ...s, banner: { kind: conflict ? 'conflict' : 'error', text: m.message } };
      }
      return s;
  }
}

export type Result = { ok: true; file: FileSnap } | { ok: false; code: string; message: string };

export interface Daemon {
  state: LocalState;
  arm(value: boolean): void;
  open(file: string): void;
  /** Edit the open file. Edits are serialised so each one carries the hash the previous one produced. */
  edit(op: EditOpWire): Promise<Result>;
  undo(): Promise<Result>;
  redo(): Promise<Result>;
  select(tag: string | null): void;
  live(tag: string, prop: string, value: unknown, uniform?: boolean): void;
  view(mode: 'scene' | 'free'): void;
  gizmo(mode: 'translate' | 'rotate' | 'scale'): void;
  dismiss(): void;
  /** Test hook: send an arbitrary message (used to prove a stale write is refused). */
  raw(msg: unknown): void;
}

const TOKEN_KEY = 'prismbox:token';

/** Move `#token=...` from the URL into sessionStorage and strip it, so it never sits in history or logs. */
export function captureToken(): string | null {
  const m = /[#&]token=([^&]+)/.exec(window.location.hash);
  if (m) {
    sessionStorage.setItem(TOKEN_KEY, decodeURIComponent(m[1] as string));
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  return sessionStorage.getItem(TOKEN_KEY);
}

export function useDaemon(): Daemon {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const wsRef = useRef<WebSocket | null>(null);
  const pending = useRef(new Map<number, (r: Result) => void>());
  const nextId = useRef(1);
  const hash = useRef<{ path: string; hash: string } | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const closing = useRef(false);

  useEffect(() => {
    if (state.file) hash.current = { path: state.file.path, hash: state.file.hash };
  }, [state.file]);

  useEffect(() => {
    closing.current = false;
    let timer: number | undefined;
    const connect = () => {
      const token = captureToken();
      if (!token) {
        dispatch({ type: 'conn', conn: 'disconnected' });
        dispatch({ type: 'banner', banner: { kind: 'error', text: 'No session token. Open the Studio URL printed by `prismbox` (it ends with #token=...).' } });
        return;
      }
      dispatch({ type: 'conn', conn: 'connecting' });
      const ws = new WebSocket(`${window.location.origin.replace(/^http/, 'ws')}/studio`);
      wsRef.current = ws;
      ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', token }));
      ws.onmessage = (ev) => {
        let msg: ToStudio;
        try {
          msg = JSON.parse(String(ev.data)) as ToStudio;
        } catch {
          return;
        }
        if (msg.type === 'ready') hash.current = msg.file ? { path: msg.file.path, hash: msg.file.hash } : null;
        if (msg.type === 'file') hash.current = { path: msg.file.path, hash: msg.file.hash };
        if (msg.type === 'result') {
          const cb = pending.current.get(msg.id);
          pending.current.delete(msg.id);
          if (msg.ok) hash.current = { path: msg.file.path, hash: msg.file.hash };
          else if (msg.file) hash.current = { path: msg.file.path, hash: msg.file.hash };
          cb?.(msg.ok ? { ok: true, file: msg.file } : { ok: false, code: msg.code, message: msg.message });
        }
        dispatch({ type: 'msg', msg });
      };
      ws.onclose = (ev) => {
        if (wsRef.current === ws) wsRef.current = null;
        pending.current.forEach((cb) => cb({ ok: false, code: 'DISCONNECTED', message: 'Lost the connection to prismbox.' }));
        pending.current.clear();
        dispatch({ type: 'conn', conn: 'disconnected' });
        if (!closing.current && ev.code !== 4403) timer = window.setTimeout(connect, 1500);
      };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => {
      closing.current = true;
      window.clearTimeout(timer);
      wsRef.current?.close();
    };
  }, []);

  const send = useCallback((m: unknown): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(m));
    return true;
  }, []);

  const request = useCallback(
    (build: (id: number) => unknown): Promise<Result> =>
      new Promise((resolve) => {
        const id = nextId.current++;
        pending.current.set(id, resolve);
        if (!send(build(id))) {
          pending.current.delete(id);
          resolve({ ok: false, code: 'DISCONNECTED', message: 'Not connected to prismbox.' });
        }
      }),
    [send],
  );

  const serial = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.current.then(fn, fn);
    queue.current = next.catch(() => undefined);
    return next;
  }, []);

  return {
    state,
    arm: (value) => void send({ type: 'arm', value }),
    open: (file) => void send({ type: 'open', file }),
    edit: (op) =>
      serial(() =>
        request((id) => ({ type: 'edit', id, file: hash.current?.path ?? '', baseHash: hash.current?.hash ?? '', op })),
      ),
    undo: () => serial(() => request((id) => ({ type: 'undo', id }))),
    redo: () => serial(() => request((id) => ({ type: 'redo', id }))),
    select: (tag) => void send({ type: 'select', tag }),
    live: (tag, prop, value, uniform) => void send({ type: 'live', tag, prop, value, ...(uniform ? { uniform: true } : {}) }),
    view: (mode) => void send({ type: 'view', mode }),
    gizmo: (mode) => void send({ type: 'gizmo', mode }),
    dismiss: () => dispatch({ type: 'dismiss' }),
    raw: (m) => void send(m),
  };
}
