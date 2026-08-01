const mockGet = jest.fn();

jest.mock('../src/services/platformApiClient', () => ({
  platformApi: { get: mockGet },
}));

const FeatureFlags = require('../src/config/FeatureFlags');

beforeEach(() => {
  jest.clearAllMocks();
});

test('all Wave 4 domains enable only from one explicit server configuration', async () => {
  expect(FeatureFlags.getFeatureFlags()).toMatchObject({
    contentApiV1: false,
    feedDiscoveryV1: false,
    economyEntitlementsEnabled: false,
  });

  mockGet.mockResolvedValueOnce({
    data: {
      flags: {
        'content.api_v1': { enabled: true },
        'feed.discovery_v1': { enabled: true },
        'economy.entitlements_v1': { enabled: true },
      },
    },
  });

  await FeatureFlags.refreshFeatureFlags();

  expect(FeatureFlags.isContentApiV1Enabled()).toBe(true);
  expect(FeatureFlags.isFeedDiscoveryV1Enabled()).toBe(true);
  expect(FeatureFlags.isEconomyEntitlementsEnabled()).toBe(true);
  expect(mockGet).toHaveBeenCalledTimes(1);

  const decodedUrl = decodeURIComponent(mockGet.mock.calls[0][0]);
  for (const key of ['content.api_v1', 'feed.discovery_v1', 'economy.entitlements_v1']) {
    expect(decodedUrl).toContain(key);
  }
});

test('a remote configuration failure disables every Wave 4 domain together', async () => {
  mockGet.mockRejectedValueOnce(new Error('configuration unavailable'));

  await FeatureFlags.refreshFeatureFlags();

  expect(FeatureFlags.isContentApiV1Enabled()).toBe(false);
  expect(FeatureFlags.isFeedDiscoveryV1Enabled()).toBe(false);
  expect(FeatureFlags.isEconomyEntitlementsEnabled()).toBe(false);
  expect(FeatureFlags.getFeatureFlags()).toMatchObject({
    loaded: false,
    contentApiV1: false,
    feedDiscoveryV1: false,
    economyEntitlementsEnabled: false,
  });
});
