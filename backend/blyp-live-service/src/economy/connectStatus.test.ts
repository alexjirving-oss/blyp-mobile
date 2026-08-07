import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveConnectFlags } from './connectStatus';

test('requires onboarding when no Connect account is linked', () => {
  const s = deriveConnectFlags({
    linked: false,
    payoutsEnabled: false,
    detailsSubmitted: false,
  });
  assert.equal(s.needsOnboarding, true);
  assert.equal(s.onboardingComplete, false);
});

test('requires onboarding when form not submitted', () => {
  const s = deriveConnectFlags({
    linked: true,
    payoutsEnabled: false,
    detailsSubmitted: false,
    stripeAccountId: 'acct_x',
  });
  assert.equal(s.needsOnboarding, true);
});

test('stops Connect loop when form submitted and only pending verification', () => {
  const s = deriveConnectFlags({
    linked: true,
    payoutsEnabled: false,
    detailsSubmitted: true,
    pendingVerification: ['individual.verification.document'],
    stripeAccountId: 'acct_x',
  });
  assert.equal(s.needsOnboarding, false);
  assert.equal(s.onboardingComplete, true);
});

test('reopens Connect when bank is still currently_due', () => {
  const s = deriveConnectFlags({
    linked: true,
    payoutsEnabled: false,
    detailsSubmitted: true,
    currentlyDue: ['external_account'],
    stripeAccountId: 'acct_x',
  });
  assert.equal(s.needsOnboarding, true);
  assert.equal(s.onboardingComplete, false);
});

test('marks ready when payouts_enabled', () => {
  const s = deriveConnectFlags({
    linked: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
    chargesEnabled: true,
    stripeAccountId: 'acct_x',
  });
  assert.equal(s.needsOnboarding, false);
  assert.equal(s.onboardingComplete, true);
  assert.equal(s.payoutsEnabled, true);
});
