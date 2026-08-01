const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const trustService = require('../dist/trust/trustRelationshipService');

const serviceSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'economy', 'economyService.ts'),
  'utf8'
);
const trustSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'trust', 'trustRelationshipService.ts'),
  'utf8'
);

test('Trust exposes a transaction-scoped fail-closed assertion for domain mutations', () => {
  assert.equal(typeof trustService.evaluateTrustPolicyInTransaction, 'function');
  assert.equal(typeof trustService.requireTrustPolicyInTransaction, 'function');
});

test('new gifts require Trust transact permission before any wallet mutation', () => {
  const replayIndex = serviceSource.indexOf('if (existing)');
  const trustIndex = serviceSource.indexOf(
    'const trustDecision = await requireTrustPolicyInTransaction'
  );
  const walletIndex = serviceSource.indexOf('// 1) Validate/lock wallets');

  assert.notEqual(replayIndex, -1, 'gift idempotency replay branch must remain present');
  assert.notEqual(trustIndex, -1, 'transaction-scoped Trust assertion must remain present');
  assert.notEqual(walletIndex, -1, 'wallet mutation boundary must remain present');
  assert.ok(trustIndex > replayIndex, 'replays must return their original committed result');
  assert.ok(walletIndex > trustIndex, 'Trust denial must occur before wallet or ledger mutation');
  assert.match(serviceSource, /capability:\s*'transact'/);
  assert.match(serviceSource, /trustDecision:\s*\{/);
});

test('transaction-scoped Trust evaluation coordinates with consent, privacy, block, and mute mutations', () => {
  const requiredLockFragments = [
    '`trust:${actorUserId}`',
    '`trust:${targetUserId}`',
    '`trust-relationship:${actorUserId}:${targetUserId}:block`',
    '`trust-relationship:${targetUserId}:${actorUserId}:block`',
    '`trust-relationship:${actorUserId}:${targetUserId}:mute`',
    '`trust-relationship:${targetUserId}:${actorUserId}:mute`',
  ];

  for (const fragment of requiredLockFragments) {
    assert.ok(trustSource.includes(fragment), `missing coordinated Trust lock: ${fragment}`);
  }

  const lockIndex = trustSource.indexOf('await lockTrustDecision(trx, actorUserId, targetUserId)');
  const readIndex = trustSource.indexOf(
    'return evaluateTrustPolicyWithConnection(trx, actorUserId, { ...input, targetUserId })'
  );
  assert.ok(lockIndex >= 0 && readIndex > lockIndex, 'Trust state must be locked before evaluation');
  assert.match(trustSource, /throw new ApiError\(403, 'TRUST_POLICY_DENIED'/);
});
