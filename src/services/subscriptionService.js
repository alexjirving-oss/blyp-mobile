// subscriptionService.js
//
// Android Plus / Plus+Coins checkout via Google Play Billing SUBS products.
// Native: PlayBillingModule.launchSubscription / querySubscriptions
// Server: blypSubscriptionActivate verifies the token and writes entitlements/{uid}.
//
// Play Console still needs the subscription products created:
//   blyp.plus.monthly / blyp.plus.coins.monthly
// Until those exist, native launch returns SKU_NOT_FOUND.

import { NativeModules, Platform } from 'react-native';
import { loadEntitlement } from './entitlementService';

export const SUBSCRIPTION_SKUS = {
  plus: 'blyp.plus.monthly',
  plus_coins: 'blyp.plus.coins.monthly',
};

const PLAY_BILLING_MODULE = NativeModules?.PlayBillingModule;

const FUNCTIONS_BASE = (
  process.env.EXPO_PUBLIC_FUNCTIONS_BASE_URL || 'https://us-central1-blyp-master.cloudfunctions.net'
).replace(/\/+$/, '');

async function firebaseIdToken() {
  try {
    // eslint-disable-next-line global-require
    const cfg = require('../config/firebase');
    const user = cfg?.auth?.currentUser;
    if (user && typeof user.getIdToken === 'function') return await user.getIdToken();
  } catch (e) {
    console.warn('[subscription] could not get Firebase ID token', e?.message || String(e));
  }
  return null;
}

/**
 * Send a verified Play purchase token to the server, which writes the paid tier
 * to entitlements/{uid} and grants coins for the plus_coins tier. Returns the
 * server result; on success the local entitlement is refreshed.
 */
export async function activateSubscription(uid, sku, purchaseToken) {
  const token = await firebaseIdToken();
  if (!token) return { ok: false, reason: 'unauthenticated' };
  try {
    const resp = await fetch(`${FUNCTIONS_BASE}/blypSubscriptionActivate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ sku, purchaseToken }),
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.ok && data?.ok) {
      if (uid) await loadEntitlement(uid);
      return data;
    }
    return { ok: false, reason: data?.reason || `http-${resp.status}` };
  } catch (e) {
    return { ok: false, reason: String(e?.message || 'activate-failed') };
  }
}

/**
 * Begin checkout for a paid plan. On a successful native purchase, the token is
 * sent to the server for verification + entitlement write. Returns a tagged result.
 * @param {'plus'|'plus_coins'} planId
 * @param {string} [uid] used to refresh the local entitlement after activation
 */
export async function startCheckout(planId, uid) {
  const sku = SUBSCRIPTION_SKUS[planId];
  if (!sku) return { ok: false, reason: 'unknown-plan' };

  if (Platform.OS !== 'android') {
    return { ok: false, reason: 'platform-not-supported' };
  }

  if (!PLAY_BILLING_MODULE?.launchSubscription) {
    return { ok: false, reason: 'billing-pending' };
  }

  try {
    // Bind the purchase to this account via Play's obfuscatedAccountId (uid ==
    // Cognito sub), so Google ties the purchase to the user (anti-fraud + RTDN
    // correlation). Older native builds ignore the extra arg harmlessly.
    const launched = await PLAY_BILLING_MODULE.launchSubscription(sku, String(uid || ''));
    const purchaseToken = String(launched?.purchaseToken || '').trim();
    if (!purchaseToken) return { ok: false, reason: 'invalid-native-purchase-result' };
    // Server verification + entitlement write + coin grant happens here.
    return await activateSubscription(uid, sku, purchaseToken);
  } catch (error) {
    const code = String(error?.code || '').toLowerCase();
    if (code === 'user_cancelled') return { ok: false, reason: 'user-cancelled' };
    return { ok: false, reason: String(error?.message || 'billing-launch-failed') };
  }
}

/**
 * Restore an existing subscription (e.g. after reinstall).
 */
export async function restoreSubscription(uid) {
  if (Platform.OS !== 'android') return { ok: false, reason: 'platform-not-supported' };
  const queryFn = PLAY_BILLING_MODULE?.querySubscriptions;
  if (typeof queryFn !== 'function') return { ok: false, reason: 'billing-pending' };
  try {
    const subs = await queryFn();
    const active = Array.isArray(subs) ? subs.find((s) => s?.purchaseToken && s?.productId) : null;
    if (!active) return { ok: false, reason: 'nothing-to-restore' };
    return await activateSubscription(uid, active.productId, active.purchaseToken);
  } catch (e) {
    return { ok: false, reason: String(e?.message || 'restore-failed') };
  }
}

export default { SUBSCRIPTION_SKUS, startCheckout, activateSubscription, restoreSubscription };
