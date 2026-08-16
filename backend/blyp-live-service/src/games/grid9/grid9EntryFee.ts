/**
 * Grid 9 entry fee: debit paid coins from platform wallet and credit 100% into
 * the match jackpot (purchaseContributionCoins). Host and joiners both pay.
 */
import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import { ensureEconomySchema } from '../../economy/schema';
import { getEconomyInfra } from '../../economy/infra';
import { planPaidOnlyCoinDebit } from '../../economy/paidOnlyCoinDebit';
import { EconomyError } from '../../economy/economyErrors';
import {
  GRID9_MAX_ENTRY_FEE_COINS,
  GRID9_MIN_ENTRY_FEE_COINS,
} from './constants';
import { Grid9Error } from './grid9Errors';
import type { Grid9GameState } from './state';
import type { Grid9HumanPlayer } from './players';

function cloneState(state: Grid9GameState): Grid9GameState {
  return JSON.parse(JSON.stringify(state)) as Grid9GameState;
}

export function normalizeGrid9EntryFeeCoins(raw: unknown): number {
  const n = Math.floor(Number(raw) || 0);
  if (!Number.isSafeInteger(n) || n < GRID9_MIN_ENTRY_FEE_COINS) return 0;
  return Math.min(GRID9_MAX_ENTRY_FEE_COINS, n);
}

/** Pure: bump jackpot by entry fee and mark human as paid. */
export function applyGrid9EntryFeeCredit(
  current: Grid9GameState,
  userId: string,
  amountCoins: number,
  nowIso = new Date().toISOString(),
): Grid9GameState {
  const amount = normalizeGrid9EntryFeeCoins(amountCoins);
  if (amount <= 0) return current;
  const human = current.players.find(
    (player): player is Grid9HumanPlayer =>
      player.kind === 'human' && player.userId === userId,
  );
  if (!human) {
    throw new Grid9Error('NOT_ELIGIBLE', 'Entry fee requires a seated combatant');
  }
  if ((human as Grid9HumanPlayer & { entryFeePaidCoins?: number }).entryFeePaidCoins) {
    return current;
  }
  const state = cloneState(current);
  const seat = state.players[human.slotIndex] as Grid9HumanPlayer & {
    entryFeePaidCoins?: number;
  };
  seat.entryFeePaidCoins = amount;
  state.jackpot.purchaseContributionCoins += amount;
  state.jackpot.currentCoins += amount;
  state.authority.stateVersion += 1;
  state.authority.mutationCount += 1;
  state.authority.lastMutationAt = nowIso;
  state.updatedAt = nowIso;
  return state;
}

/**
 * Debit platform wallet for entry fee (idempotent on matchId+userId+intentId).
 * Does not touch Redis jackpot — caller applies applyGrid9EntryFeeCredit after.
 */
export async function debitGrid9EntryFee(args: {
  matchId: string;
  userId: string;
  intentId: string;
  amountCoins: number;
}): Promise<{ charged: number; ledgerId: string | null }> {
  const amount = normalizeGrid9EntryFeeCoins(args.amountCoins);
  if (amount <= 0) return { charged: 0, ledgerId: null };

  const { db } = getEconomyInfra();
  await ensureEconomySchema(db);
  return db.transaction(async (trx: Knex.Transaction) => {
    const idempotencyKey = `grid9:entry-fee:${args.matchId}:${args.userId}:${args.intentId}`;
    const existing = await trx('ledger_entries')
      .where({ idempotency_key: idempotencyKey })
      .first();
    if (existing) {
      return { charged: amount, ledgerId: String(existing.ledger_id) };
    }

    await trx('wallets')
      .insert({ user_id: args.userId })
      .onConflict('user_id')
      .ignore();
    const wallet = await trx('wallets')
      .where({ user_id: args.userId })
      .forUpdate()
      .first();
    if (!wallet) {
      throw new EconomyError('INTERNAL', 500, 'Wallet missing');
    }
    let debit;
    try {
      debit = planPaidOnlyCoinDebit(
        BigInt(wallet.coin_balance),
        BigInt(amount),
        'paid coins for Grid 9 entry fee',
      );
    } catch {
      throw new Grid9Error(
        'INSUFFICIENT_FUNDS',
        `Need ${amount} coins to join this Grid 9 room`,
      );
    }
    const ledgerId = randomUUID();
    await trx('ledger_entries').insert({
      ledger_id: ledgerId,
      user_id: args.userId,
      entry_type: 'GRID9_ENTRY_FEE',
      currency: 'COIN',
      amount: (-debit.usePaid).toString(),
      status: 'POSTED',
      reference_type: 'GRID9_MATCH',
      reference_id: args.matchId,
      idempotency_key: idempotencyKey,
      metadata: {
        matchId: args.matchId,
        intentId: args.intentId,
        entryFeeCoins: amount,
        jackpotCreditBps: 10_000,
      },
    });
    await trx('wallets')
      .where({ user_id: args.userId })
      .update({
        coin_balance: (BigInt(wallet.coin_balance) - debit.usePaid).toString(),
        updated_at: trx.fn.now(),
      });
    return { charged: amount, ledgerId };
  });
}
