const test = require('node:test');
const assert = require('node:assert/strict');

const { economyApiRouter } = require('../dist/economy/economyApiRoutes');
const {
  giftSendSchema,
  iapVerifySchema,
  paginationSchema,
} = require('../dist/economy/economySchemas');

test('canonical economy router exposes only the declared v1 resource operations', () => {
  const routes = economyApiRouter.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods).filter((method) => layer.route.methods[method]).sort(),
    }));

  assert.deepEqual(routes, [
    { path: '/catalog', methods: ['get'] },
    { path: '/wallet', methods: ['get'] },
    { path: '/ledger', methods: ['get'] },
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
