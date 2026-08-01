const mockGet = jest.fn();
const mockPost = jest.fn();
const mockDelete = jest.fn();
const mockCreateIdempotencyKey = jest.fn((operation) => `generated:${operation}`);

jest.mock('../src/services/platformApiClient', () => ({
  platformApi: {
    get: mockGet,
    post: mockPost,
    delete: mockDelete,
  },
  createIdempotencyKey: mockCreateIdempotencyKey,
}));

const TrustApiService = require('../src/services/trustApiService').default;

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue({ data: { ok: true } });
  mockPost.mockResolvedValue({ data: { ok: true } });
  mockDelete.mockResolvedValue({ data: { ok: true } });
});

test('reads the authenticated Trust snapshot through the versioned API', async () => {
  await expect(TrustApiService.getSnapshot()).resolves.toEqual({ ok: true });
  expect(mockGet).toHaveBeenCalledWith('/api/v1/trust/me');
});

test('uses an explicit idempotency key for consent and privacy mutations', async () => {
  await TrustApiService.acceptConsent({ policyVersion: '2026.08' }, { idempotencyKey: 'accept-key' });
  expect(mockPost).toHaveBeenCalledWith(
    '/api/v1/trust/me/consent/accept',
    { policyVersion: '2026.08' },
    { idempotencyKey: 'accept-key', retries: 2 }
  );

  await TrustApiService.updatePrivacy({ discoverability: 'hidden' });
  expect(mockCreateIdempotencyKey).toHaveBeenCalledWith('trust-privacy-update');
  expect(mockPost).toHaveBeenLastCalledWith(
    '/api/v1/trust/me/privacy',
    { discoverability: 'hidden' },
    { idempotencyKey: 'generated:trust-privacy-update', retries: 2 }
  );
});

test('sets, lists, and removes relationship controls without direct storage access', async () => {
  await TrustApiService.listRelationshipControls('mute');
  expect(mockGet).toHaveBeenCalledWith('/api/v1/trust/me/relationships?type=mute');

  await TrustApiService.setRelationshipControl(
    { targetUserId: 'target/with space', controlType: 'block' },
    { idempotencyKey: 'block-key' }
  );
  expect(mockPost).toHaveBeenCalledWith(
    '/api/v1/trust/me/relationships',
    { targetUserId: 'target/with space', controlType: 'block' },
    { idempotencyKey: 'block-key', retries: 2 }
  );

  await TrustApiService.removeRelationshipControl('block', 'target/with space');
  expect(mockDelete).toHaveBeenCalledWith(
    '/api/v1/trust/me/relationships/block/target%2Fwith%20space',
    { idempotencyKey: 'generated:trust-block-remove', retries: 2 }
  );
});

test('evaluates policy as a read-only decision request without an idempotency key', async () => {
  const input = { targetUserId: 'target-1', capability: 'contact' };
  await TrustApiService.evaluatePolicy(input);
  expect(mockPost).toHaveBeenCalledWith('/api/v1/trust/decisions', input);
});
