/**
 * Scene identity: carts drive to a deployment's main container node, the technician attends errored
 * nodes by alert age, and layout rebuilds re-plan both onto the new coordinates.
 */
import { describe, expect, it } from 'vitest';
import { containerNodeId, type Service } from '../src/data/types';
import { cartRoute, mainNodeId, nodeIdsOfService, computeLayout, structureKey, type V3 } from '../src/layout';
import { cartLeaves, nextTarget, planAfterRecovery, planCart, planTechnician, standSpot, technicianQueue } from '../src/scene/agents.logic';
import { Walker } from '../src/scene/walker';
import { alert, containerNodes, env, layoutOf, project, records, service } from './fixtures';

/** Route helpers shift the aisle spot sideways (lane / technician offset), so compare with it. */
const frontAt = (front: V3, dx: number): V3 => [front[0] + dx, front[1], front[2]];
const expectPoint = (actual: V3 | undefined | null, expected: V3) => {
  expect(actual, 'point').toBeDefined();
  expect(actual![0]).toBeCloseTo(expected[0]);
  expect(actual![1]).toBeCloseTo(expected[1]);
  expect(actual![2]).toBeCloseTo(expected[2]);
};

const P = project('p1');
const E = env('e1', 'p1');

/** One compose stack `stack` split into web/db/worker containers, each in its own rack. */
function stackWorld(statuses: Partial<Record<string, Service['status']>> = {}) {
  const nodes = containerNodes('stack', ['web', 'db', 'worker'], { environmentId: 'e1', projectId: 'p1' }).map((s) => ({
    ...s,
    status: statuses[s.name] ?? 'running',
  }));
  return { services: nodes, layout: layoutOf([P], [E], nodes) };
}

describe('container node identity', () => {
  it('keeps the service id on the main container and prefixes helpers', () => {
    const { services } = stackWorld();
    expect(services.map((s) => s.id)).toEqual(['stack', containerNodeId('stack', 'db'), containerNodeId('stack', 'worker')]);
  });

  it('marks exactly one node per service as main', () => {
    const { layout } = stackWorld();
    const ids = nodeIdsOfService(layout, 'stack');
    expect(ids).toHaveLength(3);
    const mains = ids.filter((id) => layout.slots[id].main);
    expect(mains).toEqual(['stack']);
    expect(mainNodeId(layout, 'stack')).toBe('stack');
  });

  it('never resolves a helper to the main node', () => {
    const { layout } = stackWorld();
    expect(mainNodeId(layout, containerNodeId('stack', 'db'))).toBe('stack');
    expect(mainNodeId(layout, containerNodeId('stack', 'worker'))).toBe('stack');
  });

  it('returns null for a service with no node in the layout', () => {
    const { layout } = stackWorld();
    expect(mainNodeId(layout, 'ghost')).toBeNull();
  });
});

describe('deploy carts', () => {
  it('drives to the main container node, never to a helper', () => {
    const { layout } = stackWorld();
    const plan = planCart(layout, 'stack', 0.04);
    expect(plan.target).toBe('stack');
    // The route ends at the main rack's standing spot (shifted by the lane), not a helper's.
    expectPoint(plan.route?.at(-1), frontAt(layout.slots['stack'].front, 0.04));
    const helperFronts = [containerNodeId('stack', 'db'), containerNodeId('stack', 'worker')].map((id) => layout.slots[id].front);
    expect(helperFronts.some((f) => f[2] === plan.route?.at(-1)?.[2] && f[0] + 0.04 === plan.route?.at(-1)?.[0])).toBe(false);
  });

  it('has no route while the service has no node, and leaves once the deploy ends', () => {
    const { layout } = stackWorld();
    const plan = planCart(layout, 'gone-service', 0.04);
    expect(plan.route).toBeNull();
    expect(plan.target).toBeNull();
    expect(cartLeaves(plan.route, false)).toBe(false); // still deploying: wait
    expect(cartLeaves(plan.route, true)).toBe(true); // deploy over: leave
  });

  it('routes to a service that has its racks in another layout', () => {
    // A single-node service (no container split) is still a valid cart target.
    const single = service('solo', { environmentId: 'e1', projectId: 'p1' });
    const layout = layoutOf([P], [E], [single]);
    const route = cartRoute(layout, mainNodeId(layout, 'solo')!, 0.04);
    expect(route).not.toBeNull();
    expectPoint(route?.at(-1), frontAt(layout.slots['solo'].front, 0.04));
  });
});

describe('technician queue', () => {
  it('orders by alert creation, one entry per node', () => {
    const { services, layout } = stackWorld({ db: 'error', worker: 'error' });
    const alerts = records([
      alert('a-worker', containerNodeId('stack', 'worker'), 200),
      alert('a-db', containerNodeId('stack', 'db'), 100),
      alert('a-db-second', containerNodeId('stack', 'db'), 150), // same node: collapses into the older one
    ]);
    expect(technicianQueue(alerts, records(services), layout)).toEqual([
      containerNodeId('stack', 'db'),
      containerNodeId('stack', 'worker'),
    ]);
  });

  it('skips resolved alerts, non-critical alerts and nodes that are no longer in error', () => {
    const { services, layout } = stackWorld({ db: 'error' });
    const alerts = records([
      alert('resolved', containerNodeId('stack', 'db'), 10, { resolvedAt: 20 }),
      alert('warning', containerNodeId('stack', 'db'), 10, { severity: 'warning' }),
      alert('healthy', containerNodeId('stack', 'worker'), 10), // worker is running, not error
    ]);
    expect(technicianQueue(alerts, records(services), layout)).toEqual([]);
  });

  it('drops nodes whose rack is not in the current layout', () => {
    // An alert for a node that exists in the world but has no slot (a stale entry).
    const { services, layout } = stackWorld({ db: 'error' });
    const ghost: Service = { ...services[1], id: containerNodeId('stack', 'stale'), status: 'error', name: 'stale' };
    services.push(ghost);
    const alerts = records([alert('a-stale', ghost.id, 1), alert('a-db', containerNodeId('stack', 'db'), 50)]);
    expect(technicianQueue(alerts, records(services), layout)).toEqual([containerNodeId('stack', 'db')]);
  });

  it('attends a helper container in error, not the healthy main node', () => {
    const { services, layout } = stackWorld({ web: 'running', db: 'error' });
    const alerts = records([alert('a-db', containerNodeId('stack', 'db'), 10)]);
    expect(technicianQueue(alerts, records(services), layout)).toEqual([containerNodeId('stack', 'db')]);
    // The queue follows the node identity, not the service it belongs to.
    expect(mainNodeId(layout, containerNodeId('stack', 'db'))).toBe('stack');
  });
});

describe('technician routing after recovery', () => {
  it('goes to the next fault node when one is left', () => {
    const { layout } = stackWorld({ db: 'error', worker: 'error' });
    const queue = [containerNodeId('stack', 'db'), containerNodeId('stack', 'worker')];
    const plan = planAfterRecovery(layout, queue, containerNodeId('stack', 'db'), 0.42);
    expect(plan.phase).toBe('walk');
    expect(plan.target).toBe(containerNodeId('stack', 'worker'));
    expectPoint(plan.path?.at(-1), frontAt(layout.slots[containerNodeId('stack', 'worker')].front, 0.42));
  });

  it('goes home when nothing else is down', () => {
    const { layout } = stackWorld({ db: 'error' });
    const plan = planAfterRecovery(layout, [], containerNodeId('stack', 'db'), 0.42);
    expect(plan.phase).toBe('home');
    expect(plan.path?.at(-1)).toEqual(layout.home);
  });

  it('goes home when the node was removed from the world', () => {
    const { layout } = stackWorld();
    // No rack for the node we stood at: nothing to route from, so the technician is just home.
    const plan = planAfterRecovery(layout, [], 'removed', 0.42);
    expect(plan.phase).toBe('idle');
    expect(nextTarget([], 'removed')).toBeNull();
  });

  it('still walks to another fault when the node it stood at disappeared', () => {
    const { layout } = stackWorld({ worker: 'error' });
    const worker = containerNodeId('stack', 'worker');
    const plan = planAfterRecovery(layout, [worker], 'removed', 0.42);
    expect(plan.phase).toBe('walk');
    expect(plan.target).toBe(worker);
    expectPoint(plan.path?.at(-1), frontAt(layout.slots[worker].front, 0.42));
  });
});

describe('layout rebuilds', () => {
  it('re-plans a cart onto the new main rack instead of the old coordinates', () => {
    const before = stackWorld().layout;
    // Rebuilding with an extra project moves the whole grid.
    const extra = project('p2', 'another');
    const e2 = env('e2', 'p2');
    const extraSvc = service('other', { environmentId: 'e2', projectId: 'p2' });
    const after = computeLayout({
      projects: [P, extra],
      environments: [E, e2],
      services: [...stackWorld().services, extraSvc],
    });
    const oldRoute = planCart(before, 'stack', 0.04);
    const newRoute = planCart(after, 'stack', 0.04);
    expect(newRoute.route).not.toEqual(oldRoute.route);
    expectPoint(newRoute.route?.at(-1), frontAt(after.slots['stack'].front, 0.04));
  });

  it('keeps the technician working at a still-errored node, at its new position', () => {
    const { services, layout } = stackWorld({ db: 'error' });
    const db = containerNodeId('stack', 'db');
    const before = planTechnician(layout, [db], { phase: 'work', target: db, at: db }, 0.42);
    expect(before.phase).toBe('work');
    expectPoint(before.pos, standSpot(layout, db, 0.42)!);
    // A rebuild that shifts the grid: the plan now points at the new spot.
    const moved = computeLayout({
      projects: [P, project('p2')],
      environments: [E, env('e2', 'p2')],
      services: [...services, service('other', { environmentId: 'e2', projectId: 'p2' })],
    });
    const after = planTechnician(moved, [db], { phase: 'work', target: db, at: db }, 0.42);
    expect(after.phase).toBe('work');
    expectPoint(after.pos, standSpot(moved, db, 0.42)!);
    expect(moved.slots[db].front).not.toEqual(layout.slots[db].front);
  });

  it('walks to the node it was after through the new layout', () => {
    const { services, layout } = stackWorld({ db: 'error' });
    const db = containerNodeId('stack', 'db');
    const moved = computeLayout({
      projects: [P, project('p2')],
      environments: [E, env('e2', 'p2')],
      services: [...services, service('other', { environmentId: 'e2', projectId: 'p2' })],
    });
    const plan = planTechnician(moved, [db], { phase: 'walk', target: db, at: null }, 0.42);
    expect(plan.phase).toBe('walk');
    expect(plan.target).toBe(db);
    expectPoint(plan.path?.at(-1), frontAt(moved.slots[db].front, 0.42));
    // Sanity: the rebuild really moved the rack.
    expect(moved.slots[db].front).not.toEqual(layout.slots[db].front);
  });

  it('goes home when the target vanished in the rebuild', () => {
    const { layout } = stackWorld();
    const plan = planTechnician(layout, [], { phase: 'walk', target: 'gone', at: null }, 0.42);
    expect(plan.phase).toBe('idle');
    expect(plan.pos).toEqual(layout.home);
  });

  it('re-targets to the next incident when the node it was after recovered', () => {
    const { layout } = stackWorld({ db: 'error', worker: 'error' });
    const db = containerNodeId('stack', 'db');
    const worker = containerNodeId('stack', 'worker');
    // En route to db, but db recovered: only worker is left, so re-planning aims at worker.
    const plan = planTechnician(layout, [worker], { phase: 'walk', target: db, at: null }, 0.42);
    expect(plan.phase).toBe('walk');
    expect(plan.target).toBe(worker);
    expectPoint(plan.path?.at(-1), frontAt(layout.slots[worker].front, 0.42));
  });

  it('finishes walking home along the new coordinates', () => {
    const { layout } = stackWorld();
    const db = containerNodeId('stack', 'db');
    const plan = planTechnician(layout, [], { phase: 'home', target: null, at: db }, 0.42);
    expect(plan.phase).toBe('home');
    expect(plan.path?.at(-1)).toEqual(layout.home);
  });
});

describe('layout rebuild trigger', () => {
  const structure = (services: Service[]) => ({ projects: [P], environments: [E], services });

  it('changes when a service (or container) is added or removed', () => {
    const one = structure([service('a', { environmentId: 'e1', projectId: 'p1' })]);
    const two = structure([service('a', { environmentId: 'e1', projectId: 'p1' }), service('b', { environmentId: 'e1', projectId: 'p1' })]);
    expect(structureKey(one)).not.toEqual(structureKey(two));
  });

  it('stays the same on status-only changes (no needless rebuild)', () => {
    const before = structure([service('a', { environmentId: 'e1', projectId: 'p1', status: 'running' })]);
    const after = structure([service('a', { environmentId: 'e1', projectId: 'p1', status: 'error' })]);
    expect(structureKey(before)).toEqual(structureKey(after));
  });
});

describe('Walker resumption on a new path', () => {
  const at = (p: [number, number, number]) => new Walker([p, [p[0], p[1], p[2] + 1]]).pos;

  it('starts at the closest point of the new route', () => {
    const route: [number, number, number][] = [
      [0, 0, 0],
      [0, 0, 2],
      [0, 0, 4],
    ];
    const w = new Walker(route, at([0, 0, 2]));
    expect(w.pos.toArray()).toEqual([0, 0, 2]);
    expect(w.remaining).toBeCloseTo(2);
    expect(w.step(1)).toBe(false);
    expect(w.step(1)).toBe(true);
    expect(w.pos.toArray()).toEqual([0, 0, 4]);
  });
});
