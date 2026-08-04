/**
 * AndroidPlayBillingService
 *
 * Real Android billing launch bridge. Purchase verification and entitlement grant
 * remain backend-owned and occur after this function resolves with store tokens.
 */

import { NativeModules, Platform } from 'react-native';

export const ANDROID_PROOF_SKU = 'blyp.android.proof.coinpack.100';

export type AndroidProofPurchaseFailure = {
    ok: false;
    reason: string;
};

export type AndroidProofPurchaseSuccess = {
    ok: true;
    idempotencyKey: string;
    sku: string;
    storeTransactionId: string;
    purchaseToken: string;
};

export type AndroidProofPurchaseResult = AndroidProofPurchaseFailure | AndroidProofPurchaseSuccess;

type NativePlayBillingResult = {
    sku: string;
    storeTransactionId: string;
    purchaseToken: string;
};

export type NativeAndroidPurchase = {
    purchaseToken: string;
    productId: string;
    purchaseState: number;
    isAcknowledged: boolean;
};

type NativeConsumeResult = {
    ok: boolean;
    purchaseToken: string;
};

export type AndroidProductDetail = {
    sku: string;
    title: string;
    description: string;
    formattedPrice: string;
    priceCurrencyCode: string;
    priceAmountMicros: string;
};

type NativePlayBillingModule = {
    launchPurchase: (sku: string, obfuscatedAccountId: string) => Promise<NativePlayBillingResult>;
    queryPurchases: () => Promise<NativeAndroidPurchase[]>;
    consumePurchase: (purchaseToken: string) => Promise<NativeConsumeResult>;
    getProductDetails?: (skus: string[]) => Promise<AndroidProductDetail[]>;
};

const PLAY_BILLING_MODULE: NativePlayBillingModule | undefined = (NativeModules as any)?.PlayBillingModule;

function makeIdempotencyKey(prefix: string = 'iap'): string {
    const randomUUID = (global as any)?.crypto?.randomUUID?.();
    if (randomUUID && typeof randomUUID === 'string') return `${prefix}:${randomUUID}`;
    return `${prefix}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

// Resolve the current account id (Cognito sub == Firebase uid) to bind the
// purchase to via Play's obfuscatedAccountId. Best-effort; empty string is fine
// (native treats blank as "no binding").
function currentAccountId(): string {
    try {
        // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
        const cfg = require('../config/firebase');
        const uid = cfg?.auth?.currentUser?.uid;
        return uid ? String(uid) : '';
    } catch {
        return '';
    }
}

export async function launchAndroidProofPurchase(): Promise<AndroidProofPurchaseResult> {
    return launchAndroidPurchase(ANDROID_PROOF_SKU);
}

/**
 * Launch a Google Play purchase for any configured coin-pack SKU.
 * Verification + entitlement grant remain backend-owned and run after this resolves.
 */
export async function launchAndroidPurchase(requestedSku: string): Promise<AndroidProofPurchaseResult> {
    if (Platform.OS !== 'android') {
        return { ok: false, reason: 'platform-not-supported' };
    }

    const targetSku = String(requestedSku || '').trim();
    if (!targetSku) {
        return { ok: false, reason: 'invalid-sku' };
    }

    if (!PLAY_BILLING_MODULE?.launchPurchase) {
        return { ok: false, reason: 'billing-module-unavailable' };
    }

    try {
        const launched = await PLAY_BILLING_MODULE.launchPurchase(targetSku, currentAccountId());
        const sku = String(launched?.sku || targetSku).trim();
        const storeTransactionId = String(launched?.storeTransactionId || '').trim();
        const purchaseToken = String(launched?.purchaseToken || '').trim();

        if (!sku || !storeTransactionId || !purchaseToken) {
            return { ok: false, reason: 'invalid-native-purchase-result' };
        }

        return {
            ok: true,
            // Derive the idempotency key from the immutable store purchase token so
            // every retry of the SAME purchase reuses the SAME key (prevents
            // double-grants on client retries). Falls back to a random key only if
            // the token is somehow unavailable.
            idempotencyKey: purchaseToken
                ? `iap-android:${sku}:${purchaseToken}`
                : makeIdempotencyKey('iap-android'),
            sku,
            storeTransactionId,
            purchaseToken,
        };
    } catch (error: any) {
        const code = String(error?.code || '').toLowerCase();
        if (code === 'user_cancelled') {
            return { ok: false, reason: 'user-cancelled' };
        }
        return { ok: false, reason: String(error?.message || 'billing-launch-failed') };
    }
}

/**
 * Fetch localized Play Store pricing for the given SKUs. Returns an empty array
 * on any platform/availability issue so callers can fall back to static pricing.
 */
export async function getAndroidProductDetails(skus: string[]): Promise<AndroidProductDetail[]> {
    if (Platform.OS !== 'android') return [];
    if (!PLAY_BILLING_MODULE?.getProductDetails) return [];
    const list = (skus || []).map((s) => String(s || '').trim()).filter((s) => s.length > 0);
    if (list.length === 0) return [];

    try {
        const details = await PLAY_BILLING_MODULE.getProductDetails(list);
        if (!Array.isArray(details)) return [];
        return details
            .map((d) => ({
                sku: String(d?.sku || '').trim(),
                title: String(d?.title || ''),
                description: String(d?.description || ''),
                formattedPrice: String(d?.formattedPrice || ''),
                priceCurrencyCode: String(d?.priceCurrencyCode || ''),
                priceAmountMicros: String(d?.priceAmountMicros || '0'),
            }))
            .filter((d) => d.sku.length > 0);
    } catch (error) {
        console.warn('[ANDROID_BILLING] getProductDetails failed', error);
        return [];
    }
}

export async function queryPurchases(): Promise<NativeAndroidPurchase[]> {
    if (Platform.OS !== 'android') return [];
    if (!PLAY_BILLING_MODULE?.queryPurchases) return [];

    try {
        const purchases = await PLAY_BILLING_MODULE.queryPurchases();
        if (!Array.isArray(purchases)) return [];

        return purchases
            .map((entry: any) => ({
                purchaseToken: String(entry?.purchaseToken || '').trim(),
                productId: String(entry?.productId || '').trim(),
                purchaseState: Number(entry?.purchaseState ?? -1),
                isAcknowledged: Boolean(entry?.isAcknowledged),
            }))
            .filter((entry) => entry.purchaseToken.length > 0 && entry.productId.length > 0);
    } catch (error) {
        console.warn('[ANDROID_BILLING] queryPurchases failed', error);
        return [];
    }
}

export async function consumePurchase(purchaseToken: string): Promise<boolean> {
    if (Platform.OS !== 'android') return false;
    const token = String(purchaseToken || '').trim();
    if (!token) return false;
    if (!PLAY_BILLING_MODULE?.consumePurchase) return false;

    try {
        const out = await PLAY_BILLING_MODULE.consumePurchase(token);
        return Boolean(out?.ok);
    } catch (error) {
        console.warn('[ANDROID_BILLING] consumePurchase failed', error);
        return false;
    }
}
