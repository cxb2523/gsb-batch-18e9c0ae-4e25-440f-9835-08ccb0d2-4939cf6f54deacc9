import type { ModuleDefinition, ModuleParams } from '../types/graph';
import type { ScopeDataMessage, SetParamMessage } from '../types/messages';

/**
 * Pure helpers that decide what the UI has to tell the audio engine. Kept out
 * of the React hook so the two tricky paths — parameter diffing and scope
 * bookkeeping after a graph rebuild — can be tested directly.
 */

/** Params the engine currently holds, per module id. */
export type ParamCache = Map<string, ModuleParams | undefined>;

/** Snapshot of the params carried by a graph, used to seed the cache. */
export function seedParamCache(modules: readonly ModuleDefinition[]): ParamCache {
  return new Map(modules.map((m) => [m.id, m.params]));
}

/**
 * Differences between the params the engine holds and the ones in `modules`.
 * Because the cache is rebuilt from the *new* module set after every graph
 * reload, a module that survived a rebuild is compared against its own entry
 * (not a stale pre-rebuild one), and removed modules produce nothing.
 */
export function diffParams(
  cache: ParamCache,
  modules: readonly ModuleDefinition[]
): SetParamMessage[] {
  const messages: SetParamMessage[] = [];
  for (const module of modules) {
    const previous = cache.get(module.id);
    if (previous === module.params) continue;
    for (const [param, value] of Object.entries(module.params ?? {})) {
      if (value === undefined) continue;
      if ((previous as Record<string, unknown> | undefined)?.[param] === value) continue;
      messages.push({ type: 'setParam', id: module.id, param, value });
    }
  }
  return messages;
}

/**
 * Removes scope traces belonging to modules that are no longer in the graph.
 * Returns the same object when nothing was stale so React can skip a render.
 */
export function pruneScopeData(
  scopeData: Record<string, number[]>,
  modules: readonly ModuleDefinition[]
): Record<string, number[]> {
  const moduleIds = new Set(modules.map((m) => m.id));
  const next: Record<string, number[]> = {};
  let changed = false;
  for (const [id, samples] of Object.entries(scopeData)) {
    if (moduleIds.has(id)) next[id] = samples;
    else changed = true;
  }
  return changed ? next : scopeData;
}

/**
 * Merges a batch of scope frames into the running scope data, dropping any
 * frame whose generation predates the graph the UI currently shows. Without
 * this an in-flight batch produced by the pre-rebuild graph could repaint a
 * module that has just been deleted, or reseed one that the rebuild just
 * cleared.
 */
export function mergeScopeFrames(
  scopeData: Record<string, number[]>,
  message: ScopeDataMessage,
  currentGeneration: number
): Record<string, number[]> {
  if (message.generation !== undefined && message.generation !== currentGeneration) {
    return scopeData;
  }
  if (message.frames.length === 0) return scopeData;
  const next = { ...scopeData };
  for (const frame of message.frames) {
    next[frame.id] = frame.samples;
  }
  return next;
}
