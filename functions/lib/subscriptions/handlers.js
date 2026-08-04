"use strict";
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
exports.blypSubscriptionActivate = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const cors_1 = require("../http/cors");
const firebaseAdmin_1 = require("../firebaseAdmin");
const coinGrant_1 = require("./coinGrant");
const entitlement_1 = require("./entitlement");
(0, firebaseAdmin_1.initFirebaseAdmin)();
const db = admin.firestore();
function periodKey(expiryMs) {
    const d = new Date(expiryMs);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
exports.blypSubscriptionActivate = functions.https.onRequest(async (req, res) => {
    var _a;
    (0, cors_1.applyCors)(req, res, { methods: 'POST, OPTIONS' });
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
        if (!idToken)
            throw new Error('missing-token');
        const decoded = await admin.auth().verifyIdToken(idToken);
        uid = decoded.uid;
    }
    catch (_b) {
        res.status(401).json({ ok: false, reason: 'unauthenticated' });
        return;
    }
    const body = req.body || {};
    const sku = String(body.sku || '').trim();
    const purchaseToken = String(body.purchaseToken || '').trim();
    const tier = entitlement_1.SKU_TO_TIER[sku];
    if (!tier || !purchaseToken) {
        res.status(400).json({ ok: false, reason: 'bad-request' });
        return;
    }
    try {
        const verify = await (0, entitlement_1.verifyPlaySubscription)(sku, purchaseToken);
        if (!verify.ok) {
            // not-configured surfaces clearly so the app can keep the user on trial.
            res.status(verify.reason === 'not-configured' ? 503 : 402).json({ ok: false, reason: verify.reason });
            return;
        }
        // Bind the purchase token to this account. If it's already bound to a
        // DIFFERENT uid, refuse — one Play subscription purchase belongs to exactly
        // one account (prevents token sharing/replay across accounts).
        try {
            const existingToken = await db.collection('subscriptionTokens').doc((0, entitlement_1.tokenDocId)(purchaseToken)).get();
            if (existingToken.exists) {
                const boundUid = String(((_a = existingToken.data()) === null || _a === void 0 ? void 0 : _a.uid) || '');
                if (boundUid && boundUid !== uid) {
                    res.status(409).json({ ok: false, reason: 'token-already-bound' });
                    return;
                }
            }
        }
        catch (e) {
            // Lookup failure: fall through. Verification + per-period idempotency still apply.
            console.warn('[blypSubscriptionActivate] token binding check failed', e === null || e === void 0 ? void 0 : e.message);
        }
        const now = Date.now();
        await db.collection('entitlements').doc(uid).set({
            tier,
            status: 'active',
            store: 'google',
            sku,
            purchaseToken,
            currentPeriodEnd: verify.expiryMs,
            autoRenewing: verify.autoRenewing,
            updatedAt: now,
        }, { merge: true });
        // Index the purchase token -> uid so Real-time Developer Notifications (RTDN)
        // can map a renewal/cancellation/expiry back to the right account. Doc id is a
        // safe hash of the token (tokens can contain characters invalid in doc ids).
        try {
            await db.collection('subscriptionTokens').doc((0, entitlement_1.tokenDocId)(purchaseToken)).set({ uid, sku, purchaseToken, updatedAt: now }, { merge: true });
        }
        catch (e) {
            console.warn('[blypSubscriptionActivate] token index write failed', e === null || e === void 0 ? void 0 : e.message);
        }
        // Plus + Coins: grant 999 coins, idempotent per billing period — credited to
        // the live-service Postgres wallet the app actually spends from (NOT a
        // separate Firestore ledger, which previously stranded these coins).
        let coinsGranted = 0;
        const coins = (0, entitlement_1.monthlyCoinsFor)(tier);
        if (coins > 0) {
            const grant = await (0, coinGrant_1.creditSubscriptionCoinsViaLiveService)({
                uid,
                coins,
                idempotencyKey: `sub-coins:${uid}:${periodKey(verify.expiryMs)}`,
                sku,
                source: 'subscription',
            });
            coinsGranted = grant.granted;
        }
        res.status(200).json({ ok: true, tier, currentPeriodEnd: verify.expiryMs, coinsGranted });
    }
    catch (e) {
        console.error('[blypSubscriptionActivate] error', e === null || e === void 0 ? void 0 : e.message);
        res.status(500).json({ ok: false, reason: 'error' });
    }
});
//# sourceMappingURL=handlers.js.map