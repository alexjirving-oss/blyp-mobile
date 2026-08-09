/**
 * Frenemies prize funding: host-hold at Spin, settle on award, or House mint.
 * Awards always land as BONUS_COIN (entertainment / non-withdrawable).
 */
import { randomUUID } from 'crypto';
import { getEconomyInfra } from '../../economy/infra';
import { EconomyError } from '../../economy/economyErrors';
import { creditCoinsAdmin } from '../../economy/economyService';
import { logger } from '../../config/logger';

export type PrizeHold = {
  amount: number;
  roundId: string;
  paidBy: 'host' | 'house';
  hostUserId: string;
  coinDebited: number;
  bonusDebited: number;
};

export async function getSpendableCoins(userId: string): Promise<number> {
  const { db } = getEconomyInfra();
  const wallet = await db('wallets').where({ user_id: userId }).first();
  if (!wallet) return 0;
  return Number(wallet.coin_balance || 0) + Number(wallet.bonus_coin_balance || 0);
}

/** Debit host (bonus-first) and return hold record. */
export async function holdHostPrize(args: {
  hostUserId: string;
  amount: number;
  roundId: string;
  sessionId: string;
}): Promise<PrizeHold> {
  const amount = Math.max(0, Math.floor(Number(args.amount) || 0));
  if (amount <= 0) {
    return {
      amount: 0,
      roundId: args.roundId,
      paidBy: 'host',
      hostUserId: args.hostUserId,
      coinDebited: 0,
      bonusDebited: 0,
    };
  }

  const { db } = getEconomyInfra();
  const idempotencyKey = `frenemies:hold:${args.roundId}`;

  try {
    return await db.transaction(async (trx) => {
      const existing = await trx('ledger_entries')
        .where({ idempotency_key: `${idempotencyKey}:BONUS` })
        .orWhere({ idempotency_key: `${idempotencyKey}:COIN` })
        .first();
      if (existing) {
        const meta = (existing.metadata || {}) as any;
        return {
          amount,
          roundId: args.roundId,
          paidBy: 'host' as const,
          hostUserId: args.hostUserId,
          coinDebited: Number(meta.coinDebited || 0),
          bonusDebited: Number(meta.bonusDebited || amount),
        };
      }

      await trx('wallets').insert({ user_id: args.hostUserId }).onConflict('user_id').ignore();
      const wallet = await trx('wallets').where({ user_id: args.hostUserId }).forUpdate().first();
      if (!wallet) throw new EconomyError('INTERNAL', 500, 'Wallet missing');

      const bonus = BigInt(wallet.bonus_coin_balance || 0);
      const paid = BigInt(wallet.coin_balance || 0);
      const need = BigInt(amount);
      const useBonus = bonus >= need ? need : bonus;
      const usePaid = need - useBonus;
      if (paid < usePaid) {
        throw new EconomyError('INSUFFICIENT_FUNDS', 409, 'Insufficient funds');
      }

      const meta = {
        sessionId: args.sessionId,
        roundId: args.roundId,
        purpose: 'frenemies_prize_hold',
        coinDebited: Number(usePaid),
        bonusDebited: Number(useBonus),
      };

      if (usePaid > 0n) {
        await trx('ledger_entries').insert({
          ledger_id: randomUUID(),
          user_id: args.hostUserId,
          entry_type: 'FRENEMIES_HOLD',
          currency: 'COIN',
          amount: (-usePaid).toString(),
          status: 'POSTED',
          reference_type: 'FRENEMIES',
          reference_id: args.roundId,
          idempotency_key: `${idempotencyKey}:COIN`,
          metadata: meta,
        });
      }
      if (useBonus > 0n) {
        await trx('ledger_entries').insert({
          ledger_id: randomUUID(),
          user_id: args.hostUserId,
          entry_type: 'FRENEMIES_HOLD',
          currency: 'BONUS_COIN',
          amount: (-useBonus).toString(),
          status: 'POSTED',
          reference_type: 'FRENEMIES',
          reference_id: args.roundId,
          idempotency_key: `${idempotencyKey}:BONUS`,
          metadata: meta,
        });
      }

      await trx('wallets')
        .where({ user_id: args.hostUserId })
        .update({
          coin_balance: (paid - usePaid).toString(),
          bonus_coin_balance: (bonus - useBonus).toString(),
          lifetime_spend_coins: (BigInt(wallet.lifetime_spend_coins || 0) + need).toString(),
          updated_at: trx.fn.now(),
        });

      return {
        amount,
        roundId: args.roundId,
        paidBy: 'host' as const,
        hostUserId: args.hostUserId,
        coinDebited: Number(usePaid),
        bonusDebited: Number(useBonus),
      };
    });
  } catch (e: any) {
    if (e instanceof EconomyError) throw e;
    logger.error({ err: e?.message, roundId: args.roundId }, '[frenemies] hold failed');
    throw e;
  }
}

async function creditBonusCoin(args: {
  userId: string;
  amount: number;
  idempotencyKey: string;
  entryType: string;
  referenceId: string;
  meta: Record<string, unknown>;
}): Promise<void> {
  const amount = Math.max(0, Math.floor(Number(args.amount) || 0));
  if (amount <= 0) return;
  const { db } = getEconomyInfra();
  await db.transaction(async (trx) => {
    const existing = await trx('ledger_entries')
      .where({ user_id: args.userId, idempotency_key: args.idempotencyKey })
      .first();
    if (existing) return;

    await trx('wallets').insert({ user_id: args.userId }).onConflict('user_id').ignore();
    const wallet = await trx('wallets').where({ user_id: args.userId }).forUpdate().first();
    if (!wallet) throw new EconomyError('INTERNAL', 500, 'Wallet missing');

    await trx('ledger_entries').insert({
      ledger_id: randomUUID(),
      user_id: args.userId,
      entry_type: args.entryType,
      currency: 'BONUS_COIN',
      amount: String(amount),
      status: 'POSTED',
      reference_type: 'FRENEMIES',
      reference_id: args.referenceId,
      idempotency_key: args.idempotencyKey,
      metadata: args.meta,
    });

    await trx('wallets')
      .where({ user_id: args.userId })
      .update({
        bonus_coin_balance: (BigInt(wallet.bonus_coin_balance || 0) + BigInt(amount)).toString(),
        updated_at: trx.fn.now(),
      });
  });
}

/** Refund unused hold to host as BONUS_COIN (and restore COIN portion when possible). */
export async function releaseHostHold(hold: PrizeHold | null | undefined, reason: string): Promise<void> {
  if (!hold || hold.paidBy !== 'host' || hold.amount <= 0) return;
  const { db } = getEconomyInfra();
  const idem = `frenemies:release:${hold.roundId}`;

  try {
    await db.transaction(async (trx) => {
      const existing = await trx('ledger_entries')
        .where({ idempotency_key: `${idem}:BONUS` })
        .orWhere({ idempotency_key: `${idem}:COIN` })
        .first();
      if (existing) return;

      await trx('wallets').insert({ user_id: hold.hostUserId }).onConflict('user_id').ignore();
      const wallet = await trx('wallets').where({ user_id: hold.hostUserId }).forUpdate().first();
      if (!wallet) return;

      const coinBack = Math.max(0, hold.coinDebited || 0);
      const bonusBack = Math.max(0, hold.bonusDebited || 0);
      const meta = { roundId: hold.roundId, reason, purpose: 'frenemies_hold_release' };

      if (coinBack > 0) {
        await trx('ledger_entries').insert({
          ledger_id: randomUUID(),
          user_id: hold.hostUserId,
          entry_type: 'FRENEMIES_HOLD_RELEASE',
          currency: 'COIN',
          amount: String(coinBack),
          status: 'POSTED',
          reference_type: 'FRENEMIES',
          reference_id: hold.roundId,
          idempotency_key: `${idem}:COIN`,
          metadata: meta,
        });
      }
      if (bonusBack > 0) {
        await trx('ledger_entries').insert({
          ledger_id: randomUUID(),
          user_id: hold.hostUserId,
          entry_type: 'FRENEMIES_HOLD_RELEASE',
          currency: 'BONUS_COIN',
          amount: String(bonusBack),
          status: 'POSTED',
          reference_type: 'FRENEMIES',
          reference_id: hold.roundId,
          idempotency_key: `${idem}:BONUS`,
          metadata: meta,
        });
      }

      await trx('wallets')
        .where({ user_id: hold.hostUserId })
        .update({
          coin_balance: (BigInt(wallet.coin_balance || 0) + BigInt(coinBack)).toString(),
          bonus_coin_balance: (BigInt(wallet.bonus_coin_balance || 0) + BigInt(bonusBack)).toString(),
          updated_at: trx.fn.now(),
        });
    });
  } catch (e: any) {
    logger.error({ err: e?.message, roundId: hold.roundId }, '[frenemies] release hold failed');
  }
}

/**
 * Settle an award: credit winner BONUS_COIN; for host-funded, refund leftover hold.
 * House-funded uses creditCoinsAdmin mint path.
 */
export async function settlePrizeAward(args: {
  hold: PrizeHold | null | undefined;
  winnerUserId: string;
  awardAmount: number;
  roundId: string;
  reason: string;
}): Promise<{ coins: number; payer: 'host' | 'house' }> {
  const award = Math.max(0, Math.floor(Number(args.awardAmount) || 0));
  const hold = args.hold;
  const payer: 'host' | 'house' = hold?.paidBy === 'house' ? 'house' : hold?.paidBy === 'host' ? 'host' : 'house';

  if (award <= 0) {
    await releaseHostHold(hold, 'no_award');
    return { coins: 0, payer };
  }

  if (!hold || hold.paidBy === 'house') {
    try {
      await creditCoinsAdmin('system:frenemies', {
        targetUserId: args.winnerUserId,
        coins: award,
        idempotencyKey: `frenemies:${args.roundId}:${args.winnerUserId}`,
        reason: args.reason,
      });
    } catch (e: any) {
      logger.error({ err: e?.message, roundId: args.roundId }, '[frenemies] house award failed');
      throw e;
    }
    return { coins: award, payer: 'house' };
  }

  // Host-funded: hold already debited. Credit winner; refund leftover to host.
  const capped = Math.min(award, hold.amount);
  try {
    await creditBonusCoin({
      userId: args.winnerUserId,
      amount: capped,
      idempotencyKey: `frenemies:${args.roundId}:${args.winnerUserId}`,
      entryType: 'FRENEMIES_AWARD',
      referenceId: args.roundId,
      meta: { reason: args.reason, payer: 'host', hostUserId: hold.hostUserId },
    });
  } catch (e: any) {
    logger.error({ err: e?.message, roundId: args.roundId }, '[frenemies] host-funded award failed');
    await releaseHostHold(hold, 'award_failed_refund');
    throw e;
  }

  const leftover = Math.max(0, hold.amount - capped);
  if (leftover > 0) {
    // Proportional-ish refund: restore COIN first up to coinDebited, rest BONUS.
    const coinRefund = Math.min(leftover, hold.coinDebited);
    const bonusRefund = leftover - coinRefund;
    await releaseHostHold(
      {
        ...hold,
        amount: leftover,
        coinDebited: coinRefund,
        bonusDebited: bonusRefund,
      },
      'award_leftover',
    );
  }

  return { coins: capped, payer: 'host' };
}
