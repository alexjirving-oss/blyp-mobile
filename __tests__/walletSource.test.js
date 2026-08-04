const { shouldUseLiveServiceWallet } = require('../src/utils/walletSource');

describe('walletSource', () => {
  const prev = process.env.EXPO_PUBLIC_USE_LIVE_SERVICE_WALLET;

  afterEach(() => {
    if (prev === undefined) delete process.env.EXPO_PUBLIC_USE_LIVE_SERVICE_WALLET;
    else process.env.EXPO_PUBLIC_USE_LIVE_SERVICE_WALLET = prev;
  });

  it('defaults to live-service wallet when env unset', () => {
    delete process.env.EXPO_PUBLIC_USE_LIVE_SERVICE_WALLET;
    expect(shouldUseLiveServiceWallet()).toBe(true);
  });

  it('honors explicit disable', () => {
    process.env.EXPO_PUBLIC_USE_LIVE_SERVICE_WALLET = '0';
    expect(shouldUseLiveServiceWallet()).toBe(false);
  });
});
