// matchdayEntitlementService
//
// Client side of the server-authoritative Matchday Live entitlement. The guiding
// principle is ZERO-friction checkout: if the wallet already holds enough
// BlypCoins the unlock is a single confirm with an instant server grant; only
// when the balance is short do we open one native Play Billing top-up sheet and
// then auto-continue the purchase. Entitlement state is cached so re-entering a
// room is instant for the rest of the match.

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getMatchdayEntitlement,
  getMatchdayPricing,
  purchaseMatchdayEntitlement,
  makeIdempotencyKey,
  verifyAndroidIapPurchase,
  type MatchdayEntitlementStatus,
  type MatchdayPricing,
} from '../api/economyLiveApi';
import { launchAndroidProofPurchase } from './AndroidPlayBillingService';
import { logMatchdayEvent } from './matchdayAnalytics';

const cacheKey = (eventId: string) => `@blyp/matchday/entitlement/${eventId}`;

// In-memory mirror of the AsyncStorage cache so repeat checks inside a session
// never touch disk or the network once an entitlement is known to be live.
const memoryCache = new Map<string, { entitled: boolean; expiresAt: number | null }>();

export interface MatchdayEventMeta {
  homeTeam?: string;
  awayTeam?: string;
  league?: string;
  kickoff?: string;
}

function isLive(entry: { entitled: boolean; expiresAt: number | null } | undefined): boolean {
  if (!entry || !entry.entitled) return false;
  if (entry.expiresAt == null) return true;
  return entry.expiresAt > Date.now();
}

async function writeCache(eventId: string, entitled: boolean, expiresAtIso: string | null) {
  const expiresAt = expiresAtIso ? new Date(expiresAtIso).getTime() : null;
  const entry = { entitled, expiresAt: Number.isFinite(expiresAt as number) ? expiresAt : null };
  memoryCache.set(eventId, entry);
  try {
    await AsyncStorage.setItem(cacheKey(eventId), JSON.stringify(entry));
  } catch {
    // Cache is best-effort.
  }
}

async function readCache(eventId: string): Promise<{ entitled: boolean; expiresAt: number | null } | undefined> {
  if (memoryCache.has(eventId)) return memoryCache.get(eventId);
  try {
    const raw = await AsyncStorage.getItem(cacheKey(eventId));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    const entry = { entitled: !!parsed?.entitled, expiresAt: parsed?.expiresAt ?? null };
    memoryCache.set(eventId, entry);
    return entry;
  } catch {
    return undefined;
  }
}

/** Fast, cache-first check used to gate room entry without a spinner. */
export async function isEntitledCached(eventId: string): Promise<boolean> {
  return isLive(await readCache(eventId));
}

let pricingCache: MatchdayPricing | null = null;
export async function getPricing(): Promise<MatchdayPricing> {
  if (pricingCache) return pricingCache;
  pricingCache = await getMatchdayPricing();
  return pricingCache;
}

/** Authoritative status from the server; refreshes the local cache. */
export async function checkEntitlement(eventId: string): Promise<MatchdayEntitlementStatus> {
  const status = await getMatchdayEntitlement(eventId);
  await writeCache(eventId, status.entitled, status.entitlement?.expiresAt ?? null);
  return status;
}

export type UnlockOutcome =
  | { ok: true; entitled: true; viaTopUp: boolean }
  | { ok: false; reason: 'cancelled' | 'billing-unavailable' | 'insufficient-after-topup' | 'error'; message?: string };

/**
 * Zero-friction unlock. Resolves to an active entitlement or a typed failure.
 * - Already entitled -> instant.
 * - Enough coins -> single server grant (no store round-trip).
 * - Short on coins -> one native Play Billing top-up, then auto-continue.
 */
export async function unlockMatchday(eventId: string, eventMeta?: MatchdayEventMeta): Promise<UnlockOutcome> {
  try {
    const status = await checkEntitlement(eventId);
    if (status.entitled) {
      logMatchdayEvent('unlock_already_entitled', { eventId });
      return { ok: true, entitled: true, viaTopUp: false };
    }

    const price = status.priceCoins;
    const available = Number(status.wallet.coinBalance || 0) + Number(status.wallet.bonusCoinBalance || 0);

    if (available >= price) {
      await grant(eventId, eventMeta);
      logMatchdayEvent('unlock_instant', { eventId, price });
      return { ok: true, entitled: true, viaTopUp: false };
    }

    // Short on coins: one native top-up, then auto-continue into the grant.
    logMatchdayEvent('unlock_topup_start', { eventId, price, available });
    const purchase = await launchAndroidProofPurchase();
    if (!purchase.ok) {
      if (purchase.reason === 'user-cancelled') return { ok: false, reason: 'cancelled' };
      if (purchase.reason === 'billing-module-unavailable' || purchase.reason === 'platform-not-supported') {
        return { ok: false, reason: 'billing-unavailable', message: purchase.reason };
      }
      return { ok: false, reason: 'error', message: purchase.reason };
    }

    const verification = await verifyAndroidIapPurchase({
      idempotencyKey: purchase.idempotencyKey,
      platform: 'ANDROID',
      sku: purchase.sku,
      storeTransactionId: purchase.storeTransactionId,
      purchaseToken: purchase.purchaseToken,
    });

    const newBalance =
      Number(verification?.wallet?.coinBalance || 0) + Number(verification?.wallet?.bonusCoinBalance || 0);
    if (newBalance < price) {
      logMatchdayEvent('unlock_insufficient_after_topup', { eventId, price, newBalance });
      return { ok: false, reason: 'insufficient-after-topup' };
    }

    await grant(eventId, eventMeta);
    logMatchdayEvent('unlock_topup_complete', { eventId, price });
    return { ok: true, entitled: true, viaTopUp: true };
  } catch (e: any) {
    logMatchdayEvent('unlock_error', { eventId, message: e?.message || String(e) });
    return { ok: false, reason: 'error', message: e?.message || String(e) };
  }
}

async function grant(eventId: string, eventMeta?: MatchdayEventMeta) {
  const res = await purchaseMatchdayEntitlement({
    idempotencyKey: makeIdempotencyKey('matchday-unlock'),
    eventId,
    eventMeta,
  });
  await writeCache(eventId, true, res.entitlement?.expiresAt ?? null);
  return res;
}

export function clearEntitlementCache(eventId?: string) {
  if (eventId) {
    memoryCache.delete(eventId);
    AsyncStorage.removeItem(cacheKey(eventId)).catch(() => {});
  } else {
    memoryCache.clear();
  }
}
