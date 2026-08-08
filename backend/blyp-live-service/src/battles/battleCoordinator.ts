import { EconomyError } from '../economy/economyErrors';
import {
  cancelRefundBattle,
  markBattleAttendance,
  settleBattle,
} from '../economy/battleEscrowService';
import {
  applyBattleGiftPledges,
  refundBattleGiftPledges,
} from '../economy/battleGiftPledgeService';
import { BattleSide, battleSideForUser } from './battleLifecycle';
import {
  BattleArenaSnapshot,
  RegisterBattleInput,
  acceptBattleRecord,
  advanceBattleLifecycleOnce,
  cancelBattleRecord,
  declineBattleRecord,
  finishBattleRecord,
  getBattleArena,
  markBattleJoinedRecord,
  mirrorBattleById,
  recordBattleVote,
  registerBattleRecord,
  requestBattleFinalization,
} from './battleRegistryService';

async function refundClosedBattle(arena: BattleArenaSnapshot): Promise<void> {
  const battleId = arena.battleId;
  // Keep wallet lock order deterministic across escrow + pledge refunds.
  await cancelRefundBattle(arena.sideA.userId, {
    battleId,
    idempotencyKey: `battle:${battleId}:closed:escrow-refund`,
  }).catch(() => undefined);
  await refundBattleGiftPledges(
    {
      battleId,
      idempotencyKey: `battle:${battleId}:closed:pledge-refund`,
    },
    { internal: true },
  ).catch(() => undefined);
}

async function finalizeBattle(arena: BattleArenaSnapshot): Promise<BattleArenaSnapshot> {
  if (arena.state === 'ENDED') return arena;
  if (arena.state !== 'FINALIZING') return arena;
  const settled = await settleBattle(arena.sideA.userId, {
    battleId: arena.battleId,
    idempotencyKey: `battle:${arena.battleId}:attendance-settlement`,
  });
  return finishBattleRecord(
    arena.battleId,
    settled?.response?.settlement || settled?.response || { outcome: 'none_staked' },
  );
}

/**
 * Advance all due transitions under database locks. Clients poll this endpoint,
 * but only server receipt time decides when lobby/countdown/live/end occurs.
 */
export async function reconcileBattleArena(
  battleId: string,
  nowMs = Date.now(),
): Promise<BattleArenaSnapshot> {
  let arena = await getBattleArena(battleId);

  for (let i = 0; i < 8; i += 1) {
    if (arena.state === 'FINALIZING') {
      arena = await finalizeBattle(arena);
      break;
    }
    const transition = await advanceBattleLifecycleOnce(battleId, nowMs);
    if (!transition) break;
    arena = transition.after;

    if (arena.state === 'LIVE') {
      await applyBattleGiftPledges(
        {
          battleId,
          streamId: arena.sessionId || `battle:${battleId}`,
          idempotencyKey: `battle:${battleId}:pledges-at-live`,
        },
        { internal: true },
      );
      arena = await mirrorBattleById(battleId);
    } else if (arena.state === 'EXPIRED') {
      await refundClosedBattle(arena);
      arena = await mirrorBattleById(battleId);
    } else if (arena.state === 'FINALIZING') {
      arena = await finalizeBattle(arena);
      break;
    }
  }

  if (arena.state === 'FINALIZING') {
    arena = await finalizeBattle(arena);
  }
  return arena;
}

export async function registerBattle(
  creatorUserId: string,
  input: RegisterBattleInput,
): Promise<BattleArenaSnapshot> {
  await registerBattleRecord(creatorUserId, input);
  return reconcileBattleArena(input.battleId);
}

export async function acceptBattle(
  battleId: string,
  userId: string,
): Promise<BattleArenaSnapshot> {
  await acceptBattleRecord(battleId, userId);
  return reconcileBattleArena(battleId);
}

export async function declineBattle(
  battleId: string,
  userId: string,
): Promise<BattleArenaSnapshot> {
  const arena = await declineBattleRecord(battleId, userId);
  await refundClosedBattle(arena);
  return mirrorBattleById(battleId);
}

export async function cancelBattle(
  battleId: string,
  userId: string,
): Promise<BattleArenaSnapshot> {
  const arena = await cancelBattleRecord(battleId, userId);
  await refundClosedBattle(arena);
  return mirrorBattleById(battleId);
}

export async function markBattleParticipantJoined(
  battleId: string,
  userId: string,
): Promise<BattleArenaSnapshot> {
  await markBattleJoinedRecord(battleId, userId);
  await markBattleAttendance(battleId, userId);
  return reconcileBattleArena(battleId);
}

export async function endBattle(
  battleId: string,
  userId: string,
): Promise<BattleArenaSnapshot> {
  const arena = await requestBattleFinalization(battleId, userId);
  return finalizeBattle(arena);
}

export async function voteBattle(
  battleId: string,
  voterUserId: string,
  side: BattleSide,
): Promise<{ applied: boolean; battle: BattleArenaSnapshot }> {
  const arena = await reconcileBattleArena(battleId);
  if (arena.state !== 'LIVE') {
    throw new EconomyError('INVALID_STATE', 409, 'Battle is not live');
  }
  const result = await recordBattleVote(battleId, voterUserId, side);
  return { applied: result.applied, battle: result.arena };
}

export async function requireBattlePublisher(
  battleId: string,
  userId: string,
): Promise<{ battle: BattleArenaSnapshot; side: BattleSide }> {
  const battle = await reconcileBattleArena(battleId);
  const side = battleSideForUser(
    { creatorUid: battle.sideA.userId, opponentUid: battle.sideB.userId },
    userId,
  );
  if (!side) {
    throw new EconomyError('RESTRICTED', 403, 'Only battle participants can publish');
  }
  if (!['LOBBY_OPEN', 'COUNTDOWN', 'LIVE'].includes(battle.state)) {
    throw new EconomyError('INVALID_STATE', 409, 'Battle lobby is not open');
  }
  return { battle, side };
}
