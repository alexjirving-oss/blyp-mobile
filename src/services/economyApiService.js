import { createIdempotencyKey, platformApi } from './platformApiClient';

const DEFAULT_POLL_INTERVAL_MS = 15_000;

function asFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeWallet(wallet = {}) {
  const coinBalance = asFiniteNumber(wallet.coinBalance);
  const bonusCoinBalance = asFiniteNumber(wallet.bonusCoinBalance);
  const gemAvailable = asFiniteNumber(wallet.gemAvailable);
  const gemPending = asFiniteNumber(wallet.gemPending);

  return {
    coinBalance,
    bonusCoinBalance,
    spendableCoins: coinBalance + bonusCoinBalance,
    gemAvailable,
    gemPending,
  };
}

function mutationOptions(operation, idempotencyKey) {
  const key = idempotencyKey || createIdempotencyKey(operation);
  return { key, options: { idempotencyKey: key } };
}

export async function getEconomyWallet() {
  const result = await platformApi.get('/api/v1/economy/wallet');
  return normalizeWallet(result.data);
}

export async function getEconomyCatalog() {
  const result = await platformApi.get('/api/v1/economy/catalog');
  return {
    coinPacks: Array.isArray(result.data?.coinPacks) ? result.data.coinPacks : [],
    gifts: Array.isArray(result.data?.gifts) ? result.data.gifts : [],
  };
}

export async function getEconomyLedger({ cursor, limit = 50 } = {}) {
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
  const query = new URLSearchParams({ limit: String(boundedLimit) });
  if (cursor) query.set('cursor', String(cursor));

  const result = await platformApi.get(`/api/v1/economy/ledger?${query.toString()}`);
  return {
    items: Array.isArray(result.data?.items) ? result.data.items : [],
    nextCursor: result.meta?.nextCursor || null,
  };
}

export async function sendEconomyGift({
  streamId,
  receiverUserId,
  giftId,
  quantity = 1,
  idempotencyKey,
}) {
  const mutation = mutationOptions('economy-gift', idempotencyKey);
  const result = await platformApi.post(
    '/api/v1/economy/gifts',
    {
      streamId,
      receiverUserId,
      giftId,
      quantity,
      idempotencyKey: mutation.key,
    },
    mutation.options
  );
  return result.data;
}

export async function verifyEconomyPurchase({
  platform,
  sku,
  storeTransactionId,
  purchaseToken,
  receipt,
  idempotencyKey,
}) {
  const mutation = mutationOptions('economy-purchase', idempotencyKey);
  const result = await platformApi.post(
    '/api/v1/economy/purchases/verify',
    {
      platform,
      sku,
      storeTransactionId,
      ...(purchaseToken ? { purchaseToken } : {}),
      ...(receipt ? { receipt } : {}),
      idempotencyKey: mutation.key,
    },
    mutation.options
  );
  return {
    ...result.data,
    wallet: normalizeWallet(result.data?.wallet),
  };
}

export function subscribeToEconomyWallet(
  onWallet,
  { intervalMs = DEFAULT_POLL_INTERVAL_MS, onError } = {}
) {
  if (typeof onWallet !== 'function') return () => {};

  let cancelled = false;
  let timer = null;
  const boundedInterval = Math.max(5_000, Math.min(Number(intervalMs) || DEFAULT_POLL_INTERVAL_MS, 60_000));

  const poll = async () => {
    try {
      const wallet = await getEconomyWallet();
      if (!cancelled) onWallet(wallet);
    } catch (error) {
      if (!cancelled && typeof onError === 'function') onError(error);
    } finally {
      if (!cancelled) timer = setTimeout(poll, boundedInterval);
    }
  };

  void poll();
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}

export { normalizeWallet };
