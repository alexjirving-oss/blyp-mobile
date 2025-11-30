/**
 * BillingVerificationService
 * Stage 3.1 – Client-side HTTP bridge to backend purchase verification endpoint.
 * No platform SDK integration here; purely forwards receipt tokens for server validation.
 */

export type BillingVerificationResult = {
  ok: boolean;
  reason?: string; // 'simulation-mode' | 'not-implemented' | 'backend-rejected' | 'network-error' | 'no-backend-url' | 'invalid-response' | 'verified'
  provider?: 'google' | 'apple';
  productId?: string;
};

interface PlayStoreVerifyParams {
  productId?: string; // TODO(stage3-economy-hardening): Wire actual product identifiers from billing flow.
  purchaseToken?: string; // TODO(stage3-economy-hardening): Provide real purchase token from Play Billing SDK.
  userId?: string;
}

// Environment access (Expo public env pattern)
const BACKEND_VERIFY_URL = (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_BILLING_VERIFY_URL) || '';

export async function verifyPlayStorePurchase({ productId, purchaseToken, userId }: PlayStoreVerifyParams): Promise<BillingVerificationResult> {
  const url = BACKEND_VERIFY_URL;
  if (!url) {
    return { ok: false, reason: 'no-backend-url', provider: 'google', productId };
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'google', productId, purchaseToken, userId })
    });

    if (!res.ok) {
      return { ok: false, reason: 'backend-rejected', provider: 'google', productId };
    }

    const json: any = await res.json().catch(() => null);
    if (json && typeof json.ok === 'boolean') {
      return {
        ok: json.ok,
        reason: json.reason || (json.ok ? 'verified' : 'backend-rejected'),
        provider: 'google',
        productId
      };
    }

    return { ok: false, reason: 'invalid-response', provider: 'google', productId };
  } catch (err) {
    console.warn('[ECONOMY] Billing verification network error', err);
    return { ok: false, reason: 'network-error', provider: 'google', productId };
  }
}

// TODO(stage3-economy-hardening): Extend billing verification service to support Apple receipts and richer error codes.
// TODO(stage3-economy-hardening): Add retry/backoff strategy for transient network failures.
