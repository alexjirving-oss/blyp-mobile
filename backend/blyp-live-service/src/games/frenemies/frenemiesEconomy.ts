/**
 * Frenemies prize funding (Option A):
 * - Host-funded: hold/debit **paid** coin_balance only (bonus cannot fund).
 * - Awards land as spendable COIN (coin_balance += N), never BONUS/GEM/cashable.
 * - House path: capped HOUSE_GAME_PRIZE_MINT (not unbounded ADMIN_CREDIT).
 * - Idempotency keys use `:v2:` namespaces — never reinterpret old BONUS rows.
 */
import { randomUUID } from 'crypto';
import { getEconomyInfra } from '../../economy/infra';
import { EconomyError } from '../../economy/economyErrors';
import { mintHouseGamePrize } from '../../economy/houseGamePrizeMint';
import { logger } from '../../config/logger';

export type PrizeHold = {
  amount: number;
  roundId: string;
  paidBy: 'host' | 'house';
  hostUserId: string;
  coinDebited: number;
  /** Always 0 under Option A (bonus cannot fund holds). Kept for room JSON compat. */
  bonusDebited: number;
};

/** Paid coins only — bonus cannot fund host prize holds (Option A). */
export async function getPaidCoins(userId: string): Promise<number> {
  const { db } = getEconomyInfra();
  const wallet = await db('wallets').where({ user_id: userId }).first();
  if (!wallet) return 0;
  return Number(wallet.coin_balance || 0);
}

/** @deprecated Use getPaidCoins — host prize funding is paid-only. */
export async function getSpendableCoins(userId: string): Promise<number> {
  return getPaidCoins(userId);
}

/** Pure planner for paid-only host holds (unit-tested). */
export function planHostPaidPrizeHold(paidBalance: bigint, amount: bigint): { usePaid: bigint } {
  if (amount <= 0n) return { usePaid: 0n };
  if (paidBalance < amount) {
    throw new EconomyError('INSUFFICIENT_FUNDS', 409, 'Insufficient paid coins for prize hold');
  }
  return { usePaid: amount };
}

function holdIdemKey(roundId: string): string {
  return `frenemies:v2:hold:${roundId}:COIN`;
}

function releaseIdemKey(roundId: string): string {
  return `frenemies:v2:release:${roundId}:COIN`;
}

function awardIdemKey(roundId: string, winnerUserId: string): string {
  return `frenemies:v2:award:${roundId}:${winnerUserId}`;
}

/** Debit host paid COIN only and return hold record. */
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
  const idempotencyKey = holdIdemKey(args.roundId);

  try {
    return await db.transaction(async (trx) => {
      const existing = await trx('ledger_entries').where({ idempotency_key: idempotencyKey }).first();
      if (existing) {
        const meta = (existing.metadata || {}) as any;
        return {
          amount,
          roundId: args.roundId,
          paidBy: 'host' as const,
          hostUserId: args.hostUserId,
          coinDebited: Number(meta.coinDebited || Math.abs(Number(existing.amount) || amount)),
          bonusDebited: 0,
        };
      }

      await trx('wallets').insert({ user_id: args.hostUserId }).onConflict('user_id').ignore();
      const wallet = await trx('wallets').where({ user_id: args.hostUserId }).forUpdate().first();
      if (!wallet) throw new EconomyError('INTERNAL', 500, 'Wallet missing');

      const paid = BigInt(wallet.coin_balance || 0);
      const need = BigInt(amount);
      const { usePaid } = planHostPaidPrizeHold(paid, need);

      const meta = {
        sessionId: args.sessionId,
        roundId: args.roundId,
        purpose: 'frenemies_prize_hold',
        coinDebited: Number(usePaid),
        bonusDebited: 0,
        payoutVersion: 2,
        paidOnly: true,
      };

      await trx('ledger_entries').insert({
        ledger_id: randomUUID(),
        user_id: args.hostUserId,
        entry_type: 'FRENEMIES_HOLD',
        currency: 'COIN',
        amount: (-usePaid).toString(),
        status: 'POSTED',
        reference_type: 'FRENEMIES',
        reference_id: args.roundId,
        idempotency_key: idempotencyKey,
        metadata: meta,
      });

      await trx('wallets')
        .where({ user_id: args.hostUserId })
        .update({
          coin_balance: (paid - usePaid).toString(),
          lifetime_spend_coins: (BigInt(wallet.lifetime_spend_coins || 0) + usePaid).toString(),
          updated_at: trx.fn.now(),
        });

      return {
        amount,
        roundId: args.roundId,
        paidBy: 'host' as const,
        hostUserId: args.hostUserId,
        coinDebited: Number(usePaid),
        bonusDebited: 0,
      };
    });
  } catch (e: any) {
    if (e instanceof EconomyError) throw e;
    logger.error({ err: e?.message, roundId: args.roundId }, '[frenemies] hold failed');
    throw e;
  }
}

async function creditPrizeCoin(args: {
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
      currency: 'COIN',
      amount: String(amount),
      status: 'POSTED',
      reference_type: 'FRENEMIES',
      reference_id: args.referenceId,
      idempotency_key: args.idempotencyKey,
      metadata: { ...args.meta, payoutVersion: 2 },
    });

    await trx('wallets')
      .where({ user_id: args.userId })
      .update({
        coin_balance: (BigInt(wallet.coin_balance || 0) + BigInt(amount)).toString(),
        updated_at: trx.fn.now(),
      });
  });
}

/** Refund unused paid-COIN hold to host. */
export async function releaseHostHold(hold: PrizeHold | null | undefined, reason: string): Promise<void> {
  if (!hold || hold.paidBy !== 'host' || hold.amount <= 0) return;
  const { db } = getEconomyInfra();
  const idem = releaseIdemKey(hold.roundId);
  const coinBack = Math.max(0, hold.coinDebited || hold.amount || 0);
  if (coinBack <= 0) return;

  try {
    await db.transaction(async (trx) => {
      const existing = await trx('ledger_entries').where({ idempotency_key: idem }).first();
      if (existing) return;

      await trx('wallets').insert({ user_id: hold.hostUserId }).onConflict('user_id').ignore();
      const wallet = await trx('wallets').where({ user_id: hold.hostUserId }).forUpdate().first();
      if (!wallet) return;

      const meta = {
        roundId: hold.roundId,
        reason,
        purpose: 'frenemies_hold_release',
        payoutVersion: 2,
      };

      await trx('ledger_entries').insert({
        ledger_id: randomUUID(),
        user_id: hold.hostUserId,
        entry_type: 'FRENEMIES_HOLD_RELEASE',
        currency: 'COIN',
        amount: String(coinBack),
        status: 'POSTED',
        reference_type: 'FRENEMIES',
        reference_id: hold.roundId,
        idempotency_key: idem,
        metadata: meta,
      });

      await trx('wallets')
        .where({ user_id: hold.hostUserId })
        .update({
          coin_balance: (BigInt(wallet.coin_balance || 0) + BigInt(coinBack)).toString(),
          updated_at: trx.fn.now(),
        });
    });
  } catch (e: any) {
    logger.error({ err: e?.message, roundId: hold.roundId }, '[frenemies] release hold failed');
  }
}

/**
 * Settle an award: credit winner spendable COIN; host-funded refunds leftover hold.
 * House-funded uses capped mintHouseGamePrize (not creditCoinsAdmin).
 */
export async function settlePrizeAward(args: {
  hold: PrizeHold | null | undefined;
  winnerUserId: string;
  awardAmount: number;
  roundId: string;
  reason: string;
  sessionId?: string | null;
}): Promise<{ coins: number; payer: 'host' | 'house' }> {
  const award = Math.max(0, Math.floor(Number(args.awardAmount) || 0));
  const hold = args.hold;
  const payer: 'host' | 'house' =
    hold?.paidBy === 'house' ? 'house' : hold?.paidBy === 'host' ? 'host' : 'house';

  if (award <= 0) {
    await releaseHostHold(hold, 'no_award');
    return { coins: 0, payer };
  }

  if (!hold || hold.paidBy === 'house') {
    try {
      const minted = await mintHouseGamePrize({
        winnerUserId: args.winnerUserId,
        amount: award,
        idempotencyKey: awardIdemKey(args.roundId, args.winnerUserId),
        game: 'frenemies',
        sessionId: args.sessionId || null,
        referenceType: 'FRENEMIES',
        referenceId: args.roundId,
        reason: args.reason,
      });
      return { coins: minted.coins, payer: 'house' };
    } catch (e: any) {
      logger.error({ err: e?.message, roundId: args.roundId }, '[frenemies] house award failed');
      throw e;
    }
  }

  const capped = Math.min(award, hold.amount);
  try {
    await creditPrizeCoin({
      userId: args.winnerUserId,
      amount: capped,
      idempotencyKey: awardIdemKey(args.roundId, args.winnerUserId),
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
    await releaseHostHold(
      {
        ...hold,
        amount: leftover,
        coinDebited: leftover,
        bonusDebited: 0,
      },
      'award_leftover',
    );
  }

  return { coins: capped, payer: 'host' };
}
