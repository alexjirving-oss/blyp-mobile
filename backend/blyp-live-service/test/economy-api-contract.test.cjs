const test = require('node:test');
const assert = require('node:assert/strict');

const { economyApiRouter } = require('../dist/economy/economyApiRoutes');
const {
  giftSendSchema,
  iapVerifySchema,
  paginationSchema,
  quotaReservationParamsSchema,
  quotaReserveSchema,
  quotaResolutionSchema,
} = require('../dist/economy/economySchemas');
const {
  availableQuotaUnits,
  commitQuotaUnits,
  effectiveAllowanceUnits,
  releaseQuotaUnits,
  reservationHasExpired,
  reserveQuotaUnits,
} = require('../dist/economy/quotaPolicy');
const { utcDayWindow } = require('../dist/economy/entitlementService');
const {
  registeredEventTypes,
  validateEventPayload,
  validateEventVersion,
} = require('../dist/platform/events/eventRegistry');
const { platformMigrations } = require('../dist/platform/migrations/runner');

const RESERVATION_ID = '11111111-1111-4111-8111-111111111111';
const PERIOD_ID = '22222222-2222-4222-8222-222222222222';

function routeSurface() {
  return economyApiRouter.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods).filter((method) => layer.route.methods[method]).sort(),
    }));
}

test('canonical economy router exposes only the declared v1 resource operations', () => {
  assert.deepEqual(routeSurface(), [
    { path: '/catalog', methods: ['get'] },
    { path: '/wallet', methods: ['get'] },
    { path: '/ledger', methods: ['get'] },
    { path: '/entitlements', methods: ['get'] },
    { path: '/quota/reservations', methods: ['post'] },
    { path: '/quota/reservations/:reservationId/commit', methods: ['post'] },
    { path: '/quota/reservations/:reservationId/refund', methods: ['post'] },
    { path: '/gifts', methods: ['post'] },
    { path: '/purchases/verify', methods: ['post'] },
  ]);
});

test('gift contract requires canonical Cognito identity, bounded quantity, and idempotency', () => {
  const valid = giftSendSchema.parse({
    idempotencyKey: 'gift-key-1',
    streamId: 'stream-1',
    receiverUserId: '22222222-2222-4222-8222-222222222222',
    giftId: 'heart',
    quantity: '2',
  });

  assert.equal(valid.quantity, 2);
  assert.equal(
    giftSendSchema.safeParse({ ...valid, receiverUserId: 'legacy-firebase-id' }).success,
    false
  );
  assert.equal(giftSendSchema.safeParse({ ...valid, quantity: 0 }).success, false);
  assert.equal(giftSendSchema.safeParse({ ...valid, idempotencyKey: '' }).success, false);
});

test('purchase verification requires platform-specific store proof and rejects unknown fields', () => {
  assert.equal(
    iapVerifySchema.safeParse({
      idempotencyKey: 'android-key',
      platform: 'ANDROID',
      sku: 'coins-100',
      storeTransactionId: 'android-transaction-1',
      purchaseToken: 'android-token',
    }).success,
    true
  );
  assert.equal(
    iapVerifySchema.safeParse({
      idempotencyKey: 'android-key',
      platform: 'ANDROID',
      sku: 'coins-100',
      storeTransactionId: 'android-transaction-1',
    }).success,
    false
  );
  assert.equal(
    iapVerifySchema.safeParse({
      idempotencyKey: 'ios-key',
      platform: 'IOS',
      sku: 'coins-100',
      storeTransactionId: 'ios-transaction-1',
      receipt: 'signed-ios-receipt',
    }).success,
    true
  );
  assert.equal(
    iapVerifySchema.safeParse({
      idempotencyKey: 'ios-key',
      platform: 'IOS',
      sku: 'coins-100',
      storeTransactionId: 'ios-transaction-1',
      receipt: 'signed-ios-receipt',
      clientGrantedCoins: 999999,
    }).success,
    false
  );
});

test('ledger pagination remains bounded at the API boundary', () => {
  assert.deepEqual(paginationSchema.parse({ limit: '100', cursor: 'cursor-1' }), {
    limit: 100,
    cursor: 'cursor-1',
  });
  assert.equal(paginationSchema.safeParse({ limit: 0 }).success, false);
  assert.equal(paginationSchema.safeParse({ limit: 101 }).success, false);
});

test('quota schemas reject client-authored plan, allowance, user, and state truth', () => {
  assert.deepEqual(
    quotaReserveSchema.parse({
      entitlementKey: 'ai.generation',
      units: '1',
      idempotencyKey: 'quota-reserve-1',
    }),
    { entitlementKey: 'ai.generation', units: 1, idempotencyKey: 'quota-reserve-1' }
  );
  for (const forbidden of [
    { planId: 'PREMIUM' },
    { allowanceUnits: 999999 },
    { userId: 'another-user' },
    { status: 'COMMITTED' },
  ]) {
    assert.equal(
      quotaReserveSchema.safeParse({
        entitlementKey: 'ai.generation',
        units: 1,
        idempotencyKey: 'quota-reserve-1',
        ...forbidden,
      }).success,
      false
    );
  }
  assert.equal(quotaReserveSchema.safeParse({ entitlementKey: 'x', units: 1, idempotencyKey: 'a' }).success, false);
  assert.equal(quotaReserveSchema.safeParse({ entitlementKey: 'ai.generation', units: 0, idempotencyKey: 'a' }).success, false);
  assert.equal(quotaReserveSchema.safeParse({ entitlementKey: 'ai.generation', units: 1001, idempotencyKey: 'a' }).success, false);
  assert.equal(quotaResolutionSchema.safeParse({ idempotencyKey: 'commit-1' }).success, true);
  assert.equal(quotaResolutionSchema.safeParse({ idempotencyKey: 'commit-1', units: 1 }).success, false);
  assert.equal(quotaReservationParamsSchema.safeParse({ reservationId: RESERVATION_ID }).success, true);
  assert.equal(quotaReservationParamsSchema.safeParse({ reservationId: 'client-label' }).success, false);
});

test('quota arithmetic prevents overspend and releases only active reservations', () => {
  const initial = { allowanceUnits: 3, reservedUnits: 0, committedUnits: 0 };
  const reserved = reserveQuotaUnits(initial, 2);
  assert.deepEqual(reserved, { allowanceUnits: 3, reservedUnits: 2, committedUnits: 0 });
  assert.equal(availableQuotaUnits(reserved), 1);
  assert.throws(() => reserveQuotaUnits(reserved, 2), (error) => error.code === 'QUOTA_EXHAUSTED');

  const committed = commitQuotaUnits(reserved, 1);
  assert.deepEqual(committed, { allowanceUnits: 3, reservedUnits: 1, committedUnits: 1 });
  const released = releaseQuotaUnits(committed, 1);
  assert.deepEqual(released, { allowanceUnits: 3, reservedUnits: 0, committedUnits: 1 });
  assert.throws(() => releaseQuotaUnits(released, 1), (error) => error.code === 'QUOTA_STATE_INVALID');
});

test('allowance transitions never invalidate granted usage and UTC days roll over deterministically', () => {
  assert.equal(effectiveAllowanceUnits(3, 30, 1, 1), 30);
  assert.equal(effectiveAllowanceUnits(30, 3, 4, 10), 30);
  assert.equal(effectiveAllowanceUnits(3, 2, 2, 4), 6);

  assert.deepEqual(utcDayWindow(new Date('2026-08-01T23:59:59.999Z')), {
    periodStart: '2026-08-01T00:00:00.000Z',
    periodEnd: '2026-08-02T00:00:00.000Z',
  });
  assert.equal(
    reservationHasExpired('2026-08-02T00:00:00.000Z', new Date('2026-08-02T00:00:00.000Z')),
    true
  );
  assert.equal(
    reservationHasExpired('2026-08-02T00:00:00.001Z', new Date('2026-08-02T00:00:00.000Z')),
    false
  );
});

test('all quota lifecycle events are registered, versioned, and strictly validated', () => {
  const eventTypes = [
    'economy.quota.reserved.v1',
    'economy.quota.committed.v1',
    'economy.quota.refunded.v1',
    'economy.quota.expired.v1',
  ];
  const payload = {
    userId: '11111111-1111-4111-8111-111111111111',
    entitlementKey: 'ai.generation',
    planId: 'FREE',
    reservationId: RESERVATION_ID,
    quotaPeriodId: PERIOD_ID,
    units: 1,
    periodStart: '2026-08-01T00:00:00.000Z',
    periodEnd: '2026-08-02T00:00:00.000Z',
    remainingUnits: 2,
  };

  for (const eventType of eventTypes) {
    assert.equal(registeredEventTypes().includes(eventType), true);
    assert.doesNotThrow(() => validateEventVersion(eventType, 1));
    assert.deepEqual(validateEventPayload(eventType, payload), payload);
    assert.throws(
      () => validateEventPayload(eventType, { ...payload, remainingUnits: -1 }),
      (error) => error.code === 'EVENT_PAYLOAD_INVALID'
    );
  }
});

test('entitlement migration is registered once with the reserved id and remains ordered', () => {
  const ids = platformMigrations.map((migration) => migration.id);
  assert.equal(ids.filter((id) => id === '0005_economy_entitlements').length, 1);
  assert.deepEqual(ids, [...ids].sort());
});


test('entitlement transactions are lock-safe, Trust-gated, append-only, and disabled by default', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const sourceRoot = path.join(__dirname, '..', 'src');
  const service = fs.readFileSync(path.join(sourceRoot, 'economy', 'entitlementService.ts'), 'utf8');
  const migration = fs.readFileSync(
    path.join(sourceRoot, 'platform', 'migrations', '0005EconomyEntitlements.ts'),
    'utf8'
  );
  const routes = fs.readFileSync(path.join(sourceRoot, 'economy', 'economyApiRoutes.ts'), 'utf8');

  const replayIndex = service.indexOf("where({ user_id: userId, idempotency_key: input.idempotencyKey })");
  const trustIndex = service.indexOf('requireTrustPolicyInTransaction(trx, userId');
  const reservationMutationIndex = service.indexOf("trx('quota_reservations').insert");
  assert.ok(replayIndex >= 0 && replayIndex < trustIndex);
  assert.ok(trustIndex >= 0 && trustIndex < reservationMutationIndex);

  assert.match(service, /pg_advisory_xact_lock/);
  assert.match(service, /\.forUpdate\(\)/);
  assert.match(service, /trx\('quota_usage_ledger'\)\.insert/);
  assert.match(service, /enqueueDomainEvent\(trx/);
  assert.match(service, /whereIn\('provider_status', \['active', 'trialing'\]\)/);
  assert.match(service, /whereNotNull\('provider_verified_at'\)/);
  assert.match(service, /source: 'FREE_DEFAULT'/);

  assert.match(migration, /'0005_economy_entitlements'/);
  assert.match(migration, /CHECK \(reserved_units \+ committed_units <= allowance_units\)/);
  assert.match(migration, /UNIQUE \(user_id, idempotency_key\)/);
  assert.match(migration, /trg_quota_usage_ledger_append_only/);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON quota_usage_ledger/);
  assert.match(migration, /'UTC_DAY', 0, 900, true, '\{\"configurationState\":\"pending_approval\"\}'::jsonb/);
  assert.match(migration, /'economy\.entitlements_v1'/);
  assert.match(migration, /false,\s*0,\s*'Enable server-authoritative/s);

  assert.match(routes, /isFeatureEnabled\(db, ENTITLEMENTS_FLAG, userId\)/);
  assert.match(routes, /404, 'FEATURE_DISABLED'/);
  assert.match(routes, /requireMutationIdempotency/);
  assert.match(routes, /assertBodyIdempotencyMatchesHeader/);
});
