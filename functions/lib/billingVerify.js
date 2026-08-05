"use strict";
// Stage 3 Backend Billing Verification Stub
// Matches mobile BillingVerificationService expectations.
// IMPORTANT: Replace placeholder Play API logic before enabling REQUIRE_SERVER_RECEIPT_VALIDATION.
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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.billingVerify = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const firebaseAdmin_1 = require("./firebaseAdmin");
(0, firebaseAdmin_1.initFirebaseAdmin)();
const db = admin.firestore();
// SECURITY: this legacy endpoint previously returned "verified" for ANY token,
// which would grant coins for free. It is superseded by the live-service
// /iap/verify endpoint (real Google Play Developer API verification). It now
// fails closed so it can never grant entitlements, even if a client still calls it.
async function verifyWithGooglePlay(_productId, _purchaseToken, _userId) {
    return { ok: false, reason: 'backend-error' };
}
exports.billingVerify = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).json({ ok: false, reason: 'backend-error' });
        return;
    }
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
    let decoded = null;
    try {
        if (!idToken)
            throw new Error('missing-token');
        decoded = await admin.auth().verifyIdToken(idToken);
    }
    catch (err) {
        console.error('[BILLING] Invalid auth token', err);
        res.status(401).json({ ok: false, reason: 'backend-error' });
        return;
    }
    const body = req.body;
    if (!body || !body.userId || decoded.uid !== body.userId) {
        console.error('[BILLING] userId mismatch', { bodyUserId: body === null || body === void 0 ? void 0 : body.userId, authUid: decoded === null || decoded === void 0 ? void 0 : decoded.uid });
        res.status(403).json({ ok: false, reason: 'backend-error' });
        return;
    }
    const { provider, productId, purchaseToken, userId } = body;
    try {
        const tokenDocId = `${provider}:${purchaseToken}`;
        const tokenDocRef = db.collection('billingTokens').doc(tokenDocId);
        const tokenDoc = await tokenDocRef.get();
        if (tokenDoc.exists) {
            res.json({ ok: false, reason: 'token-already-used' });
            return;
        }
        let result;
        if (provider === 'google') {
            result = await verifyWithGooglePlay(productId, purchaseToken, userId);
        }
        else {
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
        res.json({ ok: true, reason: 'verified' });
    }
    catch (err) {
        console.error('[BILLING] Unexpected error', err);
        res.status(500).json({ ok: false, reason: 'backend-error' });
    }
});
//# sourceMappingURL=billingVerify.js.map