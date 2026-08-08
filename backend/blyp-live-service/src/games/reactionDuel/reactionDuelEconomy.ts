import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import { getEconomyInfra } from '../../economy/infra';
import { EconomyError } from '../../economy/economyErrors';
import { ensureEconomySchema } from '../../economy/schema';
import { getEconomyEnv } from '../../config/economyEnv';
import {
  isValidReactionDuelStake,
  reactionDuelPrizeCoins,
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
      `Reaction Duel requires ${amount.toString()} coins`,
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
  stakeCoins: number;
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
      stakeCoins: args.stakeCoins,
    },
  });
}

/**
 * Locks one player's server-selected stake. The row is inserted first so
 * concurrent retries serialize on the same (duel, user) primary key.
 */
export async function lockReactionDuelEntry(args: {
  duelId: string;
  sessionId: string;
  userId: string;
  stakeCoins: number;
}) {
  if (!isValidReactionDuelStake(args.stakeCoins)) {
    throw new EconomyError('INVALID_INPUT', 400, 'Invalid Reaction Duel stake');
  }
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
      const lockedCoins = Number(BigInt(entry.coin_cost) + BigInt(entry.bonus_coin_cost));
      if (lockedCoins !== args.stakeCoins) {
        throw new EconomyError('CONFLICT', 409, 'Reaction Duel stake mismatch');
      }
      const wallet = await trx('wallets').where({ user_id: args.userId }).first();
      return {
        replay: true,
        entryCoins: lockedCoins,
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
      BigInt(args.stakeCoins),
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
      stakeCoins: args.stakeCoins,
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
      stakeCoins: args.stakeCoins,
    });

    await trx('wallets')
      .where({ user_id: args.userId })
      .update({
        coin_balance: debit.coinBalance.toString(),
        bonus_coin_balance: debit.bonusCoinBalance.toString(),
        lifetime_spend_coins: (
          BigInt(wallet.lifetime_spend_coins || 0) +
          BigInt(args.stakeCoins)
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
      entryCoins: args.stakeCoins,
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
        stakeCoins: Number(paidCoinCost + bonusCoinCost),
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
        stakeCoins: Number(paidCoinCost + bonusCoinCost),
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

export function buildReactionDuelPrizeCredit(args: {
  duelId: string;
  sessionId: string;
  winnerUserId: string;
  stakeCoins: number;
  reason: string;
}) {
  const prizeCoins = reactionDuelPrizeCoins(args.stakeCoins);
  return {
    userId: args.winnerUserId,
    entryType: 'REACTION_DUEL_PRIZE' as const,
    currency: 'COIN' as const,
    amount: prizeCoins,
    status: 'PENDING' as const,
    referenceType: 'REACTION_DUEL' as const,
    referenceId: args.duelId,
    idempotencyKey: `reaction-duel:${args.duelId}:prize`,
    metadata: {
      duelId: args.duelId,
      sessionId: args.sessionId,
      stakeCoins: args.stakeCoins,
      prizeCoins,
      reason: args.reason,
      liveOnly: true,
      convertsAtLiveEnd: true,
      coinToGemCountRatio: '1:1',
      gemCashoutValueRelativeToLiveCoin: 0.5,
    },
  };
}

/**
 * Records the winner's 3× prize as live-scoped COIN, not GEM. It intentionally
 * does not enter the spendable wallet: the live-end hook converts this exact
 * ledger amount 1:1 into earned gems, preventing spend-then-convert duplication.
 */
export async function awardReactionDuelPrize(args: {
  duelId: string;
  sessionId: string;
  winnerUserId: string;
  stakeCoins: number;
  reason: string;
}) {
  if (!isValidReactionDuelStake(args.stakeCoins)) {
    throw new EconomyError('INVALID_INPUT', 400, 'Invalid Reaction Duel stake');
  }
  const { db } = getEconomyInfra();
  await ensureEconomySchema(db);
  const prizeCredit = buildReactionDuelPrizeCredit({
    ...args,
  });

  return db.transaction(async (trx) => {
    const entries = (await trx('reaction_duel_entries')
      .where({
        duel_id: args.duelId,
        session_id: args.sessionId,
      })
      .orderBy('user_id', 'asc')
      .forUpdate()) as EntryRow[];
    const eligible = entries.filter(
      (entry) => entry.status === 'LOCKED' || entry.status === 'SETTLED',
    );
    const winnerEntry = eligible.find((entry) => entry.user_id === args.winnerUserId);
    const stakeMatches = eligible.every(
      (entry) =>
        BigInt(entry.coin_cost) + BigInt(entry.bonus_coin_cost) ===
        BigInt(args.stakeCoins),
    );
    if (eligible.length !== 2 || !winnerEntry || !stakeMatches) {
      throw new EconomyError(
        'CONFLICT',
        409,
        'Both Reaction Duel entries must lock the agreed stake',
      );
    }

    const existing = await trx('ledger_entries')
      .where({ idempotency_key: prizeCredit.idempotencyKey })
      .first();
    if (existing) {
      return {
        replay: true,
        coinsCredited: Number(existing.amount),
        currency: String(existing.currency),
        liveOnly: true,
      };
    }

    await trx('ledger_entries').insert({
      ledger_id: randomUUID(),
      user_id: prizeCredit.userId,
      entry_type: prizeCredit.entryType,
      currency: prizeCredit.currency,
      amount: prizeCredit.amount.toString(),
      status: prizeCredit.status,
      reference_type: prizeCredit.referenceType,
      reference_id: prizeCredit.referenceId,
      idempotency_key: prizeCredit.idempotencyKey,
      metadata: prizeCredit.metadata,
    });

    await trx('reaction_duel_entries')
      .where({ duel_id: args.duelId, session_id: args.sessionId })
      .whereIn('status', ['LOCKED', 'SETTLED'])
      .update({
        status: 'SETTLED',
        settled_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });

    return {
      replay: false,
      coinsCredited: prizeCredit.amount,
      currency: prizeCredit.currency,
      liveOnly: true,
    };
  });
}

type ReactionPrizeLedgerRow = {
  ledger_id: string;
  user_id: string;
  amount: string;
  reference_id: string;
  metadata: Record<string, unknown> | string | null;
};

function ledgerMetadata(value: ReactionPrizeLedgerRow['metadata']): Record<string, unknown> {
  if (value && typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

export function planReactionDuelGemSettlement(coins: bigint) {
  if (coins < 0n) throw new RangeError('Reaction Duel settlement coins cannot be negative');
  return {
    coinsConverted: coins,
    gemsCredited: coins,
    coinToGemCountRatio: '1:1' as const,
    gemCashoutValueRelativeToLiveCoin: 0.5 as const,
  };
}

/**
 * Converts every unsettled prize from one live session into earned GEM at 1:1
 * count. Production's normal pending-gem hold is retained. The transaction is
 * idempotent: each source coin row is marked CONVERTED with one unique GEM row.
 */
export async function settleReactionDuelLiveCoins(args: { sessionId: string }) {
  const { db } = getEconomyInfra();
  await ensureEconomySchema(db);
  const env = getEconomyEnv();
  const gemStatus = env.PENDING_GEMS_HOLD_SECONDS > 0 ? 'PENDING' : 'POSTED';

  return db.transaction(async (trx) => {
    const prizes = (await trx('ledger_entries')
      .where({
        entry_type: 'REACTION_DUEL_PRIZE',
        currency: 'COIN',
        status: 'PENDING',
      })
      .whereRaw("metadata->>'sessionId' = ?", [args.sessionId])
      .orderBy('user_id', 'asc')
      .orderBy('created_at', 'asc')
      .forUpdate()) as ReactionPrizeLedgerRow[];

    if (prizes.length === 0) {
      return {
        prizesConverted: 0,
        coinsConverted: 0,
        gemsCredited: 0,
        gemStatus,
      };
    }

    const byUser = new Map<string, ReactionPrizeLedgerRow[]>();
    for (const prize of prizes) {
      const list = byUser.get(prize.user_id) || [];
      list.push(prize);
      byUser.set(prize.user_id, list);
    }

    let coinsConverted = 0n;
    const convertedAt = new Date().toISOString();
    for (const userId of Array.from(byUser.keys()).sort()) {
      const userPrizes = byUser.get(userId) || [];
      const totalCoins = userPrizes.reduce((sum, prize) => sum + BigInt(prize.amount), 0n);
      const plan = planReactionDuelGemSettlement(totalCoins);

      await trx('wallets').insert({ user_id: userId }).onConflict('user_id').ignore();
      const wallet = await trx('wallets').where({ user_id: userId }).forUpdate().first();
      if (!wallet) throw new EconomyError('INTERNAL', 500, 'Reaction Duel winner wallet missing');

      for (const prize of userPrizes) {
        const metadata = ledgerMetadata(prize.metadata);
        const duelId = String(metadata.duelId || prize.reference_id);
        const prizePlan = planReactionDuelGemSettlement(BigInt(prize.amount));
        await trx('ledger_entries').insert({
          ledger_id: randomUUID(),
          user_id: userId,
          entry_type: 'REACTION_DUEL_GEM_SETTLEMENT',
          currency: 'GEM',
          amount: prizePlan.gemsCredited.toString(),
          status: gemStatus,
          reference_type: 'REACTION_DUEL',
          reference_id: duelId,
          idempotency_key: `reaction-duel:${duelId}:live-end-gems`,
          metadata: {
            ...metadata,
            sessionId: args.sessionId,
            sourceCoinLedgerId: prize.ledger_id,
            convertedAt,
            coinToGemCountRatio: prizePlan.coinToGemCountRatio,
            gemCashoutValueRelativeToLiveCoin:
              prizePlan.gemCashoutValueRelativeToLiveCoin,
            pendingHoldSeconds: env.PENDING_GEMS_HOLD_SECONDS,
          },
        });
        await trx('ledger_entries')
          .where({ ledger_id: prize.ledger_id, status: 'PENDING' })
          .update({
            status: 'CONVERTED',
            metadata: trx.raw('metadata || ?::jsonb', [
              JSON.stringify({
                convertedAt,
                convertedToGems: prizePlan.gemsCredited.toString(),
              }),
            ]),
          });
      }

      const gemColumn =
        env.PENDING_GEMS_HOLD_SECONDS > 0 ? 'gem_pending' : 'gem_available';
      await trx('wallets')
        .where({ user_id: userId })
        .update({
          [gemColumn]: (BigInt(wallet[gemColumn] || 0) + plan.gemsCredited).toString(),
          lifetime_earned_gems: (
            BigInt(wallet.lifetime_earned_gems || 0) + plan.gemsCredited
          ).toString(),
          updated_at: trx.fn.now(),
        });
      coinsConverted += plan.coinsConverted;
    }

    return {
      prizesConverted: prizes.length,
      coinsConverted: Number(coinsConverted),
      gemsCredited: Number(coinsConverted),
      gemStatus,
    };
  });
}
