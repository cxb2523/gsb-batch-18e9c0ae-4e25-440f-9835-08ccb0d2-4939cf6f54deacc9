/** The typed postMessage protocol between Studio (parent) and the sandboxed preview (iframe). */

export type ViewMode = 'scene' | 'free';
export type GizmoMode = 'translate' | 'rotate' | 'scale';

export type ToSandbox =
  | { type: 'load'; files: Record<string, string>; entry: string; selected: string | null }
  | { type: 'arm'; value: boolean }
  | { type: 'select'; tag: string | null }
  | { type: 'view'; mode: ViewMode }
  | { type: 'gizmo'; mode: GizmoMode }
  | { type: 'snap'; enabled: boolean }
  | { type: 'resetCamera' }
  | { type: 'focus' }
  | { type: 'live'; tag: string; prop: string; value: unknown; uniform?: boolean };

export interface TransformChange {
  from: number[];
  to: number[];
}

export type FromSandbox =
  | { type: 'ready' }
  | { type: 'loaded' }
  | { type: 'error'; message: string }
  | { type: 'pick'; tag: string | null }
  | { type: 'transform'; tag: string; changes: Partial<Record<'position' | 'rotation' | 'scale', TransformChange>> }
  | { type: 'frozen'; value: boolean }
  | { type: 'key'; key: string; mod: boolean; shift: boolean };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isNums = (v: unknown): v is number[] => Array.isArray(v) && v.every((n) => typeof n === 'number' && Number.isFinite(n));

/** Validate a message from the sandbox. Anything that does not match exactly is dropped (the sandbox is untrusted). */
export function parseFromSandbox(data: unknown): FromSandbox | null {
  if (!isObj(data) || typeof data.type !== 'string') return null;
  switch (data.type) {
    case 'ready':
    case 'loaded':
      return { type: data.type };
    case 'error':
      return typeof data.message === 'string' ? { type: 'error', message: data.message.slice(0, 2000) } : null;
    case 'pick':
      return data.tag === null || (typeof data.tag === 'string' && data.tag.length < 300) ? { type: 'pick', tag: data.tag } : null;
    case 'key':
      return typeof data.key === 'string' && data.key.length <= 20 && typeof data.mod === 'boolean' && typeof data.shift === 'boolean' ? { type: 'key', key: data.key, mod: data.mod, shift: data.shift } : null;
    case 'frozen':
      return typeof data.value === 'boolean' ? { type: 'frozen', value: data.value } : null;
    case 'transform': {
      if (typeof data.tag !== 'string' || data.tag.length >= 300 || !isObj(data.changes)) return null;
      const changes: Partial<Record<'position' | 'rotation' | 'scale', TransformChange>> = {};
      for (const k of ['position', 'rotation', 'scale'] as const) {
        const c = data.changes[k];
        if (c === undefined) continue;
        if (!isObj(c) || !isNums(c.from) || !isNums(c.to) || c.from.length !== 3 || c.to.length !== 3) return null;
        changes[k] = { from: c.from, to: c.to };
      }
      return Object.keys(changes).length ? { type: 'transform', tag: data.tag, changes } : null;
    }
    default:
      return null;
  }
}

/** Validate a message from Studio inside the sandbox. */
export function parseToSandbox(data: unknown): ToSandbox | null {
  if (!isObj(data) || typeof data.type !== 'string') return null;
  switch (data.type) {
    case 'load':
      if (!isObj(data.files) || typeof data.entry !== 'string') return null;
      if (!Object.values(data.files).every((v) => typeof v === 'string')) return null;
      return { type: 'load', files: data.files as Record<string, string>, entry: data.entry, selected: typeof data.selected === 'string' ? data.selected : null };
    case 'arm':
      return typeof data.value === 'boolean' ? { type: 'arm', value: data.value } : null;
    case 'select':
      return data.tag === null || typeof data.tag === 'string' ? { type: 'select', tag: data.tag as string | null } : null;
    case 'view':
      return data.mode === 'scene' || data.mode === 'free' ? { type: 'view', mode: data.mode } : null;
    case 'gizmo':
      return data.mode === 'translate' || data.mode === 'rotate' || data.mode === 'scale' ? { type: 'gizmo', mode: data.mode } : null;
    case 'snap':
      return typeof data.enabled === 'boolean' ? { type: 'snap', enabled: data.enabled } : null;
    case 'resetCamera':
      return { type: 'resetCamera' };
    case 'focus':
      return { type: 'focus' };
    case 'live':
      return typeof data.tag === 'string' && typeof data.prop === 'string' ? { type: 'live', tag: data.tag, prop: data.prop, value: data.value, uniform: data.uniform === true } : null;
    default:
      return null;
  }
}
