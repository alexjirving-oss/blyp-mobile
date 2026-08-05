"use strict";
/**
 * Scheduled jobs for the Blyp search platform.
 *
 *  - buildBlypIndex     : promotes harvested in-app page snapshots into Blyp's OWN
 *                         index (blypIndexDocs). This is the seed of "no permanent
 *                         partner" - the corpus we serve from grows every day.
 *  - blypRetentionSweep : deletes raw events past their retention window (Charter:
 *                         keep the minimum, anonymise/prune the rest on schedule).
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
exports.blypRetentionSweep = exports.buildBlypIndex = void 0;
const functions = __importStar(require("firebase-functions"));
const firebaseAdmin_1 = require("../firebaseAdmin");
const types_1 = require("../platform/types");
const util_1 = require("../platform/util");
const STOP = new Set([
    'the', 'a', 'an', 'of', 'for', 'to', 'in', 'on', 'and', 'or', 'with', 'is', 'are', 'was',
    'this', 'that', 'from', 'by', 'at', 'as', 'it', 'be', 'you', 'your', 'we', 'our',
]);
function keywordsFrom(text, cap = 25) {
    const seen = new Set();
    String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .forEach((t) => {
        if (t.length > 2 && !STOP.has(t))
            seen.add(t);
    });
    return Array.from(seen).slice(0, cap);
}
exports.buildBlypIndex = functions
    .runWith({ memory: '512MB', timeoutSeconds: 300 })
    .pubsub.schedule('every 24 hours')
    .onRun(async () => {
    (0, firebaseAdmin_1.initFirebaseAdmin)();
    const db = firebaseAdmin_1.admin.firestore();
    const snap = await db
        .collection(types_1.COLLECTIONS.searchEvents)
        .where('type', '==', 'snapshot')
        .orderBy('ts', 'desc')
        .limit(500)
        .get();
    let upserts = 0;
    let batch = db.batch();
    let inBatch = 0;
    for (const d of snap.docs) {
        const ev = d.data();
        const s = ev.snapshot;
        if (!(s === null || s === void 0 ? void 0 : s.url))
            continue;
        const url = (0, util_1.canonicalUrl)(s.url);
        const id = (0, util_1.sha256)(url).slice(0, 32);
        const keywords = keywordsFrom(`${s.title || ''} ${s.description || ''} ${s.excerpt || ''}`);
        if (!keywords.length)
            continue;
        batch.set(db.collection(types_1.COLLECTIONS.blypIndexDocs).doc(id), {
            url,
            canonicalUrl: url,
            title: s.title || url,
            description: s.description || '',
            excerpt: s.excerpt || '',
            keywords,
            fingerprint: s.fingerprint || '',
            source: 'snapshot',
            updatedAt: Date.now(),
        }, { merge: true });
        upserts += 1;
        inBatch += 1;
        if (inBatch >= 400) {
            // eslint-disable-next-line no-await-in-loop
            await batch.commit();
            batch = db.batch();
            inBatch = 0;
        }
    }
    if (inBatch > 0)
        await batch.commit();
    console.log(`[buildBlypIndex] upserted ${upserts} index docs`);
    return null;
});
async function sweepCollection(coll, nowMs, max = 400) {
    const db = firebaseAdmin_1.admin.firestore();
    const snap = await db.collection(coll).where('retentionExpiresAt', '<', nowMs).limit(max).get();
    if (snap.empty)
        return 0;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    return snap.size;
}
exports.blypRetentionSweep = functions
    .runWith({ memory: '256MB', timeoutSeconds: 300 })
    .pubsub.schedule('every 24 hours')
    .onRun(async () => {
    (0, firebaseAdmin_1.initFirebaseAdmin)();
    const now = Date.now();
    const collections = [
        types_1.COLLECTIONS.searchQueries,
        types_1.COLLECTIONS.searchResultsServed,
        types_1.COLLECTIONS.searchEvents,
        types_1.COLLECTIONS.impressionEvents,
    ];
    let deleted = 0;
    for (const c of collections) {
        // eslint-disable-next-line no-await-in-loop
        deleted += await sweepCollection(c, now);
    }
    console.log(`[blypRetentionSweep] deleted ${deleted} expired event docs`);
    return null;
});
//# sourceMappingURL=scheduled.js.map