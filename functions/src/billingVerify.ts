// Stage 3 Backend Billing Verification Stub
// Matches mobile BillingVerificationService expectations.
// IMPORTANT: Replace placeholder Play API logic before enabling REQUIRE_SERVER_RECEIPT_VALIDATION.

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

import { initFirebaseAdmin } from './firebaseAdmin';

initFirebaseAdmin();

const db = admin.firestore();

// Shared request/response types
export type BillingVerifyRequest = {
  provider: 'google' | 'apple';
  productId: string;
  purchaseToken: string;
  userId: string;
};

export type BillingVerifyResponse = {
  ok: boolean;
  reason?:
    | 'verified'
    | 'invalid-token'
    | 'mismatched-sku'
    | 'expired'
    | 'token-already-used'
    | 'backend-error';
};

// SECURITY: this legacy endpoint previously returned "verified" for ANY token,
// which would grant coins for free. It is superseded by the live-service
// /iap/verify endpoint (real Google Play Developer API verification). It now
// fails closed so it can never grant entitlements, even if a client still calls it.
async function verifyWithGooglePlay(_productId: string, _purchaseToken: string, _userId: string) {
  return { ok: false, reason: 'backend-error' as BillingVerifyResponse['reason'] };
}

export const billingVerify = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, reason: 'backend-error' } as BillingVerifyResponse);
    return;
  }

  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
  let decoded: admin.auth.DecodedIdToken | null = null;

  try {
    if (!idToken) throw new Error('missing-token');
    decoded = await admin.auth().verifyIdToken(idToken);
  } catch (err) {
    console.error('[BILLING] Invalid auth token', err);
    res.status(401).json({ ok: false, reason: 'backend-error' } as BillingVerifyResponse);
    return;
  }

  const body = req.body as BillingVerifyRequest;
  if (!body || !body.userId || decoded.uid !== body.userId) {
    console.error('[BILLING] userId mismatch', { bodyUserId: body?.userId, authUid: decoded?.uid });
    res.status(403).json({ ok: false, reason: 'backend-error' } as BillingVerifyResponse);
    return;
  }

  const { provider, productId, purchaseToken, userId } = body;
  try {
    const tokenDocId = `${provider}:${purchaseToken}`;
    const tokenDocRef = db.collection('billingTokens').doc(tokenDocId);
    const tokenDoc = await tokenDocRef.get();

    if (tokenDoc.exists) {
      res.json({ ok: false, reason: 'token-already-used' } as BillingVerifyResponse);
      return;
    }

    let result: BillingVerifyResponse;
    if (provider === 'google') {
      result = await verifyWithGooglePlay(productId, purchaseToken, userId);
    } else {
      // Apple path placeholder
      result = { ok: false, reason: 'backend-error' };
    }

    if (!result.ok) {
      res.json(result);
      return;
    }

    await tokenDocRef.set({
      provider,
      productId,
      userId,
      verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // TODO(stage3-economy-ledger): Append server-side ledger entry mirroring mobile ledgerType coin_purchase/gem_purchase.

    res.json({ ok: true, reason: 'verified' } as BillingVerifyResponse);
  } catch (err) {
    console.error('[BILLING] Unexpected error', err);
    res.status(500).json({ ok: false, reason: 'backend-error' } as BillingVerifyResponse);
  }
});
