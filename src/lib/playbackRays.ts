/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Multi-transmitter mobility replay — per-Tx ray grouping, categorical colors
 * and view-model helpers.
 *
 * The backend returns every waypoint's rays as one union (`MobilityStep.paths`)
 * with each `PropagationPath.txId` tagged, and may additionally carry an
 * explicit `raysByTx` map. Local/fixture replay data can use either shape (or
 * one of the common aliases below). Everything the 3D ray layer and the legend
 * render goes through `buildTxRayGroups`, so the scene graph, the DOM legend
 * and tests all agree on Tx identity / color / emphasis.
 */
import type { PropagationPath } from '../types';

// Strong categorical palette that stays readable on the studio's near-white
// background. Indexed by the Tx's position in the scene's Tx order, so colors
// are stable across replay steps.
export const TX_RAY_PALETTE: readonly number[] = [
  0x2563eb, // blue-600
  0xdc2626, // red-600
  0x059669, // emerald-600
  0x7c3aed, // violet-600
  0xd97706, // amber-600
  0x0e7490, // cyan-700
  0xbe185d, // pink-700
  0x4d7c0f, // lime-700
];

// Neutral gray for rays that carry no txId (legacy / hand-authored fixtures).
export const UNTAGGED_RAY_COLOR = 0x64748b; // slate-500
export const UNTAGGED_TX_ID = '__untagged__';

export function txRayColorIndex(txId: string, orderedIds?: readonly string[] | null): number {
  if (orderedIds && orderedIds.length > 0) {
    const i = orderedIds.indexOf(txId);
    if (i >= 0) return i % TX_RAY_PALETTE.length;
  }
  // Stable FNV-ish hash fallback for ids outside the ordered device list.
  let h = 2166136261 >>> 0;
  for (let i = 0; i < txId.length; i++) {
    h ^= txId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h % TX_RAY_PALETTE.length;
}

export function txRayColor(txId: string, orderedIds?: readonly string[] | null): number {
  if (txId === UNTAGGED_TX_ID) return UNTAGGED_RAY_COLOR;
  return TX_RAY_PALETTE[txRayColorIndex(txId, orderedIds)];
}

export function numberToCssHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

export function txRayCssColor(txId: string, orderedIds?: readonly string[] | null): string {
  return numberToCssHex(txRayColor(txId, orderedIds));
}

export interface RayTxInfo {
  id: string;
  name?: string | null;
}

// Accepted shapes for an explicit per-Tx ray collection on a replay step.
export type RaysByTxInput =
  | Record<string, PropagationPath[] | undefined | null>
  | Array<
      | { txId: string; paths?: PropagationPath[] | null; rays?: PropagationPath[] | null }
      | [string, PropagationPath[]]
    >
  | null
  | undefined;

/**
 * The slice of a replay step `buildTxRayGroups` needs. Structurally satisfied
 * by `MobilityStep`; kept local so this module stays free of API/React imports.
 */
export interface RayStepLike {
  paths?: PropagationPath[] | null;
  // Canonical field added by `withRaysByTx`; aliases tolerate hand-authored
  // local replay fixtures that name the collection differently.
  raysByTx?: RaysByTxInput;
  pathsByTx?: RaysByTxInput;
  txRays?: RaysByTxInput;
  perTxPaths?: RaysByTxInput;
  servingTxId?: string | null;
  perTx?: Array<{
    txId: string;
    txName?: string | null;
    // Optional rays nested in the per-Tx breakdown (not sent by the current
    // backend, which keeps rays in the tagged union, but tolerated here).
    paths?: PropagationPath[] | null;
    rays?: PropagationPath[] | null;
  }> | null;
}

export interface TxRayGroup {
  txId: string;
  txName: string;
  color: number;
  cssColor: string;
  paths: PropagationPath[];
  /** False when this step carries no ray for the Tx — legend shows "no path". */
  hasPaths: boolean;
  /** The currently emphasized (serving or manually focused) transmitter. */
  emphasized: boolean;
  /** The backend/best-server designated transmitter, independent of focus. */
  serving: boolean;
}

function normalizeRaysByTx(input: RaysByTxInput): Map<string, PropagationPath[]> | null {
  if (!input) return null;
  const map = new Map<string, PropagationPath[]>();
  if (Array.isArray(input)) {
    for (const entry of input) {
      if (Array.isArray(entry)) {
        const [txId, paths] = entry;
        if (txId != null) map.set(String(txId), Array.isArray(paths) ? paths : []);
      } else if (entry && typeof entry === 'object') {
        const txId = String(entry.txId);
        const paths = entry.paths ?? entry.rays ?? [];
        map.set(txId, Array.isArray(paths) ? paths : []);
      }
    }
    return map.size > 0 ? map : null;
  }
  if (typeof input === 'object') {
    for (const [txId, paths] of Object.entries(input)) {
      map.set(txId, Array.isArray(paths) ? (paths as PropagationPath[]) : []);
    }
    return map;
  }
  return null;
}

/**
 * Extract each transmitter's ray set from a replay step.
 *
 * Precedence: an explicit per-Tx field (`raysByTx` / `pathsByTx` / `txRays` /
 * `perTxPaths`) wins when present; otherwise the union `step.paths` is grouped
 * by `PropagationPath.txId`. Rays without a `txId` land in `UNTAGGED_TX_ID`.
 */
export function extractRaysByTx(step: RayStepLike | null | undefined): Map<string, PropagationPath[]> {
  const empty = new Map<string, PropagationPath[]>();
  if (!step) return empty;

  const explicit =
    normalizeRaysByTx(step.raysByTx) ??
    normalizeRaysByTx(step.pathsByTx) ??
    normalizeRaysByTx(step.txRays) ??
    normalizeRaysByTx(step.perTxPaths);
  if (explicit) return explicit;

  // Optional perTx[i].paths / perTx[i].rays collections.
  if (Array.isArray(step.perTx)) {
    const fromPerTx = new Map<string, PropagationPath[]>();
    let anyRays = false;
    for (const t of step.perTx) {
      const rays = Array.isArray(t.paths) ? t.paths : Array.isArray(t.rays) ? t.rays : null;
      if (rays) {
        fromPerTx.set(String(t.txId), rays);
        anyRays = true;
      }
    }
    if (anyRays) return fromPerTx;
  }

  const map = new Map<string, PropagationPath[]>();
  for (const p of step.paths ?? []) {
    const txId = p.txId ? String(p.txId) : UNTAGGED_TX_ID;
    const arr = map.get(txId);
    if (arr) arr.push(p);
    else map.set(txId, [p]);
  }
  return map;
}

/**
 * Return a copy of `step` carrying the canonical `raysByTx` record. Called when
 * mobility results / selected steps enter app state so "the replay step
 * carries every transmitter's ray set" is literally true at runtime.
 */
export function withRaysByTx<T extends RayStepLike>(step: T): T & { raysByTx: Record<string, PropagationPath[]> } {
  const map = extractRaysByTx(step);
  const raysByTx: Record<string, PropagationPath[]> = {};
  for (const [txId, paths] of map) raysByTx[txId] = paths;
  return { ...step, raysByTx };
}

export interface BuildGroupsArgs {
  step?: RayStepLike | null;
  /** Every known transmitter — entries are kept even with zero rays. */
  txs?: RayTxInfo[] | null;
  /** Manual legend focus; when null the step's serving Tx is emphasized. */
  focusTxId?: string | null;
}

/**
 * Build the ordered per-Tx view groups for one replay step.
 *
 * Order: known `txs` first (scene order), then Tx ids found only in the step's
 * ray data. A known Tx missing from the step gets an empty `paths` group with
 * `hasPaths === false` so the legend can flag "no path" without the renderer
 * drawing anything.
 */
export function buildTxRayGroups({ step, txs, focusTxId }: BuildGroupsArgs): TxRayGroup[] {
  const raysByTx = extractRaysByTx(step);
  const knownTxs = txs ?? [];

  const orderedIds: string[] = [];
  const seen = new Set<string>();
  for (const t of knownTxs) {
    const id = String(t.id);
    if (!seen.has(id)) {
      seen.add(id);
      orderedIds.push(id);
    }
  }
  for (const id of raysByTx.keys()) {
    if (!seen.has(id)) {
      seen.add(id);
      orderedIds.push(id);
    }
  }

  const perTxNames = new Map<string, string>();
  for (const p of step?.perTx ?? []) {
    if (p?.txId != null && p.txName) perTxNames.set(String(p.txId), p.txName);
  }
  const txNames = new Map<string, string>();
  for (const t of knownTxs) {
    if (t.name) txNames.set(String(t.id), t.name);
  }

  const servingTxId = step?.servingTxId != null ? String(step.servingTxId) : null;
  const effectiveEmphasisId = focusTxId != null ? String(focusTxId) : servingTxId;

  return orderedIds.map((txId, index) => {
    const paths = raysByTx.get(txId) ?? [];
    const color =
      txId === UNTAGGED_TX_ID ? UNTAGGED_RAY_COLOR : TX_RAY_PALETTE[index % TX_RAY_PALETTE.length];
    const txName =
      txNames.get(txId) ??
      perTxNames.get(txId) ??
      (txId === UNTAGGED_TX_ID ? 'Unknown Tx' : txId);
    const isServing = servingTxId != null && txId === servingTxId;
    return {
      txId,
      txName,
      color,
      cssColor: numberToCssHex(color),
      paths,
      hasPaths: paths.length > 0,
      serving: isServing,
      emphasized: effectiveEmphasisId != null && txId === effectiveEmphasisId,
    };
  });
}
