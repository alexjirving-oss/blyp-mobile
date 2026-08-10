import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import type { Knex } from 'knex';
import { getEconomyInfra } from './infra';
import { getEconomyEnv } from '../config/economyEnv';
import { EconomyError } from './economyErrors';
import { decodeCursor, encodeCursor } from './cursor';
import { findIapCatalogEntry } from './iapCatalog';
import { emitGiftEvent, emitLiveGameEvent, emitGameEvent } from '../realtime/realtimeBus';
import { applyReviveForReceiver, getRoom } from '../games/artillery/gameRoomService';
import { applyCheerForReceiver } from '../games/marble/marbleRoomService';
import {
  enqueuePostGiftNotification,
  getUserTeamForEarnings,
  incrementPostGiftTotals,
  mirrorTeamEarnings,
  setPostReachBoostedFs,
} from '../admin/firestoreAdmin';
import { getSessionById } from '../live/liveSessionStore';
import { listGuests } from '../live/guestSlotStore';
import { logger } from '../config/logger';
import type { AdminCreditCoinsInput, IapVerifyInput, PromoteBattleInput, PromoteMethodBookInput, PromoteSpotlightBookInput, PromoteTimeSlotBookInput } from './economySchemas';
import {
  getBattleArenaBySession,
  mirrorBattleById,
  scoreBattleGiftInTransaction,
} from '../battles/battleRegistryService';
import {
  isWithdrawLaunchTestUser,
  LAUNCH_TEST_GEM_CREDIT_CAP,
} from './withdrawLaunchTest';

// Team gift bonus rates, expressed in micro-gems per base gem so all accrual is
// done in integers (1 gem = 1_000_000 micro). Member earns +10% of base gems,
// the team leader earns 5% of the member's base gems.
const MICRO_PER_GEM = 1_000_000n;
const MEMBER_BONUS_MICRO_PER_GEM = 100_000n; // 10% => 0.10 gem per base gem
const LEADER_BONUS_MICRO_PER_GEM = 50_000n; //  5% => 0.05 gem per base gem

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

type PromoteCatalogMethod = {
  methodId: string;
  type: string;
  title: string;
  subtitle: string;
  category: string;
  packages: Array<{ id: string; label: string; hours: number; coins: number }>;
};

type PromotePricing = {
  battle: { coins: number; durationHours: number };
  timeSlot: { per30MinCoins: number };
  spotlight: { coins1h: number; coins24h: number; coins7d: number };
  catalog: PromoteCatalogMethod[];
  packages: Record<string, Array<{ id: string; label: string; hours: number; coins: number }>>;
  limits: { maxActivePerUser: number; searchGlobalCap: number };
};

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
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

  // If Google reports the token as already consumed, it must have been redeemed
  // through a path other than this ledger (our own grants short-circuit to a
  // replay before ever calling Google). Reject to prevent re-granting.
  if (Number(purchaseJson.consumptionState) === 1) {
    return { verified: false, providerOrderId: purchaseJson.orderId || null, detail: 'already_consumed' };
  }

  const providerOrderId = String(purchaseJson.orderId || '').trim() || String(input.storeTransactionId || '').trim() || null;
  return { verified: true, providerOrderId, detail: 'google_verified' };
}

async function verifyAppleAppStorePurchase(input: IapVerifyInput): Promise<ProviderVerifyResult> {
  const env = getEconomyEnv();
  const bundleId = String(env.APPLE_BUNDLE_ID || '').trim();
  const issuerId = String(env.APPLE_ISSUER_ID || '').trim();
  const keyId = String(env.APPLE_KEY_ID || '').trim();
  const privateKey = String(env.APPLE_PRIVATE_KEY_P8 || '').trim().replace(/\\n/g, '\n');

  if (!bundleId || !issuerId || !keyId || !privateKey) {
    throw new EconomyError(
      'PROVIDER_ERROR',
      503,
      'Apple IAP credentials not configured (APPLE_BUNDLE_ID / APPLE_ISSUER_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY_P8)'
    );
  }

  const transactionId = String(input.storeTransactionId || input.purchaseToken || '').trim();
  if (!transactionId) {
    return { verified: false, providerOrderId: null, detail: 'missing_transaction_id' };
  }

  // App Store Server API JWT (ES256).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const jwt = require('jsonwebtoken') as typeof import('jsonwebtoken');
  const now = Math.floor(Date.now() / 1000);
  const token = jwt.sign(
    {
      iss: issuerId,
      iat: now,
      exp: now + 20 * 60,
      aud: 'appstoreconnect-v1',
      bid: bundleId,
    },
    privateKey,
    { algorithm: 'ES256', keyid: keyId }
  );

  const url = `https://api.storekit.itunes.apple.com/inApps/v1/transactions/${encodeURIComponent(transactionId)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  // Sandbox fallback
  const finalRes =
    res.status === 404 || res.status === 401
      ? await fetch(
          `https://api.storekit-sandbox.itunes.apple.com/inApps/v1/transactions/${encodeURIComponent(transactionId)}`,
          { method: 'GET', headers: { Authorization: `Bearer ${token}` } }
        )
      : res;

  if (finalRes.status === 404) {
    return { verified: false, providerOrderId: null, detail: 'purchase_not_found' };
  }

  const body = (await finalRes.json().catch(() => null)) as { signedTransactionInfo?: string } | null;
  if (!finalRes.ok || !body?.signedTransactionInfo) {
    throw new EconomyError('PROVIDER_ERROR', 503, 'Apple transaction lookup failed', body ?? `HTTP_${finalRes.status}`);
  }

  // Decode JWS payload (middle segment) without full cert chain verify —
  // transport was authenticated to Apple; productId must still match SKU.
  const parts = String(body.signedTransactionInfo).split('.');
  if (parts.length < 2) {
    return { verified: false, providerOrderId: null, detail: 'bad_signed_transaction' };
  }
  const payloadJson = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  let payload: { productId?: string; transactionId?: string; bundleId?: string; revocationDate?: number } = {};
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    return { verified: false, providerOrderId: null, detail: 'bad_transaction_payload' };
  }

  if (payload.revocationDate) {
    return { verified: false, providerOrderId: payload.transactionId || null, detail: 'revoked' };
  }
  if (payload.bundleId && payload.bundleId !== bundleId) {
    return { verified: false, providerOrderId: payload.transactionId || null, detail: 'bundle_mismatch' };
  }
  if (String(payload.productId || '') !== String(input.sku || '')) {
    return { verified: false, providerOrderId: payload.transactionId || null, detail: 'sku_mismatch' };
  }

  return {
    verified: true,
    providerOrderId: String(payload.transactionId || transactionId),
    detail: 'apple_verified',
  };
}

async function verifyProviderPurchase(input: IapVerifyInput): Promise<ProviderVerifyResult> {
  if (input.platform === 'ANDROID') {
    return verifyGooglePlayPurchase(input);
  }
  if (input.platform === 'IOS') {
    return verifyAppleAppStorePurchase(input);
  }

  throw new EconomyError('PROVIDER_ERROR', 503, `Unsupported IAP platform: ${input.platform}`);
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

  const feedBoost = clampInt(Number((env as any).PROMOTE_FEED_BOOST_COINS ?? 150), 0, 1_000_000);
  const profileCoins = clampInt(Number((env as any).PROMOTE_PROFILE_COINS ?? 200), 0, 1_000_000);
  const liveCoins = clampInt(Number((env as any).PROMOTE_LIVE_COINS ?? 300), 0, 1_000_000);
  const searchCoins = clampInt(Number((env as any).PROMOTE_SEARCH_COINS ?? 350), 0, 1_000_000);
  const followersCoins = clampInt(Number((env as any).PROMOTE_FOLLOWERS_COINS ?? 120), 0, 1_000_000);
  const teamCoins = clampInt(Number((env as any).PROMOTE_TEAM_COINS ?? 220), 0, 1_000_000);
  const crossSportCoins = clampInt(Number((env as any).PROMOTE_CROSS_SPORT_COINS ?? 260), 0, 1_000_000);
  const rematchCoins = clampInt(Number((env as any).PROMOTE_REMATCH_COINS ?? 180), 0, 1_000_000);
  const maxActivePerUser = clampInt(Number((env as any).PROMOTE_MAX_ACTIVE_PER_USER ?? 5), 1, 50);
  const searchGlobalCap = clampInt(Number((env as any).PROMOTE_SEARCH_GLOBAL_CAP ?? 8), 1, 100);

  const catalog: PromoteCatalogMethod[] = [
    {
      methodId: 'spotlight',
      type: 'SPOTLIGHT',
      title: 'Spotlight',
      subtitle: 'Exclusive homepage spotlight window',
      category: 'exclusive',
      packages: [
        { id: '1h', label: '1 hour', hours: 1, coins: spot1h },
        { id: '24h', label: '24 hours', hours: 24, coins: spot24h },
        { id: '7d', label: '7 days', hours: 168, coins: spot7d },
      ],
    },
    {
      methodId: 'time_slot',
      type: 'TIME_SLOT',
      title: 'Prime Time Slot',
      subtitle: 'Book an exclusive discovery slot',
      category: 'exclusive',
      packages: [
        { id: '30m', label: '30 min', hours: 0.5, coins: timeSlot30 },
        { id: '60m', label: '60 min', hours: 1, coins: timeSlot30 * 2 },
        { id: '120m', label: '2 hours', hours: 2, coins: timeSlot30 * 4 },
      ],
    },
    {
      methodId: 'battle',
      type: 'BATTLE',
      title: 'Battle Boost+',
      subtitle: 'Amplify an upcoming or live battle',
      category: 'battle',
      packages: [{ id: '24h', label: '24 hours', hours: battleDurationHours, coins: battleCoins }],
    },
    {
      methodId: 'feed_boost',
      type: 'FEED_BOOST',
      title: 'Feed Boost',
      subtitle: 'Charter boost for one post in For You',
      category: 'feed',
      packages: [
        { id: '6h', label: '6 hours', hours: 6, coins: feedBoost },
        { id: '24h', label: '24 hours', hours: 24, coins: Math.round(feedBoost * 2.6) },
        { id: '72h', label: '3 days', hours: 72, coins: Math.round(feedBoost * 6) },
      ],
    },
    {
      methodId: 'profile',
      type: 'PROFILE',
      title: 'Profile Amplify',
      subtitle: 'Surface your profile to interested fans',
      category: 'profile',
      packages: [
        { id: '12h', label: '12 hours', hours: 12, coins: profileCoins },
        { id: '48h', label: '48 hours', hours: 48, coins: Math.round(profileCoins * 2.75) },
      ],
    },
    {
      methodId: 'live',
      type: 'LIVE',
      title: 'Live Amplify',
      subtitle: 'Push viewers toward your live session',
      category: 'live',
      packages: [
        { id: '2h', label: '2 hours', hours: 2, coins: liveCoins },
        { id: '6h', label: '6 hours', hours: 6, coins: Math.round(liveCoins * 2.3) },
      ],
    },
    {
      methodId: 'search',
      type: 'SEARCH_SPONSORED',
      title: 'Search Sponsored',
      subtitle: 'One labelled sponsored slot in search',
      category: 'search',
      packages: [
        { id: '12h', label: '12 hours', hours: 12, coins: searchCoins },
        { id: '48h', label: '48 hours', hours: 48, coins: Math.round(searchCoins * 2.5) },
      ],
    },
    {
      methodId: 'followers',
      type: 'FOLLOWERS_NOTIFY',
      title: 'Followers Notify',
      subtitle: 'Nudge followers about new content',
      category: 'audience',
      packages: [
        { id: '6h', label: '6 hours', hours: 6, coins: followersCoins },
        { id: '24h', label: '24 hours', hours: 24, coins: Math.round(followersCoins * 2.3) },
      ],
    },
    {
      methodId: 'team',
      type: 'TEAM_SHOUTOUT',
      title: 'Team Shoutout',
      subtitle: 'Reach fans of your team affinity',
      category: 'audience',
      packages: [
        { id: '12h', label: '12 hours', hours: 12, coins: teamCoins },
        { id: '48h', label: '48 hours', hours: 48, coins: Math.round(teamCoins * 2.7) },
      ],
    },
    {
      methodId: 'cross_sport',
      type: 'CROSS_SPORT',
      title: 'Cross-Sport Push',
      subtitle: 'Cross into adjacent sport audiences',
      category: 'audience',
      packages: [
        { id: '12h', label: '12 hours', hours: 12, coins: crossSportCoins },
        { id: '48h', label: '48 hours', hours: 48, coins: Math.round(crossSportCoins * 2.7) },
      ],
    },
    {
      methodId: 'rematch',
      type: 'REMATCH',
      title: 'Rematch Promo',
      subtitle: 'Promote a rematch or sequel battle',
      category: 'battle',
      packages: [
        { id: '24h', label: '24 hours', hours: 24, coins: rematchCoins },
        { id: '72h', label: '3 days', hours: 72, coins: Math.round(rematchCoins * 2.5) },
      ],
    },
  ];

  const packages: Record<string, Array<{ id: string; label: string; hours: number; coins: number }>> = {};
  for (const m of catalog) packages[m.methodId] = m.packages;

  return {
    battle: { coins: battleCoins, durationHours: battleDurationHours },
    timeSlot: { per30MinCoins: timeSlot30 },
    spotlight: { coins1h: spot1h, coins24h: spot24h, coins7d: spot7d },
    catalog,
    packages,
    limits: { maxActivePerUser, searchGlobalCap },
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

/**
 * Currently-valid promotions for discovery / For You ranking.
 * Window: status ACTIVE and starts_at <= now < ends_at.
 */
export async function getActivePromotions(limit = 200) {
  const { db } = getEconomyInfra();
  const cap = clampInt(Number(limit) || 200, 1, 500);
  const now = nowIso();

  const rows = await db('promotions')
    .select({
      promotionId: 'promotion_id',
      userId: 'user_id',
      promotionType: 'promotion_type',
      status: 'status',
      startsAt: 'starts_at',
      endsAt: 'ends_at',
      metadata: 'metadata',
    })
    .where({ status: 'ACTIVE' })
    .andWhere('starts_at', '<=', now)
    .andWhere('ends_at', '>', now)
    .orderBy('ends_at', 'asc')
    .limit(cap);

  return {
    asOf: now,
    promotions: (rows || []).map((r: any) => {
      const meta = r?.metadata && typeof r.metadata === 'object' ? r.metadata : {};
      const battleRef =
        meta?.battleRef != null && String(meta.battleRef).trim()
          ? String(meta.battleRef).trim()
          : null;
      const postRef =
        meta?.postRef != null && String(meta.postRef).trim() ? String(meta.postRef).trim() : null;
      const streamRef =
        meta?.streamRef != null && String(meta.streamRef).trim() ? String(meta.streamRef).trim() : null;
      const methodId =
        meta?.methodId != null && String(meta.methodId).trim() ? String(meta.methodId).trim() : null;
      const note = meta?.note != null && String(meta.note).trim() ? String(meta.note).trim() : null;
      const targeting =
        meta?.targeting && typeof meta.targeting === 'object' ? meta.targeting : null;
      return {
        promotionId: String(r.promotionId),
        userId: String(r.userId),
        promotionType: String(r.promotionType || '').toUpperCase(),
        startsAt: new Date(r.startsAt).toISOString(),
        endsAt: new Date(r.endsAt).toISOString(),
        battleRef,
        postRef,
        streamRef,
        methodId,
        note,
        targeting,
      };
    }),
  };
}

export async function purchasePromoteBattle(userId: string, input: PromoteBattleInput) {
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


const METHOD_TYPE: Record<string, string> = {
  spotlight: 'SPOTLIGHT',
  time_slot: 'TIME_SLOT',
  battle: 'BATTLE',
  feed_boost: 'FEED_BOOST',
  profile: 'PROFILE',
  live: 'LIVE',
  search: 'SEARCH_SPONSORED',
  followers: 'FOLLOWERS_NOTIFY',
  team: 'TEAM_SHOUTOUT',
  cross_sport: 'CROSS_SPORT',
  rematch: 'REMATCH',
};

async function assertPromoteFairCaps(
  trx: Knex.Transaction,
  userId: string,
  promotionType: string,
  limits: { maxActivePerUser: number; searchGlobalCap: number },
) {
  const now = nowIso();
  const activeForUser = await trx('promotions')
    .where({ user_id: userId, status: 'ACTIVE' })
    .andWhere('ends_at', '>', now)
    .count<{ count: string }>({ count: '*' })
    .first();
  const activeCount = Number((activeForUser as any)?.count || 0);
  if (activeCount >= limits.maxActivePerUser) {
    throw new EconomyError('PROMOTE_CAP', 409, 'Too many active promotions');
  }

  const sameType = await trx('promotions')
    .where({ user_id: userId, status: 'ACTIVE', promotion_type: promotionType })
    .andWhere('ends_at', '>', now)
    .first();
  if (sameType) {
    throw new EconomyError('PROMOTE_TYPE_ACTIVE', 409, 'You already have an active campaign of this type');
  }

  if (promotionType === 'SEARCH_SPONSORED') {
    const searchActive = await trx('promotions')
      .where({ status: 'ACTIVE', promotion_type: 'SEARCH_SPONSORED' })
      .andWhere('starts_at', '<=', now)
      .andWhere('ends_at', '>', now)
      .count<{ count: string }>({ count: '*' })
      .first();
    const searchCount = Number((searchActive as any)?.count || 0);
    if (searchCount >= limits.searchGlobalCap) {
      throw new EconomyError('SEARCH_CAP', 409, 'Search sponsored slots are full');
    }
  }
}

function pickPackage(
  pricing: PromotePricing,
  methodId: string,
  packageId?: string | null,
): { id: string; label: string; hours: number; coins: number } {
  const list = pricing.packages?.[methodId] || pricing.catalog.find((m) => m.methodId === methodId)?.packages || [];
  if (!list.length) throw new EconomyError('INVALID_INPUT', 400, 'Unknown promote method');
  const id = String(packageId || list[0].id);
  const found = list.find((p) => p.id === id) || list[0];
  return found;
}

export async function purchasePromoteMethod(userId: string, input: PromoteMethodBookInput) {
  const methodId = String(input.methodId || '').trim();
  const promotionType = METHOD_TYPE[methodId];
  if (!promotionType) throw new EconomyError('INVALID_INPUT', 400, 'Unknown methodId');

  // Route legacy exclusive / battle bookings through existing helpers when possible.
  if (methodId === 'spotlight') {
    const durationKey = (input.durationKey || (input.packageId as '1h' | '24h' | '7d') || '1h') as '1h' | '24h' | '7d';
    if (!input.startsAt) throw new EconomyError('INVALID_INPUT', 400, 'startsAt required for spotlight');
    return bookPromoteSpotlight(userId, {
      idempotencyKey: input.idempotencyKey,
      startsAt: input.startsAt,
      durationKey,
      note: input.note,
    });
  }
  if (methodId === 'time_slot') {
    if (!input.startsAt) throw new EconomyError('INVALID_INPUT', 400, 'startsAt required for time_slot');
    const pkg = (await getPromotePricing()).packages.time_slot?.find((p) => p.id === input.packageId);
    const durationMinutes =
      input.durationMinutes ||
      (pkg ? Math.max(15, Math.round(pkg.hours * 60)) : 30);
    return bookPromoteTimeSlot(userId, {
      idempotencyKey: input.idempotencyKey,
      startsAt: input.startsAt,
      durationMinutes,
      note: input.note,
    });
  }
  if (methodId === 'battle') {
    return purchasePromoteBattle(userId, {
      idempotencyKey: input.idempotencyKey,
      battleRef: input.battleRef,
    });
  }

  const { db } = getEconomyInfra();
  const pricing = await getPromotePricing();
  const pkg = pickPackage(pricing, methodId, input.packageId);
  const coins = BigInt(pkg.coins);
  const { idempotencyKey } = input;

  if (methodId === 'feed_boost' && !String(input.postRef || '').trim()) {
    throw new EconomyError('INVALID_INPUT', 400, 'postRef required for feed_boost');
  }
  if ((methodId === 'rematch') && !String(input.battleRef || '').trim()) {
    throw new EconomyError('INVALID_INPUT', 400, 'battleRef required for rematch');
  }

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

    await assertPromoteFairCaps(trx, userId, promotionType, pricing.limits);

    const start = new Date();
    const end = new Date(start);
    end.setMinutes(end.getMinutes() + Math.max(15, Math.round(pkg.hours * 60)));

    const promotionId = randomUUID();
    const meta: Record<string, any> = {
      originalIdempotencyKey: idempotencyKey,
      methodId,
      packageId: pkg.id,
      note: input.note ?? null,
      battleRef: input.battleRef ?? null,
      postRef: input.postRef ?? null,
      streamRef: input.streamRef ?? null,
      targeting: input.targeting ?? null,
    };

    await trx('promotions').insert({
      promotion_id: promotionId,
      user_id: userId,
      promotion_type: promotionType,
      status: 'ACTIVE',
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      coin_cost: coins.toString(),
      idempotency_key: idempotencyKey,
      metadata: meta,
      created_at: nowIso(),
    });

    const newBalances = await debitCoinsForPromotion(trx, userId, coins, idempotencyKey, promotionId, meta);

    // Best-effort Firestore reach.boosted for FEED_BOOST (outside strict trx semantics).
    if (promotionType === 'FEED_BOOST' && meta.postRef) {
      try {
        await setPostReachBoostedFs(String(meta.postRef), true, {
          boostEndsAt: end.toISOString(),
          boostPromotionId: promotionId,
          actorUserId: userId,
        });
      } catch (e: any) {
        logger.warn({ err: e?.message || String(e), postRef: meta.postRef }, '[promote] setPostReachBoostedFs failed');
      }
    }

    return {
      kind: 'ok' as const,
      response: {
        promotionId,
        promotionType,
        status: 'ACTIVE',
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        coinCost: Number(coins),
        newBalances,
      },
    };
  });
}

export async function getMyPromotions(userId: string, limit = 50) {
  const { db } = getEconomyInfra();
  const cap = clampInt(Number(limit) || 50, 1, 200);
  const now = nowIso();

  const rows = await db('promotions')
    .select({
      promotionId: 'promotion_id',
      userId: 'user_id',
      promotionType: 'promotion_type',
      status: 'status',
      startsAt: 'starts_at',
      endsAt: 'ends_at',
      coinCost: 'coin_cost',
      metadata: 'metadata',
      createdAt: 'created_at',
    })
    .where({ user_id: userId })
    .orderBy('created_at', 'desc')
    .limit(cap);

  const mapRow = (r: any) => {
    const meta = r?.metadata && typeof r.metadata === 'object' ? r.metadata : {};
    const endsAt = new Date(r.endsAt).toISOString();
    const startsAt = new Date(r.startsAt).toISOString();
    const stillActive =
      String(r.status || '').toUpperCase() === 'ACTIVE' && new Date(endsAt).getTime() > Date.now();
    return {
      promotionId: String(r.promotionId),
      userId: String(r.userId),
      promotionType: String(r.promotionType || '').toUpperCase(),
      status: stillActive ? 'ACTIVE' : String(r.status || 'ENDED').toUpperCase() === 'ACTIVE' ? 'ENDED' : String(r.status || 'ENDED').toUpperCase(),
      startsAt,
      endsAt,
      coinCost: Number(r.coinCost || 0),
      battleRef: meta?.battleRef != null && String(meta.battleRef).trim() ? String(meta.battleRef).trim() : null,
      postRef: meta?.postRef != null && String(meta.postRef).trim() ? String(meta.postRef).trim() : null,
      streamRef: meta?.streamRef != null && String(meta.streamRef).trim() ? String(meta.streamRef).trim() : null,
      methodId: meta?.methodId != null && String(meta.methodId).trim() ? String(meta.methodId).trim() : null,
      note: meta?.note != null && String(meta.note).trim() ? String(meta.note).trim() : null,
      targeting: meta?.targeting && typeof meta.targeting === 'object' ? meta.targeting : null,
      createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : startsAt,
    };
  };

  const mapped = (rows || []).map(mapRow);
  const active = mapped.filter((p: any) => p.status === 'ACTIVE');
  const history = mapped.filter((p: any) => p.status !== 'ACTIVE');

  return { asOf: now, active, history };
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
  const { db } = getEconomyInfra();
  const env = getEconomyEnv();

  const row = await db.transaction(async (trx) => {
    const wallet = await ensureWalletRow(trx, userId);

    // Lazily settle matured pending gems: any PENDING gem earning older than the
    // hold window is promoted to available. This runs on read so creators see
    // their earnings unlock without needing a separate cron/worker.
    const holdSeconds = Number(env.PENDING_GEMS_HOLD_SECONDS || 0);
    if (holdSeconds > 0 && BigInt(wallet.gem_pending || 0) > 0n) {
      const matured = await trx('ledger_entries')
        .where({ user_id: userId, currency: 'GEM', status: 'PENDING' })
        .andWhereRaw(`created_at <= NOW() - INTERVAL '${holdSeconds} seconds'`)
        .select('ledger_id', 'amount');

      if (matured.length > 0) {
        let sum = 0n;
        for (const e of matured) sum += BigInt(e.amount);
        // Never release more than is actually pending (defensive clamp).
        const pending = BigInt(wallet.gem_pending || 0);
        const release = sum > pending ? pending : sum;
        if (release > 0n) {
          await trx('ledger_entries')
            .whereIn('ledger_id', matured.map((e: any) => e.ledger_id))
            .update({ status: 'POSTED' });
          await trx('wallets')
            .where({ user_id: userId })
            .update({
              gem_pending: (pending - release).toString(),
              gem_available: (BigInt(wallet.gem_available || 0) + release).toString(),
              updated_at: trx.fn.now(),
            });
          wallet.gem_pending = (pending - release).toString();
          wallet.gem_available = (BigInt(wallet.gem_available || 0) + release).toString();
        }
      }
    }

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
  const { db } = getEconomyInfra();

  return await db.transaction(async (trx) => {
    await trx('wallets').insert({ user_id: userId }).onConflict('user_id').ignore();

    // Dedupe defense-in-depth:
    // 1) Per-user idempotency key (client retries of the same attempt).
    // 2) GLOBAL dedupe on the Google purchase token/order id, so the SAME store
    //    purchase can never grant twice — whether replayed with a fresh
    //    idempotency key or submitted by a different user (token reuse attack).
    const purchaseToken = String(input.purchaseToken || '').trim();

    if (purchaseToken) {
      const existingByToken = await trx('ledger_entries')
        .where({ entry_type: 'COIN_PURCHASE' })
        .whereRaw("metadata->>'purchaseToken' = ?", [purchaseToken])
        .first();

      if (existingByToken) {
        // Token already redeemed by a DIFFERENT user => reject as fraud/reuse.
        if (String(existingByToken.user_id) !== String(userId)) {
          throw new EconomyError(
            'VERIFICATION_FAILED',
            409,
            'Purchase token already redeemed',
            'purchase_token_reused',
          );
        }

        // Same user re-submitting the same token => idempotent replay.
        const walletReplay = await trx('wallets').where({ user_id: userId }).first();
        if (!walletReplay) throw new EconomyError('INTERNAL', 500, 'Wallet missing');

        return {
          kind: 'replay' as const,
          response: {
            valid: true,
            duplicatePerfId: String(existingByToken.reference_id || ''),
            grantedCoins: Number(existingByToken.amount || 0),
            grantedGems: 0,
            wallet: {
              coinBalance: Number(walletReplay.coin_balance || 0),
              bonusCoinBalance: Number(walletReplay.bonus_coin_balance || 0),
              gemAvailable: Number(walletReplay.gem_available || 0),
              gemPending: Number(walletReplay.gem_pending || 0),
            },
          },
        };
      }
    }

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

    let product = await trx('iap_products')
      .where({ platform: input.platform, sku: input.sku, enabled: true })
      .first();

    // Authoritative grant is always the in-code catalog (website BASE, no bonus).
    // Converge stale iap_products rows that still hold legacy bonus totals.
    const catalogEntry = findIapCatalogEntry(input.platform, input.sku);
    if (!catalogEntry) {
      if (!product) {
        throw new EconomyError('NOT_FOUND', 404, 'IAP product not found or disabled');
      }
    } else {
      await trx('iap_products')
        .insert({
          platform: catalogEntry.platform,
          sku: catalogEntry.sku,
          coins_granted: catalogEntry.coinsGranted,
          enabled: true,
          metadata: trx.raw('?::jsonb', [
            JSON.stringify({ label: catalogEntry.label, priceUsd: catalogEntry.priceUsd, source: 'catalog' }),
          ]),
        })
        .onConflict(['platform', 'sku'])
        .merge({ coins_granted: catalogEntry.coinsGranted, enabled: true });

      product = await trx('iap_products')
        .where({ platform: input.platform, sku: input.sku, enabled: true })
        .first();

      if (!product) {
        throw new EconomyError('NOT_FOUND', 404, 'IAP product not found or disabled');
      }
      // Never trust a stale DB grant over the locked base catalog.
      product = { ...product, coins_granted: catalogEntry.coinsGranted };
    }

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
        // Persist the store purchase token so it can be globally deduped on
        // subsequent verify calls (see the token pre-check above).
        ...(purchaseToken ? { purchaseToken } : {}),
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

/**
 * Credit subscription coins into the SAME Postgres wallet the app reads and
 * spends from. This replaces the legacy Firestore ledger credit so that
 * Plus+Coins monthly coins are actually visible/spendable (previously they were
 * written to a separate Firestore wallet and stranded).
 *
 * Idempotent per (user, idempotencyKey): the caller passes a period-scoped key
 * (e.g. `sub-coins:<uid>:<YYYY-MM>`) so a billing period can only ever grant
 * once, even across activate + RTDN renewal retries. The global UNIQUE index on
 * idempotency_key is the race-proof backstop.
 */
export async function creditSubscriptionCoins(
  userId: string,
  input: { coins: number; idempotencyKey: string; sku?: string | null; source?: string | null },
): Promise<{
  kind: 'ok' | 'replay';
  granted: number;
  wallet: { coinBalance: number; bonusCoinBalance: number; gemAvailable: number; gemPending: number };
}> {
  const { db } = getEconomyInfra();

  const coins = Math.floor(Number(input.coins || 0));
  if (!Number.isFinite(coins) || coins <= 0) {
    throw new EconomyError('INVALID_INPUT', 400, 'coins must be a positive integer');
  }
  const idempotencyKey = String(input.idempotencyKey || '').trim();
  if (!idempotencyKey) {
    throw new EconomyError('INVALID_INPUT', 400, 'idempotencyKey required');
  }

  const readWallet = async (q: any) => {
    const w = await q('wallets').where({ user_id: userId }).first();
    return {
      coinBalance: Number(w?.coin_balance || 0),
      bonusCoinBalance: Number(w?.bonus_coin_balance || 0),
      gemAvailable: Number(w?.gem_available || 0),
      gemPending: Number(w?.gem_pending || 0),
    };
  };

  try {
    return await db.transaction(async (trx) => {
      await trx('wallets').insert({ user_id: userId }).onConflict('user_id').ignore();

      // Per-(user,key) replay guard (the UNIQUE index is the race-proof backstop).
      const existing = await trx('ledger_entries')
        .where({ user_id: userId, idempotency_key: idempotencyKey, entry_type: 'SUBSCRIPTION_COINS' })
        .first();
      if (existing) {
        return { kind: 'replay' as const, granted: 0, wallet: await readWallet(trx) };
      }

      const wallet = await trx('wallets').where({ user_id: userId }).forUpdate().first();
      if (!wallet) throw new EconomyError('INTERNAL', 500, 'Wallet missing');

      const grant = BigInt(coins);
      const newCoinBalance = BigInt(wallet.coin_balance) + grant;

      await trx('wallets')
        .where({ user_id: userId })
        .update({ coin_balance: newCoinBalance.toString(), updated_at: trx.fn.now() });

      await trx('ledger_entries').insert({
        ledger_id: randomUUID(),
        user_id: userId,
        entry_type: 'SUBSCRIPTION_COINS',
        currency: 'COIN',
        amount: grant.toString(),
        status: 'POSTED',
        reference_type: 'SUBSCRIPTION',
        reference_id: input.sku || null,
        idempotency_key: idempotencyKey,
        metadata: { source: input.source || 'subscription', sku: input.sku || null },
      });

      return { kind: 'ok' as const, granted: coins, wallet: await readWallet(trx) };
    });
  } catch (e: any) {
    // Lost the idempotency race (another activate/RTDN credited the same period
    // first): the UNIQUE(idempotency_key) constraint rejected the duplicate. The
    // grant already happened, so report the current wallet as a replay.
    if (e?.code === '23505') {
      return { kind: 'replay', granted: 0, wallet: await readWallet(db) };
    }
    throw e;
  }
}

/**
 * Account-deletion purge (GDPR/CCPA). Removes the user's personal economy data:
 * wallet balance, subscription/entitlement rows, and per-user activity rows.
 *
 * The immutable financial ledger (ledger_entries, gift_events, stream/team
 * earnings) is intentionally RETAINED for legal/accounting/fraud-prevention —
 * consistent with the deletion policy ("we may retain limited information when
 * required for legal, security, fraud-prevention, or compliance purposes").
 * Anonymizing the user_id in those tables is a follow-up.
 *
 * Idempotent: re-running simply deletes nothing more. Never throws on a missing
 * table (deployments may not have every optional table).
 */
export async function purgeUserData(userId: string): Promise<{ deleted: Record<string, number> }> {
  const { db } = getEconomyInfra();
  const uid = String(userId || '').trim();
  if (!uid) throw new EconomyError('INVALID_INPUT', 400, 'userId required');

  // Personal/deletable tables keyed by user_id. Financial ledgers are excluded.
  const tables = [
    'wallets',
    'user_subscriptions',
    'matchday_entitlements',
    'matchday_predictions',
    'live_game_entries',
  ];

  const deleted: Record<string, number> = {};
  for (const table of tables) {
    try {
      const n = await db(table).where({ user_id: uid }).del();
      deleted[table] = Number(n || 0);
    } catch (e: any) {
      // Missing table or no user_id column on this deployment — skip safely.
      deleted[table] = -1;
    }
  }
  return { deleted };
}

export async function getLedger(userId: string, rawCursor?: string, rawLimit?: number) {
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

/**
 * Live-room gift recipient guard. If `streamId` resolves to an active LIVE
 * session, the recipient MUST be the host or a guest on that stage — the server
 * no longer trusts the client to constrain recipients. Contexts with no live
 * session (e.g. feed-post gifts, or ended/cleaned-up streams) are intentionally
 * left unchanged so non-live gifting keeps working. Viewer gifting will extend
 * the allowed set behind a feature flag in a later phase.
 */
async function assertValidLiveRecipient(streamId: string, receiverUserId: string): Promise<void> {
  const session = await getSessionById(streamId);
  if (!session || session.status !== 'LIVE') return; // not a live-room context
  // Viewer-gifting toggle: when enabled, any user may be gifted within an active
  // live room (we still confirmed it IS a live session above). Safe while
  // withdrawals are OFF — gems have no cash-out. Re-gate behind anti-fraud
  // (velocity/graph) before withdrawals are ever enabled.
  const allowViewerGifting = /^(1|true|yes|on)$/i.test(String(process.env.ALLOW_VIEWER_GIFTING || '').trim());
  if (allowViewerGifting) return;
  if (receiverUserId === session.hostUserId) return;
  // Battle side B is an equal publisher, not a guest. Resolve both fixed sides
  // from the canonical registry rather than relying on an unrelated game room.
  const battle = await getBattleArenaBySession(streamId).catch(() => null);
  if (
    battle &&
    (receiverUserId === battle.sideA.userId || receiverUserId === battle.sideB.userId)
  ) {
    return;
  }
  const guests = await listGuests(streamId);
  const onStage = guests.some(
    (g) => g.userId === receiverUserId && (g.state === 'INVITED' || g.state === 'LIVE')
  );
  if (onStage) return;
  // Battle participants (e.g. the opponent) aren't "guests" but are equal
  // co-hosts on the shared stage. If an artillery match is running, treat its
  // registered players as valid recipients so revive-gifts reach either creator.
  if (/^(1|true|yes|on)$/i.test(String(process.env.LIVE_ARTILLERY_ENABLED || '').trim())) {
    try {
      const room = await getRoom(streamId);
      if (room && (room.players['0'] === receiverUserId || room.players['1'] === receiverUserId)) {
        return;
      }
    } catch {
      // fall through to the default rejection
    }
  }
  throw new EconomyError('RECEIVER_INVALID', 403, 'Recipient is not on this live stage');
}

export async function sendGift(senderUserId: string, input: {
  streamId: string;
  receiverUserId: string;
  giftId: string;
  quantity: number;
  idempotencyKey: string;
  battleId?: string;
  battleSide?: 'A' | 'B';
}) {
  const { db } = getEconomyInfra();
  const env = getEconomyEnv();

  const {
    streamId,
    receiverUserId,
    giftId,
    quantity,
    idempotencyKey,
    battleId,
    battleSide,
  } = input;
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
        notificationGiftName: String(gift.name || giftId).trim() || giftId,
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

    // Server-authoritative recipient check for live rooms. Runs only for NEW
    // gifts (idempotent replays returned above), so a guest leaving mid-stream
    // never breaks a legitimate retry. Non-live contexts (posts) are unaffected.
    await assertValidLiveRecipient(streamId, receiverUserId);

    // 1) Validate/lock wallets
    await trx.raw('SELECT 1');

    // Ensure both wallet rows exist, then lock them in a deterministic
    // (sorted-by-id) order. Locking in a consistent order prevents deadlocks
    // when two users send gifts to each other concurrently.
    await trx('wallets').insert({ user_id: senderUserId }).onConflict('user_id').ignore();
    await trx('wallets').insert({ user_id: receiverUserId }).onConflict('user_id').ignore();

    const [firstId, secondId] = [senderUserId, receiverUserId].sort();
    const lockedFirst = await trx('wallets').where({ user_id: firstId }).forUpdate().first();
    const lockedSecond = firstId === secondId
      ? lockedFirst
      : await trx('wallets').where({ user_id: secondId }).forUpdate().first();

    const senderWallet = senderUserId === firstId ? lockedFirst : lockedSecond;
    const receiverWallet = receiverUserId === firstId ? lockedFirst : lockedSecond;
    if (!senderWallet) throw new EconomyError('INTERNAL', 500, 'Sender wallet missing');
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

    const battleScore = await scoreBattleGiftInTransaction(trx, {
      streamId,
      battleId,
      side: battleSide,
      receiverUserId,
      giftEventId,
      scoreCoins: totalCostCoins,
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
      notificationGiftName: String(gift.name || giftId).trim() || giftId,
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
        battle: battleScore
          ? {
              battleId: battleScore.battleId,
              side: battleScore.side,
              score: battleScore.score,
              applied: battleScore.applied,
            }
          : undefined,
        createdAt,
      },
    };
  });

  // 5.2 After commit: publish socket event
  const battleResult = (result.response as any)?.battle;
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
    ...(battleResult
      ? {
          battleId: battleResult.battleId,
          battleSide: battleResult.side,
          battleScore: battleResult.score,
        }
      : {}),
  };
  emitGiftEvent(streamId, payload);
  if (battleResult?.battleId) {
    await mirrorBattleById(String(battleResult.battleId));
  }

  // Revive-gift hook: when the artillery battle-stage game is live and a viewer
  // sends the `revive` gift to a creator on stage, apply a revive to that
  // creator's team and rebroadcast the authoritative state. Best-effort and
  // only for new sends (never on idempotent replays) so it can't double-revive.
  if (
    result.kind === 'success' &&
    giftId === 'revive' &&
    /^(1|true|yes|on)$/i.test(String(process.env.LIVE_ARTILLERY_ENABLED || '').trim())
  ) {
    try {
      const room = await applyReviveForReceiver({ sessionId: streamId, receiverUserId });
      if (room) {
        emitGameEvent(streamId, {
          sessionId: room.sessionId,
          type: 'STATE',
          version: room.version,
          battleId: room.battleId,
          players: room.players,
          state: room.state,
          revive: { receiverUserId, senderUserId },
        });
      }
    } catch (e: any) {
      logger.warn({ err: e?.message || String(e) }, '[artillery] revive-gift hook failed (non-fatal)');
    }
  }

  // Cheer Burst → marble race capped boost (per marble / heat). Best-effort.
  // applyCheerForReceiver emits marble_game_event BOOST itself.
  if (
    result.kind === 'success' &&
    giftId === 'cheer_burst' &&
    /^(1|true|yes|on)$/i.test(String(process.env.LIVE_MARBLE_RACE_ENABLED || '').trim())
  ) {
    try {
      await applyCheerForReceiver({
        sessionId: streamId,
        receiverUserId,
        senderUserId,
      });
    } catch (e: any) {
      logger.warn({ err: e?.message || String(e) }, '[marble] cheer_burst hook failed (non-fatal)');
    }
  }

  // Team bonus: if the recipient is in a team, mint an extra 10% of the gems
  // they just earned to them, and 5% to their team leader. Done after the gift
  // commit so it never blocks or fails the core gift. Skipped on idempotent
  // replays (no new gems were earned).
  if (result.kind === 'success' && result.response.gemsCredited > 0) {
    try {
      await applyTeamGiftBonus({
        giftEventId: result.response.giftEventId,
        memberUserId: receiverUserId,
        baseGems: result.response.gemsCredited,
        coins: result.response.coinSpent,
      });
    } catch (e: any) {
      logger.error(
        { err: e?.message || String(e), giftEventId: result.response.giftEventId },
        '[economy] applyTeamGiftBonus failed (non-fatal)'
      );
    }
  }

  // Feed/post gifts: mirror coin totals onto the Firestore post so the For You
  // UI can show gifted coins next to likes. Skip when streamId is an active
  // LIVE session (those already use stream_earnings + live summary).
  if (result.kind === 'success' && result.response.coinSpent > 0) {
    try {
      const session = await getSessionById(streamId);
      const isLiveRoom = !!session && session.status === 'LIVE';
      if (!isLiveRoom) {
        await incrementPostGiftTotals(streamId, result.response.coinSpent, result.response.gift.quantity || 1);
      }
    } catch (e: any) {
      logger.warn(
        { err: e?.message || String(e), streamId, giftEventId: result.response.giftEventId },
        '[economy] incrementPostGiftTotals failed (non-fatal)',
      );
    }
  }

  // Feed/video gift notification. Live and battle gifts share /gift/send, so the
  // Firestore helper only queues when posts/{streamId} exists and its canonical
  // owner matches the credited receiver. It uses giftEventId as the durable
  // dedupe key and also runs on idempotent replays to repair a failed first
  // post-commit enqueue without ever double-pushing.
  if (!battleId && result.response.coinSpent > 0) {
    try {
      const notification = await enqueuePostGiftNotification({
        giftEventId: result.response.giftEventId,
        senderUserId,
        receiverUserId,
        postId: streamId,
        giftId,
        giftName: result.notificationGiftName,
        quantity: result.response.gift.quantity,
        coinSpent: result.response.coinSpent,
      });
      if (!notification.ok) {
        logger.warn(
          {
            detail: notification.detail,
            giftEventId: result.response.giftEventId,
            postId: streamId,
          },
          '[economy] post gift notification enqueue failed (non-fatal)',
        );
      }
    } catch (e: any) {
      logger.warn(
        { err: e?.message || String(e), giftEventId: result.response.giftEventId, postId: streamId },
        '[economy] post gift notification enqueue failed (non-fatal)',
      );
    }
  }

  return result;
}

/**
 * Pay out the team gift bonus for a single gift the member just received.
 *  - member earns an extra 10% of base gems
 *  - team leader earns 5% of base gems (skipped if the member IS the leader)
 * Accrual is tracked in micro-gems and only whole gems are credited to wallets,
 * with the fractional remainder carried forward (so 5% of 50 = 2.5 isn't lost —
 * the next gift tops it up). Idempotent per giftEventId via the unique ledger key.
 */
async function applyTeamGiftBonus(input: {
  giftEventId: string;
  memberUserId: string;
  baseGems: number;
  coins: number;
}): Promise<void> {
  const { giftEventId, memberUserId } = input;
  const baseGems = BigInt(Math.max(0, Math.floor(input.baseGems)));
  if (baseGems <= 0n) return;

  const team = await getUserTeamForEarnings(memberUserId);
  if (!team || !team.teamId) return;
  const leaderUserId = String(team.leaderId || '');
  const leaderIsMember = !leaderUserId || leaderUserId === memberUserId;

  const { db } = getEconomyInfra();
  const env = getEconomyEnv();
  const gemColumn = env.PENDING_GEMS_HOLD_SECONDS > 0 ? 'gem_pending' : 'gem_available';

  const deltas = await db.transaction(async (trx) => {
    // Idempotency: if we already paid this gift's bonus, do nothing.
    const already = await trx('ledger_entries')
      .where({ idempotency_key: `team-bonus:${giftEventId}:member` })
      .first();
    if (already) return null;

    // Upsert the accrual row and add this gift's micro-gems.
    await trx('team_earnings')
      .insert({
        team_id: team.teamId,
        member_user_id: memberUserId,
        leader_user_id: leaderUserId || memberUserId,
        coins_received: BigInt(Math.max(0, Math.floor(input.coins))).toString(),
        base_gems: baseGems.toString(),
        member_bonus_micro: (baseGems * MEMBER_BONUS_MICRO_PER_GEM).toString(),
        leader_bonus_micro: (leaderIsMember ? 0n : baseGems * LEADER_BONUS_MICRO_PER_GEM).toString(),
      })
      .onConflict(['team_id', 'member_user_id'])
      .merge({
        leader_user_id: leaderUserId || memberUserId,
        coins_received: trx.raw('team_earnings.coins_received + ?', [BigInt(Math.max(0, Math.floor(input.coins))).toString()]),
        base_gems: trx.raw('team_earnings.base_gems + ?', [baseGems.toString()]),
        member_bonus_micro: trx.raw('team_earnings.member_bonus_micro + ?', [(baseGems * MEMBER_BONUS_MICRO_PER_GEM).toString()]),
        leader_bonus_micro: trx.raw('team_earnings.leader_bonus_micro + ?', [(leaderIsMember ? 0n : baseGems * LEADER_BONUS_MICRO_PER_GEM).toString()]),
        updated_at: trx.fn.now(),
      });

    const row = await trx('team_earnings')
      .where({ team_id: team.teamId, member_user_id: memberUserId })
      .forUpdate()
      .first();
    if (!row) return null;

    const memberMicro = BigInt(row.member_bonus_micro);
    const memberPaid = BigInt(row.member_bonus_paid);
    const memberWholeOwed = memberMicro / MICRO_PER_GEM;
    const memberCredit = memberWholeOwed > memberPaid ? memberWholeOwed - memberPaid : 0n;

    const leaderMicro = BigInt(row.leader_bonus_micro);
    const leaderPaid = BigInt(row.leader_bonus_paid);
    const leaderWholeOwed = leaderMicro / MICRO_PER_GEM;
    const leaderCredit = !leaderIsMember && leaderWholeOwed > leaderPaid ? leaderWholeOwed - leaderPaid : 0n;

    // Credit the member's wallet (whole gems) + ledger.
    if (memberCredit > 0n) {
      await trx('wallets').insert({ user_id: memberUserId }).onConflict('user_id').ignore();
      await trx('wallets')
        .where({ user_id: memberUserId })
        .update({
          [gemColumn]: trx.raw(`${gemColumn} + ?`, [memberCredit.toString()]),
          lifetime_earned_gems: trx.raw('lifetime_earned_gems + ?', [memberCredit.toString()]),
          updated_at: trx.fn.now(),
        });
      await trx('ledger_entries').insert({
        ledger_id: randomUUID(),
        user_id: memberUserId,
        entry_type: 'TEAM_BONUS_EARN',
        currency: 'GEM',
        amount: memberCredit.toString(),
        status: env.PENDING_GEMS_HOLD_SECONDS > 0 ? 'PENDING' : 'POSTED',
        reference_type: 'GIFT_EVENT',
        reference_id: giftEventId,
        idempotency_key: `team-bonus:${giftEventId}:member`,
        metadata: { teamId: team.teamId, role: 'member', baseGems: baseGems.toString() },
      });
    } else {
      // Still record the marker so this gift is treated as processed (idempotent).
      await trx('ledger_entries').insert({
        ledger_id: randomUUID(),
        user_id: memberUserId,
        entry_type: 'TEAM_BONUS_EARN',
        currency: 'GEM',
        amount: '0',
        status: 'POSTED',
        reference_type: 'GIFT_EVENT',
        reference_id: giftEventId,
        idempotency_key: `team-bonus:${giftEventId}:member`,
        metadata: { teamId: team.teamId, role: 'member', baseGems: baseGems.toString(), carried: true },
      });
    }

    // Credit the leader's wallet (whole gems) + ledger.
    if (leaderCredit > 0n && leaderUserId) {
      await trx('wallets').insert({ user_id: leaderUserId }).onConflict('user_id').ignore();
      await trx('wallets')
        .where({ user_id: leaderUserId })
        .update({
          [gemColumn]: trx.raw(`${gemColumn} + ?`, [leaderCredit.toString()]),
          lifetime_earned_gems: trx.raw('lifetime_earned_gems + ?', [leaderCredit.toString()]),
          updated_at: trx.fn.now(),
        });
      await trx('ledger_entries').insert({
        ledger_id: randomUUID(),
        user_id: leaderUserId,
        entry_type: 'TEAM_LEADER_BONUS',
        currency: 'GEM',
        amount: leaderCredit.toString(),
        status: env.PENDING_GEMS_HOLD_SECONDS > 0 ? 'PENDING' : 'POSTED',
        reference_type: 'GIFT_EVENT',
        reference_id: giftEventId,
        idempotency_key: `team-bonus:${giftEventId}:leader`,
        metadata: { teamId: team.teamId, role: 'leader', fromMember: memberUserId, baseGems: baseGems.toString() },
      });
    }

    // Apply the credited whole gems to the paid counters.
    await trx('team_earnings')
      .where({ team_id: team.teamId, member_user_id: memberUserId })
      .update({
        member_bonus_paid: (memberPaid + memberCredit).toString(),
        leader_bonus_paid: (leaderPaid + leaderCredit).toString(),
        updated_at: trx.fn.now(),
      });

    return {
      // For the Firestore mirror we report the PRECISE earned amounts (including
      // fractions) so the dashboard reflects true earnings, not just whole gems.
      baseGemsDelta: Number(baseGems),
      memberBonusDelta: Number(baseGems) * 0.1,
      leaderBonusDelta: leaderIsMember ? 0 : Number(baseGems) * 0.05,
      coinsDelta: Math.max(0, Math.floor(input.coins)),
      leaderUserId,
    };
  });

  if (!deltas) return;

  // Mirror to Firestore for the leader dashboard (best-effort, outside the txn).
  await mirrorTeamEarnings({
    teamId: team.teamId,
    memberUserId,
    leaderUserId: deltas.leaderUserId,
    baseGemsDelta: deltas.baseGemsDelta,
    memberBonusDelta: deltas.memberBonusDelta,
    leaderBonusDelta: deltas.leaderBonusDelta,
    coinsDelta: deltas.coinsDelta,
  });
}

/**
 * Admin goodwill / support credits land in BONUS_COIN (spendable, never
 * cashable). Purchased COIN and creator GEM remain separate; admin credits
 * must never be indistinguishable from IAP-funded balances or withdrawable gems.
 */
export async function creditCoinsAdmin(actorUserId: string, input: AdminCreditCoinsInput) {
  const { db } = getEconomyInfra();
  const createdAt = nowIso();

  const { targetUserId, coins, idempotencyKey, reason } = input;

  const out = await db.transaction(async (trx) => {
    // Idempotency replay: per-target user + idempotency key.
    const existing = await trx('ledger_entries')
      .select({
        ledgerId: 'ledger_id',
        amount: 'amount',
        createdAt: 'created_at',
        currency: 'currency',
      })
      .where({ user_id: targetUserId, entry_type: 'ADMIN_CREDIT', idempotency_key: idempotencyKey })
      .first();

    if (existing) {
      const wallet = await ensureWalletRow(trx, targetUserId);
      const creditedCurrency = String(existing.currency || 'BONUS_COIN');
      return {
        targetUserId,
        coinsCredited: Number(existing.amount),
        currency: creditedCurrency,
        nonWithdrawable: true,
        newBalance:
          creditedCurrency === 'COIN'
            ? Number(wallet.coin_balance)
            : Number(wallet.bonus_coin_balance),
        coinBalance: Number(wallet.coin_balance),
        bonusCoinBalance: Number(wallet.bonus_coin_balance),
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
    const beforeBonus = BigInt(wallet.bonus_coin_balance || 0);
    const afterBonus = beforeBonus + delta;
    const ledgerId = randomUUID();

    const metadata = {
      actorUserId,
      targetUserId,
      reason: typeof reason === 'string' ? reason : null,
      timestamp: createdAt,
      nonWithdrawable: true,
      source: 'admin_credit',
    };

    await trx('ledger_entries').insert({
      ledger_id: ledgerId,
      user_id: targetUserId,
      entry_type: 'ADMIN_CREDIT',
      currency: 'BONUS_COIN',
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
        bonus_coin_balance: afterBonus.toString(),
        updated_at: trx.fn.now(),
      });

    return {
      targetUserId,
      coinsCredited: Number(coins),
      currency: 'BONUS_COIN',
      nonWithdrawable: true,
      newBalance: Number(afterBonus),
      coinBalance: Number(wallet.coin_balance),
      bonusCoinBalance: Number(afterBonus),
      ledgerId,
      createdAt,
      replay: false,
    };
  });

  return out;
}

/**
 * Owner / launch-test gem credit → gem_available (audited ledger).
 * Bypasses the normal 7d pending hold so Owner can prove cash-out today.
 * Never use this for normal user gift settlement.
 */
export async function creditGemsAdminLaunchTest(
  actorUserId: string,
  input: {
    targetUserId: string;
    gems: number;
    idempotencyKey: string;
    reason?: string | null;
  },
) {
  const { db } = getEconomyInfra();
  const createdAt = nowIso();
  const { targetUserId, gems, idempotencyKey, reason } = input;
  const gemsInt = Math.floor(Number(gems));
  if (!Number.isFinite(gemsInt) || gemsInt < 1) {
    throw new EconomyError('INVALID_INPUT', 400, 'gems invalid');
  }
  if (gemsInt > LAUNCH_TEST_GEM_CREDIT_CAP) {
    throw new EconomyError('INVALID_INPUT', 400, `gems exceed launch-test cap ${LAUNCH_TEST_GEM_CREDIT_CAP}`);
  }
  if (!isWithdrawLaunchTestUser(targetUserId)) {
    throw new EconomyError(
      'WITHDRAWAL_DENIED',
      403,
      'Target is not a launch-test / Owner allowlisted user',
    );
  }

  const out = await db.transaction(async (trx) => {
    const existing = await trx('ledger_entries')
      .select({
        ledgerId: 'ledger_id',
        amount: 'amount',
        createdAt: 'created_at',
      })
      .where({
        user_id: targetUserId,
        entry_type: 'ADMIN_GEM_CREDIT',
        idempotency_key: idempotencyKey,
      })
      .first();

    if (existing) {
      const wallet = await ensureWalletRow(trx, targetUserId);
      return {
        targetUserId,
        gemsCredited: Number(existing.amount),
        currency: 'GEM' as const,
        withdrawable: true,
        gemAvailable: Number(wallet.gem_available),
        gemPending: Number(wallet.gem_pending),
        ledgerId: String(existing.ledgerId),
        createdAt: new Date(existing.createdAt).toISOString(),
        replay: true,
        launchTest: true,
      };
    }

    await trx('wallets').insert({ user_id: targetUserId }).onConflict('user_id').ignore();
    const wallet = await trx('wallets').where({ user_id: targetUserId }).forUpdate().first();
    if (!wallet) throw new EconomyError('INTERNAL', 500, 'Target wallet missing');

    const delta = BigInt(gemsInt);
    const before = BigInt(wallet.gem_available || 0);
    const after = before + delta;
    const ledgerId = randomUUID();

    const metadata = {
      actorUserId,
      targetUserId,
      reason: typeof reason === 'string' ? reason : null,
      timestamp: createdAt,
      source: 'admin_gem_credit_launch_test',
      bypassPendingHold: true,
      launchTest: true,
    };

    await trx('ledger_entries').insert({
      ledger_id: ledgerId,
      user_id: targetUserId,
      entry_type: 'ADMIN_GEM_CREDIT',
      currency: 'GEM',
      amount: delta.toString(),
      status: 'POSTED',
      reference_type: 'ADMIN_GEM_CREDIT',
      reference_id: ledgerId,
      idempotency_key: idempotencyKey,
      metadata,
    });

    await trx('wallets')
      .where({ user_id: targetUserId })
      .update({
        gem_available: after.toString(),
        lifetime_earned_gems: trx.raw('lifetime_earned_gems + ?', [delta.toString()]),
        updated_at: trx.fn.now(),
      });

    return {
      targetUserId,
      gemsCredited: gemsInt,
      currency: 'GEM' as const,
      withdrawable: true,
      gemAvailable: Number(after),
      gemPending: Number(wallet.gem_pending || 0),
      ledgerId,
      createdAt,
      replay: false,
      launchTest: true,
    };
  });

  return out;
}

// ----------------------------------------------------------------------------
// Daily reward streak
//
// Server-authoritative daily streak. Coins are credited to the SAME wallet the
// app reads (`wallets[user_id]`, keyed by the Cognito sub), through the audited
// `ledger_entries` path. "One claim per UTC day" is guaranteed by the GLOBALLY
// UNIQUE `idempotency_key = daily:<userId>:<UTC-day>` — a replayed/concurrent
// tap can never double-pay. Reward matches the established model:
// base 10 + min(streak*2, 50).
// ----------------------------------------------------------------------------

const DAILY_BASE_REWARD = 10;
const DAILY_MAX_BONUS = 50;

function utcDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function addUtcDays(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map((n) => parseInt(n, 10));
  return utcDay(Date.UTC(y, m - 1, d) + delta * 86_400_000);
}

function dailyRewardForStreak(streak: number): number {
  return DAILY_BASE_REWARD + Math.min(streak * 2, DAILY_MAX_BONUS);
}

/** jsonb columns may arrive as an object (pg default) or a string; normalize. */
function readLedgerMetadata(raw: any): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return {};
}

async function readDailyStreakState(
  q: Knex | Knex.Transaction,
  userId: string
): Promise<{ lastClaimDay: string | null; streak: number }> {
  const last = await q('ledger_entries')
    .where({ user_id: userId, entry_type: 'DAILY_REWARD' })
    .orderBy([{ column: 'created_at', order: 'desc' }, { column: 'ledger_id', order: 'desc' }])
    .first();

  if (!last) return { lastClaimDay: null, streak: 0 };
  const meta = readLedgerMetadata(last.metadata);
  const lastClaimDay = typeof meta.day === 'string' ? meta.day : null;
  const streak = Number.isFinite(Number(meta.streak)) ? Number(meta.streak) : 0;
  return { lastClaimDay, streak };
}

export type DailyRewardPeek = {
  ok: true;
  streak: number;
  claimedToday: boolean;
  claimableReward: number;
};

export type DailyRewardClaim = {
  ok: true;
  alreadyClaimed: boolean;
  streak: number;
  reward: number;
  balanceCoins: number;
};

/** Peek the current streak + claimable reward without mutating anything. */
export async function peekDailyReward(userId: string): Promise<DailyRewardPeek> {
  const { db } = getEconomyInfra();
  const today = utcDay(Date.now());
  const state = await readDailyStreakState(db, userId);
  const claimedToday = state.lastClaimDay === today;
  const nextStreak = state.lastClaimDay === addUtcDays(today, -1) ? state.streak + 1 : 1;
  return {
    ok: true,
    streak: state.streak,
    claimedToday,
    claimableReward: claimedToday ? 0 : dailyRewardForStreak(nextStreak),
  };
}

/** Claim today's reward. Idempotent server-side; safe to call once per tap. */
export async function claimDailyReward(userId: string): Promise<DailyRewardClaim> {
  const { db } = getEconomyInfra();
  const today = utcDay(Date.now());
  const idempotencyKey = `daily:${userId}:${today}`;

  return await db.transaction(async (trx) => {
    // Lock the wallet row FIRST so concurrent taps serialize here (rather than
    // racing to insert duplicate idempotency keys and tripping a unique error).
    await trx('wallets').insert({ user_id: userId }).onConflict('user_id').ignore();
    const wallet = await trx('wallets').where({ user_id: userId }).forUpdate().first();
    if (!wallet) throw new EconomyError('INTERNAL', 500, 'Wallet missing');

    // Idempotency: the unique key is the authority for "one claim per UTC day".
    const existing = await trx('ledger_entries').where({ idempotency_key: idempotencyKey }).first();
    if (existing) {
      const meta = readLedgerMetadata(existing.metadata);
      return {
        ok: true as const,
        alreadyClaimed: true,
        streak: Number.isFinite(Number(meta.streak)) ? Number(meta.streak) : 0,
        reward: 0,
        balanceCoins: Number(wallet.coin_balance),
      };
    }

    const state = await readDailyStreakState(trx, userId);
    const newStreak = state.lastClaimDay === addUtcDays(today, -1) ? state.streak + 1 : 1;
    const reward = dailyRewardForStreak(newStreak);

    const before = BigInt(wallet.coin_balance);
    const after = before + BigInt(reward);
    const ledgerId = randomUUID();

    await trx('ledger_entries').insert({
      ledger_id: ledgerId,
      user_id: userId,
      entry_type: 'DAILY_REWARD',
      currency: 'COIN',
      amount: reward.toString(),
      status: 'POSTED',
      reference_type: 'DAILY_REWARD',
      reference_id: today,
      idempotency_key: idempotencyKey,
      metadata: { source: 'daily_streak', streak: newStreak, day: today },
    });

    await trx('wallets').where({ user_id: userId }).update({
      coin_balance: after.toString(),
      updated_at: trx.fn.now(),
    });

    return {
      ok: true as const,
      alreadyClaimed: false,
      streak: newStreak,
      reward,
      balanceCoins: Number(after),
    };
  });
}

export async function startLiveGame(hostUserId: string, input: { streamId: string; entryFeeCoins: number; idempotencyKey: string }) {
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
  const { db } = getEconomyInfra();
  const { streamId, winners, idempotencyKey } = input;

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
