"use strict";
/**
 * Abuse rate-limiting for anonymous public endpoints (search).
 *
 * The Charter says anyone can search, and free users get UNLIMITED plain search.
 * So this is NOT a product cap - it is purely an abuse / cost guard against a
 * single client (or script) hammering the endpoint. Thresholds are deliberately
 * generous: a real human searching as fast as they can will never hit them.
 *
 * Implementation: a Firestore fixed-window counter, one tiny doc per caller key
 * (hashed IP + session). Failure-tolerant - if the limiter itself errors, we ALLOW
 * the request (never break search because the guard hiccuped).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SEARCH_RATE_LIMIT = void 0;
exports.callerKey = callerKey;
exports.checkRateLimit = checkRateLimit;
const firebaseAdmin_1 = require("../firebaseAdmin");
const types_1 = require("./types");
const util_1 = require("./util");
/** Generous default: 40 requests / 10s burst per caller key. */
exports.SEARCH_RATE_LIMIT = { windowMs: 10000, max: 40 };
/**
 * Derive a stable, privacy-preserving caller key from the request. Uses the
 * forwarded client IP (Cloud Functions sits behind a proxy) plus the app session.
 * The raw values are hashed so we never persist an IP in plaintext.
 */
function callerKey(ip, session) {
    const raw = `${ip || 'noip'}|${session || 'anon'}`;
    return (0, util_1.sha256)(raw).slice(0, 32);
}
/**
 * Atomically increment the fixed-window counter for `key` and decide whether the
 * request is allowed. One Firestore doc per key; the window resets in place, so the
 * collection size is bounded by the number of distinct callers (swept on retention).
 */
async function checkRateLimit(key, opts = exports.SEARCH_RATE_LIMIT) {
    try {
        (0, firebaseAdmin_1.initFirebaseAdmin)();
        const ref = firebaseAdmin_1.admin.firestore().collection(types_1.COLLECTIONS.rateLimits).doc(key);
        const now = Date.now();
        const result = await firebaseAdmin_1.admin.firestore().runTransaction(async (tx) => {
            var _a, _b;
            const snap = await tx.get(ref);
            const data = snap.exists ? snap.data() : null;
            let windowStart = (_a = data === null || data === void 0 ? void 0 : data.windowStart) !== null && _a !== void 0 ? _a : 0;
            let count = (_b = data === null || data === void 0 ? void 0 : data.count) !== null && _b !== void 0 ? _b : 0;
            if (!windowStart || now - windowStart >= opts.windowMs) {
                // Start a fresh window.
                windowStart = now;
                count = 1;
            }
            else {
                count += 1;
            }
            tx.set(ref, { windowStart, count, updatedAt: now, expiresAt: windowStart + opts.windowMs * 6 }, { merge: true });
            const allowed = count <= opts.max;
            const retryAfterSec = allowed ? 0 : Math.ceil((windowStart + opts.windowMs - now) / 1000);
            return { allowed, retryAfterSec, remaining: Math.max(0, opts.max - count) };
        });
        return result;
    }
    catch (e) {
        const failOpen = opts.failOpen !== false;
        console.error('[rateLimit] error (' + (failOpen ? 'allowing' : 'denying') + ' request)', e === null || e === void 0 ? void 0 : e.message);
        if (failOpen) {
            return { allowed: true, retryAfterSec: 0, remaining: opts.max };
        }
        return { allowed: false, retryAfterSec: 30, remaining: 0 };
    }
}
//# sourceMappingURL=rateLimit.js.map