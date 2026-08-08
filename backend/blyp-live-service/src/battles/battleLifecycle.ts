export const BATTLE_LOBBY_LEAD_MS = 15 * 60 * 1000;
export const BATTLE_JOIN_GRACE_MS = 2 * 60 * 1000;
export const BATTLE_COUNTDOWN_MS = 5 * 1000;

export const BATTLE_LIFECYCLE_STATES = [
  'INVITED',
  'ACCEPTED',
  'LOBBY_OPEN',
  'COUNTDOWN',
  'LIVE',
  'FINALIZING',
  'ENDED',
  'DECLINED',
  'CANCELLED',
  'EXPIRED',
] as const;

export type BattleLifecycleState = (typeof BATTLE_LIFECYCLE_STATES)[number];
export type BattleSide = 'A' | 'B';
export type BattleTerminalReason =
  | 'DURATION_COMPLETE'
  | 'MANUAL_END'
  | 'NO_SHOW_A'
  | 'NO_SHOW_B'
  | 'NO_SHOW_BOTH'
  | 'DECLINED'
  | 'CANCELLED'
  | 'INVITE_EXPIRED';

export type BattleAuthorization = {
  creatorUid: string;
  opponentUid: string;
};

export type BattleLifecycleSnapshot = {
  state: BattleLifecycleState;
  scheduledStartAtMs: number;
  durationSec: number;
  sideAJoined: boolean;
  sideBJoined: boolean;
  countdownEndsAtMs?: number | null;
  liveStartedAtMs?: number | null;
};

export type BattleLifecycleDecision = {
  nextState: BattleLifecycleState;
  terminalReason?: BattleTerminalReason;
  countdownEndsAtMs?: number;
  liveStartedAtMs?: number;
};

const TERMINAL_STATES = new Set<BattleLifecycleState>([
  'ENDED',
  'DECLINED',
  'CANCELLED',
  'EXPIRED',
]);

export function isBattleTerminalState(state: BattleLifecycleState): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * Registry-based publisher authorization. This deliberately has no escrow input:
 * free battles and staked battles authorize the same fixed A/B stage roles.
 */
export function battleSideForUser(
  battle: BattleAuthorization,
  userId: string,
): BattleSide | null {
  if (battle.creatorUid === userId) return 'A';
  if (battle.opponentUid === userId) return 'B';
  return null;
}

export function userIdForBattleSide(
  battle: BattleAuthorization,
  side: BattleSide,
): string {
  return side === 'A' ? battle.creatorUid : battle.opponentUid;
}

/** Fixed token metadata makes side A left/slot 0 and side B right/slot 1. */
export function battleTokenAttributes(
  side: BattleSide,
  battleId: string,
  sessionId: string,
  title = '',
): Record<string, string> {
  return {
    role: 'battle',
    battleId,
    battleSide: side,
    slotIndex: side === 'A' ? '0' : '1',
    sessionId,
    ...(title ? { title } : {}),
  };
}

export function noShowReason(
  sideAJoined: boolean,
  sideBJoined: boolean,
): BattleTerminalReason {
  if (sideAJoined && !sideBJoined) return 'NO_SHOW_B';
  if (!sideAJoined && sideBJoined) return 'NO_SHOW_A';
  return 'NO_SHOW_BOTH';
}

/**
 * Pure lifecycle reducer. Server receipt time is the only clock. The caller may
 * apply this repeatedly in one lock (for example ACCEPTED -> LOBBY_OPEN ->
 * COUNTDOWN) until the state stabilizes.
 */
export function evaluateBattleLifecycle(
  battle: BattleLifecycleSnapshot,
  nowMs: number,
): BattleLifecycleDecision | null {
  if (isBattleTerminalState(battle.state) || battle.state === 'FINALIZING') return null;

  const publishedAt = battle.scheduledStartAtMs;
  const graceEndsAt = publishedAt + BATTLE_JOIN_GRACE_MS;

  if (battle.state === 'INVITED') {
    if (nowMs >= graceEndsAt) {
      return { nextState: 'EXPIRED', terminalReason: 'INVITE_EXPIRED' };
    }
    return null;
  }

  if (battle.state === 'ACCEPTED') {
    if (nowMs >= publishedAt - BATTLE_LOBBY_LEAD_MS) {
      return { nextState: 'LOBBY_OPEN' };
    }
    return null;
  }

  if (battle.state === 'LOBBY_OPEN') {
    if (nowMs < publishedAt) return null;
    if (battle.sideAJoined && battle.sideBJoined) {
      return {
        nextState: 'COUNTDOWN',
        countdownEndsAtMs: Math.max(nowMs, publishedAt) + BATTLE_COUNTDOWN_MS,
      };
    }
    if (nowMs >= graceEndsAt) {
      return {
        nextState: 'FINALIZING',
        terminalReason: noShowReason(battle.sideAJoined, battle.sideBJoined),
      };
    }
    return null;
  }

  if (battle.state === 'COUNTDOWN') {
    const countdownEndsAt = Number(battle.countdownEndsAtMs || 0);
    if (countdownEndsAt > 0 && nowMs >= countdownEndsAt) {
      return { nextState: 'LIVE', liveStartedAtMs: countdownEndsAt };
    }
    return null;
  }

  if (battle.state === 'LIVE') {
    const liveStartedAt = Number(battle.liveStartedAtMs || 0);
    const durationMs = Math.max(60, battle.durationSec || 300) * 1000;
    if (liveStartedAt > 0 && nowMs >= liveStartedAt + durationMs) {
      return { nextState: 'FINALIZING', terminalReason: 'DURATION_COMPLETE' };
    }
  }

  return null;
}

export type BattleScore = { A: number; B: number };

/**
 * Small deterministic model of the database's UNIQUE(gift_event_id) scoring
 * rule. Production uses the same decision with a unique insert inside the gift
 * transaction; this helper makes the exactly-once contract directly testable.
 */
export function applyGiftScoreOnce(
  score: BattleScore,
  seenGiftEventIds: Set<string>,
  input: { giftEventId: string; side: BattleSide; points: number },
): { applied: boolean; score: BattleScore } {
  if (seenGiftEventIds.has(input.giftEventId)) {
    return { applied: false, score: { ...score } };
  }
  seenGiftEventIds.add(input.giftEventId);
  const points = Math.max(1, Math.floor(Number(input.points) || 0));
  return {
    applied: true,
    score: {
      ...score,
      [input.side]: score[input.side] + points,
    },
  };
}
