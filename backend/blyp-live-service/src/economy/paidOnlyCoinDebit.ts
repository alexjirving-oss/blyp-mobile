/**
 * Option A / lock-3: stakes and entries that pay spendable COIN must debit
 * paid coin_balance only. Bonus cannot fund a path that credits COIN (farm).
 */
import { EconomyError } from './economyErrors';

export function planPaidOnlyCoinDebit(
  paidBalance: bigint,
  amount: bigint,
  label = 'paid coins',
): { usePaid: bigint } {
  const need = amount < 0n ? 0n : amount;
  if (need <= 0n) return { usePaid: 0n };
  if (paidBalance < need) {
    throw new EconomyError(
      'INSUFFICIENT_FUNDS',
      409,
      `Insufficient ${label} (bonus cannot fund this)`,
    );
  }
  return { usePaid: need };
}

export function planLiveGamePaidEntry(paidBalance: bigint, fee: bigint): { usePaid: bigint } {
  return planPaidOnlyCoinDebit(paidBalance, fee, 'paid coins for live game entry');
}

export function planMatchdayPaidDebit(paidBalance: bigint, amount: bigint): { usePaid: bigint } {
  return planPaidOnlyCoinDebit(paidBalance, amount, 'paid coins for Matchday');
}
