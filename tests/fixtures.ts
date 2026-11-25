/** Builders for the tests: a small world that computes a real layout, and container-split services. */
import type { Alert, Environment, Project, Service, ServiceStatus } from '../src/data/types';
import { containerNodeId } from '../src/data/types';
import { computeLayout, type Layout } from '../src/layout';

export const project = (id: string, name = id): Project => ({ id, name, color: '#7c6cff' });

export const env = (id: string, projectId: string, name = 'production'): Environment => ({ id, projectId, name });

/** A service node. Container nodes are `<baseId>::<key>`, all sharing the base service's fields. */
export function service(
  id: string,
  opts: { environmentId: string; projectId: string; status?: ServiceStatus; kind?: Service['kind']; name?: string } = {
    environmentId: '',
    projectId: '',
  },
): Service {
  return {
    id,
    projectId: opts.projectId,
    environmentId: opts.environmentId,
    serverId: 'local',
    name: opts.name ?? id,
    kind: opts.kind ?? 'app',
    status: opts.status ?? 'running',
    cpu: 0,
    memMb: 0,
    memLimitMb: 0,
    replicas: 1,
    lastDeploy: null,
    cpuHist: [],
  };
}

/** A compose service split into a main node (keeps the service id) and helper container nodes. */
export function containerNodes(
  baseId: string,
  keys: string[],
  opts: { environmentId: string; projectId: string; status?: ServiceStatus },
): Service[] {
  return keys.map((key, i) =>
    service(i === 0 ? baseId : containerNodeId(baseId, key), {
      ...opts,
      name: key,
      // Helpers mirror the main node's status unless told otherwise (per-container error is set by callers).
      status: opts.status ?? 'running',
    }),
  );
}

export function alert(id: string, serviceId: string, createdAt: number, opts: { resolvedAt?: number; severity?: Alert['severity'] } = {}): Alert {
  return {
    id,
    serviceId,
    severity: opts.severity ?? 'critical',
    title: 'Node in error state',
    message: 'down',
    createdAt,
    resolvedAt: opts.resolvedAt,
  };
}

export function layoutOf(projects: Project[], environments: Environment[], services: Service[]): Layout {
  return computeLayout({ projects, environments, services });
}

export function records<T extends { id: string }>(xs: T[]): Record<string, T> {
  return Object.fromEntries(xs.map((x) => [x.id, x]));
}
