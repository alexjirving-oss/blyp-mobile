"use strict";
/**
 * Premium gate for the assistant. Reads the admin-written entitlements/{uid}
 * doc — the single source of truth a client can never forge — and reports
 * whether the user currently has an ACTIVE paid subscription.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSubscriptionState = void 0;
const firebaseAdmin_1 = require("../firebaseAdmin");
const types_1 = require("./types");
const PAID_TIERS = new Set(['plus', 'plus_coins']);
async function getSubscriptionState(uid) {
    const db = firebaseAdmin_1.admin.firestore();
    try {
        const snap = await db.collection(types_1.ASSISTANT_COLLECTIONS.entitlements).doc(uid).get();
        if (!snap.exists)
            return { active: false, tier: null, currentPeriodEnd: null };
        const d = snap.data();
        const tier = typeof (d === null || d === void 0 ? void 0 : d.tier) === 'string' ? d.tier : null;
        const status = String((d === null || d === void 0 ? void 0 : d.status) || '');
        const periodEnd = Number((d === null || d === void 0 ? void 0 : d.currentPeriodEnd) || 0) || null;
        const active = status === 'active' &&
            !!tier &&
            PAID_TIERS.has(tier) &&
            (periodEnd == null || periodEnd > Date.now());
        return { active, tier, currentPeriodEnd: periodEnd };
    }
    catch (_a) {
        // Fail CLOSED here: a premium feature must not open on an infra error.
        return { active: false, tier: null, currentPeriodEnd: null };
    }
}
exports.getSubscriptionState = getSubscriptionState;
//# sourceMappingURL=entitlement.js.map