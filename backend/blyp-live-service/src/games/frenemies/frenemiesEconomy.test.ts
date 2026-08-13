import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EconomyError } from '../../economy/economyErrors';
import { planHostPaidPrizeHold } from './frenemiesEconomy';

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
