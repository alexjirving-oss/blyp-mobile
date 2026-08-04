/**
 * Google Play Real-time Developer Notifications (RTDN) handler.
 *
 *  blypPlayRtdn — Pub/Sub trigger that keeps entitlements/{uid} in sync with the
 *  real subscription lifecycle (renewals, cancellations, grace period, account
 *  hold, pause, expiry, refund). This is what actually downgrades a user to Free
 *  when a free-trial conversion or renewal payment fails.
 *
 * SETUP (needs you — done once in the Google Cloud / Play Console):
 *   1. Create a Pub/Sub topic named `play-rtdn` in the SAME GCP project as these
 *      Functions.
 *   2. Play Console → Monetisation setup → Real-time developer notifications →
 *      set the topic to `projects/<project-id>/topics/play-rtdn` and Send a test.
 *   3. Grant the Play service account publish rights on the topic (Play Console
 *      shows the exact service account to add as a Pub/Sub Publisher).
 *
 * Until the topic + RTDN are configured this function simply never fires; the
 * activation endpoint still works, and access still ends when currentPeriodEnd
 * passes — RTDN just makes renewals/cancellations reflect immediately.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { initFirebaseAdmin } from '../firebaseAdmin';
import { creditSubscriptionCoinsViaLiveService } from './coinGrant';
import { SKU_TO_TIER, monthlyCoinsFor, verifyPlaySubscription, tokenDocId } from './entitlement';

initFirebaseAdmin();
const db = admin.firestore();

// Play subscription notification types (developer notifications reference).
const SUB = {
  RECOVERED: 1,
  RENEWED: 2,
  CANCELED: 3,
  PURCHASED: 4,
  ON_HOLD: 5,
  IN_GRACE_PERIOD: 6,
  RESTARTED: 7,
  PRICE_CHANGE_CONFIRMED: 8,
  DEFERRED: 9,
  PAUSED: 10,
  PAUSE_SCHEDULE_CHANGED: 11,
  REVOKED: 12,
  EXPIRED: 13,
} as const;

function periodKey(expiryMs: number): string {
  const d = new Date(expiryMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function grantRenewalCoins(uid: string, sku: string, tier: 'plus' | 'plus_coins', expiryMs: number) {
  const coins = monthlyCoinsFor(tier);
  if (coins <= 0) return;
  // Credit the live-service Postgres wallet (same as activation), idempotent per
  // billing period. Never throws — RTDN must not crash on a transient failure.
  await creditSubscriptionCoinsViaLiveService({
    uid,
    coins,
    idempotencyKey: `sub-coins:${uid}:${periodKey(expiryMs)}`,
    sku,
    source: 'subscription-renewal',
  });
}

export const blypPlayRtdn = functions.pubsub.topic('play-rtdn').onPublish(async (message) => {
  let payload: any = {};
  try {
    payload = message.json || JSON.parse(Buffer.from(message.data, 'base64').toString('utf8'));
  } catch {
    console.warn('[blypPlayRtdn] unparseable message');
    return;
  }

  const sub = payload?.subscriptionNotification;
  if (!sub) return; // ignore test/voided/one-time notifications here

  const purchaseToken = String(sub.purchaseToken || '').trim();
  const sku = String(sub.subscriptionId || '').trim();
  const type = Number(sub.notificationType || 0);
  if (!purchaseToken || !sku) return;

  const tier = SKU_TO_TIER[sku];
  if (!tier) {
    console.warn('[blypPlayRtdn] unknown sku', sku);
    return;
  }

  // Map the purchase token back to the account that activated it.
  const mapSnap = await db.collection('subscriptionTokens').doc(tokenDocId(purchaseToken)).get();
  const uid = mapSnap.exists ? String(mapSnap.data()?.uid || '') : '';
  if (!uid) {
    console.warn('[blypPlayRtdn] no uid mapped for purchase token');
    return;
  }

  const ref = db.collection('entitlements').doc(uid);
  const now = Date.now();

  try {
    switch (type) {
      // Refund / chargeback / developer-revoked: remove access immediately.
      case SUB.REVOKED: {
        await ref.set({ status: 'revoked', currentPeriodEnd: now - 1, autoRenewing: false, updatedAt: now }, { merge: true });
        return;
      }
      // Period ended without renewal (e.g. failed trial conversion / failed renewal
      // after grace + hold): force Free now.
      case SUB.EXPIRED: {
        await ref.set({ status: 'expired', currentPeriodEnd: now - 1, autoRenewing: false, updatedAt: now }, { merge: true });
        return;
      }
      // No access during hold / pause: restrict now (Google restores via RECOVERED).
      case SUB.ON_HOLD: {
        await ref.set({ status: 'on_hold', currentPeriodEnd: now - 1, autoRenewing: false, updatedAt: now }, { merge: true });
        return;
      }
      case SUB.PAUSED: {
        await ref.set({ status: 'paused', currentPeriodEnd: now - 1, autoRenewing: false, updatedAt: now }, { merge: true });
        return;
      }
      // Cancelled but not yet expired: keep access until currentPeriodEnd; just stop
      // auto-renew. EXPIRED will arrive at the end of the paid period.
      case SUB.CANCELED: {
        await ref.set({ status: 'canceled', autoRenewing: false, updatedAt: now }, { merge: true });
        return;
      }
      default:
        break;
    }

    // PURCHASED / RENEWED / RECOVERED / RESTARTED / IN_GRACE_PERIOD / price change /
    // deferred: re-verify with Google and reflect the authoritative period end.
    const verify = await verifyPlaySubscription(sku, purchaseToken);
    if (verify.ok) {
      await ref.set(
        {
          tier,
          status: 'active',
          store: 'google',
          sku,
          purchaseToken,
          currentPeriodEnd: verify.expiryMs,
          autoRenewing: verify.autoRenewing,
          updatedAt: now,
        },
        { merge: true },
      );
      if (type === SUB.RENEWED || type === SUB.RECOVERED || type === SUB.RESTARTED) {
        await grantRenewalCoins(uid, sku, tier, verify.expiryMs);
      }
      return;
    }

    // Couldn't confirm an active period — fail safe to Free.
    await ref.set({ status: 'inactive', currentPeriodEnd: now - 1, autoRenewing: false, updatedAt: now }, { merge: true });
  } catch (e) {
    console.error('[blypPlayRtdn] error handling notification', (e as Error)?.message);
  }
});
