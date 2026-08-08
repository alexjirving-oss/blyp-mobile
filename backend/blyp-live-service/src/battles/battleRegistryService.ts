import type { Knex } from 'knex';
import { getFirestore } from '../admin/firestoreAdmin';
import { EconomyError } from '../economy/economyErrors';
import { getEconomyInfra } from '../economy/infra';
import { ensureEconomySchema } from '../economy/schema';
import { emitBattleEvent } from '../realtime/realtimeBus';
import {
  BATTLE_JOIN_GRACE_MS,
  BATTLE_LOBBY_LEAD_MS,
  BattleLifecycleDecision,
  BattleLifecycleState,
  BattleSide,
  BattleTerminalReason,
  battleSideForUser,
  evaluateBattleLifecycle,
} from './battleLifecycle';
import { buildBattleFirestoreMirror } from './battleFirestoreMirror';

export type BattleRegistryRow = {
  battle_id: string;
  room_id: string;
  creator_uid: string;
  opponent_uid: string;
  creator_name: string;
  creator_username: string;
  opponent_name: string;
  opponent_username: string;
  title: string;
  state: BattleLifecycleState;
  scheduled_start_at: string | Date;
  duration_sec: number;
  deposit_mode: string;
  stake_coins: string;
  session_id: string | null;
  stage_arn: string | null;
  side_a_joined_at: string | Date | null;
  side_b_joined_at: string | Date | null;
  countdown_ends_at: string | Date | null;
  live_started_at: string | Date | null;
  finalizing_at: string | Date | null;
  ended_at: string | Date | null;
  terminal_reason: BattleTerminalReason | null;
  winner_side: BattleSide | null;
  score_a: string;
  score_b: string;
  settlement_json: any;
  version: number;
  created_at: string | Date;
  updated_at: string | Date;
};

export type BattleArenaSnapshot = {
  battleId: string;
  roomId: string;
  state: BattleLifecycleState;
  title: string;
  scheduledStartAt: number;
  lobbyOpensAt: number;
  graceEndsAt: number;
  durationSec: number;
  depositMode: string;
  stakeCoins: number;
  sessionId: string | null;
  stageArn: string | null;
  countdownEndsAt: number | null;
  liveStartedAt: number | null;
  finalizingAt: number | null;
  endedAt: number | null;
  terminalReason: BattleTerminalReason | null;
  winnerSide: BattleSide | null;
  score: { A: number; B: number };
  sideA: {
    userId: string;
    displayName: string;
    username: string;
    joined: boolean;
    joinedAt: number | null;
  };
  sideB: {
    userId: string;
    displayName: string;
    username: string;
    joined: boolean;
    joinedAt: number | null;
  };
  settlement: any;
  version: number;
  createdAt: number;
  updatedAt: number;
};

export type RegisterBattleInput = {
  battleId: string;
  opponentUid: string;
  creatorName?: string;
  creatorUsername?: string;
  opponentName?: string;
  opponentUsername?: string;
  title?: string;
  scheduledStartAt: number;
  durationSec: number;
  depositMode: 'free' | 'staked';
  stakeCoins: number;
};

export type BattleTransition = {
  before: BattleArenaSnapshot;
  after: BattleArenaSnapshot;
  decision: BattleLifecycleDecision;
};

function timestampMs(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function numberValue(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function serializeBattleArena(row: BattleRegistryRow): BattleArenaSnapshot {
  const scheduledStartAt = timestampMs(row.scheduled_start_at) || 0;
  const sideAJoinedAt = timestampMs(row.side_a_joined_at);
  const sideBJoinedAt = timestampMs(row.side_b_joined_at);
  return {
    battleId: row.battle_id,
    roomId: row.room_id,
    state: row.state,
    title: row.title || '',
    scheduledStartAt,
    lobbyOpensAt: scheduledStartAt - BATTLE_LOBBY_LEAD_MS,
    graceEndsAt: scheduledStartAt + BATTLE_JOIN_GRACE_MS,
    durationSec: Math.max(60, numberValue(row.duration_sec) || 300),
    depositMode: row.deposit_mode || 'free',
    stakeCoins: numberValue(row.stake_coins),
    sessionId: row.session_id || null,
    stageArn: row.stage_arn || null,
    countdownEndsAt: timestampMs(row.countdown_ends_at),
    liveStartedAt: timestampMs(row.live_started_at),
    finalizingAt: timestampMs(row.finalizing_at),
    endedAt: timestampMs(row.ended_at),
    terminalReason: row.terminal_reason || null,
    winnerSide: row.winner_side || null,
    score: {
      A: numberValue(row.score_a),
      B: numberValue(row.score_b),
    },
    sideA: {
      userId: row.creator_uid,
      displayName: row.creator_name || row.creator_username || 'Creator',
      username: row.creator_username || '',
      joined: sideAJoinedAt !== null,
      joinedAt: sideAJoinedAt,
    },
    sideB: {
      userId: row.opponent_uid,
      displayName: row.opponent_name || row.opponent_username || 'Opponent',
      username: row.opponent_username || '',
      joined: sideBJoinedAt !== null,
      joinedAt: sideBJoinedAt,
    },
    settlement: row.settlement_json || {},
    version: numberValue(row.version),
    createdAt: timestampMs(row.created_at) || Date.now(),
    updatedAt: timestampMs(row.updated_at) || Date.now(),
  };
}

async function requireBattleRow(
  trx: Knex | Knex.Transaction,
  battleId: string,
  lock = false,
): Promise<BattleRegistryRow> {
  let query = trx<BattleRegistryRow>('battle_registry').where({ battle_id: battleId });
  if (lock) query = query.forUpdate();
  const row = await query.first();
  if (!row) throw new EconomyError('NOT_FOUND', 404, 'Battle not found');
  return row;
}

function requireParticipant(row: BattleRegistryRow, userId: string): BattleSide {
  const side = battleSideForUser(
    { creatorUid: row.creator_uid, opponentUid: row.opponent_uid },
    userId,
  );
  if (!side) throw new EconomyError('RESTRICTED', 403, 'Only battle participants can do that');
  return side;
}

/**
 * Firestore remains the mobile realtime presentation mirror. Postgres is the
 * authority; clients never increment battle score or move lifecycle state.
 */
export async function mirrorBattleArena(arena: BattleArenaSnapshot): Promise<void> {
  const fs = getFirestore();
  if (!fs) return;
  try {
    await fs.collection('battles').doc(arena.battleId).set(
      buildBattleFirestoreMirror(arena),
      { merge: true },
    );

    if (
      arena.sessionId &&
      ['ENDED', 'DECLINED', 'CANCELLED', 'EXPIRED'].includes(arena.state)
    ) {
      const streamRef = fs.collection('liveStreams').doc(arena.sessionId);
      const stream = await streamRef.get();
      if (stream.data()?.activeBattleId === arena.battleId) {
        await streamRef.set(
          {
            activeBattleId: null,
            activeBattleIdUpdatedAt: Date.now(),
          },
          { merge: true },
        );
      }
    }
  } catch {
    // REST polling is authoritative if the presentation mirror is unavailable.
  }

  if (arena.sessionId) {
    emitBattleEvent(arena.sessionId, {
      battleId: arena.battleId,
      state: arena.state,
      version: arena.version,
      score: arena.score,
      countdownEndsAt: arena.countdownEndsAt,
      liveStartedAt: arena.liveStartedAt,
      winnerSide: arena.winnerSide,
    });
  }
}

export async function mirrorBattleById(battleId: string): Promise<BattleArenaSnapshot> {
  const arena = await getBattleArena(battleId);
  await mirrorBattleArena(arena);
  return arena;
}

export async function registerBattleRecord(
  creatorUserId: string,
  input: RegisterBattleInput,
): Promise<BattleArenaSnapshot> {
  const { db } = getEconomyInfra();
  await ensureEconomySchema(db);
  if (!creatorUserId || !input.opponentUid || creatorUserId === input.opponentUid) {
    throw new EconomyError('INVALID_INPUT', 400, 'Battle sides must be distinct');
  }
  const scheduledStartAt = Number(input.scheduledStartAt);
  if (!Number.isFinite(scheduledStartAt) || scheduledStartAt < Date.now() - BATTLE_JOIN_GRACE_MS) {
    throw new EconomyError('INVALID_INPUT', 400, 'Invalid battle start time');
  }

  const arena = await db.transaction(async (trx) => {
    await trx('battle_registry')
      .insert({
        battle_id: input.battleId,
        room_id: `battle:${input.battleId}`,
        creator_uid: creatorUserId,
        opponent_uid: input.opponentUid,
        creator_name: String(input.creatorName || '').trim(),
        creator_username: String(input.creatorUsername || '').trim().replace(/^@/, ''),
        opponent_name: String(input.opponentName || '').trim(),
        opponent_username: String(input.opponentUsername || '').trim().replace(/^@/, ''),
        title: String(input.title || '').trim(),
        state: 'INVITED',
        scheduled_start_at: new Date(scheduledStartAt).toISOString(),
        duration_sec: Math.max(60, Math.floor(Number(input.durationSec) || 300)),
        deposit_mode: input.depositMode,
        stake_coins: Math.max(0, Math.floor(Number(input.stakeCoins) || 0)),
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      })
      .onConflict('battle_id')
      .ignore();

    const row = await requireBattleRow(trx, input.battleId, true);
    if (row.creator_uid !== creatorUserId || row.opponent_uid !== input.opponentUid) {
      throw new EconomyError('CONFLICT', 409, 'Battle id already belongs to another event');
    }
    return serializeBattleArena(row);
  });
  await mirrorBattleArena(arena);
  return arena;
}

export async function getBattleArena(battleId: string): Promise<BattleArenaSnapshot> {
  const { db } = getEconomyInfra();
  await ensureEconomySchema(db);
  return serializeBattleArena(await requireBattleRow(db, battleId));
}

export async function getBattleArenaBySession(
  sessionId: string,
  trx?: Knex | Knex.Transaction,
): Promise<BattleArenaSnapshot | null> {
  const db = trx || getEconomyInfra().db;
  const row = await db<BattleRegistryRow>('battle_registry').where({ session_id: sessionId }).first();
  return row ? serializeBattleArena(row) : null;
}

export async function acceptBattleRecord(
  battleId: string,
  userId: string,
): Promise<BattleArenaSnapshot> {
  const { db } = getEconomyInfra();
  await ensureEconomySchema(db);
  const arena = await db.transaction(async (trx) => {
    const row = await requireBattleRow(trx, battleId, true);
    if (row.opponent_uid !== userId) {
      throw new EconomyError('RESTRICTED', 403, 'Only the invited opponent can accept');
    }
    if (row.state !== 'INVITED') {
      throw new EconomyError('INVALID_STATE', 409, `Battle is ${row.state}`);
    }
    await trx('battle_registry').where({ battle_id: battleId }).update({
      state: 'ACCEPTED',
      version: trx.raw('version + 1'),
      updated_at: trx.fn.now(),
    });
    return serializeBattleArena(await requireBattleRow(trx, battleId));
  });
  await mirrorBattleArena(arena);
  return arena;
}

async function closeBattleRecord(
  battleId: string,
  userId: string,
  state: 'DECLINED' | 'CANCELLED',
): Promise<BattleArenaSnapshot> {
  const { db } = getEconomyInfra();
  await ensureEconomySchema(db);
  const arena = await db.transaction(async (trx) => {
    const row = await requireBattleRow(trx, battleId, true);
    if (state === 'DECLINED') {
      if (row.opponent_uid !== userId) {
        throw new EconomyError('RESTRICTED', 403, 'Only the invited opponent can decline');
      }
      if (row.state !== 'INVITED') {
        throw new EconomyError('INVALID_STATE', 409, `Battle is ${row.state}`);
      }
    } else {
      requireParticipant(row, userId);
      if (!['INVITED', 'ACCEPTED', 'LOBBY_OPEN', 'COUNTDOWN'].includes(row.state)) {
        throw new EconomyError('INVALID_STATE', 409, 'Battle can no longer be cancelled');
      }
    }
    await trx('battle_registry').where({ battle_id: battleId }).update({
      state,
      terminal_reason: state === 'DECLINED' ? 'DECLINED' : 'CANCELLED',
      ended_at: trx.fn.now(),
      version: trx.raw('version + 1'),
      updated_at: trx.fn.now(),
    });
    return serializeBattleArena(await requireBattleRow(trx, battleId));
  });
  await mirrorBattleArena(arena);
  return arena;
}

export function declineBattleRecord(battleId: string, userId: string) {
  return closeBattleRecord(battleId, userId, 'DECLINED');
}

export function cancelBattleRecord(battleId: string, userId: string) {
  return closeBattleRecord(battleId, userId, 'CANCELLED');
}

export async function attachBattleStage(
  battleId: string,
  creatorUserId: string,
  input: { sessionId: string; stageArn: string },
): Promise<{ arena: BattleArenaSnapshot; attached: boolean }> {
  const { db } = getEconomyInfra();
  await ensureEconomySchema(db);
  const result = await db.transaction(async (trx) => {
    const row = await requireBattleRow(trx, battleId, true);
    if (row.creator_uid !== creatorUserId) {
      throw new EconomyError('RESTRICTED', 403, 'Only side A can open the battle stage');
    }
    if (!['LOBBY_OPEN', 'COUNTDOWN', 'LIVE'].includes(row.state)) {
      throw new EconomyError('INVALID_STATE', 409, 'Battle lobby is not open');
    }
    if (row.session_id && row.stage_arn) {
      return { arena: serializeBattleArena(row), attached: false };
    }
    await trx('battle_registry').where({ battle_id: battleId }).update({
      session_id: input.sessionId,
      stage_arn: input.stageArn,
      version: trx.raw('version + 1'),
      updated_at: trx.fn.now(),
    });
    return {
      arena: serializeBattleArena(await requireBattleRow(trx, battleId)),
      attached: true,
    };
  });
  await mirrorBattleArena(result.arena);
  return result;
}

export async function markBattleJoinedRecord(
  battleId: string,
  userId: string,
): Promise<BattleArenaSnapshot> {
  const { db } = getEconomyInfra();
  await ensureEconomySchema(db);
  const arena = await db.transaction(async (trx) => {
    const row = await requireBattleRow(trx, battleId, true);
    const side = requireParticipant(row, userId);
    if (!['LOBBY_OPEN', 'COUNTDOWN', 'LIVE'].includes(row.state)) {
      throw new EconomyError('INVALID_STATE', 409, 'Battle lobby is not open');
    }
    const column = side === 'A' ? 'side_a_joined_at' : 'side_b_joined_at';
    if (!row[column]) {
      await trx('battle_registry').where({ battle_id: battleId }).update({
        [column]: trx.fn.now(),
        version: trx.raw('version + 1'),
        updated_at: trx.fn.now(),
      });
    }
    return serializeBattleArena(await requireBattleRow(trx, battleId));
  });
  await mirrorBattleArena(arena);
  return arena;
}

export async function advanceBattleLifecycleOnce(
  battleId: string,
  nowMs: number,
): Promise<BattleTransition | null> {
  const { db } = getEconomyInfra();
  await ensureEconomySchema(db);
  const transition = await db.transaction(async (trx) => {
    const row = await requireBattleRow(trx, battleId, true);
    const before = serializeBattleArena(row);
    const decision = evaluateBattleLifecycle(
      {
        state: row.state,
        scheduledStartAtMs: before.scheduledStartAt,
        durationSec: before.durationSec,
        sideAJoined: before.sideA.joined,
        sideBJoined: before.sideB.joined,
        countdownEndsAtMs: before.countdownEndsAt,
        liveStartedAtMs: before.liveStartedAt,
      },
      nowMs,
    );
    if (!decision) return null;

    const patch: Record<string, any> = {
      state: decision.nextState,
      version: trx.raw('version + 1'),
      updated_at: trx.fn.now(),
    };
    if (decision.countdownEndsAtMs) {
      patch.countdown_ends_at = new Date(decision.countdownEndsAtMs).toISOString();
    }
    if (decision.liveStartedAtMs) {
      patch.live_started_at = new Date(decision.liveStartedAtMs).toISOString();
    }
    if (decision.nextState === 'FINALIZING') patch.finalizing_at = trx.fn.now();
    if (decision.terminalReason) patch.terminal_reason = decision.terminalReason;
    if (decision.nextState === 'EXPIRED') patch.ended_at = trx.fn.now();

    await trx('battle_registry').where({ battle_id: battleId }).update(patch);
    return {
      before,
      after: serializeBattleArena(await requireBattleRow(trx, battleId)),
      decision,
    };
  });
  if (transition) await mirrorBattleArena(transition.after);
  return transition;
}

export async function requestBattleFinalization(
  battleId: string,
  userId: string,
): Promise<BattleArenaSnapshot> {
  const { db } = getEconomyInfra();
  await ensureEconomySchema(db);
  const arena = await db.transaction(async (trx) => {
    const row = await requireBattleRow(trx, battleId, true);
    requireParticipant(row, userId);
    if (row.state === 'FINALIZING' || row.state === 'ENDED') return serializeBattleArena(row);
    if (row.state !== 'LIVE') {
      throw new EconomyError('INVALID_STATE', 409, 'Battle is not live');
    }
    await trx('battle_registry').where({ battle_id: battleId }).update({
      state: 'FINALIZING',
      terminal_reason: 'MANUAL_END',
      finalizing_at: trx.fn.now(),
      version: trx.raw('version + 1'),
      updated_at: trx.fn.now(),
    });
    return serializeBattleArena(await requireBattleRow(trx, battleId));
  });
  await mirrorBattleArena(arena);
  return arena;
}

export async function finishBattleRecord(
  battleId: string,
  settlement: any,
): Promise<BattleArenaSnapshot> {
  const { db } = getEconomyInfra();
  await ensureEconomySchema(db);
  const arena = await db.transaction(async (trx) => {
    const row = await requireBattleRow(trx, battleId, true);
    if (row.state === 'ENDED') return serializeBattleArena(row);
    if (row.state !== 'FINALIZING') {
      throw new EconomyError('INVALID_STATE', 409, 'Battle is not finalizing');
    }
    const scoreA = numberValue(row.score_a);
    const scoreB = numberValue(row.score_b);
    const winnerSide: BattleSide | null = scoreA === scoreB ? null : scoreA > scoreB ? 'A' : 'B';
    await trx('battle_registry').where({ battle_id: battleId }).update({
      state: 'ENDED',
      winner_side: winnerSide,
      settlement_json: settlement || {},
      ended_at: trx.fn.now(),
      version: trx.raw('version + 1'),
      updated_at: trx.fn.now(),
    });
    return serializeBattleArena(await requireBattleRow(trx, battleId));
  });
  await mirrorBattleArena(arena);
  return arena;
}

export type BattleScoreResult = {
  battleId: string;
  side: BattleSide;
  applied: boolean;
  score: { A: number; B: number };
};

/**
 * Validate explicit A/B targeting and score a gift in the same transaction as
 * the wallet debit + gift_event insert. The gift_event primary key makes retries
 * exactly once across Cloud Run instances.
 */
export async function scoreBattleGiftInTransaction(
  trx: Knex.Transaction,
  input: {
    streamId: string;
    battleId?: string;
    side?: BattleSide;
    receiverUserId: string;
    giftEventId: string;
    scoreCoins: bigint;
  },
): Promise<BattleScoreResult | null> {
  const row: BattleRegistryRow | undefined = await trx<BattleRegistryRow>('battle_registry')
    .where({ session_id: input.streamId })
    .forUpdate()
    .first();

  if (!row) {
    if (input.battleId || input.side) {
      throw new EconomyError('INVALID_INPUT', 400, 'Battle gift target does not match this live');
    }
    return null;
  }
  if (row.state !== 'LIVE') {
    throw new EconomyError('INVALID_STATE', 409, 'Battle gifts open when the match is live');
  }
  if (!input.battleId || input.battleId !== row.battle_id || !input.side) {
    throw new EconomyError('INVALID_INPUT', 400, 'Choose side A or side B for this battle gift');
  }
  const expectedReceiver = input.side === 'A' ? row.creator_uid : row.opponent_uid;
  if (input.receiverUserId !== expectedReceiver) {
    throw new EconomyError('RECEIVER_INVALID', 403, 'Gift recipient does not match the selected battle side');
  }

  const existing = await trx('battle_score_events')
    .where({ gift_event_id: input.giftEventId })
    .first();
  if (existing) {
    return {
      battleId: row.battle_id,
      side: input.side,
      applied: false,
      score: { A: numberValue(row.score_a), B: numberValue(row.score_b) },
    };
  }

  const points = input.scoreCoins > 0n ? input.scoreCoins : 1n;
  await trx('battle_score_events').insert({
    gift_event_id: input.giftEventId,
    battle_id: row.battle_id,
    side: input.side,
    score_coins: points.toString(),
    created_at: trx.fn.now(),
  });
  const scoreColumn = input.side === 'A' ? 'score_a' : 'score_b';
  await trx('battle_registry').where({ battle_id: row.battle_id }).update({
    [scoreColumn]: trx.raw('?? + ?', [scoreColumn, points.toString()]),
    version: trx.raw('version + 1'),
    updated_at: trx.fn.now(),
  });
  const updated = await requireBattleRow(trx, row.battle_id);
  return {
    battleId: row.battle_id,
    side: input.side,
    applied: true,
    score: { A: numberValue(updated.score_a), B: numberValue(updated.score_b) },
  };
}

export async function recordBattleVote(
  battleId: string,
  voterUserId: string,
  side: BattleSide,
): Promise<{ applied: boolean; arena: BattleArenaSnapshot }> {
  const { db } = getEconomyInfra();
  await ensureEconomySchema(db);
  const result = await db.transaction(async (trx) => {
    const row = await requireBattleRow(trx, battleId, true);
    if (row.state !== 'LIVE') {
      throw new EconomyError('INVALID_STATE', 409, 'Voting is only open during the live battle');
    }
    if (row.creator_uid === voterUserId || row.opponent_uid === voterUserId) {
      throw new EconomyError('RESTRICTED', 403, 'Battle participants cannot vote');
    }
    const existing = await trx('battle_vote_events')
      .where({ battle_id: battleId, voter_uid: voterUserId })
      .first();
    if (existing) {
      return { applied: false, arena: serializeBattleArena(row) };
    }
    await trx('battle_vote_events').insert({
      battle_id: battleId,
      voter_uid: voterUserId,
      side,
      created_at: trx.fn.now(),
    });
    const scoreColumn = side === 'A' ? 'score_a' : 'score_b';
    await trx('battle_registry').where({ battle_id: battleId }).update({
      [scoreColumn]: trx.raw('?? + 1', [scoreColumn]),
      version: trx.raw('version + 1'),
      updated_at: trx.fn.now(),
    });
    return {
      applied: true,
      arena: serializeBattleArena(await requireBattleRow(trx, battleId)),
    };
  });
  await mirrorBattleArena(result.arena);
  return result;
}
