import { actionsById } from '../data/actions';
import { items } from '../data/items';
import type { GameState, OfflineRewardLine, OfflineSummary, RewardRoll, SkillId } from '../types/game';
import { completeOfflineTravel } from './mapSystem';
import { addItem, addLog, addSkillXp, cloneState, consumeItems, hasItems } from './stateUtils';

const MAX_OFFLINE_MS = 24 * 60 * 60 * 1000;
const MIN_REPORT_MS = 5000;

interface SettledAction {
  actionName: string;
  completions: number;
  rewards: OfflineRewardLine[];
  xp: Partial<Record<SkillId, number>>;
}

function rewardLabel(reward: RewardRoll): string {
  if (reward.gp) return 'GP';
  return reward.itemId ? items[reward.itemId]?.name ?? reward.itemId : 'Reward';
}

function expectedQuantity(reward: RewardRoll, completions: number): number {
  const chance = reward.chance ?? 1;
  const baseQuantity = reward.quantity ?? ((reward.minQuantity ?? 1) + (reward.maxQuantity ?? reward.minQuantity ?? 1)) / 2;
  const expected = baseQuantity * chance * completions;
  const whole = Math.floor(expected);
  const remainder = expected - whole;
  return whole + (Math.random() < remainder ? 1 : 0);
}

function maxCompletionsFromInputs(state: GameState, actionId: string, theoretical: number): number {
  const action = actionsById[actionId];
  if (!action?.inputs?.length) return theoretical;

  return action.inputs.reduce((max, input) => {
    return Math.min(max, Math.floor((state.bank[input.itemId] ?? 0) / input.quantity));
  }, theoretical);
}

/**
 * Settle the active skill action over the full offline window, mirroring the
 * live rules in `idleSystem.ts`. Returns the summary pieces plus the amount of
 * offline time this settlement accounted for, so map travel can use the rest.
 */
function settleActiveAction(state: GameState, elapsedMs: number): { settled: SettledAction | null; consumedMs: number } {
  if (!state.activeActionId) return { settled: null, consumedMs: 0 };

  const action = actionsById[state.activeActionId];
  if (!action) {
    state.activeActionId = null;
    state.actionProgressMs = 0;
    return { settled: null, consumedMs: 0 };
  }

  const totalMs = elapsedMs + state.actionProgressMs;
  const theoretical = Math.floor(totalMs / action.intervalMs);
  const completions = maxCompletionsFromInputs(state, action.id, theoretical);
  const rewards: OfflineRewardLine[] = [];

  for (let index = 0; index < completions; index += 1) {
    if (!hasItems(state, action.inputs)) break;
    consumeItems(state, action.inputs);
  }

  if (completions > 0) {
    addSkillXp(state, action.skillId, action.xp * completions, action.masteryXp * completions);

    action.outputs.forEach((reward) => {
      const quantity = expectedQuantity(reward, completions);
      if (quantity <= 0) return;

      if (reward.gp) {
        const amount = reward.gp * quantity;
        state.gp += amount;
        rewards.push({ label: 'GP', quantity: amount });
        return;
      }

      if (reward.itemId && addItem(state, reward.itemId, quantity)) {
        rewards.push({ label: rewardLabel(reward), quantity });
      }
    });
  }

  if (completions < theoretical && action.inputs?.length) {
    state.activeActionId = null;
    state.actionProgressMs = 0;
    addLog(state, 'warning', `${action.name} stopped offline: missing resources.`);
  } else {
    state.actionProgressMs = totalMs % action.intervalMs;
  }

  return {
    settled: {
      actionName: action.name,
      completions,
      rewards,
      xp: completions > 0 ? { [action.skillId]: action.xp * completions } : {},
    },
    // The existing skill rules account for the whole elapsed window, so no
    // time is left over for travel while an action is being settled.
    consumedMs: elapsedMs,
  };
}

export function applyOfflineProgression(state: GameState, now = Date.now()): GameState {
  const elapsed = Math.max(0, now - state.lastSavedAt);
  if (elapsed < MIN_REPORT_MS) {
    return { ...state, lastSavedAt: now };
  }

  const cappedElapsed = Math.min(elapsed, MAX_OFFLINE_MS);
  const next = cloneState(state);
  next.lastSavedAt = now;

  // 1. Settle the skill action first, using the existing rules.
  const { settled, consumedMs } = settleActiveAction(next, cappedElapsed);

  // 2. Hand whatever offline time the action did not consume to map travel.
  //    This no-ops (without touching destination/progress) when the run is
  //    over, a fight is active, or there is no destination.
  const remainingMs = Math.max(0, cappedElapsed - consumedMs);
  const travel = completeOfflineTravel(next, remainingMs);

  const summary: OfflineSummary = {
    secondsAway: Math.floor(cappedElapsed / 1000),
    capped: elapsed > MAX_OFFLINE_MS,
    actionName: settled?.actionName ?? null,
    completions: settled?.completions ?? 0,
    rewards: settled?.rewards ?? [],
    xp: settled?.xp ?? {},
    map: {
      advanced: travel.advanced,
      arrivedTileName: travel.arrivedTileName,
      interruptedBy: travel.interruptedBy,
    },
  };
  next.offlineSummary = summary;

  return next;
}
