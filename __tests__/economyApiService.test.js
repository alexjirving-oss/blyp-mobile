const mockGet = jest.fn();
const mockPost = jest.fn();
const mockCreateIdempotencyKey = jest.fn((operation) => `generated:${operation}`);

jest.mock('../src/services/platformApiClient', () => ({
  platformApi: {
    get: mockGet,
    post: mockPost,
  },
  createIdempotencyKey: mockCreateIdempotencyKey,
}));

const EconomyApiService = require('../src/services/economyApiService');

beforeEach(() => {
  jest.clearAllMocks();
});

test('normalizes the authenticated canonical wallet', async () => {
  mockGet.mockResolvedValue({
    data: {
      coinBalance: '20',
      bonusCoinBalance: 5,
      gemAvailable: '7',
      gemPending: 2,
    },
  });

  await expect(EconomyApiService.getEconomyWallet()).resolves.toEqual({
    coinBalance: 20,
    bonusCoinBalance: 5,
    spendableCoins: 25,
    gemAvailable: 7,
    gemPending: 2,
  });
  expect(mockGet).toHaveBeenCalledWith('/api/v1/economy/wallet');
});

test('reads the server catalog and cursor ledger through versioned routes', async () => {
  mockGet
    .mockResolvedValueOnce({ data: { coinPacks: [{ sku: 'coins-100' }], gifts: [{ giftId: 'heart' }] } })
    .mockResolvedValueOnce({ data: { items: [{ ledgerId: 'ledger-1' }] }, meta: { nextCursor: 'next-1' } });

  await expect(EconomyApiService.getEconomyCatalog()).resolves.toEqual({
    coinPacks: [{ sku: 'coins-100' }],
    gifts: [{ giftId: 'heart' }],
  });
  await expect(
    EconomyApiService.getEconomyLedger({ cursor: 'cursor/with space', limit: 500 })
  ).resolves.toEqual({ items: [{ ledgerId: 'ledger-1' }], nextCursor: 'next-1' });

  expect(mockGet).toHaveBeenNthCalledWith(1, '/api/v1/economy/catalog');
  expect(mockGet).toHaveBeenNthCalledWith(
    2,
    '/api/v1/economy/ledger?limit=100&cursor=cursor%2Fwith+space'
  );
});

test('sends gifts with one canonical idempotency key in body and header', async () => {
  mockPost.mockResolvedValue({ data: { giftEventId: 'gift-event-1', replayed: false } });

  await EconomyApiService.sendEconomyGift({
    streamId: 'stream-1',
    receiverUserId: '22222222-2222-4222-8222-222222222222',
    giftId: 'heart',
    quantity: 2,
    idempotencyKey: 'gift-key',
  });

  expect(mockPost).toHaveBeenCalledWith(
    '/api/v1/economy/gifts',
    {
      streamId: 'stream-1',
      receiverUserId: '22222222-2222-4222-8222-222222222222',
      giftId: 'heart',
      quantity: 2,
      idempotencyKey: 'gift-key',
    },
    { idempotencyKey: 'gift-key' }
  );
});

test('verifies a store purchase with generated idempotency and normalizes the returned wallet', async () => {
  mockPost.mockResolvedValue({
    data: {
      purchaseId: 'purchase-1',
      wallet: {
        coinBalance: '100',
        bonusCoinBalance: '10',
        gemAvailable: '4',
        gemPending: '1',
      },
    },
  });

  await expect(
    EconomyApiService.verifyEconomyPurchase({
      platform: 'ANDROID',
      sku: 'coins-100',
      storeTransactionId: 'store-transaction-1',
      purchaseToken: 'verified-by-store-adapter',
    })
  ).resolves.toMatchObject({
    purchaseId: 'purchase-1',
    wallet: {
      spendableCoins: 110,
      gemAvailable: 4,
      gemPending: 1,
    },
  });

  expect(mockCreateIdempotencyKey).toHaveBeenCalledWith('economy-purchase');
  expect(mockPost).toHaveBeenCalledWith(
    '/api/v1/economy/purchases/verify',
    {
      platform: 'ANDROID',
      sku: 'coins-100',
      storeTransactionId: 'store-transaction-1',
      purchaseToken: 'verified-by-store-adapter',
      idempotencyKey: 'generated:economy-purchase',
    },
    { idempotencyKey: 'generated:economy-purchase' }
  );
});
