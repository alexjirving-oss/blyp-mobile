"use strict";
/**
 * Firestore-backed response cache. Keeps supplier costs down and makes repeat
 * queries instant. Keyed by queryHash (query + coarse country).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCache = getCache;
exports.setCache = setCache;
const firebaseAdmin_1 = require("../firebaseAdmin");
const types_1 = require("../platform/types");
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 min
async function getCache(queryHash) {
    try {
        (0, firebaseAdmin_1.initFirebaseAdmin)();
        const ref = firebaseAdmin_1.admin.firestore().collection(types_1.COLLECTIONS.searchCache).doc(queryHash);
        const snap = await ref.get();
        if (!snap.exists)
            return null;
        const data = snap.data();
        if (!data || data.schemaVersion !== types_1.SCHEMA_VERSION)
            return null;
        if (Date.now() > data.expiresAt)
            return null;
        return data.payload;
    }
    catch (_a) {
        return null;
    }
}
async function setCache(queryHash, payload, ttlMs = DEFAULT_TTL_MS) {
    try {
        (0, firebaseAdmin_1.initFirebaseAdmin)();
        const doc = {
            schemaVersion: types_1.SCHEMA_VERSION,
            queryHash,
            ts: Date.now(),
            expiresAt: Date.now() + ttlMs,
            payload,
        };
        await firebaseAdmin_1.admin.firestore().collection(types_1.COLLECTIONS.searchCache).doc(queryHash).set(doc);
    }
    catch (_a) {
        // cache write failures are non-fatal
    }
}
//# sourceMappingURL=cache.js.map