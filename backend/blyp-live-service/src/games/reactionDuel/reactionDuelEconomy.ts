import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import { getEconomyInfra } from '../../economy/infra';
import { EconomyError } from '../../economy/economyErrors';
import { ensureEconomySchema } from '../../economy/schema';
import {
  REACTION_DUEL_ENTRY_COINS,
  REACTION_DUEL_PRIZE_COINS,
} from './reactionDuelEngine';

export interface ReactionWalletAmounts {
  coinBalance: bigint;
  bonusCoinBalance: bigint;
}

export interface ReactionEntryDebitPlan extends ReactionWalletAmounts {
  paidCoinCost: bigint;
  bonusCoinCost: bigint;
}

export function planReactionEntryDebit(
  wallet: ReactionWalletAmounts,
  amount: bigint,
): ReactionEntryDebitPlan {
  const bonusCoinCost =
    wallet.bonusCoinBalance >= amount ? amount : wallet.bonusCoinBalance;
  const paidCoinCost = amount - bonusCoinCost;
  if (wallet.coinBalance < paidCoinCost) {
    throw new EconomyError(
      'INSUFFICIENT_FUNDS',
      409,
      `Reaction Duel requires ${REACTION_DUEL_ENTRY_COINS} coins`,
    );
  }
  return {
    paidCoinCost,
    bonusCoinCost,
    coinBalance: wallet.coinBalance - paidCoinCost,
    bonusCoinBalance: wallet.bonusCoinBalance - bonusCoinCost,
  };
}

export function planReactionEntryRefund(
  wallet: ReactionWalletAmounts,
  entry: { paidCoinCost: bigint; bonusCoinCost: bigint },
): ReactionWalletAmounts {
  return {
    coinBalance: wallet.coinBalance + entry.paidCoinCost,
    bonusCoinBalance: wallet.bonusCoinBalance + entry.bonusCoinCost,
  };
}

type EntryRow = {
  duel_id: string;
  session_id: string;
  user_id: string;
  status: 'PENDING' | 'LOCKED' | 'REFUNDED' | 'SETTLED';
  coin_cost: string;
  bonus_coin_cost: string;
};

function balances(row: any) {
  return {
    coinBalance: Number(row?.coin_balance || 0),
    bonusCoinBalance: Number(row?.bonus_coin_balance || 0),
  };
}

function entryKey(duelId: string, userId: string, suffix: string): string {
  return `reaction-duel:${duelId}:${userId}:${suffix}`;
}

async function writeLedger(args: {
  trx: Knex.Transaction;
  userId: string;
  duelId: string;
  sessionId: string;
  entryType: 'REACTION_DUEL_ENTRY' | 'REACTION_DUEL_REFUND';
  currency: 'COIN' | 'BONUS_COIN';
  amount: bigint;
  idempotencyKey: string;
}): Promise<void> {
  if (args.amount === 0n) return;
  await args.trx('ledger_entries').insert({
    ledger_id: randomUUID(),
    user_id: args.userId,
    entry_type: args.entryType,
    currency: args.currency,
    amount: args.amount.toString(),
    status: 'POSTED',
    reference_type: 'REACTION_DUEL',
    reference_id: args.duelId,
    idempotency_key: args.idempotencyKey,
    metadata: {
      duelId: args.duelId,
      sessionId: args.sessionId,
      entryCoins: REACTION_DUEL_ENTRY_COINS,
    },
  });
}

/**
 * Locks one player's fixed 100-coin entry. The row is inserted first so
 * concurrent retries serialize on the same (duel, user) primary key.
 */
export async function lockReactionDuelEntry(args: {
  duelId: string;
  sessionId: string;
  userId: string;
}) {
  const { db } = getEconomyInfra();
  await ensureEconomySchema(db);

  return db.transaction(async (trx) => {
    await trx('reaction_duel_entries')
      .insert({
        duel_id: args.duelId,
        session_id: args.sessionId,
        user_id: args.userId,
        status: 'PENDING',
        coin_cost: '0',
        bonus_coin_cost: '0',
        created_at: new Date().toISOString(),
        updated_at: trx.fn.now(),
      })
      .onConflict(['duel_id', 'user_id'])
      .ignore();

    const entry = (await trx('reaction_duel_entries')
      .where({ duel_id: args.duelId, user_id: args.userId })
      .forUpdate()
      .first()) as EntryRow | undefined;
    if (!entry) throw new EconomyError('INTERNAL', 500, 'Reaction Duel entry missing');
    if (entry.session_id !== args.sessionId) {
      throw new EconomyError('CONFLICT', 409, 'Reaction Duel session mismatch');
    }
    if (entry.status === 'LOCKED') {
      const wallet = await trx('wallets').where({ user_id: args.userId }).first();
      return {
        replay: true,
        entryCoins: Number(BigInt(entry.coin_cost) + BigInt(entry.bonus_coin_cost)),
        newBalances: balances(wallet),
      };
    }
    if (entry.status !== 'PENDING') {
      throw new EconomyError('CONFLICT', 409, 'Reaction Duel entry is already settled');
    }

    await trx('wallets')
      .insert({ user_id: args.userId })
      .onConflict('user_id')
      .ignore();
    const wallet = await trx('wallets')
      .where({ user_id: args.userId })
      .forUpdate()
      .first();
    if (!wallet) throw new EconomyError('INTERNAL', 500, 'Wallet missing');

    const debit = planReactionEntryDebit(
      {
        coinBalance: BigInt(wallet.coin_balance),
        bonusCoinBalance: BigInt(wallet.bonus_coin_balance),
      },
      BigInt(REACTION_DUEL_ENTRY_COINS),
    );

    await writeLedger({
      trx,
      userId: args.userId,
      duelId: args.duelId,
      sessionId: args.sessionId,
      entryType: 'REACTION_DUEL_ENTRY',
      currency: 'COIN',
      amount: -debit.paidCoinCost,
      idempotencyKey: entryKey(args.duelId, args.userId, 'entry:coin'),
    });
    await writeLedger({
      trx,
      userId: args.userId,
      duelId: args.duelId,
      sessionId: args.sessionId,
      entryType: 'REACTION_DUEL_ENTRY',
      currency: 'BONUS_COIN',
      amount: -debit.bonusCoinCost,
      idempotencyKey: entryKey(args.duelId, args.userId, 'entry:bonus'),
    });

    await trx('wallets')
      .where({ user_id: args.userId })
      .update({
        coin_balance: debit.coinBalance.toString(),
        bonus_coin_balance: debit.bonusCoinBalance.toString(),
        lifetime_spend_coins: (
          BigInt(wallet.lifetime_spend_coins || 0) +
          BigInt(REACTION_DUEL_ENTRY_COINS)
        ).toString(),
        updated_at: trx.fn.now(),
      });
    await trx('reaction_duel_entries')
      .where({ duel_id: args.duelId, user_id: args.userId })
      .update({
        status: 'LOCKED',
        coin_cost: debit.paidCoinCost.toString(),
        bonus_coin_cost: debit.bonusCoinCost.toString(),
        locked_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });

    return {
      replay: false,
      entryCoins: REACTION_DUEL_ENTRY_COINS,
      newBalances: {
        coinBalance: Number(debit.coinBalance),
        bonusCoinBalance: Number(debit.bonusCoinBalance),
      },
    };
  });
}

/** Restores every locked entry in its original paid/bonus currencies. */
export async function refundReactionDuelEntries(args: {
  duelId: string;
  sessionId: string;
  reason: string;
}) {
  const { db } = getEconomyInfra();
  await ensureEconomySchema(db);

  return db.transaction(async (trx) => {
    const entries = (await trx('reaction_duel_entries')
      .where({ duel_id: args.duelId, session_id: args.sessionId })
      .orderBy('user_id', 'asc')
      .forUpdate()) as EntryRow[];

    if (entries.some((entry) => entry.status === 'SETTLED')) {
      throw new EconomyError('CONFLICT', 409, 'Reaction Duel is already settled');
    }

    const refunded: Record<string, number> = {};
    for (const entry of entries) {
      if (entry.status !== 'LOCKED') continue;
      await trx('wallets')
        .insert({ user_id: entry.user_id })
        .onConflict('user_id')
        .ignore();
      const wallet = await trx('wallets')
        .where({ user_id: entry.user_id })
        .forUpdate()
        .first();
      if (!wallet) throw new EconomyError('INTERNAL', 500, 'Wallet missing');

      const paidCoinCost = BigInt(entry.coin_cost);
      const bonusCoinCost = BigInt(entry.bonus_coin_cost);
      const next = planReactionEntryRefund(
        {
          coinBalance: BigInt(wallet.coin_balance),
          bonusCoinBalance: BigInt(wallet.bonus_coin_balance),
        },
        { paidCoinCost, bonusCoinCost },
      );

      await writeLedger({
        trx,
        userId: entry.user_id,
        duelId: args.duelId,
        sessionId: args.sessionId,
        entryType: 'REACTION_DUEL_REFUND',
        currency: 'COIN',
        amount: paidCoinCost,
        idempotencyKey: entryKey(args.duelId, entry.user_id, 'refund:coin'),
      });
      await writeLedger({
        trx,
        userId: entry.user_id,
        duelId: args.duelId,
        sessionId: args.sessionId,
        entryType: 'REACTION_DUEL_REFUND',
        currency: 'BONUS_COIN',
        amount: bonusCoinCost,
        idempotencyKey: entryKey(args.duelId, entry.user_id, 'refund:bonus'),
      });

      await trx('wallets')
        .where({ user_id: entry.user_id })
        .update({
          coin_balance: next.coinBalance.toString(),
          bonus_coin_balance: next.bonusCoinBalance.toString(),
          updated_at: trx.fn.now(),
        });
      await trx('reaction_duel_entries')
        .where({ duel_id: args.duelId, user_id: entry.user_id })
        .update({
          status: 'REFUNDED',
          refund_reason: args.reason,
          refunded_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        });
      refunded[entry.user_id] = Number(paidCoinCost + bonusCoinCost);
    }
    return { refunded };
  });
}

export type ReactionPrizeCredit = (
  actorUserId: string,
  input: {
    targetUserId: string;
    coins: number;
    idempotencyKey: string;
    reason?: string;
  },
) => Promise<unknown>;

export function buildReactionDuelPrizeCredit(args: {
  duelId: string;
  winnerUserId: string;
  reason: string;
}) {
  return {
    actorUserId: 'system:reaction-duel',
    input: {
      targetUserId: args.winnerUserId,
      coins: REACTION_DUEL_PRIZE_COINS,
      idempotencyKey: `reaction-duel:${args.duelId}:prize`,
      reason: args.reason,
    },
  };
}

/**
 * The pool removes 200 coins and the existing HOUSE/admin credit path mints the
 * fixed 300-coin prize, so the house contribution is exactly 100 coins.
 */
export async function awardReactionDuelPrize(
  args: {
    duelId: string;
    sessionId: string;
    winnerUserId: string;
    reason: string;
  },
  credit?: ReactionPrizeCredit,
) {
  const { db } = getEconomyInfra();
  await ensureEconomySchema(db);
  const entries = (await db('reaction_duel_entries').where({
    duel_id: args.duelId,
    session_id: args.sessionId,
  })) as EntryRow[];
  const winnerEntry = entries.find((entry) => entry.user_id === args.winnerUserId);
  if (
    entries.filter((entry) => entry.status === 'LOCKED' || entry.status === 'SETTLED')
      .length !== 2 ||
    !winnerEntry ||
    (winnerEntry.status !== 'LOCKED' && winnerEntry.status !== 'SETTLED')
  ) {
    throw new EconomyError('CONFLICT', 409, 'Both Reaction Duel entries must be locked');
  }

  const prizeCredit = buildReactionDuelPrizeCredit({
    duelId: args.duelId,
    winnerUserId: args.winnerUserId,
    reason: args.reason,
  });
  const creditPrize =
    credit ??
    (await import('../../economy/economyService')).creditCoinsAdmin;
  const prize = await creditPrize(prizeCredit.actorUserId, prizeCredit.input);

  await db('reaction_duel_entries')
    .where({ duel_id: args.duelId, session_id: args.sessionId })
    .whereIn('status', ['LOCKED', 'SETTLED'])
    .update({
      status: 'SETTLED',
      settled_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
  return prize;
}
