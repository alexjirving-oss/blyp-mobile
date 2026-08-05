/**
 * Subscription activation endpoint.
 *
 *  blypSubscriptionActivate — called by the app after a successful Play
 *  subscription purchase (or on restore). It verifies the purchase token with
 *  Google Play, writes the paid tier to entitlements/{uid} (admin-only), and for
 *  the Plus + Coins tier grants 999 coins via the real idempotent ledger, once
 *  per billing period.
 *
 *  Paying buys features + coins, never reach (BLYP_CHARTER.md → Money).
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { applyCors } from '../http/cors';
import { initFirebaseAdmin } from '../firebaseAdmin';
import { creditSubscriptionCoinsViaLiveService } from './coinGrant';
import { SKU_TO_TIER, monthlyCoinsFor, verifyPlaySubscription, tokenDocId } from './entitlement';
import { ensureTrialDocIfMissing } from '../assistant/entitlement';

initFirebaseAdmin();
const db = admin.firestore();

function periodKey(expiryMs: number): string {
  const d = new Date(expiryMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Once-per-account 30-day trial bootstrap. Creates entitlements/{uid} only when
 * missing — never renews trial clocks or overwrites paid subscribers.
 */
export const blypEnsureTrial = functions.https.onRequest(async (req, res) => {
  applyCors(req, res, { methods: 'POST, OPTIONS' });
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, reason: 'method' });
    return;
  }

  const authHeader = String(req.headers.authorization || '');
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
  let uid = '';
  try {
    if (!idToken) throw new Error('missing-token');
    const decoded = await admin.auth().verifyIdToken(idToken);
    uid = decoded.uid;
  } catch {
    res.status(401).json({ ok: false, reason: 'unauthenticated' });
    return;
  }

  try {
    const result = await ensureTrialDocIfMissing(uid, 'blypEnsureTrial');
    res.status(200).json({
      ok: true,
      created: result.created,
      entitlement: result.entitlement,
    });
  } catch (e) {
    console.error('[blypEnsureTrial] error', (e as Error)?.message);
    res.status(500).json({ ok: false, reason: 'error' });
  }
});

export const blypSubscriptionActivate = functions.https.onRequest(async (req, res) => {
  applyCors(req, res, { methods: 'POST, OPTIONS' });
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, reason: 'method' });
    return;
  }

  // Auth: Firebase ID token (uid == Cognito sub via mintFirebaseCustomToken).
  const authHeader = String(req.headers.authorization || '');
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
  let uid = '';
  try {
    if (!idToken) throw new Error('missing-token');
    const decoded = await admin.auth().verifyIdToken(idToken);
    uid = decoded.uid;
  } catch {
    res.status(401).json({ ok: false, reason: 'unauthenticated' });
    return;
  }

  const body = req.body || {};
  const sku = String(body.sku || '').trim();
  const purchaseToken = String(body.purchaseToken || '').trim();
  const tier = SKU_TO_TIER[sku];
  if (!tier || !purchaseToken) {
    res.status(400).json({ ok: false, reason: 'bad-request' });
    return;
  }

  try {
    const verify = await verifyPlaySubscription(sku, purchaseToken);
    if (!verify.ok) {
      // not-configured surfaces clearly so the app can keep the user on trial.
      res.status(verify.reason === 'not-configured' ? 503 : 402).json({ ok: false, reason: verify.reason });
      return;
    }

    // Bind the purchase token to this account. If it's already bound to a
    // DIFFERENT uid, refuse — one Play subscription purchase belongs to exactly
    // one account (prevents token sharing/replay across accounts).
    try {
      const existingToken = await db.collection('subscriptionTokens').doc(tokenDocId(purchaseToken)).get();
      if (existingToken.exists) {
        const boundUid = String(existingToken.data()?.uid || '');
        if (boundUid && boundUid !== uid) {
          res.status(409).json({ ok: false, reason: 'token-already-bound' });
          return;
        }
      }
    } catch (e) {
      // Lookup failure: fall through. Verification + per-period idempotency still apply.
      console.warn('[blypSubscriptionActivate] token binding check failed', (e as Error)?.message);
    }

    const now = Date.now();
    await db.collection('entitlements').doc(uid).set(
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

    // Index the purchase token -> uid so Real-time Developer Notifications (RTDN)
    // can map a renewal/cancellation/expiry back to the right account. Doc id is a
    // safe hash of the token (tokens can contain characters invalid in doc ids).
    try {
      await db.collection('subscriptionTokens').doc(tokenDocId(purchaseToken)).set(
        { uid, sku, purchaseToken, updatedAt: now },
        { merge: true },
      );
    } catch (e) {
      console.warn('[blypSubscriptionActivate] token index write failed', (e as Error)?.message);
    }

    // Plus + Coins: grant 999 coins, idempotent per billing period — credited to
    // the live-service Postgres wallet the app actually spends from (NOT a
    // separate Firestore ledger, which previously stranded these coins).
    let coinsGranted = 0;
    const coins = monthlyCoinsFor(tier);
    if (coins > 0) {
      const grant = await creditSubscriptionCoinsViaLiveService({
        uid,
        coins,
        idempotencyKey: `sub-coins:${uid}:${periodKey(verify.expiryMs)}`,
        sku,
        source: 'subscription',
      });
      coinsGranted = grant.granted;
    }

    res.status(200).json({ ok: true, tier, currentPeriodEnd: verify.expiryMs, coinsGranted });
  } catch (e) {
    console.error('[blypSubscriptionActivate] error', (e as Error)?.message);
    res.status(500).json({ ok: false, reason: 'error' });
  }
});
