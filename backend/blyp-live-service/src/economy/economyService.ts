import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import type { Knex } from 'knex';
import { getEconomyInfra } from './infra';
import { getEconomyEnv } from '../config/economyEnv';
import { EconomyError } from './economyErrors';
import { decodeCursor, encodeCursor } from './cursor';
import { emitGiftEvent, emitLiveGameEvent } from '../realtime/realtimeBus';
import { requireTrustPolicyInTransaction } from '../trust/trustRelationshipService';
import type { AdminCreditCoinsInput, IapVerifyInput, PromoteBattleInput, PromoteSpotlightBookInput, PromoteTimeSlotBookInput } from './economySchemas';

function nowIso() {
  return new Date().toISOString();
}

type IapVerifySuccessResponse = {
  valid: true;
  duplicatePerfId: string | null;
  grantedCoins: number;
  grantedGems: number;
  wallet: {
    coinBalance: number;
    bonusCoinBalance: number;
    gemAvailable: number;
    gemPending: number;
  };
};

type GoogleServiceAccount = {
  client_email: string;
  private_key: string;
  private_key_id?: string;
  token_uri?: string;
};

type ProviderVerifyResult = {
  verified: boolean;
  providerOrderId: string | null;
  detail?: string;
};

type PromotePricing = {
  battle: { coins: number; durationHours: number };
  timeSlot: { per30MinCoins: number };
  spotlight: { coins1h: number; coins24h: number; coins7d: number };
};

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

const COGNITO_SUB_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertCanonicalSubUserId(value: unknown, field: string): string {
  const userId = String(value || '').trim();
  if (!COGNITO_SUB_REGEX.test(userId)) {
    throw new EconomyError('INVALID_INPUT', 400, `${field} must be a Cognito sub`, { field, value: userId || null });
  }
  return userId;
}

function parseGoogleServiceAccount(raw: string): GoogleServiceAccount {
  try {
    const parsed = JSON.parse(raw) as GoogleServiceAccount;
    if (!parsed?.client_email || !parsed?.private_key) {
      throw new Error('missing_client_email_or_private_key');
    }
    return parsed;
  } catch (err) {
    throw new EconomyError('PROVIDER_ERROR', 503, 'Invalid GOOGLE_PLAY_SERVICE_ACCOUNT_JSON');
  }
}

async function getGoogleAccessToken(serviceAccount: GoogleServiceAccount): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: serviceAccount.token_uri || 'https://oauth2.googleapis.com/token',
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  };

  const assertion = jwt.sign(payload, serviceAccount.private_key, {
    algorithm: 'RS256',
    header: serviceAccount.private_key_id ? { alg: 'RS256', kid: serviceAccount.private_key_id } : { alg: 'RS256' },
  });

  const tokenBody = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const tokenRes = await fetch(serviceAccount.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody.toString(),
  });

  const tokenJson = (await tokenRes.json().catch(() => null)) as { access_token?: string; error?: string } | null;
  if (!tokenRes.ok || !tokenJson?.access_token) {
    throw new EconomyError('PROVIDER_ERROR', 503, 'Google access token request failed', tokenJson ?? `HTTP_${tokenRes.status}`);
  }

  return tokenJson.access_token;
}

async function verifyGooglePlayPurchase(input: IapVerifyInput): Promise<ProviderVerifyResult> {
  const env = getEconomyEnv();
  const packageName = String(env.GOOGLE_PLAY_PACKAGE_NAME || '').trim();
  const serviceAccountRaw = String(env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON || '').trim();

  if (!packageName || !serviceAccountRaw) {
    throw new EconomyError('PROVIDER_ERROR', 503, 'Google Play provider credentials are not configured');
  }

  const serviceAccount = parseGoogleServiceAccount(serviceAccountRaw);
  const accessToken = await getGoogleAccessToken(serviceAccount);

  const sku = encodeURIComponent(input.sku);
  const token = encodeURIComponent(String(input.purchaseToken || ''));
  const purchaseUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases/products/${sku}/tokens/${token}`;

  const purchaseRes = await fetch(purchaseUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (purchaseRes.status === 404) {
    return { verified: false, providerOrderId: null, detail: 'purchase_not_found' };
  }

  const purchaseJson = (await purchaseRes.json().catch(() => null)) as {
    purchaseState?: number;
    orderId?: string;
    consumptionState?: number;
    acknowledgementState?: number;
  } | null;

  if (!purchaseRes.ok || !purchaseJson) {
    throw new EconomyError('PROVIDER_ERROR', 503, 'Google Play purchase verify request failed', purchaseJson ?? `HTTP_${purchaseRes.status}`);
  }

  const purchaseState = Number(purchaseJson.purchaseState);
  if (purchaseState !== 0) {
    return { verified: false, providerOrderId: purchaseJson.orderId || null, detail: `purchase_state_${purchaseState}` };
  }

  const providerOrderId = String(purchaseJson.orderId || '').trim() || String(input.storeTransactionId || '').trim() || null;
  return { verified: true, providerOrderId, detail: 'google_verified' };
}

async function verifyProviderPurchase(input: IapVerifyInput): Promise<ProviderVerifyResult> {
  if (input.platform === 'ANDROID') {
    return verifyGooglePlayPurchase(input);
  }

  throw new EconomyError('PROVIDER_ERROR', 503, 'iOS provider verification is not configured yet');
}

export async function getPromotePricing(): Promise<PromotePricing> {
  const env = getEconomyEnv();
  // Defaults are intentionally conservative and can be overridden by env.
  const battleCoins = clampInt(Number((env as any).PROMOTE_BATTLE_COINS ?? 100), 0, 1_000_000);
  const battleDurationHours = clampInt(Number((env as any).PROMOTE_BATTLE_DURATION_HOURS ?? 24), 1, 168);
  const timeSlot30 = clampInt(Number((env as any).PROMOTE_TIME_SLOT_30MIN_COINS ?? 250), 0, 1_000_000);
  const spot1h = clampInt(Number((env as any).PROMOTE_SPOTLIGHT_1H_COINS ?? 500), 0, 10_000_000);
  const spot24h = clampInt(Number((env as any).PROMOTE_SPOTLIGHT_24H_COINS ?? 5000), 0, 10_000_000);
  const spot7d = clampInt(Number((env as any).PROMOTE_SPOTLIGHT_7D_COINS ?? 25000), 0, 10_000_000);

  return {
    battle: { coins: battleCoins, durationHours: battleDurationHours },
    timeSlot: { per30MinCoins: timeSlot30 },
    spotlight: { coins1h: spot1h, coins24h: spot24h, coins7d: spot7d },
  };
}

function parseIsoDate(s: string): Date {
  const d = new Date(String(s || '').trim());
  if (!Number.isFinite(d.getTime())) throw new EconomyError('INVALID_INPUT', 400, 'Invalid startsAt');
  return d;
}

function durationKeyToMinutes(key: '1h' | '24h' | '7d') {
  if (key === '1h') return 60;
  if (key === '24h') return 24 * 60;
  return 7 * 24 * 60;
}

async function debitCoinsForPromotion(
  trx: Knex.Transaction,
  userId: string,
  totalCostCoins: bigint,
  idempotencyKey: string,
  promotionId: string,
  meta: Record<string, any>
) {
  await trx('wallets').insert({ user_id: userId }).onConflict('user_id').ignore();
  const wallet = await trx('wallets').where({ user_id: userId }).forUpdate().first();
  if (!wallet) throw new EconomyError('INTERNAL', 500, 'Wallet missing');

  const bonus = BigInt(wallet.bonus_coin_balance);
  const paid = BigInt(wallet.coin_balance);

  const useBonus = bonus >= totalCostCoins ? totalCostCoins : bonus;
  const remaining = totalCostCoins - useBonus;
  const usePaid = remaining;
  if (paid < usePaid) throw new EconomyError('INSUFFICIENT_FUNDS', 409, 'Insufficient funds');

  if (usePaid > 0n) {
    await trx('ledger_entries').insert({
      ledger_id: randomUUID(),
      user_id: userId,
      entry_type: 'PROMOTE_SPEND',
      currency: 'COIN',
      amount: (-usePaid).toString(),
      status: 'POSTED',
      reference_type: 'PROMOTION',
      reference_id: promotionId,
      idempotency_key: `${idempotencyKey}:COIN`,
      metadata: meta,
    });
  }
  if (useBonus > 0n) {
    await trx('ledger_entries').insert({
      ledger_id: randomUUID(),
      user_id: userId,
      entry_type: 'PROMOTE_SPEND',
      currency: 'BONUS_COIN',
      amount: (-useBonus).toString(),
      status: 'POSTED',
      reference_type: 'PROMOTION',
      reference_id: promotionId,
      idempotency_key: `${idempotencyKey}:BONUS`,
      metadata: meta,
    });
  }

  await trx('wallets')
    .where({ user_id: userId })
    .update({
      coin_balance: (paid - usePaid).toString(),
      bonus_coin_balance: (bonus - useBonus).toString(),
      lifetime_spend_coins: (BigInt(wallet.lifetime_spend_coins) + totalCostCoins).toString(),
      updated_at: trx.fn.now(),
    });

  const updated = await trx('wallets').where({ user_id: userId }).first();
  return {
    coinBalance: Number(updated?.coin_balance ?? 0),
    bonusCoinBalance: Number(updated?.bonus_coin_balance ?? 0),
  };
}

async function findOverlappingPromotion(
  trx: Knex.Transaction,
  promotionType: string,
  startsAtIso: string,
  endsAtIso: string
) {
  return await trx('promotions')
    .where({ promotion_type: promotionType, status: 'ACTIVE' })
    .andWhere('starts_at', '<', endsAtIso)
    .andWhere('ends_at', '>', startsAtIso)
    .first();
}

export async function getSpotlightAvailability(durationKey: '1h' | '24h' | '7d') {
  const { db } = getEconomyInfra();

  const minutes = durationKeyToMinutes(durationKey);
  const now = new Date();
  const stepMinutes = 15;

  // Round up to next step.
  const rounded = new Date(now);
  rounded.setSeconds(0, 0);
  const mins = rounded.getMinutes();
  const next = mins % stepMinutes === 0 ? mins : mins + (stepMinutes - (mins % stepMinutes));
  rounded.setMinutes(next);

  const maxResults = 12;
  const out: string[] = [];

  // Iterate forward until we find enough free slots (cap search to avoid runaway).
  const maxIterations = 400;
  let cursor = new Date(rounded);

  await db.transaction(async (trx) => {
    for (let i = 0; i < maxIterations && out.length < maxResults; i++) {
      const startIso = cursor.toISOString();
      const end = new Date(cursor);
      end.setMinutes(end.getMinutes() + minutes);
      const endIso = end.toISOString();

      const overlap = await findOverlappingPromotion(trx, 'SPOTLIGHT', startIso, endIso);
      if (!overlap) {
        out.push(startIso);
      }
      cursor = new Date(cursor);
      cursor.setMinutes(cursor.getMinutes() + stepMinutes);
    }
  });

  return { durationKey, availableStartsAt: out };
}

export async function purchasePromoteBattle(userId: string, input: PromoteBattleInput) {
  userId = assertCanonicalSubUserId(userId, 'userId');
  const { db } = getEconomyInfra();
  const pricing = await getPromotePricing();
  const coins = BigInt(pricing.battle.coins);
  const durationHours = pricing.battle.durationHours;
  const { idempotencyKey, battleRef } = input;

  return await db.transaction(async (trx) => {
    const existing = await trx('promotions').where({ user_id: userId, idempotency_key: idempotencyKey }).first();
    if (existing) {
      const wallet = await ensureWalletRow(trx, userId);
      return {
        kind: 'replay' as const,
        response: {
          promotionId: existing.promotion_id,
          promotionType: existing.promotion_type,
          status: existing.status,
          startsAt: new Date(existing.starts_at).toISOString(),
          endsAt: new Date(existing.ends_at).toISOString(),
          coinCost: Number(existing.coin_cost),
          newBalances: {
            coinBalance: Number(wallet.coin_balance),
            bonusCoinBalance: Number(wallet.bonus_coin_balance),
          },
        },
      };
    }

    const start = new Date();
    const end = new Date(start);
    end.setHours(end.getHours() + durationHours);

    const promotionId = randomUUID();
    const meta = { originalIdempotencyKey: idempotencyKey, battleRef: battleRef ?? null };

    await trx('promotions').insert({
      promotion_id: promotionId,
      user_id: userId,
      promotion_type: 'BATTLE',
      status: 'ACTIVE',
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      coin_cost: coins.toString(),
      idempotency_key: idempotencyKey,
      metadata: meta,
      created_at: nowIso(),
    });

    const newBalances = await debitCoinsForPromotion(trx, userId, coins, idempotencyKey, promotionId, meta);
    return {
      kind: 'ok' as const,
      response: {
        promotionId,
        promotionType: 'BATTLE',
        status: 'ACTIVE',
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        coinCost: Number(coins),
        newBalances,
      },
    };
  });
}

export async function bookPromoteTimeSlot(userId: string, input: PromoteTimeSlotBookInput) {
  userId = assertCanonicalSubUserId(userId, 'userId');
  const { db } = getEconomyInfra();
  const pricing = await getPromotePricing();
  const { idempotencyKey, startsAt, durationMinutes, note } = input;

  const start = parseIsoDate(startsAt);
  const dur = clampInt(Number(durationMinutes), 15, 24 * 60);
  const end = new Date(start);
  end.setMinutes(end.getMinutes() + dur);
  if (end.getTime() <= start.getTime()) throw new EconomyError('INVALID_INPUT', 400, 'Invalid duration');

  // Price is per 30-min block.
  const blocks = BigInt(Math.max(1, Math.ceil(dur / 30)));
  const coins = BigInt(pricing.timeSlot.per30MinCoins) * blocks;

  return await db.transaction(async (trx) => {
    const existing = await trx('promotions').where({ user_id: userId, idempotency_key: idempotencyKey }).first();
    if (existing) {
      const wallet = await ensureWalletRow(trx, userId);
      return {
        kind: 'replay' as const,
        response: {
          promotionId: existing.promotion_id,
          promotionType: existing.promotion_type,
          status: existing.status,
          startsAt: new Date(existing.starts_at).toISOString(),
          endsAt: new Date(existing.ends_at).toISOString(),
          coinCost: Number(existing.coin_cost),
          newBalances: {
            coinBalance: Number(wallet.coin_balance),
            bonusCoinBalance: Number(wallet.bonus_coin_balance),
          },
        },
      };
    }

    // Global exclusivity for time slots.
    const overlap = await findOverlappingPromotion(trx, 'TIME_SLOT', start.toISOString(), end.toISOString());
    if (overlap) throw new EconomyError('SLOT_UNAVAILABLE', 409, 'Selected slot is unavailable');

    const promotionId = randomUUID();
    const meta = { originalIdempotencyKey: idempotencyKey, note: note ?? null };

    await trx('promotions').insert({
      promotion_id: promotionId,
      user_id: userId,
      promotion_type: 'TIME_SLOT',
      status: 'ACTIVE',
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      coin_cost: coins.toString(),
      idempotency_key: idempotencyKey,
      metadata: meta,
      created_at: nowIso(),
    });

    const newBalances = await debitCoinsForPromotion(trx, userId, coins, idempotencyKey, promotionId, meta);
    return {
      kind: 'ok' as const,
      response: {
        promotionId,
        promotionType: 'TIME_SLOT',
        status: 'ACTIVE',
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        coinCost: Number(coins),
        newBalances,
      },
    };
  });
}

export async function bookPromoteSpotlight(userId: string, input: PromoteSpotlightBookInput) {
  userId = assertCanonicalSubUserId(userId, 'userId');
  const { db } = getEconomyInfra();
  const pricing = await getPromotePricing();
  const { idempotencyKey, startsAt, durationKey, note } = input;

  const minutes = durationKeyToMinutes(durationKey);
  const start = parseIsoDate(startsAt);
  const end = new Date(start);
  end.setMinutes(end.getMinutes() + minutes);

  const coins = BigInt(
    durationKey === '1h'
      ? pricing.spotlight.coins1h
      : durationKey === '24h'
        ? pricing.spotlight.coins24h
        : pricing.spotlight.coins7d
  );

  return await db.transaction(async (trx) => {
    const existing = await trx('promotions').where({ user_id: userId, idempotency_key: idempotencyKey }).first();
    if (existing) {
      const wallet = await ensureWalletRow(trx, userId);
      return {
        kind: 'replay' as const,
        response: {
          promotionId: existing.promotion_id,
          promotionType: existing.promotion_type,
          status: existing.status,
          startsAt: new Date(existing.starts_at).toISOString(),
          endsAt: new Date(existing.ends_at).toISOString(),
          coinCost: Number(existing.coin_cost),
          newBalances: {
            coinBalance: Number(wallet.coin_balance),
            bonusCoinBalance: Number(wallet.bonus_coin_balance),
          },
        },
      };
    }

    const overlap = await findOverlappingPromotion(trx, 'SPOTLIGHT', start.toISOString(), end.toISOString());
    if (overlap) throw new EconomyError('SLOT_UNAVAILABLE', 409, 'Spotlight slot is unavailable');

    const promotionId = randomUUID();
    const meta = { originalIdempotencyKey: idempotencyKey, durationKey, note: note ?? null };

    await trx('promotions').insert({
      promotion_id: promotionId,
      user_id: userId,
      promotion_type: 'SPOTLIGHT',
      status: 'ACTIVE',
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      coin_cost: coins.toString(),
      idempotency_key: idempotencyKey,
      metadata: meta,
      created_at: nowIso(),
    });

    const newBalances = await debitCoinsForPromotion(trx, userId, coins, idempotencyKey, promotionId, meta);
    return {
      kind: 'ok' as const,
      response: {
        promotionId,
        promotionType: 'SPOTLIGHT',
        status: 'ACTIVE',
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        coinCost: Number(coins),
        newBalances,
      },
    };
  });
}

async function ensureWalletRow(trx: Knex.Transaction, userId: string) {
  await trx('wallets')
    .insert({ user_id: userId })
    .onConflict('user_id')
    .ignore();

  const row = await trx('wallets').where({ user_id: userId }).first();
  if (!row) {
    throw new EconomyError('INTERNAL', 500, 'Failed to load wallet');
  }
  return row;
}

export async function getCatalog() {
  const { db } = getEconomyInfra();

  const [coinPacks, gifts] = await Promise.all([
    db('iap_products')
      .select({
        platform: 'platform',
        sku: 'sku',
        coinsGranted: 'coins_granted',
        enabled: 'enabled',
        metadata: 'metadata',
      })
      .orderBy('sku', 'asc'),
    db('gift_catalog')
      .select({
        giftId: 'gift_id',
        name: 'name',
        coinCost: 'coin_cost',
        enabled: 'enabled',
        rarity: 'rarity',
        minLevel: 'min_level',
        cooldownMs: 'cooldown_ms',
        assetJson: 'asset_json',
      })
      .orderBy('gift_id', 'asc'),
  ]);

  return { coinPacks, gifts };
}

export async function getWallet(userId: string) {
  userId = assertCanonicalSubUserId(userId, 'userId');
  const { db } = getEconomyInfra();

  const row = await db.transaction(async (trx) => {
    const wallet = await ensureWalletRow(trx, userId);
    return wallet;
  });

  return {
    coinBalance: Number(row.coin_balance),
    bonusCoinBalance: Number(row.bonus_coin_balance),
    gemAvailable: Number(row.gem_available),
    gemPending: Number(row.gem_pending),
  };
}

export async function verifyIapPurchaseAndGrant(userId: string, input: IapVerifyInput): Promise<{ kind: 'ok'; response: IapVerifySuccessResponse } | { kind: 'replay'; response: IapVerifySuccessResponse }> {
  userId = assertCanonicalSubUserId(userId, 'userId');
  const { db } = getEconomyInfra();

  return await db.transaction(async (trx) => {
    await trx('wallets').insert({ user_id: userId }).onConflict('user_id').ignore();

    const existingLedger = await trx('ledger_entries')
      .where({ user_id: userId, idempotency_key: input.idempotencyKey, entry_type: 'COIN_PURCHASE' })
      .first();

    if (existingLedger) {
      const walletReplay = await trx('wallets').where({ user_id: userId }).first();
      if (!walletReplay) throw new EconomyError('INTERNAL', 500, 'Wallet missing');

      const replayResponse: IapVerifySuccessResponse = {
        valid: true,
        duplicatePerfId: String(existingLedger.reference_id || ''),
        grantedCoins: Number(existingLedger.amount || 0),
        grantedGems: 0,
        wallet: {
          coinBalance: Number(walletReplay.coin_balance || 0),
          bonusCoinBalance: Number(walletReplay.bonus_coin_balance || 0),
          gemAvailable: Number(walletReplay.gem_available || 0),
          gemPending: Number(walletReplay.gem_pending || 0),
        },
      };

      return { kind: 'replay' as const, response: replayResponse };
    }

    const product = await trx('iap_products')
      .where({ platform: input.platform, sku: input.sku, enabled: true })
      .first();

    if (!product) {
      throw new EconomyError('NOT_FOUND', 404, 'IAP product not found or disabled');
    }

    const verifyResult = await verifyProviderPurchase(input);
    if (!verifyResult.verified) {
      throw new EconomyError('VERIFICATION_FAILED', 409, 'Purchase verification failed', verifyResult.detail || 'provider_rejected');
    }

    const wallet = await trx('wallets').where({ user_id: userId }).forUpdate().first();
    if (!wallet) throw new EconomyError('INTERNAL', 500, 'Wallet missing');

    const grantCoins = BigInt(product.coins_granted || 0);
    if (grantCoins <= 0n) {
      throw new EconomyError('INVALID_INPUT', 400, 'IAP product has zero coin grant');
    }

    const newCoinBalance = BigInt(wallet.coin_balance) + grantCoins;
    const purchaseRefId = verifyResult.providerOrderId || input.storeTransactionId;

    await trx('wallets')
      .where({ user_id: userId })
      .update({
        coin_balance: newCoinBalance.toString(),
        updated_at: trx.fn.now(),
      });

    await trx('ledger_entries').insert({
      ledger_id: randomUUID(),
      user_id: userId,
      entry_type: 'COIN_PURCHASE',
      currency: 'COIN',
      amount: grantCoins.toString(),
      status: 'POSTED',
      reference_type: 'IAP',
      reference_id: purchaseRefId,
      idempotency_key: input.idempotencyKey,
      metadata: {
        platform: input.platform,
        sku: input.sku,
        storeTransactionId: input.storeTransactionId,
        providerOrderId: verifyResult.providerOrderId,
      },
    });

    const updatedWallet = await trx('wallets').where({ user_id: userId }).first();
    if (!updatedWallet) throw new EconomyError('INTERNAL', 500, 'Wallet missing after purchase grant');

    const response: IapVerifySuccessResponse = {
      valid: true,
      duplicatePerfId: null,
      grantedCoins: Number(grantCoins),
      grantedGems: 0,
      wallet: {
        coinBalance: Number(updatedWallet.coin_balance || 0),
        bonusCoinBalance: Number(updatedWallet.bonus_coin_balance || 0),
        gemAvailable: Number(updatedWallet.gem_available || 0),
        gemPending: Number(updatedWallet.gem_pending || 0),
      },
    };

    return { kind: 'ok' as const, response };
  });
}

export async function getLedger(userId: string, rawCursor?: string, rawLimit?: number) {
  userId = assertCanonicalSubUserId(userId, 'userId');
  const { db } = getEconomyInfra();

  const limit = Math.max(1, Math.min(100, rawLimit ?? 20));
  const cursor = decodeCursor(rawCursor);

  const q = db('ledger_entries')
    .select({
      ledgerId: 'ledger_id',
      entryType: 'entry_type',
      currency: 'currency',
      amount: 'amount',
      referenceType: 'reference_type',
      referenceId: 'reference_id',
      createdAt: 'created_at',
      metadata: 'metadata',
    })
    .where({ user_id: userId })
    .orderBy([{ column: 'created_at', order: 'desc' }, { column: 'ledger_id', order: 'desc' }])
    .limit(limit);

  if (cursor) {
    q.andWhereRaw('(created_at, ledger_id) < (?, ?)', [cursor.createdAt, cursor.ledgerId]);
  }

  const rows = await q;

  const items = rows.map((r) => ({
    ledgerId: r.ledgerId,
    entryType: r.entryType,
    currency: r.currency,
    amount: Number(r.amount),
    referenceType: r.referenceType,
    referenceId: r.referenceId,
    createdAt: new Date(r.createdAt).toISOString(),
    metadata: r.metadata ?? {},
  }));

  const nextCursor = rows.length === limit
    ? encodeCursor({
      createdAt: new Date(rows[rows.length - 1].createdAt).toISOString(),
      ledgerId: rows[rows.length - 1].ledgerId,
    })
    : null;

  return { items, nextCursor };
}

export async function getStreamSummary(userId: string, streamId: string) {
  userId = assertCanonicalSubUserId(userId, 'userId');
  const { db } = getEconomyInfra();

  // Viewer spend (current user as sender)
  const viewerAgg = await db('gift_events')
    .where({ stream_id: streamId, sender_user_id: userId })
    .select(db.raw('COALESCE(SUM(coin_cost::numeric), 0) as coin_spent'))
    .count<{ gift_count: string }[]>({ gift_count: '*' });

  const viewerRow: any = Array.isArray(viewerAgg) ? viewerAgg[0] : viewerAgg;
  const viewer = {
    userId,
    coinSpent: Number(viewerRow?.coin_spent ?? 0),
    giftCount: Number(viewerRow?.gift_count ?? 0),
  };

  // Creator earnings (current user as creator)
  const creatorRow = await db('stream_earnings')
    .where({ stream_id: streamId, creator_user_id: userId })
    .first();

  const creator = creatorRow
    ? {
      userId,
      coinsReceived: Number(creatorRow.coins_received ?? 0),
      gemsEarned: Number(creatorRow.gems_earned ?? 0),
    }
    : null;

  return {
    streamId,
    viewer,
    creator: creator ?? undefined,
  };
}

export async function sendGift(senderUserId: string, input: { streamId: string; receiverUserId: string; giftId: string; quantity: number; idempotencyKey: string }) {
  senderUserId = assertCanonicalSubUserId(senderUserId, 'senderUserId');
  const { db } = getEconomyInfra();
  const env = getEconomyEnv();

  const { streamId, giftId, quantity, idempotencyKey } = input;
  const receiverUserId = assertCanonicalSubUserId(input.receiverUserId, 'receiverUserId');
  if (receiverUserId === senderUserId) {
    throw new EconomyError('RECEIVER_INVALID', 404, 'receiverUserId invalid');
  }

  const result = await db.transaction(async (trx) => {
    // 0) Idempotency replay: sender+key uniquely identifies the gift_event.
    const existing = await trx('gift_events')
      .where({ sender_user_id: senderUserId, idempotency_key: idempotencyKey })
      .first();

    const gift = await trx('gift_catalog').where({ gift_id: giftId }).first();
    if (!gift) {
      throw new EconomyError('GIFT_NOT_FOUND', 404, 'Gift not found');
    }
    if (gift.enabled !== true) {
      throw new EconomyError('GIFT_NOT_FOUND', 404, 'Gift disabled');
    }

    if (existing) {
      const qtyFromRow = Number(existing.quantity);
      const derivedQty = Number(existing.coin_cost) / Number(gift.coin_cost);
      const safeQty = Number.isFinite(qtyFromRow)
        ? Math.max(1, Math.floor(qtyFromRow))
        : Number.isFinite(derivedQty)
          ? Math.max(1, Math.floor(derivedQty))
          : 1;

      const senderWallet = await ensureWalletRow(trx, senderUserId);
      const receiverWallet = await ensureWalletRow(trx, receiverUserId);

      return {
        kind: 'replay' as const,
        response: {
          giftEventId: existing.gift_event_id,
          streamId: existing.stream_id,
          sequenceNo: Number(existing.sequence_no),
          coinSpent: Number(existing.coin_cost),
          gemsCredited: Number(existing.gems_credited),
          newBalances: {
            coinBalance: Number(senderWallet.coin_balance),
            bonusCoinBalance: Number(senderWallet.bonus_coin_balance),
          },
          receiver: {
            userId: receiverUserId,
            newGemPendingOrAvailable:
              env.PENDING_GEMS_HOLD_SECONDS > 0 ? Number(receiverWallet.gem_pending) : Number(receiverWallet.gem_available),
          },
          gift: {
            giftId,
            quantity: safeQty,
          },
          createdAt: new Date(existing.created_at).toISOString(),
        },
      };
    }

    // New value transfer is fail-closed on the shared Trust policy. Replays return
    // their original committed response without creating a second side effect.
    const trustDecision = await requireTrustPolicyInTransaction(trx, senderUserId, {
      targetUserId: receiverUserId,
      capability: 'transact',
    });

    // 1) Validate/lock wallets
    await trx.raw('SELECT 1');

    // sender wallet FOR UPDATE
    await trx('wallets').insert({ user_id: senderUserId }).onConflict('user_id').ignore();
    const senderWallet = await trx('wallets').where({ user_id: senderUserId }).forUpdate().first();
    if (!senderWallet) throw new EconomyError('INTERNAL', 500, 'Sender wallet missing');

    // receiver wallet FOR UPDATE
    await trx('wallets').insert({ user_id: receiverUserId }).onConflict('user_id').ignore();
    const receiverWallet = await trx('wallets').where({ user_id: receiverUserId }).forUpdate().first();
    if (!receiverWallet) throw new EconomyError('INTERNAL', 500, 'Receiver wallet missing');

    const unitCost = BigInt(gift.coin_cost);
    const qty = BigInt(quantity);
    const totalCostCoins = unitCost * qty;

    const bonus = BigInt(senderWallet.bonus_coin_balance);
    const paid = BigInt(senderWallet.coin_balance);

    const useBonus = bonus >= totalCostCoins ? totalCostCoins : bonus;
    const remaining = totalCostCoins - useBonus;
    const usePaid = remaining;

    if (paid < usePaid) {
      throw new EconomyError('INSUFFICIENT_FUNDS', 409, 'Insufficient funds');
    }

    const grossCoins = totalCostCoins;
    const platformFeeCoins = (grossCoins * BigInt(env.ECONOMY_TAKE_RATE_BPS)) / BigInt(10000);
    const creatorCoins = grossCoins - platformFeeCoins;
    const gemsCredited = (creatorCoins * BigInt(env.GEMS_PER_COIN_NUM)) / BigInt(env.GEMS_PER_COIN_DEN);

    // 6) stream counter
    await trx('stream_counters').insert({ stream_id: streamId }).onConflict('stream_id').ignore();
    const counter = await trx('stream_counters').where({ stream_id: streamId }).forUpdate().first();
    if (!counter) throw new EconomyError('INTERNAL', 500, 'Stream counter missing');

    const nextSeq = BigInt(counter.last_sequence) + BigInt(1);
    await trx('stream_counters')
      .where({ stream_id: streamId })
      .update({ last_sequence: nextSeq.toString(), updated_at: trx.fn.now() });

    // 7) insert gift_events
    const giftEventId = randomUUID();
    const createdAt = nowIso();

    await trx('gift_events').insert({
      gift_event_id: giftEventId,
      stream_id: streamId,
      sender_user_id: senderUserId,
      receiver_user_id: receiverUserId,
      gift_id: giftId,
      quantity: Number(quantity),
      coin_cost: totalCostCoins.toString(),
      gems_credited: gemsCredited.toString(),
      sequence_no: nextSeq.toString(),
      idempotency_key: idempotencyKey,
      created_at: createdAt,
    });

    // 8) ledger entries (note: unique per user_id, so suffix the idempotency key)
    const senderCoinEntryId = usePaid > 0n ? randomUUID() : null;
    const senderBonusEntryId = useBonus > 0n ? randomUUID() : null;
    const receiverEarnEntryId = randomUUID();

    const commonMeta = {
      originalIdempotencyKey: idempotencyKey,
      streamId,
      giftId,
      quantity: Number(quantity),
      totalCostCoins: totalCostCoins.toString(),
      platformFeeCoins: platformFeeCoins.toString(),
      creatorCoins: creatorCoins.toString(),
      trustDecision: {
        capability: trustDecision.capability,
        policyProfileVersion: trustDecision.policyProfileVersion,
        privacyVersion: trustDecision.privacyVersion,
      },
    };

    if (usePaid > 0n) {
      await trx('ledger_entries').insert({
        ledger_id: senderCoinEntryId,
        user_id: senderUserId,
        entry_type: 'GIFT_SPEND',
        currency: 'COIN',
        amount: (-usePaid).toString(),
        status: 'POSTED',
        reference_type: 'GIFT_EVENT',
        reference_id: giftEventId,
        idempotency_key: `${idempotencyKey}:COIN`,
        metadata: commonMeta,
      });
    }

    if (useBonus > 0n) {
      await trx('ledger_entries').insert({
        ledger_id: senderBonusEntryId,
        user_id: senderUserId,
        entry_type: 'GIFT_SPEND',
        currency: 'BONUS_COIN',
        amount: (-useBonus).toString(),
        status: 'POSTED',
        reference_type: 'GIFT_EVENT',
        reference_id: giftEventId,
        idempotency_key: `${idempotencyKey}:BONUS`,
        metadata: commonMeta,
      });
    }

    await trx('ledger_entries').insert({
      ledger_id: receiverEarnEntryId,
      user_id: receiverUserId,
      entry_type: 'GIFT_EARN',
      currency: 'GEM',
      amount: gemsCredited.toString(),
      status: env.PENDING_GEMS_HOLD_SECONDS > 0 ? 'PENDING' : 'POSTED',
      reference_type: 'GIFT_EVENT',
      reference_id: giftEventId,
      idempotency_key: `${idempotencyKey}:EARN`,
      metadata: commonMeta,
    });

    // 9) update wallets
    await trx('wallets')
      .where({ user_id: senderUserId })
      .update({
        coin_balance: (paid - usePaid).toString(),
        bonus_coin_balance: (bonus - useBonus).toString(),
        lifetime_spend_coins: (BigInt(senderWallet.lifetime_spend_coins) + totalCostCoins).toString(),
        updated_at: trx.fn.now(),
      });

    if (env.PENDING_GEMS_HOLD_SECONDS > 0) {
      await trx('wallets')
        .where({ user_id: receiverUserId })
        .update({
          gem_pending: (BigInt(receiverWallet.gem_pending) + gemsCredited).toString(),
          lifetime_earned_gems: (BigInt(receiverWallet.lifetime_earned_gems) + gemsCredited).toString(),
          updated_at: trx.fn.now(),
        });
    } else {
      await trx('wallets')
        .where({ user_id: receiverUserId })
        .update({
          gem_available: (BigInt(receiverWallet.gem_available) + gemsCredited).toString(),
          lifetime_earned_gems: (BigInt(receiverWallet.lifetime_earned_gems) + gemsCredited).toString(),
          updated_at: trx.fn.now(),
        });
    }

    // 10) update stream earnings
    await trx('stream_earnings')
      .insert({
        stream_id: streamId,
        creator_user_id: receiverUserId,
        coins_received: totalCostCoins.toString(),
        gems_earned: gemsCredited.toString(),
        updated_at: trx.fn.now(),
      })
      .onConflict(['stream_id', 'creator_user_id'])
      .merge({
        coins_received: trx.raw('stream_earnings.coins_received + ?', [totalCostCoins.toString()]),
        gems_earned: trx.raw('stream_earnings.gems_earned + ?', [gemsCredited.toString()]),
        updated_at: trx.fn.now(),
      });

    // Reload sender balances for response
    const senderAfter = await trx('wallets').where({ user_id: senderUserId }).first();
    const receiverAfter = await trx('wallets').where({ user_id: receiverUserId }).first();

    return {
      kind: 'success' as const,
      response: {
        giftEventId,
        streamId,
        sequenceNo: Number(nextSeq),
        coinSpent: Number(totalCostCoins),
        gemsCredited: Number(gemsCredited),
        newBalances: {
          coinBalance: Number(senderAfter?.coin_balance ?? 0),
          bonusCoinBalance: Number(senderAfter?.bonus_coin_balance ?? 0),
        },
        receiver: {
          userId: receiverUserId,
          newGemPendingOrAvailable:
            env.PENDING_GEMS_HOLD_SECONDS > 0
              ? Number(receiverAfter?.gem_pending ?? 0)
              : Number(receiverAfter?.gem_available ?? 0),
        },
        gift: {
          giftId,
          quantity,
        },
        createdAt,
      },
    };
  });

  // 5.2 After commit: publish socket event
  const payload = {
    streamId: result.response.streamId,
    sequenceNo: result.response.sequenceNo,
    giftEventId: result.response.giftEventId,
    giftId,
    quantity: result.response.gift.quantity,
    coinSpent: result.response.coinSpent,
    gemsCredited: result.response.gemsCredited,
    sender: { userId: senderUserId, handle: null, avatarUrl: null },
    receiver: { userId: receiverUserId, handle: null, avatarUrl: null },
    createdAt: result.response.createdAt,
  };
  emitGiftEvent(streamId, payload);

  return result;
}

export async function creditCoinsAdmin(actorUserId: string, input: AdminCreditCoinsInput) {
  actorUserId = assertCanonicalSubUserId(actorUserId, 'actorUserId');
  const { db } = getEconomyInfra();
  const createdAt = nowIso();

  const { coins, idempotencyKey, reason } = input;
  const targetUserId = assertCanonicalSubUserId(input.targetUserId, 'targetUserId');

  const out = await db.transaction(async (trx) => {
    // Idempotency replay: per-target user + idempotency key.
    const existing = await trx('ledger_entries')
      .select({
        ledgerId: 'ledger_id',
        amount: 'amount',
        createdAt: 'created_at',
      })
      .where({ user_id: targetUserId, entry_type: 'ADMIN_CREDIT', idempotency_key: idempotencyKey })
      .first();

    if (existing) {
      const wallet = await ensureWalletRow(trx, targetUserId);
      return {
        targetUserId,
        coinsCredited: Number(existing.amount),
        newBalance: Number(wallet.coin_balance),
        ledgerId: String(existing.ledgerId),
        createdAt: new Date(existing.createdAt).toISOString(),
        replay: true,
      };
    }

    // Lock wallet row.
    await trx('wallets').insert({ user_id: targetUserId }).onConflict('user_id').ignore();
    const wallet = await trx('wallets').where({ user_id: targetUserId }).forUpdate().first();
    if (!wallet) throw new EconomyError('INTERNAL', 500, 'Target wallet missing');

    const delta = BigInt(coins);
    const before = BigInt(wallet.coin_balance);
    const after = before + delta;
    const ledgerId = randomUUID();

    const metadata = {
      actorUserId,
      targetUserId,
      reason: typeof reason === 'string' ? reason : null,
      timestamp: createdAt,
    };

    await trx('ledger_entries').insert({
      ledger_id: ledgerId,
      user_id: targetUserId,
      entry_type: 'ADMIN_CREDIT',
      currency: 'COIN',
      amount: delta.toString(),
      status: 'POSTED',
      reference_type: 'ADMIN_CREDIT',
      reference_id: ledgerId,
      idempotency_key: idempotencyKey,
      metadata,
    });

    await trx('wallets')
      .where({ user_id: targetUserId })
      .update({
        coin_balance: after.toString(),
        updated_at: trx.fn.now(),
      });

    return {
      targetUserId,
      coinsCredited: Number(coins),
      newBalance: Number(after),
      ledgerId,
      createdAt,
      replay: false,
    };
  });

  return out;
}

export async function startLiveGame(hostUserId: string, input: { streamId: string; entryFeeCoins: number; idempotencyKey: string }) {
  hostUserId = assertCanonicalSubUserId(hostUserId, 'hostUserId');
  const { db } = getEconomyInfra();

  const { streamId, entryFeeCoins, idempotencyKey } = input;

  const result = await db.transaction(async (trx) => {
    const existing = await trx('live_games')
      .where({ host_user_id: hostUserId, idempotency_key: idempotencyKey })
      .first();
    if (existing) {
      return {
        kind: 'replay' as const,
        response: {
          gameId: existing.game_id,
          streamId,
          state: {
            gameId: existing.game_id,
            streamId,
            hostUserId: existing.host_user_id,
            status: existing.status,
            entryFeeCoins: Number(existing.entry_fee_coins),
            poolCoins: Number(existing.pool_coins),
          },
        },
      };
    }

    const active = await trx('live_games')
      .where({ stream_id: streamId })
      .whereIn('status', ['CREATED', 'RUNNING'])
      .first();
    if (active) throw new EconomyError('CONFLICT', 409, 'A live game is already active for this stream');

    const gameId = randomUUID();
    await trx('live_games').insert({
      game_id: gameId,
      stream_id: streamId,
      host_user_id: hostUserId,
      status: 'RUNNING',
      entry_fee_coins: BigInt(entryFeeCoins).toString(),
      pool_coins: '0',
      idempotency_key: idempotencyKey,
      created_at: nowIso(),
      started_at: nowIso(),
      updated_at: trx.fn.now(),
    });

    return {
      kind: 'success' as const,
      response: {
        gameId,
        streamId,
        state: {
          gameId,
          streamId,
          hostUserId,
          status: 'RUNNING',
          entryFeeCoins: Number(entryFeeCoins),
          poolCoins: 0,
        },
      },
    };
  });

  emitLiveGameEvent(streamId, { streamId, type: 'LIVE_GAME_STATE', state: result.response.state });
  return result;
}

export async function joinLiveGame(userId: string, input: { streamId: string; idempotencyKey: string }) {
  userId = assertCanonicalSubUserId(userId, 'userId');
  const { db } = getEconomyInfra();
  const { streamId, idempotencyKey } = input;

  const result = await db.transaction(async (trx) => {
    const existing = await trx('live_game_entries').where({ user_id: userId, idempotency_key: idempotencyKey }).first();
    if (existing) {
      const game = await trx('live_games').where({ game_id: existing.game_id }).first();
      return {
        kind: 'replay' as const,
        response: {
          gameId: existing.game_id,
          streamId,
          entryId: existing.entry_id,
          coinSpent: Number(BigInt(existing.coin_cost) + BigInt(existing.bonus_coin_cost)),
          state: game
            ? {
              gameId: game.game_id,
              streamId: game.stream_id,
              hostUserId: game.host_user_id,
              status: game.status,
              entryFeeCoins: Number(game.entry_fee_coins),
              poolCoins: Number(game.pool_coins),
            }
            : null,
        },
      };
    }

    const game = await trx('live_games')
      .where({ stream_id: streamId })
      .whereIn('status', ['RUNNING'])
      .orderBy('created_at', 'desc')
      .first();
    if (!game) throw new EconomyError('NOT_FOUND', 404, 'No running game for stream');

    const priorJoin = await trx('live_game_entries').where({ game_id: game.game_id, user_id: userId }).first();
    if (priorJoin) throw new EconomyError('CONFLICT', 409, 'Already joined');

    const fee = BigInt(game.entry_fee_coins);

    await trx('wallets').insert({ user_id: userId }).onConflict('user_id').ignore();
    const wallet = await trx('wallets').where({ user_id: userId }).forUpdate().first();
    if (!wallet) throw new EconomyError('INTERNAL', 500, 'Wallet missing');

    const bonus = BigInt(wallet.bonus_coin_balance);
    const paid = BigInt(wallet.coin_balance);

    const useBonus = bonus >= fee ? fee : bonus;
    const remaining = fee - useBonus;
    const usePaid = remaining;
    if (paid < usePaid) throw new EconomyError('INSUFFICIENT_FUNDS', 409, 'Insufficient funds');

    const entryId = randomUUID();
    await trx('live_game_entries').insert({
      entry_id: entryId,
      game_id: game.game_id,
      stream_id: streamId,
      user_id: userId,
      coin_cost: usePaid.toString(),
      bonus_coin_cost: useBonus.toString(),
      idempotency_key: idempotencyKey,
      created_at: nowIso(),
    });

    if (usePaid > 0n) {
      await trx('ledger_entries').insert({
        ledger_id: randomUUID(),
        user_id: userId,
        entry_type: 'LIVE_GAME_ENTRY',
        currency: 'COIN',
        amount: (-usePaid).toString(),
        status: 'POSTED',
        reference_type: 'LIVE_GAME',
        reference_id: game.game_id,
        idempotency_key: `${idempotencyKey}:COIN`,
        metadata: { streamId, gameId: game.game_id },
      });
    }
    if (useBonus > 0n) {
      await trx('ledger_entries').insert({
        ledger_id: randomUUID(),
        user_id: userId,
        entry_type: 'LIVE_GAME_ENTRY',
        currency: 'BONUS_COIN',
        amount: (-useBonus).toString(),
        status: 'POSTED',
        reference_type: 'LIVE_GAME',
        reference_id: game.game_id,
        idempotency_key: `${idempotencyKey}:BONUS`,
        metadata: { streamId, gameId: game.game_id },
      });
    }

    await trx('wallets')
      .where({ user_id: userId })
      .update({
        coin_balance: (paid - usePaid).toString(),
        bonus_coin_balance: (bonus - useBonus).toString(),
        lifetime_spend_coins: (BigInt(wallet.lifetime_spend_coins) + fee).toString(),
        updated_at: trx.fn.now(),
      });

    await trx('live_games').where({ game_id: game.game_id }).update({
      pool_coins: (BigInt(game.pool_coins) + fee).toString(),
      updated_at: trx.fn.now(),
    });

    const updated = await trx('live_games').where({ game_id: game.game_id }).first();

    return {
      kind: 'success' as const,
      response: {
        gameId: game.game_id,
        streamId,
        entryId,
        coinSpent: Number(usePaid),
        bonusCoinSpent: Number(useBonus),
        state: {
          gameId: game.game_id,
          streamId,
          hostUserId: game.host_user_id,
          status: updated.status,
          entryFeeCoins: Number(updated.entry_fee_coins),
          poolCoins: Number(updated.pool_coins),
        },
      },
    };
  });

  emitLiveGameEvent(streamId, { streamId, type: 'LIVE_GAME_STATE', state: result.response.state });
  return result;
}

export async function finalizeLiveGame(hostUserId: string, input: { streamId: string; winners?: string[]; idempotencyKey: string }) {
  hostUserId = assertCanonicalSubUserId(hostUserId, 'hostUserId');
  const { db } = getEconomyInfra();
  const { streamId, idempotencyKey } = input;
  const winners = (input.winners || []).map((winnerId, idx) => assertCanonicalSubUserId(winnerId, `winners[${idx}]`));

  const mode = String(process.env.LIVE_GAMES_PAYOUT_MODE || 'SAFE').toUpperCase();
  const payoutCurrency = mode === 'CASHOUT' ? 'COIN' : 'BONUS_COIN';

  const result = await db.transaction(async (trx) => {
    const settled = await trx('live_game_settlements').where({ host_user_id: hostUserId, idempotency_key: idempotencyKey }).first();
    if (settled) {
      return { kind: 'replay' as const, response: settled.response_json };
    }

    const game = await trx('live_games')
      .where({ stream_id: streamId, host_user_id: hostUserId })
      .whereIn('status', ['RUNNING'])
      .orderBy('created_at', 'desc')
      .first();
    if (!game) throw new EconomyError('NOT_FOUND', 404, 'No running game for stream');

    const pool = BigInt(game.pool_coins);
    const hostShare = (pool * 30n) / 100n;
    const winnerShareTotal = pool - hostShare;

    const entrantsRows = await trx('live_game_entries')
      .where({ game_id: game.game_id })
      .select('user_id')
      .orderBy('created_at', 'asc')
      .orderBy('user_id', 'asc');
    const entrants = entrantsRows.map((r: any) => r.user_id).filter(Boolean);
    const entrantSet = new Set(entrants);

    const requestedWinners = Array.from(new Set((winners || []).filter(Boolean)));
    const selectedWinners = requestedWinners.length > 0 ? requestedWinners.filter((id) => entrantSet.has(id)) : entrants;
    if (selectedWinners.length === 0) throw new EconomyError('INVALID_INPUT', 400, 'No eligible winners');

    const perWinnerBase = winnerShareTotal / BigInt(selectedWinners.length);
    const remainder = winnerShareTotal - perWinnerBase * BigInt(selectedWinners.length);
    const winnerPayouts: Array<{ userId: string; amount: bigint }> = [];

    // credit host
    await trx('wallets').insert({ user_id: hostUserId }).onConflict('user_id').ignore();
    const hostWallet = await trx('wallets').where({ user_id: hostUserId }).forUpdate().first();
    if (!hostWallet) throw new EconomyError('INTERNAL', 500, 'Host wallet missing');

    const hostBeforeCoin = BigInt(hostWallet.coin_balance);
    const hostBeforeBonus = BigInt(hostWallet.bonus_coin_balance);
    const hostAfterCoin = payoutCurrency === 'COIN' ? hostBeforeCoin + hostShare : hostBeforeCoin;
    const hostAfterBonus = payoutCurrency === 'BONUS_COIN' ? hostBeforeBonus + hostShare : hostBeforeBonus;

    await trx('wallets').where({ user_id: hostUserId }).update({
      coin_balance: hostAfterCoin.toString(),
      bonus_coin_balance: hostAfterBonus.toString(),
      updated_at: trx.fn.now(),
    });

    await trx('ledger_entries').insert({
      ledger_id: randomUUID(),
      user_id: hostUserId,
      entry_type: 'LIVE_GAME_PAYOUT',
      currency: payoutCurrency,
      amount: hostShare.toString(),
      status: 'POSTED',
      reference_type: 'LIVE_GAME',
      reference_id: game.game_id,
      idempotency_key: `${idempotencyKey}:HOST`,
      metadata: { streamId, gameId: game.game_id, role: 'host', mode },
    });

    // credit winners
    for (let i = 0; i < selectedWinners.length; i++) {
      const winnerId = selectedWinners[i];
      const payout = perWinnerBase + (BigInt(i) < remainder ? 1n : 0n);
      if (payout === 0n) continue;

      winnerPayouts.push({ userId: winnerId, amount: payout });

      await trx('wallets').insert({ user_id: winnerId }).onConflict('user_id').ignore();
      const w = await trx('wallets').where({ user_id: winnerId }).forUpdate().first();
      if (!w) continue;

      const beforeCoin = BigInt(w.coin_balance);
      const beforeBonus = BigInt(w.bonus_coin_balance);
      const afterCoin = payoutCurrency === 'COIN' ? beforeCoin + payout : beforeCoin;
      const afterBonus = payoutCurrency === 'BONUS_COIN' ? beforeBonus + payout : beforeBonus;
      await trx('wallets').where({ user_id: winnerId }).update({
        coin_balance: afterCoin.toString(),
        bonus_coin_balance: afterBonus.toString(),
        updated_at: trx.fn.now(),
      });
      await trx('ledger_entries').insert({
        ledger_id: randomUUID(),
        user_id: winnerId,
        entry_type: 'LIVE_GAME_PAYOUT',
        currency: payoutCurrency,
        amount: payout.toString(),
        status: 'POSTED',
        reference_type: 'LIVE_GAME',
        reference_id: game.game_id,
        idempotency_key: `${idempotencyKey}:WIN:${winnerId}`,
        metadata: { streamId, gameId: game.game_id, role: 'winner', mode },
      });
    }

    // mark ended
    await trx('live_games').where({ game_id: game.game_id }).update({
      status: 'ENDED',
      ended_at: nowIso(),
      updated_at: trx.fn.now(),
    });

    const response = {
      gameId: game.game_id,
      streamId,
      status: 'ENDED',
      entryFeeCoins: Number(game.entry_fee_coins),
      poolCoins: Number(pool),
      payoutCurrency,
      host: { userId: hostUserId, amount: Number(hostShare) },
      winners: winnerPayouts.map((p) => ({ userId: p.userId, amount: Number(p.amount) })),
    };

    await trx('live_game_settlements').insert({
      settlement_id: randomUUID(),
      game_id: game.game_id,
      stream_id: streamId,
      host_user_id: hostUserId,
      idempotency_key: idempotencyKey,
      response_json: response,
      created_at: nowIso(),
    });

    return { kind: 'success' as const, response };
  });

  emitLiveGameEvent(streamId, {
    streamId,
    type: 'LIVE_GAME_STATE',
    state: {
      gameId: result.response.gameId,
      streamId,
      hostUserId,
      status: 'ENDED',
      entryFeeCoins: result.response.entryFeeCoins,
      poolCoins: result.response.poolCoins,
    },
  });
  return result;
}
