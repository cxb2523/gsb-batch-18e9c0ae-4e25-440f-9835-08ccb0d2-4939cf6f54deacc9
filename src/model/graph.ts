import { ModuleKind } from '../types/graph';
import type { Connection, Graph, ModuleDefinition, ModuleParams, PortRef } from '../types/graph';
import { createEmojiId } from '../utils/emojiIds';
import { INPUT_PORTS, OUTPUT_PORTS } from './ports';
import { DEFAULT_PARAMS } from './params';

// Pure operations on the patch graph. The React state hook wraps these.

export const EMPTY_GRAPH: Graph = { modules: [], connections: [] };

const samePort = (a: PortRef, b: PortRef) => a.id === b.id && a.port === b.port;

export const sameConnection = (a: Connection, b: Connection) =>
  samePort(a.from, b.from) && samePort(a.to, b.to);

export function findModule(graph: Graph, id: string): ModuleDefinition | undefined {
  return graph.modules.find((m) => m.id === id);
}

export function createModule(
  graph: Graph,
  kind: ModuleKind,
  position: { x: number; y: number },
  params?: ModuleParams
): ModuleDefinition {
  const existingIds = new Set(graph.modules.map((m) => m.id));
  return {
    id: createEmojiId(kind.toLowerCase(), existingIds),
    kind,
    params: params ?? DEFAULT_PARAMS[kind],
    x: Math.round(position.x),
    y: Math.round(position.y),
  };
}

export function insertModule(graph: Graph, module: ModuleDefinition): Graph {
  if (graph.modules.some((m) => m.id === module.id)) return graph;
  return { ...graph, modules: [...graph.modules, module] };
}

const BYPASS_INPUTS: Partial<Record<ModuleKind, string[]>> = {
  [ModuleKind.VCA]: ['in'],
  [ModuleKind.PAN]: ['in'],
  [ModuleKind.DELAY]: ['in'],
  [ModuleKind.RECTIFIER]: ['in'],
  [ModuleKind.SLEW]: ['in'],
  [ModuleKind.ATTEN]: ['in'],
};

const portRefKey = (ref: PortRef) => `${ref.id}\u0000${ref.port}`;

/**
 * Every Output input port reachable from `id` along the *audio* signal chain:
 * cables are followed through intermediate modules only when they enter that
 * module's audio input (the same `in` used for bypassing). A cable into a
 * modulation port (a VCA's `cv`, a Delay's `time`, …) is not part of the signal
 * path, so deleting a module that fed only CV must not splice its source into
 * the speakers. Stops at Output modules; cycles are followed once per module.
 */
function reachableOutputPorts(graph: Graph, id: string, outputIds: Set<string>): PortRef[] {
  const kindById = new Map(graph.modules.map((m) => [m.id, m.kind]));
  const destinations = new Map<string, PortRef>();
  const visited = new Set<string>([id]);
  let frontier: string[] = [id];

  while (frontier.length > 0) {
    const next: string[] = [];
    for (const sourceId of frontier) {
      for (const conn of graph.connections) {
        if (conn.from.id !== sourceId) continue;
        if (outputIds.has(conn.to.id)) {
          destinations.set(portRefKey(conn.to), { id: conn.to.id, port: conn.to.port });
          continue;
        }
        const targetKind = kindById.get(conn.to.id);
        if (!targetKind) continue;
        const audioInputs = BYPASS_INPUTS[targetKind];
        if (!audioInputs || !audioInputs.includes(conn.to.port)) continue;
        if (visited.has(conn.to.id)) continue;
        visited.add(conn.to.id);
        next.push(conn.to.id);
      }
    }
    frontier = next;
  }

  return [...destinations.values()];
}

/**
 * Removes a module. If it sat between a signal source and the output — directly
 * or through a chain of downstream modules — the source is re-routed straight
 * to the Output port(s) the chain fed, so the patch keeps sounding. Each
 * distinct source/Output-port pair is added at most once, and a module with no
 * bypassable input simply loses its cables without leaving dangling refs.
 */
export function deleteModule(graph: Graph, id: string): Graph {
  const module = findModule(graph, id);
  if (!module) return graph;

  const outputIds = new Set(
    graph.modules.filter((m) => m.kind === ModuleKind.OUTPUT).map((m) => m.id)
  );
  const bypassPorts = BYPASS_INPUTS[module.kind] ?? [];
  const bypassSources = graph.connections.filter(
    (conn) => conn.to.id === id && bypassPorts.includes(conn.to.port)
  );

  const remaining = graph.connections.filter((conn) => conn.from.id !== id && conn.to.id !== id);

  if (bypassSources.length > 0) {
    const destinations = reachableOutputPorts(graph, id, outputIds);
    for (const source of bypassSources) {
      // A self-patch through the deleted module has no surviving source.
      if (source.from.id === id) continue;
      for (const destination of destinations) {
        const candidate: Connection = {
          from: { ...source.from },
          to: { ...destination },
        };
        if (!remaining.some((c) => sameConnection(c, candidate))) {
          remaining.push(candidate);
        }
      }
    }
  }

  return {
    ...graph,
    modules: graph.modules.filter((m) => m.id !== id),
    connections: remaining,
  };
}

export function updateModule(graph: Graph, id: string, updates: Partial<ModuleDefinition>): Graph {
  return {
    ...graph,
    modules: graph.modules.map((m) => (m.id === id ? { ...m, ...updates } : m)),
  };
}

export function updateModuleParam(
  graph: Graph,
  id: string,
  param: string,
  value: number | string
): Graph {
  return {
    ...graph,
    modules: graph.modules.map((m) =>
      m.id === id ? { ...m, params: { ...m.params, [param]: value } } : m
    ),
  };
}

export function isValidConnection(graph: Graph, from: PortRef, to: PortRef): boolean {
  const source = findModule(graph, from.id);
  const target = findModule(graph, to.id);
  if (!source || !target) return false;
  return (
    OUTPUT_PORTS[source.kind].includes(from.port) && INPUT_PORTS[target.kind].includes(to.port)
  );
}

export function connect(graph: Graph, from: PortRef, to: PortRef): Graph {
  const candidate: Connection = { from: { ...from }, to: { ...to } };
  if (!isValidConnection(graph, from, to)) return graph;
  if (graph.connections.some((c) => sameConnection(c, candidate))) return graph;
  return { ...graph, connections: [...graph.connections, candidate] };
}

export function disconnect(graph: Graph, from: PortRef, to: PortRef): Graph {
  const target: Connection = { from, to };
  return {
    ...graph,
    connections: graph.connections.filter((c) => !sameConnection(c, target)),
  };
}

/** The part of the graph the audio engine cares about (no canvas positions). */
export function toEngineGraph(graph: Graph): Graph {
  return {
    modules: graph.modules.map(({ id, kind, params }) => ({ id, kind, params })),
    connections: graph.connections,
  };
}
