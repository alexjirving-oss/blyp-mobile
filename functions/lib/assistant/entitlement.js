"use strict";
/**
 * Premium / trial gate for AI features. Reads entitlements/{uid} — clients
 * cannot forge paid tiers (rules + activate CF). Trial is honored while
 * trialEndsAt is in the future.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSubscriptionState = getSubscriptionState;
exports.ensureTrialIfMissing = ensureTrialIfMissing;
exports.ensureTrialDocIfMissing = ensureTrialDocIfMissing;
const firebaseAdmin_1 = require("../firebaseAdmin");
const types_1 = require("./types");
const PAID_TIERS = new Set(['plus', 'plus_coins']);
const STATUS_BLOCKS_PAID = new Set(['revoked', 'expired', 'on_hold', 'paused', 'inactive']);
const TRIAL_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
function emptyState() {
    return {
        active: false,
        trialing: false,
        tier: null,
        currentPeriodEnd: null,
        trialEndsAt: null,
    };
}
function computeFromDoc(d) {
    const tier = typeof (d === null || d === void 0 ? void 0 : d.tier) === 'string' ? d.tier : null;
    const status = String((d === null || d === void 0 ? void 0 : d.status) || '');
    const periodEnd = Number((d === null || d === void 0 ? void 0 : d.currentPeriodEnd) || 0) || null;
    const trialEndsAt = Number((d === null || d === void 0 ? void 0 : d.trialEndsAt) || 0) || null;
    const now = Date.now();
    const paidActive = !!tier &&
        PAID_TIERS.has(tier) &&
        !STATUS_BLOCKS_PAID.has(status) &&
        periodEnd != null &&
        periodEnd > now;
    const trialing = !paidActive &&
        ((status === 'trialing' && !!trialEndsAt && trialEndsAt > now) ||
            (tier === 'trial' && !!trialEndsAt && trialEndsAt > now));
    return {
        active: paidActive || trialing,
        trialing,
        tier,
        currentPeriodEnd: periodEnd,
        trialEndsAt,
    };
}
async function getSubscriptionState(uid) {
    const db = firebaseAdmin_1.admin.firestore();
    try {
        const snap = await db.collection(types_1.ASSISTANT_COLLECTIONS.entitlements).doc(uid).get();
        if (!snap.exists)
            return emptyState();
        return computeFromDoc(snap.data());
    }
    catch (_a) {
        // Fail CLOSED: premium features must not open on an infra error.
        return emptyState();
    }
}
/**
 * If the user has never received an entitlement doc, start the same 30-day
 * trial the mobile client expects. Does NOT renew expired / paid / free docs —
 * once entitlements/{uid} exists, that clock is permanent for the account.
 *
 * Omits `store` / paid fields so the shape stays trial-only (matches client rules).
 */
async function ensureTrialIfMissing(uid, source = 'server_bootstrap') {
    const db = firebaseAdmin_1.admin.firestore();
    const ref = db.collection(types_1.ASSISTANT_COLLECTIONS.entitlements).doc(uid);
    try {
        const snap = await ref.get();
        if (snap.exists)
            return computeFromDoc(snap.data());
        const now = Date.now();
        const doc = {
            tier: 'trial',
            status: 'trialing',
            trialStartedAt: now,
            trialEndsAt: now + TRIAL_DAYS * DAY_MS,
            updatedAt: now,
            source,
        };
        // create() fails if another request won the race — re-read either way.
        try {
            await ref.create(doc);
        }
        catch (_a) {
            const again = await ref.get();
            if (again.exists)
                return computeFromDoc(again.data());
        }
        return computeFromDoc(doc);
    }
    catch (_b) {
        return emptyState();
    }
}
/** Raw entitlement payload for clients (once-per-account bootstrap). */
async function ensureTrialDocIfMissing(uid, source = 'blypEnsureTrial') {
    const db = firebaseAdmin_1.admin.firestore();
    const ref = db.collection(types_1.ASSISTANT_COLLECTIONS.entitlements).doc(uid);
    const snap = await ref.get();
    if (snap.exists) {
        return { created: false, entitlement: (snap.data() || {}) };
    }
    const now = Date.now();
    const doc = {
        tier: 'trial',
        status: 'trialing',
        trialStartedAt: now,
        trialEndsAt: now + TRIAL_DAYS * DAY_MS,
        updatedAt: now,
        source,
    };
    try {
        await ref.create(doc);
        return { created: true, entitlement: doc };
    }
    catch (_a) {
        const again = await ref.get();
        if (again.exists) {
            return { created: false, entitlement: (again.data() || {}) };
        }
        throw new Error('trial-create-failed');
    }
}
//# sourceMappingURL=entitlement.js.map