/**
 * Pre-arranged battle gifts — viewers schedule a gift for an upcoming battle.
 *
 * Money rules:
 *  - Coins are debited immediately when the pledge is created (bonus-first).
 *  - When the match clock starts (liveStartedAt), pledges convert to real gifts:
 *    gems credited to the chosen side, gift_events written, socket gift feed.
 *  - If the battle is cancelled/rejected before apply, held coins are refunded.
 *  - Viewers may cancel their own held pledge before apply for a full refund.
 */

import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import { getEconomyInfra } from './infra';
import { EconomyError } from './economyErrors';
import { ensureEconomySchema } from './schema';
import { getEconomyEnv } from '../config/economyEnv';
import { emitGiftEvent } from '../realtime/realtimeBus';
import {
  mirrorBattleById,
  scoreBattleGiftInTransaction,
} from '../battles/battleRegistryService';
import type {
  BattleGiftPledgeCreateInput,
  BattleGiftPledgeCancelInput,
  BattleGiftPledgesApplyInput,
  BattleGiftPledgesRefundInput,
} from './economySchemas';

function nowIso() {
  return new Date().toISOString();
}

type PledgeRow = {
  pledge_id: string;
  battle_id: string;
  pledger_uid: string;
  side: string;
  receiver_uid: string;
  gift_id: string;
  quantity: number;
  coin_cost: string;
  status: string;
  stream_id: string | null;
  gift_event_id: string | null;
  score_coins: string;
  idempotency_key: string;
  metadata: any;
  created_at: string | Date;
  applied_at: string | Date | null;
  refunded_at: string | Date | null;
};

type BattleGateRow = {
  battle_id: string;
  creator_uid: string;
  opponent_uid: string;
  state: string;
  session_id: string | null;
};

async function requireBattleGate(
  trx: Knex | Knex.Transaction,
  battleId: string,
  lock = false,
): Promise<BattleGateRow> {
  let query = trx<BattleGateRow>('battle_registry').where({ battle_id: battleId });
  if (lock) query = query.forUpdate();
  const row = await query.first();
  if (!row) throw new EconomyError('NOT_FOUND', 404, 'Battle not found');
  return row;
}

async function balancesFor(trx: Knex.Transaction, userId: string) {
  const w = await trx('wallets').where({ user_id: userId }).first();
  return {
    coinBalance: Number(w?.coin_balance || 0),
    bonusCoinBalance: Number(w?.bonus_coin_balance || 0),
  };
}

async function creditCoins(
  trx: Knex.Transaction,
  userId: string,
  amount: bigint,
  battleId: string,
  pledgeId: string,
  idempotencyKey: string
): Promise<void> {
  if (amount <= 0n) return;
  await trx('wallets').insert({ user_id: userId }).onConflict('user_id').ignore();
  const w = await trx('wallets').where({ user_id: userId }).forUpdate().first();
  if (!w) throw new EconomyError('INTERNAL', 500, 'Wallet missing');
  await trx('wallets').where({ user_id: userId }).update({
    coin_balance: (BigInt(w.coin_balance) + amount).toString(),
    updated_at: trx.fn.now(),
  });
  await trx('ledger_entries').insert({
    ledger_id: randomUUID(),
    user_id: userId,
    entry_type: 'BATTLE_GIFT_PLEDGE_REFUND',
    currency: 'COIN',
    amount: amount.toString(),
    status: 'POSTED',
    reference_type: 'BATTLE_GIFT_PLEDGE',
    reference_id: pledgeId,
    idempotency_key: idempotencyKey,
    metadata: { battleId, pledgeId },
  });
}

function serializePledge(row: PledgeRow) {
  return {
    pledgeId: row.pledge_id,
    battleId: row.battle_id,
    pledgerUid: row.pledger_uid,
    side: row.side as 'creator' | 'opponent',
    receiverUid: row.receiver_uid,
    giftId: row.gift_id,
    quantity: Number(row.quantity),
    coinCost: Number(row.coin_cost),
    status: row.status,
    streamId: row.stream_id || null,
    giftEventId: row.gift_event_id || null,
    scoreCoins: Number(row.score_coins || row.coin_cost),
    createdAt: new Date(row.created_at).toISOString(),
    appliedAt: row.applied_at ? new Date(row.applied_at).toISOString() : null,
    refundedAt: row.refunded_at ? new Date(row.refunded_at).toISOString() : null,
  };
}

/** Debit coins now and hold a pledge until the battle match starts. */
export async function createBattleGiftPledge(userId: string, input: BattleGiftPledgeCreateInput) {
  const { db } = getEconomyInfra();
  await ensureEconomySchema(db);
  const { battleId, side, giftId, quantity, creatorUid, opponentUid, idempotencyKey } = input;

  if (creatorUid === opponentUid) {
    throw new EconomyError('INVALID_INPUT', 400, 'Battle sides must be distinct');
  }

  const result = await db.transaction(async (trx) => {
    const battle = await requireBattleGate(trx, battleId, true);
    if (battle.creator_uid !== creatorUid || battle.opponent_uid !== opponentUid) {
      throw new EconomyError('INVALID_INPUT', 400, 'Battle participants do not match the registry');
    }
    if (!['INVITED', 'ACCEPTED', 'LOBBY_OPEN'].includes(battle.state)) {
      throw new EconomyError('INVALID_STATE', 409, 'This battle no longer accepts scheduled gifts');
    }
    const receiverUid = side === 'creator' ? battle.creator_uid : battle.opponent_uid;
    if (receiverUid === userId) {
      throw new EconomyError('INVALID_INPUT', 400, 'Cannot pledge a gift to yourself');
    }

    const existing = await trx('battle_gift_pledges')
      .where({ pledger_uid: userId, idempotency_key: idempotencyKey })
      .first();
    if (existing) {
      return {
        kind: 'replay' as const,
        response: {
          ...serializePledge(existing as PledgeRow),
          newBalances: await balancesFor(trx, userId),
        },
      };
    }

    const gift = await trx('gift_catalog').where({ gift_id: giftId }).first();
    if (!gift || gift.enabled !== true) {
      throw new EconomyError('GIFT_NOT_FOUND', 404, 'Gift not found');
    }

    const qty = BigInt(quantity);
    const unitCost = BigInt(gift.coin_cost);
    const totalCost = unitCost * qty;

    await trx('wallets').insert({ user_id: userId }).onConflict('user_id').ignore();
    const wallet = await trx('wallets').where({ user_id: userId }).forUpdate().first();
    if (!wallet) throw new EconomyError('INTERNAL', 500, 'Wallet missing');

    const bonus = BigInt(wallet.bonus_coin_balance);
    const paid = BigInt(wallet.coin_balance);
    const useBonus = bonus >= totalCost ? totalCost : bonus;
    const usePaid = totalCost - useBonus;
    if (paid < usePaid) throw new EconomyError('INSUFFICIENT_FUNDS', 409, 'Insufficient funds');

    const pledgeId = randomUUID();
    const createdAt = nowIso();

    if (usePaid > 0n) {
      await trx('ledger_entries').insert({
        ledger_id: randomUUID(),
        user_id: userId,
        entry_type: 'BATTLE_GIFT_PLEDGE',
        currency: 'COIN',
        amount: (-usePaid).toString(),
        status: 'POSTED',
        reference_type: 'BATTLE_GIFT_PLEDGE',
        reference_id: pledgeId,
        idempotency_key: `${idempotencyKey}:COIN`,
        metadata: { battleId, side, giftId, quantity, receiverUid },
      });
    }
    if (useBonus > 0n) {
      await trx('ledger_entries').insert({
        ledger_id: randomUUID(),
        user_id: userId,
        entry_type: 'BATTLE_GIFT_PLEDGE',
        currency: 'BONUS_COIN',
        amount: (-useBonus).toString(),
        status: 'POSTED',
        reference_type: 'BATTLE_GIFT_PLEDGE',
        reference_id: pledgeId,
        idempotency_key: `${idempotencyKey}:BONUS`,
        metadata: { battleId, side, giftId, quantity, receiverUid },
      });
    }

    await trx('wallets').where({ user_id: userId }).update({
      coin_balance: (paid - usePaid).toString(),
      bonus_coin_balance: (bonus - useBonus).toString(),
      lifetime_spend_coins: (BigInt(wallet.lifetime_spend_coins) + totalCost).toString(),
      updated_at: trx.fn.now(),
    });

    await trx('battle_gift_pledges').insert({
      pledge_id: pledgeId,
      battle_id: battleId,
      pledger_uid: userId,
      side,
      receiver_uid: receiverUid,
      gift_id: giftId,
      quantity: Number(quantity),
      coin_cost: totalCost.toString(),
      status: 'HELD',
      score_coins: totalCost.toString(),
      idempotency_key: idempotencyKey,
      metadata: {
        creatorUid,
        opponentUid,
        giftName: gift.name || giftId,
        unitCost: Number(unitCost),
      },
      created_at: createdAt,
      updated_at: createdAt,
    });

    const row = await trx('battle_gift_pledges').where({ pledge_id: pledgeId }).first();
    return {
      kind: 'success' as const,
      response: {
        ...serializePledge(row as PledgeRow),
        newBalances: await balancesFor(trx, userId),
      },
    };
  });

  return result;
}

/** Viewer cancels their own held pledge — full coin refund. */
export async function cancelBattleGiftPledge(userId: string, input: BattleGiftPledgeCancelInput) {
  const { db } = getEconomyInfra();
  await ensureEconomySchema(db);
  const { pledgeId, idempotencyKey } = input;

  return db.transaction(async (trx) => {
    const row: PledgeRow | undefined = await trx('battle_gift_pledges')
      .where({ pledge_id: pledgeId })
      .forUpdate()
      .first();
    if (!row) throw new EconomyError('NOT_FOUND', 404, 'Pledge not found');
    if (row.pledger_uid !== userId) throw new EconomyError('RESTRICTED', 403, 'Not your pledge');
    const battle = await requireBattleGate(trx, row.battle_id, true);
    if (['COUNTDOWN', 'LIVE', 'FINALIZING', 'ENDED'].includes(battle.state)) {
      throw new EconomyError('INVALID_STATE', 409, 'The battle has started; this pledge can no longer be cancelled');
    }
    if (row.status === 'REFUNDED' || row.status === 'CANCELLED') {
      return {
        kind: 'replay' as const,
        response: {
          ...serializePledge(row),
          refunded: true,
          newBalances: await balancesFor(trx, userId),
        },
      };
    }
    if (row.status === 'APPLIED') {
      throw new EconomyError('CONFLICT', 409, 'Pledge already delivered');
    }
    if (row.status !== 'HELD') {
      throw new EconomyError('CONFLICT', 409, `Pledge is ${row.status}`);
    }

    const amount = BigInt(row.coin_cost);
    await creditCoins(trx, userId, amount, row.battle_id, pledgeId, `${idempotencyKey}:REFUND`);
    const refundedAt = nowIso();
    await trx('battle_gift_pledges').where({ pledge_id: pledgeId }).update({
      status: 'CANCELLED',
      refunded_at: refundedAt,
      updated_at: refundedAt,
    });
    const updated = await trx('battle_gift_pledges').where({ pledge_id: pledgeId }).first();
    return {
      kind: 'success' as const,
      response: {
        ...serializePledge(updated as PledgeRow),
        refunded: true,
        newBalances: await balancesFor(trx, userId),
      },
    };
  });
}

/**
 * Convert held pledges into real gifts when the battle match starts.
 * Coins were already taken at pledge time — this credits gems + gift feed only.
 */
export async function applyBattleGiftPledges(
  input: BattleGiftPledgesApplyInput,
  opts: { actorUserId?: string; internal?: boolean } = {},
) {
  const { db } = getEconomyInfra();
  const env = getEconomyEnv();
  await ensureEconomySchema(db);
  const { battleId, streamId, idempotencyKey } = input;
  const battle = await requireBattleGate(db, battleId);
  if (battle.state !== 'LIVE') {
    throw new EconomyError('INVALID_STATE', 409, 'Scheduled gifts can only be applied once the battle is live');
  }
  if (
    !opts.internal &&
    (!opts.actorUserId ||
      (opts.actorUserId !== battle.creator_uid && opts.actorUserId !== battle.opponent_uid))
  ) {
    throw new EconomyError('RESTRICTED', 403, 'Only battle participants can apply scheduled gifts');
  }
  if (streamId && battle.session_id && String(streamId) !== battle.session_id) {
    throw new EconomyError('INVALID_INPUT', 400, 'Battle stream does not match the registry');
  }
  const effectiveStreamId = String(battle.session_id || streamId || `battle:${battleId}`);

  const pending = await db('battle_gift_pledges')
    .where({ battle_id: battleId, status: 'HELD' })
    .orderBy('created_at', 'asc')
    .select('pledge_id');

  if (!pending.length) {
    return {
      kind: 'success' as const,
      response: {
        battleId,
        streamId: effectiveStreamId,
        applied: [] as any[],
        scoreDelta: { creator: 0, opponent: 0 },
        appliedCount: 0,
      },
    };
  }

  const applied: any[] = [];
  const scoreDelta = { creator: 0, opponent: 0 };
  const emitQueue: any[] = [];

  for (const { pledge_id: pledgeId } of pending) {
    const one = await db.transaction(async (trx) => {
      const row: PledgeRow | undefined = await trx('battle_gift_pledges')
        .where({ pledge_id: pledgeId })
        .forUpdate()
        .first();
      if (!row || row.status !== 'HELD') return null;

      const giftEventIdem = `${idempotencyKey}:${pledgeId}`;
      const existingEvent = await trx('gift_events')
        .where({ sender_user_id: row.pledger_uid, idempotency_key: giftEventIdem })
        .first();

      const totalCostCoins = BigInt(row.coin_cost);
      const platformFeeCoins = (totalCostCoins * BigInt(env.ECONOMY_TAKE_RATE_BPS)) / BigInt(10000);
      const creatorCoins = totalCostCoins - platformFeeCoins;
      const gemsCredited = (creatorCoins * BigInt(env.GEMS_PER_COIN_NUM)) / BigInt(env.GEMS_PER_COIN_DEN);
      const qty = Math.max(1, Number(row.quantity) || 1);

      let giftEventId = existingEvent?.gift_event_id as string | undefined;
      let sequenceNo = existingEvent ? Number(existingEvent.sequence_no) : 0;
      let createdAt = existingEvent ? new Date(existingEvent.created_at).toISOString() : nowIso();

      if (!existingEvent) {
        await trx('wallets').insert({ user_id: row.receiver_uid }).onConflict('user_id').ignore();
        const receiverWallet = await trx('wallets').where({ user_id: row.receiver_uid }).forUpdate().first();
        if (!receiverWallet) throw new EconomyError('INTERNAL', 500, 'Receiver wallet missing');

        await trx('stream_counters').insert({ stream_id: effectiveStreamId }).onConflict('stream_id').ignore();
        const counter = await trx('stream_counters').where({ stream_id: effectiveStreamId }).forUpdate().first();
        if (!counter) throw new EconomyError('INTERNAL', 500, 'Stream counter missing');
        const nextSeq = BigInt(counter.last_sequence) + 1n;
        await trx('stream_counters')
          .where({ stream_id: effectiveStreamId })
          .update({ last_sequence: nextSeq.toString(), updated_at: trx.fn.now() });

        giftEventId = randomUUID();
        sequenceNo = Number(nextSeq);
        createdAt = nowIso();

        await trx('gift_events').insert({
          gift_event_id: giftEventId,
          stream_id: effectiveStreamId,
          sender_user_id: row.pledger_uid,
          receiver_user_id: row.receiver_uid,
          gift_id: row.gift_id,
          quantity: qty,
          coin_cost: totalCostCoins.toString(),
          gems_credited: gemsCredited.toString(),
          sequence_no: nextSeq.toString(),
          idempotency_key: giftEventIdem,
          created_at: createdAt,
        });

        await trx('ledger_entries').insert({
          ledger_id: randomUUID(),
          user_id: row.receiver_uid,
          entry_type: 'GIFT_EARN',
          currency: 'GEM',
          amount: gemsCredited.toString(),
          status: env.PENDING_GEMS_HOLD_SECONDS > 0 ? 'PENDING' : 'POSTED',
          reference_type: 'GIFT_EVENT',
          reference_id: giftEventId,
          idempotency_key: `${giftEventIdem}:EARN`,
          metadata: {
            battleId,
            pledgeId,
            giftId: row.gift_id,
            quantity: qty,
            streamId: effectiveStreamId,
            prearranged: true,
          },
        });

        if (env.PENDING_GEMS_HOLD_SECONDS > 0) {
          await trx('wallets').where({ user_id: row.receiver_uid }).update({
            gem_pending: (BigInt(receiverWallet.gem_pending) + gemsCredited).toString(),
            lifetime_earned_gems: (BigInt(receiverWallet.lifetime_earned_gems) + gemsCredited).toString(),
            updated_at: trx.fn.now(),
          });
        } else {
          await trx('wallets').where({ user_id: row.receiver_uid }).update({
            gem_available: (BigInt(receiverWallet.gem_available) + gemsCredited).toString(),
            lifetime_earned_gems: (BigInt(receiverWallet.lifetime_earned_gems) + gemsCredited).toString(),
            updated_at: trx.fn.now(),
          });
        }

        await trx('stream_earnings')
          .insert({
            stream_id: effectiveStreamId,
            creator_user_id: row.receiver_uid,
            coins_received: totalCostCoins.toString(),
            gems_earned: gemsCredited.toString(),
            updated_at: trx.fn.now(),
          })
          .onConflict(['stream_id', 'creator_user_id'])
          .merge({
            coins_received: trx.raw('stream_earnings.coins_received + ?', [totalCostCoins.toString()]),
            gems_earned: trx.raw('stream_earnings.gems_earned + ?', [gemsCredited.toString()]),
            updated_at: trx.fn.now(),
          });
      }

      if (!giftEventId) {
        throw new EconomyError('INTERNAL', 500, 'Gift event missing during pledge apply');
      }
      const battleSide = row.side === 'creator' ? 'A' : 'B';
      const scoreCoins = Number(row.score_coins || row.coin_cost);
      const battleScore = await scoreBattleGiftInTransaction(trx, {
        streamId: effectiveStreamId,
        battleId,
        side: battleSide,
        receiverUserId: row.receiver_uid,
        giftEventId,
        scoreCoins: BigInt(Math.max(1, scoreCoins)),
      });

      const appliedAt = nowIso();
      await trx('battle_gift_pledges').where({ pledge_id: pledgeId }).update({
        status: 'APPLIED',
        stream_id: effectiveStreamId,
        gift_event_id: giftEventId,
        applied_at: appliedAt,
        updated_at: appliedAt,
      });

      return {
        pledge: serializePledge({
          ...row,
          status: 'APPLIED',
          stream_id: effectiveStreamId,
          gift_event_id: giftEventId || null,
          applied_at: appliedAt,
        }),
        emit: {
          streamId: effectiveStreamId,
          sequenceNo,
          giftEventId,
          giftId: row.gift_id,
          quantity: qty,
          coinSpent: Number(totalCostCoins),
          gemsCredited: Number(gemsCredited),
          sender: { userId: row.pledger_uid, handle: null, avatarUrl: null },
          receiver: { userId: row.receiver_uid, handle: null, avatarUrl: null },
          createdAt,
          prearranged: true,
          battleId,
          battleSide,
          battleScore: battleScore?.score,
        },
        side: row.side as 'creator' | 'opponent',
        scoreCoins: battleScore?.applied ? scoreCoins : 0,
      };
    });

    if (!one) continue;
    applied.push(one.pledge);
    if (one.side === 'creator') scoreDelta.creator += one.scoreCoins;
    else scoreDelta.opponent += one.scoreCoins;
    emitQueue.push(one.emit);
  }

  for (const payload of emitQueue) {
    try {
      emitGiftEvent(payload.streamId, payload);
    } catch {
      /* best-effort socket fanout */
    }
  }

  await mirrorBattleById(battleId);

  return {
    kind: 'success' as const,
    response: {
      battleId,
      streamId: effectiveStreamId,
      applied,
      scoreDelta,
      appliedCount: applied.length,
    },
  };
}

/** Refund all held pledges for a cancelled/rejected battle. Idempotent. */
export async function refundBattleGiftPledges(
  input: BattleGiftPledgesRefundInput,
  opts: { actorUserId?: string; internal?: boolean } = {},
) {
  const { db } = getEconomyInfra();
  await ensureEconomySchema(db);
  const { battleId, idempotencyKey } = input;
  const battle = await requireBattleGate(db, battleId);
  if (!['DECLINED', 'CANCELLED', 'EXPIRED'].includes(battle.state)) {
    throw new EconomyError('INVALID_STATE', 409, 'Battle pledges are not refundable in the current state');
  }
  if (
    !opts.internal &&
    (!opts.actorUserId ||
      (opts.actorUserId !== battle.creator_uid && opts.actorUserId !== battle.opponent_uid))
  ) {
    throw new EconomyError('RESTRICTED', 403, 'Only battle participants can refund scheduled gifts');
  }

  const held = await db('battle_gift_pledges')
    .where({ battle_id: battleId, status: 'HELD' })
    .select('pledge_id');

  const refunded: any[] = [];
  for (const { pledge_id: pledgeId } of held) {
    const one = await db.transaction(async (trx) => {
      const row: PledgeRow | undefined = await trx('battle_gift_pledges')
        .where({ pledge_id: pledgeId })
        .forUpdate()
        .first();
      if (!row || row.status !== 'HELD') return null;

      const amount = BigInt(row.coin_cost);
      await creditCoins(
        trx,
        row.pledger_uid,
        amount,
        battleId,
        pledgeId,
        `${idempotencyKey}:${pledgeId}:REFUND`
      );
      const refundedAt = nowIso();
      await trx('battle_gift_pledges').where({ pledge_id: pledgeId }).update({
        status: 'REFUNDED',
        refunded_at: refundedAt,
        updated_at: refundedAt,
      });
      const updated = await trx('battle_gift_pledges').where({ pledge_id: pledgeId }).first();
      return serializePledge(updated as PledgeRow);
    });
    if (one) refunded.push(one);
  }

  return {
    kind: 'success' as const,
    response: {
      battleId,
      refunded,
      refundedCount: refunded.length,
      refundedCoins: refunded.reduce((sum, p) => sum + Number(p.coinCost || 0), 0),
    },
  };
}

export async function listBattleGiftPledges(battleId: string, opts: { mineUid?: string } = {}) {
  const { db } = getEconomyInfra();
  await ensureEconomySchema(db);
  let q = db('battle_gift_pledges').where({ battle_id: battleId }).orderBy('created_at', 'desc');
  if (opts.mineUid) q = q.andWhere({ pledger_uid: opts.mineUid });
  const rows = await q.limit(100);
  return {
    battleId,
    pledges: (rows as PledgeRow[]).map(serializePledge),
    heldCount: (rows as PledgeRow[]).filter((r) => r.status === 'HELD').length,
    heldCoins: (rows as PledgeRow[])
      .filter((r) => r.status === 'HELD')
      .reduce((sum, r) => sum + Number(r.coin_cost || 0), 0),
  };
}
