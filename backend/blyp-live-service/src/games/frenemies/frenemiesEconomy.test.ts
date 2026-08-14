import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EconomyError } from '../../economy/economyErrors';
import { planHostPaidPrizeHold, planViewerActionDebit } from './frenemiesEconomy';

describe('frenemiesEconomy Option A paid-only hold', () => {
  it('holds from paid balance only', () => {
    assert.deepEqual(planHostPaidPrizeHold(200n, 100n), { usePaid: 100n });
  });

  it('rejects when host only has bonus-sized need unmet by paid', () => {
    assert.throws(
      () => planHostPaidPrizeHold(50n, 100n),
      (err: unknown) =>
        err instanceof EconomyError &&
        err.code === 'INSUFFICIENT_FUNDS' &&
        /paid coins/i.test(err.message),
    );
  });

  it('allows zero amount without debit', () => {
    assert.deepEqual(planHostPaidPrizeHold(0n, 0n), { usePaid: 0n });
  });
});

describe('frenemiesEconomy viewer action debit (bonus-first)', () => {
  it('spends bonus before paid', () => {
    const plan = planViewerActionDebit(100n, 40n, 50n);
    assert.equal(plan.useBonus, 40n);
    assert.equal(plan.usePaid, 10n);
    assert.equal(plan.coinBalance, 90n);
    assert.equal(plan.bonusCoinBalance, 0n);
  });

  it('rejects when combined balance is short', () => {
    assert.throws(
      () => planViewerActionDebit(10n, 10n, 50n),
      (err: unknown) => err instanceof EconomyError && err.code === 'INSUFFICIENT_FUNDS',
    );
  });
});
