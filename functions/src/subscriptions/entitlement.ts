/**
 * Server-side entitlement helpers + Google Play subscription verification.
 *
 * Trust model: PAID tiers are written ONLY here (admin SDK), after a verified
 * Play purchase token. The client can self-start a trial but can never write a
 * paid tier (see firestore.rules → entitlements/{userId}).
 *
 * BLOCKED (needs you):
 *   - Play Console: create subscription products (see SKU_TO_TIER).
 *   - Grant the Functions service account "View financial data" on the Play
 *     Console so androidpublisher can read subscription state.
 *   - Set PLAY_PACKAGE_NAME in the functions environment.
 * Until verifyPlaySubscription is configured it refuses to grant (never fakes).
 */

import * as crypto from 'crypto';

export type PaidTier = 'plus' | 'plus_coins';

/**
 * Stable, Firestore-safe document id for a Play purchase token. Tokens can contain
 * characters that aren't valid in document ids (and are very long), so we hash them.
 */
export function tokenDocId(purchaseToken: string): string {
  return crypto.createHash('sha256').update(String(purchaseToken)).digest('hex');
}

export const SKU_TO_TIER: Record<string, PaidTier> = {
  'blyp.plus.monthly': 'plus',
  'blyp.plus.coins.monthly': 'plus_coins',
};

export function monthlyCoinsFor(tier: PaidTier): number {
  return tier === 'plus_coins' ? 999 : 0;
}

export type PlayVerifyResult =
  | { ok: true; expiryMs: number; autoRenewing: boolean }
  | { ok: false; reason: 'not-configured' | 'invalid' | 'expired' | 'error' };

const PLAY_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

/**
 * Verify a Google Play subscription purchase token via the Android Publisher API
 * (subscriptionsv2). Uses Application Default Credentials (the Functions service
 * account). Returns not-configured if the package name or auth client is missing,
 * so we never grant on an unverifiable token.
 */
export async function verifyPlaySubscription(
  sku: string,
  purchaseToken: string,
): Promise<PlayVerifyResult> {
  const packageName = process.env.PLAY_PACKAGE_NAME;
  if (!packageName || !sku || !purchaseToken) {
    return { ok: false, reason: 'not-configured' };
  }

  let accessToken: string | null = null;
  try {
    // google-auth-library ships transitively with @google-cloud/storage. Loaded
    // lazily so a missing dep degrades to not-configured rather than crashing.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { GoogleAuth } = require('google-auth-library');
    const auth = new GoogleAuth({ scopes: [PLAY_SCOPE] });
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    accessToken = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token || null;
  } catch (e) {
    console.warn('[subscriptions] Play auth unavailable', (e as Error)?.message);
    return { ok: false, reason: 'not-configured' };
  }
  if (!accessToken) return { ok: false, reason: 'not-configured' };

  try {
    const url =
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
      `${encodeURIComponent(packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!resp.ok) {
      if (resp.status === 404 || resp.status === 400) return { ok: false, reason: 'invalid' };
      return { ok: false, reason: 'error' };
    }
    const data: any = await resp.json();
    // subscriptionsv2: lineItems[].expiryTime (RFC3339), subscriptionState.
    const state = String(data?.subscriptionState || '');
    const expiryIso = data?.lineItems?.[0]?.expiryTime || data?.lineItems?.[0]?.expiry_time;
    const expiryMs = expiryIso ? Date.parse(expiryIso) : 0;
    const active = state === 'SUBSCRIPTION_STATE_ACTIVE' || state === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD';
    if (!active || !expiryMs || expiryMs < Date.now()) {
      return { ok: false, reason: 'expired' };
    }
    const autoRenewing = !!data?.lineItems?.[0]?.autoRenewingPlan?.autoRenewEnabled;
    return { ok: true, expiryMs, autoRenewing };
  } catch (e) {
    console.error('[subscriptions] Play verify error', (e as Error)?.message);
    return { ok: false, reason: 'error' };
  }
}
