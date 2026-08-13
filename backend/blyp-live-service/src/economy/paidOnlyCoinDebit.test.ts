import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EconomyError } from './economyErrors';
import {
  planLiveGamePaidEntry,
  planMatchdayPaidDebit,
  planPaidOnlyCoinDebit,
} from './paidOnlyCoinDebit';

describe('planPaidOnlyCoinDebit (lock-3 anti-farm)', () => {
  it('debits paid balance only', () => {
    assert.deepEqual(planPaidOnlyCoinDebit(200n, 75n), { usePaid: 75n });
  });

  it('rejects when paid is short even if bonus would have covered', () => {
    assert.throws(
      () => planPaidOnlyCoinDebit(40n, 100n),
      (err: unknown) =>
        err instanceof EconomyError &&
        err.code === 'INSUFFICIENT_FUNDS' &&
        /bonus cannot fund/i.test(err.message),
    );
  });

  it('allows zero without debit', () => {
    assert.deepEqual(planPaidOnlyCoinDebit(0n, 0n), { usePaid: 0n });
  });
});

describe('live game + matchday paid-only entry planners', () => {
  it('plans live-game fee from paid only', () => {
    assert.deepEqual(planLiveGamePaidEntry(500n, 50n), { usePaid: 50n });
  });

  it('rejects live-game join when paid is short', () => {
    assert.throws(
      () => planLiveGamePaidEntry(10n, 50n),
      (err: unknown) =>
        err instanceof EconomyError && err.code === 'INSUFFICIENT_FUNDS',
    );
  });

  it('plans Matchday stake from paid only', () => {
    assert.deepEqual(planMatchdayPaidDebit(80n, 80n), { usePaid: 80n });
    assert.throws(
      () => planMatchdayPaidDebit(5n, 20n),
      /bonus cannot fund/i,
    );
  });
});
