"use strict";
/**
 * Substrate writers - the only place that persists events/ledgers to Firestore.
 *
 * Everything is fire-and-forget and failure-tolerant: logging must NEVER break a
 * user-facing search. Each writer stamps schema versions and a retention expiry
 * so the corpus can be anonymised/pruned on schedule (Charter: maximum safe data,
 * minimum kept longer than needed).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RETENTION = void 0;
exports.logSearchQuery = logSearchQuery;
exports.logResultsServed = logResultsServed;
exports.logSearchEvent = logSearchEvent;
exports.logPostEvents = logPostEvents;
exports.logCostRevenue = logCostRevenue;
const firebaseAdmin_1 = require("../firebaseAdmin");
const types_1 = require("./types");
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Providers whose RESULT CONTENT we are not licensed to store (e.g. Brave's free
 * plan forbids storing API results). For these we log only position/kind/provider
 * for de-biasing - never the title or URL. Blyp's own corpus is built solely from
 * first-party page snapshots + on-platform content, which we DO own.
 */
const NO_STORE_PROVIDERS = new Set(['brave']);
/** Retention windows (days). Raw event detail is short-lived; aggregates are not. */
exports.RETENTION = {
    searchQueriesDays: 180,
    resultsServedDays: 180,
    searchEventsDays: 180,
    impressionEventsDays: 30, // raw post signals are short-lived; merit is kept on the post
    ledgerDays: 1825, // 5y - unit economics are kept for audited transparency
};
function db() {
    (0, firebaseAdmin_1.initFirebaseAdmin)();
    return firebaseAdmin_1.admin.firestore();
}
function expiry(days) {
    return Date.now() + days * DAY_MS;
}
/** Strip undefined values - Firestore rejects them. */
function clean(obj) {
    const out = {};
    Object.keys(obj).forEach((k) => {
        const v = obj[k];
        if (v !== undefined)
            out[k] = v;
    });
    return out;
}
async function logSearchQuery(params) {
    try {
        const doc = clean({
            schemaVersion: types_1.SCHEMA_VERSION,
            queryHash: params.queryHash,
            query: params.query,
            intent: params.intent,
            geo: params.geo,
            sessionHash: params.sessionHash,
            ts: Date.now(),
            retentionExpiresAt: expiry(exports.RETENTION.searchQueriesDays),
        });
        await db().collection(types_1.COLLECTIONS.searchQueries).add(doc);
    }
    catch (e) {
        console.warn('[substrate] logSearchQuery failed', e === null || e === void 0 ? void 0 : e.message);
    }
}
async function logResultsServed(params) {
    try {
        const doc = {
            schemaVersion: types_1.SCHEMA_VERSION,
            rankerVersion: types_1.RANKER_VERSION,
            queryHash: params.queryHash,
            sessionHash: params.sessionHash,
            ts: Date.now(),
            results: params.results.map((r, position) => {
                var _a, _b;
                const provider = ((_a = r.provenance) === null || _a === void 0 ? void 0 : _a.provider) || 'unknown';
                const noStore = NO_STORE_PROVIDERS.has(provider);
                return clean({
                    position,
                    kind: r.kind,
                    // Licensing guard: never persist content/URL for no-store suppliers.
                    url: noStore ? undefined : r.url,
                    title: noStore ? undefined : r.title,
                    provider,
                    exploration: ((_b = params.explorationUrls) === null || _b === void 0 ? void 0 : _b.has(r.url || '')) || undefined,
                });
            }),
            retentionExpiresAt: expiry(exports.RETENTION.resultsServedDays),
        };
        await db().collection(types_1.COLLECTIONS.searchResultsServed).add(doc);
    }
    catch (e) {
        console.warn('[substrate] logResultsServed failed', e === null || e === void 0 ? void 0 : e.message);
    }
}
async function logSearchEvent(doc) {
    try {
        const full = clean(Object.assign(Object.assign({}, doc), { schemaVersion: types_1.SCHEMA_VERSION, ts: Date.now(), retentionExpiresAt: expiry(exports.RETENTION.searchEventsDays) }));
        await db().collection(types_1.COLLECTIONS.searchEvents).add(full);
    }
    catch (e) {
        console.warn('[substrate] logSearchEvent failed', e === null || e === void 0 ? void 0 : e.message);
    }
}
/**
 * Persist a batch of post interaction signals (impressions/likes/shares/etc.) that
 * feed the earn-your-reach engine. PII firewall: sessionHash only. Fire-and-forget.
 */
async function logPostEvents(events) {
    if (!events.length)
        return;
    try {
        const database = db();
        const coll = database.collection(types_1.COLLECTIONS.impressionEvents);
        const now = Date.now();
        const retentionExpiresAt = expiry(exports.RETENTION.impressionEventsDays);
        let batch = database.batch();
        let inBatch = 0;
        for (const ev of events) {
            const doc = clean(Object.assign(Object.assign({}, ev), { schemaVersion: types_1.SCHEMA_VERSION, ts: ev.ts || now, retentionExpiresAt }));
            batch.set(coll.doc(), doc);
            inBatch += 1;
            if (inBatch >= 400) {
                // eslint-disable-next-line no-await-in-loop
                await batch.commit();
                batch = database.batch();
                inBatch = 0;
            }
        }
        if (inBatch > 0)
            await batch.commit();
    }
    catch (e) {
        console.warn('[substrate] logPostEvents failed', e === null || e === void 0 ? void 0 : e.message);
    }
}
async function logCostRevenue(params) {
    try {
        const doc = clean({
            schemaVersion: types_1.SCHEMA_VERSION,
            queryHash: params.queryHash,
            ts: Date.now(),
            cacheHit: params.cacheHit,
            costMicros: params.costMicros,
            costBreakdown: params.costBreakdown,
            retentionExpiresAt: expiry(exports.RETENTION.ledgerDays),
        });
        await db().collection(types_1.COLLECTIONS.costRevenueLedger).add(doc);
    }
    catch (e) {
        console.warn('[substrate] logCostRevenue failed', e === null || e === void 0 ? void 0 : e.message);
    }
}
//# sourceMappingURL=substrate.js.map