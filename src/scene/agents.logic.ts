/**
 * Decisions behind the moving agents — pure, no React, so they can be tested directly.
 *
 * Container identity: a service split over several containers becomes several nodes, each in its
 * own rack slot. Exactly one node — the main container — keeps the service id; helpers are
 * `<serviceId>::<container>`. A deploy belongs to the service, so its cart only ever drives to
 * the main node. The technician instead attends any node that is in error with an open alert.
 */
import type { Alert, Service } from '../data/types';
import { cartRoute, mainNodeId, routeBetween, routeFromHome, routeHome, type Layout, type V3 } from '../layout';

/**
 * Nodes that need a hand, oldest incident first: an unresolved critical alert on a node that is
 * still in error and still has a rack in the layout. Duplicate alerts for one node collapse into
 * a single queue entry (its oldest alert decides the order).
 */
export function technicianQueue(alerts: Record<string, Alert>, services: Record<string, Service>, layout: Layout): string[] {
  const ordered = Object.values(alerts)
    .filter((a) => !a.resolvedAt && a.severity === 'critical' && services[a.serviceId]?.status === 'error')
    .sort((a, b) => a.createdAt - b.createdAt);
  const queue: string[] = [];
  const seen = new Set<string>();
  for (const a of ordered) {
    if (seen.has(a.serviceId) || !layout.slots[a.serviceId]) continue; // dedupe per node, and drop nodes with no rack
    seen.add(a.serviceId);
    queue.push(a.serviceId);
  }
  return queue;
}

/** The next fault node to attend, skipping the one just left; null when nothing else is down. */
export function nextTarget(queue: string[], exclude: string | null): string | null {
  return queue.find((id) => id !== exclude) ?? null;
}

export type TechPhase = 'idle' | 'walk' | 'work' | 'home';

export interface TechState {
  phase: TechPhase;
  /** Node the technician is walking to. */
  target: string | null;
  /** Node the technician stands at while working. */
  at: string | null;
}

export interface TechPlan {
  phase: TechPhase;
  target: string | null;
  at: string | null;
  /** Route for walk / home; null for work (the technician holds pos) and idle (at home). */
  path: V3[] | null;
  /** Standing spot for the work phase, or the home spot for idle. */
  pos: V3 | null;
}

const idleAt = (layout: Layout): TechPlan => ({ phase: 'idle', target: null, at: null, path: null, pos: layout.home });

/** The technician's standing spot in front of a node, with the same lateral shift the routes use. */
export function standSpot(layout: Layout, id: string, dx: number): V3 | null {
  const slot = layout.slots[id];
  return slot ? [slot.front[0] + dx, slot.front[1], slot.front[2]] : null;
}

/**
 * What the technician should do after a layout rebuild (service / environment / project added or
 * removed). Every old coordinate is stale, so nothing is resumed on the old route: it either keeps
 * working at a node that still needs it (at its new spot), walks to the node it was after — or the
 * oldest open incident — and otherwise walks back home from where it stands. The caller resumes the
 * returned path at the position closest to the technician's current spot.
 */
export function planTechnician(layout: Layout, queue: string[], prev: TechState, dx: number): TechPlan {
  // Still at a node that needs work and still has a rack: keep working there, at the new position.
  if (prev.phase === 'work' && prev.at && queue.includes(prev.at) && layout.slots[prev.at]) {
    return { phase: 'work', target: prev.at, at: prev.at, path: null, pos: standSpot(layout, prev.at, dx) };
  }

  // Prefer the node we were already heading for while it still has an open incident; otherwise
  // take the oldest incident left in the queue.
  const target = (prev.target && queue.includes(prev.target) ? prev.target : null) ?? queue[0] ?? null;
  if (target) {
    const path = routeFromHome(layout, target, dx);
    if (path) return { phase: 'walk', target, at: null, path, pos: null };
  }

  // Nothing to do: go back to the waiting spot from the rack we were at, if it still exists.
  if (prev.at && layout.slots[prev.at]) {
    const path = routeHome(layout, prev.at, dx);
    if (path) return { phase: 'home', target: null, at: prev.at, path, pos: null };
  }
  return idleAt(layout);
}

/** What to do once the node the technician was working at recovered (or disappeared). */
export function planAfterRecovery(layout: Layout, queue: string[], from: string | null, dx: number): TechPlan {
  const job = nextTarget(queue, from);
  if (job && layout.slots[job]) {
    const direct = from && layout.slots[from] ? routeBetween(layout, from, job, dx) : null;
    const path = direct ?? routeFromHome(layout, job, dx);
    if (path) return { phase: 'walk', target: job, at: null, path, pos: null };
  }
  // Nothing (else) to do: head back to the waiting spot, from where we stand when that rack exists.
  const path = from && layout.slots[from] ? routeHome(layout, from, dx) : null;
  if (path) return { phase: 'home', target: null, at: from, path, pos: null };
  return idleAt(layout);
}

export interface CartPlan {
  /** Node the cart drives to: the service's main container, or null when it has no node right now. */
  target: string | null;
  route: V3[] | null;
}

/**
 * Where a deployment's cart belongs in a layout. Only the main container node is a valid target;
 * with no node at all there is nowhere to drive (the cart just leaves once the deploy ends).
 */
export function planCart(layout: Layout, serviceId: string, lane: number): CartPlan {
  const target = mainNodeId(layout, serviceId);
  return { target, route: target ? cartRoute(layout, target, lane) : null };
}

/** A cart with no destination may leave as soon as its deploy has ended (otherwise it waits, hidden). */
export const cartLeaves = (route: V3[] | null, terminal: boolean) => !route && terminal;
