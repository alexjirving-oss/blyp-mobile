"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyPlaySubscription = exports.monthlyCoinsFor = exports.SKU_TO_TIER = exports.tokenDocId = void 0;
const crypto = __importStar(require("crypto"));
/**
 * Stable, Firestore-safe document id for a Play purchase token. Tokens can contain
 * characters that aren't valid in document ids (and are very long), so we hash them.
 */
function tokenDocId(purchaseToken) {
    return crypto.createHash('sha256').update(String(purchaseToken)).digest('hex');
}
exports.tokenDocId = tokenDocId;
exports.SKU_TO_TIER = {
    'blyp.plus.monthly': 'plus',
    'blyp.plus.coins.monthly': 'plus_coins',
};
function monthlyCoinsFor(tier) {
    return tier === 'plus_coins' ? 999 : 0;
}
exports.monthlyCoinsFor = monthlyCoinsFor;
const PLAY_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
/**
 * Verify a Google Play subscription purchase token via the Android Publisher API
 * (subscriptionsv2). Uses Application Default Credentials (the Functions service
 * account). Returns not-configured if the package name or auth client is missing,
 * so we never grant on an unverifiable token.
 */
async function verifyPlaySubscription(sku, purchaseToken) {
    var _a, _b, _c, _d, _e, _f, _g;
    const packageName = process.env.PLAY_PACKAGE_NAME ||
        process.env.GOOGLE_PLAY_PACKAGE_NAME ||
        'com.blyp.mobile';
    if (!sku || !purchaseToken) {
        return { ok: false, reason: 'not-configured' };
    }
    let accessToken = null;
    try {
        // google-auth-library ships transitively with @google-cloud/storage. Loaded
        // lazily so a missing dep degrades to not-configured rather than crashing.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { GoogleAuth } = require('google-auth-library');
        const auth = new GoogleAuth({ scopes: [PLAY_SCOPE] });
        const client = await auth.getClient();
        const tokenResponse = await client.getAccessToken();
        accessToken = typeof tokenResponse === 'string' ? tokenResponse : (tokenResponse === null || tokenResponse === void 0 ? void 0 : tokenResponse.token) || null;
    }
    catch (e) {
        console.warn('[subscriptions] Play auth unavailable', e === null || e === void 0 ? void 0 : e.message);
        return { ok: false, reason: 'not-configured' };
    }
    if (!accessToken)
        return { ok: false, reason: 'not-configured' };
    try {
        const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
            `${encodeURIComponent(packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
        const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!resp.ok) {
            if (resp.status === 404 || resp.status === 400)
                return { ok: false, reason: 'invalid' };
            return { ok: false, reason: 'error' };
        }
        const data = await resp.json();
        // subscriptionsv2: lineItems[].expiryTime (RFC3339), subscriptionState.
        const state = String((data === null || data === void 0 ? void 0 : data.subscriptionState) || '');
        const expiryIso = ((_b = (_a = data === null || data === void 0 ? void 0 : data.lineItems) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.expiryTime) || ((_d = (_c = data === null || data === void 0 ? void 0 : data.lineItems) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.expiry_time);
        const expiryMs = expiryIso ? Date.parse(expiryIso) : 0;
        const active = state === 'SUBSCRIPTION_STATE_ACTIVE' || state === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD';
        if (!active || !expiryMs || expiryMs < Date.now()) {
            return { ok: false, reason: 'expired' };
        }
        const autoRenewing = !!((_g = (_f = (_e = data === null || data === void 0 ? void 0 : data.lineItems) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.autoRenewingPlan) === null || _g === void 0 ? void 0 : _g.autoRenewEnabled);
        return { ok: true, expiryMs, autoRenewing };
    }
    catch (e) {
        console.error('[subscriptions] Play verify error', e === null || e === void 0 ? void 0 : e.message);
        return { ok: false, reason: 'error' };
    }
}
exports.verifyPlaySubscription = verifyPlaySubscription;
//# sourceMappingURL=entitlement.js.map