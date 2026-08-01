const mockGet = jest.fn();
const mockPost = jest.fn();
const mockCreateIdempotencyKey = jest.fn((operation) => `generated:${operation}`);
const mockIsEnabled = jest.fn(() => true);

jest.mock('../src/config/FeatureFlags', () => ({
  isEconomyEntitlementsEnabled: mockIsEnabled,
}));

jest.mock('../src/services/platformApiClient', () => ({
  platformApi: {
    get: mockGet,
    post: mockPost,
  },
  createIdempotencyKey: mockCreateIdempotencyKey,
}));

const EntitlementApiService = require('../src/services/entitlementApiService');

const RESERVATION_ID = '11111111-1111-4111-8111-111111111111';

function reservationResponse(status = 'RESERVED') {
  return {
    data: {
      reservation: {
        reservationId: RESERVATION_ID,
        entitlementKey: 'ai.generation',
        planId: 'FREE',
        units: '1',
        status,
        expiresAt: '2026-08-01T12:15:00.000Z',
        reservedAt: '2026-08-01T12:00:00.000Z',
        committedAt: status === 'COMMITTED' ? '2026-08-01T12:01:00.000Z' : null,
        refundedAt: status === 'REFUNDED' ? '2026-08-01T12:01:00.000Z' : null,
        expiredAt: null,
      },
      quota: {
        quotaPeriodId: '22222222-2222-4222-8222-222222222222',
        planId: 'FREE',
        periodStart: '2026-08-01T00:00:00.000Z',
        periodEnd: '2026-08-02T00:00:00.000Z',
        allowanceUnits: '3',
        reservedUnits: status === 'RESERVED' ? '1' : '0',
        committedUnits: status === 'COMMITTED' ? '1' : '0',
        availableUnits: '2',
      },
      replayed: false,
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsEnabled.mockReturnValue(true);
});

test('fails closed without calling the backend when the entitlement rollout flag is disabled', async () => {
  mockIsEnabled.mockReturnValue(false);

  await expect(EntitlementApiService.getEconomyEntitlements()).rejects.toMatchObject({
    code: 'FEATURE_DISABLED',
  });
  await expect(
    EntitlementApiService.reserveEconomyQuota({ entitlementKey: 'ai.generation' })
  ).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  expect(mockGet).not.toHaveBeenCalled();
  expect(mockPost).not.toHaveBeenCalled();
});

test('reads and normalizes only the server-authored plan, subscription, and quota snapshot', async () => {
  mockGet.mockResolvedValue({
    data: {
      plan: {
        planId: 'PREMIUM',
        planTier: 'PREMIUM',
        planName: 'Premium',
        source: 'VERIFIED_SUBSCRIPTION',
      },
      subscription: { subscriptionId: 'subscription-1', status: 'active' },
      entitlements: [
        {
          entitlementKey: 'ai.generation',
          granted: true,
          unitName: 'request',
          periodKind: 'UTC_DAY',
          reservationTtlSeconds: '900',
          configuration: { modelClass: 'standard' },
          quota: {
            quotaPeriodId: 'period-1',
            planId: 'PREMIUM',
            allowanceUnits: '30',
            reservedUnits: '2',
            committedUnits: '5',
            availableUnits: '23',
          },
        },
      ],
      evaluatedAt: '2026-08-01T12:00:00.000Z',
    },
  });

  await expect(EntitlementApiService.getEconomyEntitlements()).resolves.toMatchObject({
    plan: { planTier: 'PREMIUM', source: 'VERIFIED_SUBSCRIPTION' },
    subscription: { subscriptionId: 'subscription-1' },
    entitlements: [
      {
        entitlementKey: 'ai.generation',
        reservationTtlSeconds: 900,
        quota: {
          allowanceUnits: 30,
          reservedUnits: 2,
          committedUnits: 5,
          availableUnits: 23,
        },
      },
    ],
  });
  expect(mockGet).toHaveBeenCalledWith('/api/v1/economy/entitlements');
});

test('reserves quota with one generated idempotency key and no client plan or allowance fields', async () => {
  mockPost.mockResolvedValue(reservationResponse());

  await expect(
    EntitlementApiService.reserveEconomyQuota({ entitlementKey: 'ai.generation', units: 1 })
  ).resolves.toMatchObject({
    reservation: { reservationId: RESERVATION_ID, units: 1, status: 'RESERVED' },
    quota: { allowanceUnits: 3, reservedUnits: 1, availableUnits: 2 },
    replayed: false,
  });

  expect(mockCreateIdempotencyKey).toHaveBeenCalledWith('economy-quota-reserve');
  expect(mockPost).toHaveBeenCalledWith(
    '/api/v1/economy/quota/reservations',
    {
      entitlementKey: 'ai.generation',
      units: 1,
      idempotencyKey: 'generated:economy-quota-reserve',
    },
    { idempotencyKey: 'generated:economy-quota-reserve' }
  );
});

test('commits and refunds encoded reservation resources with matching body and header keys', async () => {
  mockPost
    .mockResolvedValueOnce(reservationResponse('COMMITTED'))
    .mockResolvedValueOnce(reservationResponse('REFUNDED'));

  await EntitlementApiService.commitEconomyQuota({
    reservationId: `${RESERVATION_ID}/unsafe`,
    idempotencyKey: 'commit-key',
  });
  await EntitlementApiService.refundEconomyQuota({
    reservationId: RESERVATION_ID,
    idempotencyKey: 'refund-key',
  });

  expect(mockPost).toHaveBeenNthCalledWith(
    1,
    `/api/v1/economy/quota/reservations/${RESERVATION_ID}%2Funsafe/commit`,
    { idempotencyKey: 'commit-key' },
    { idempotencyKey: 'commit-key' }
  );
  expect(mockPost).toHaveBeenNthCalledWith(
    2,
    `/api/v1/economy/quota/reservations/${RESERVATION_ID}/refund`,
    { idempotencyKey: 'refund-key' },
    { idempotencyKey: 'refund-key' }
  );
});

test('withEconomyQuota commits success and releases a failed operation', async () => {
  mockPost
    .mockResolvedValueOnce(reservationResponse('RESERVED'))
    .mockResolvedValueOnce(reservationResponse('COMMITTED'))
    .mockResolvedValueOnce(reservationResponse('RESERVED'))
    .mockResolvedValueOnce(reservationResponse('REFUNDED'));

  await expect(
    EntitlementApiService.withEconomyQuota(
      { entitlementKey: 'ai.generation' },
      async () => 'generated-content'
    )
  ).resolves.toBe('generated-content');

  await expect(
    EntitlementApiService.withEconomyQuota(
      { entitlementKey: 'ai.generation' },
      async () => {
        throw new Error('provider failed');
      }
    )
  ).rejects.toThrow('provider failed');

  expect(mockPost.mock.calls.map((call) => call[0])).toEqual([
    '/api/v1/economy/quota/reservations',
    `/api/v1/economy/quota/reservations/${RESERVATION_ID}/commit`,
    '/api/v1/economy/quota/reservations',
    `/api/v1/economy/quota/reservations/${RESERVATION_ID}/refund`,
  ]);
});
