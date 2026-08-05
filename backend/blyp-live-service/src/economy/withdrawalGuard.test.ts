import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessWithdrawal } from './withdrawalGuard';

const base = {
  now: Date.now(),
  amountCoins: 1000,
  withdrawableCoins: 5000,
  accountAgeMs: 40 * 24 * 60 * 60 * 1000,
  emailVerified: true,
  kycStatus: 'verified' as const,
  accountFrozen: false,
  underFraudReview: false,
  openChargebackCount: 0,
  hasPayoutAccount: true,
  payoutAccountAgeMs: 14 * 24 * 60 * 60 * 1000,
  openRequestCount: 0,
  lastRequestAt: null as number | null,
  requestsLast24h: 0,
  requestsLast7d: 0,
  paidOutLast24hCoins: 0,
  paidOutLast7dCoins: 0,
  paidOutLast30dCoins: 0,
  selfFundedCoins: 0,
};

test('allows a clean withdrawal request', () => {
  const a = assessWithdrawal(base);
  assert.equal(a.decision, 'allow');
});

test('denies when cashable balance is only self-funded', () => {
  const a = assessWithdrawal({
    ...base,
    withdrawableCoins: 2000,
    selfFundedCoins: 1500,
    amountCoins: 1000,
  });
  assert.equal(a.decision, 'deny');
  assert.ok(a.reasons.includes('INSUFFICIENT_WITHDRAWABLE_BALANCE'));
});

test('denies below minimum payout', () => {
  const a = assessWithdrawal({ ...base, amountCoins: 100 });
  assert.equal(a.decision, 'deny');
  assert.ok(a.reasons.includes('BELOW_MIN_PAYOUT'));
});

test('routes large amounts to manual review', () => {
  const a = assessWithdrawal({ ...base, amountCoins: 100_000, withdrawableCoins: 200_000 });
  assert.equal(a.decision, 'review');
  assert.equal(a.requiresManualReview, true);
  assert.ok(a.reasons.includes('LARGE_AMOUNT'));
});

test('routes new payout accounts to manual review', () => {
  const a = assessWithdrawal({
    ...base,
    payoutAccountAgeMs: 2 * 24 * 60 * 60 * 1000,
  });
  assert.equal(a.decision, 'review');
  assert.ok(a.reasons.includes('NEW_PAYOUT_ACCOUNT'));
});
