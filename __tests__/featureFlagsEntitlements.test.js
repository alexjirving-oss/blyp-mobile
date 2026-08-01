const mockGet = jest.fn();

jest.mock('../src/services/platformApiClient', () => ({
  platformApi: { get: mockGet },
}));

const FeatureFlags = require('../src/config/FeatureFlags');

beforeEach(() => {
  jest.clearAllMocks();
});

test('economy entitlements are fail-closed until explicitly enabled by the server', async () => {
  expect(FeatureFlags.isEconomyEntitlementsEnabled()).toBe(false);

  mockGet.mockResolvedValueOnce({
    data: {
      flags: {
        'economy.entitlements_v1': { enabled: true },
      },
    },
  });
  await FeatureFlags.refreshFeatureFlags();

  expect(FeatureFlags.isEconomyEntitlementsEnabled()).toBe(true);
  expect(mockGet).toHaveBeenCalledTimes(1);
  const requestedUrl = mockGet.mock.calls[0][0];
  expect(requestedUrl).toContain('/api/v1/platform/feature-flags?keys=');
  expect(decodeURIComponent(requestedUrl)).toContain('economy.entitlements_v1');

  mockGet.mockRejectedValueOnce(new Error('configuration unavailable'));
  await FeatureFlags.refreshFeatureFlags();
  expect(FeatureFlags.isEconomyEntitlementsEnabled()).toBe(false);
  expect(FeatureFlags.getFeatureFlags()).toMatchObject({
    loaded: false,
    economyEntitlementsEnabled: false,
  });
});
