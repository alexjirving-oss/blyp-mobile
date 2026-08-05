"use strict";
/**
 * Blyp platform substrate - canonical type definitions.
 *
 * This is the "capture-now-or-never" data model from the Blyp Charter. ONE event
 * substrate + a set of ledgers powers feed ranking, search ranking, the Blyp Score,
 * creator payouts, the transparency dashboard, trust/safety and the path to Blyp's
 * own search index. Suppliers (Brave/OSM/Gemini) are swappable behind it.
 *
 * Design rules encoded here:
 *  - PII firewall: events are keyed by a hashed SESSION, never a raw userId.
 *  - Provenance on every harvested record (source, canonical url, hash, consent).
 *  - Position-aware logging so learning-to-rank is possible later.
 *  - Everything stamped with schema/ranker/provider versions for safe migration.
 *
 * Some collections below are written by later phases (post versions, boost ledger,
 * trust records, impression events). They are defined now so the schema is fixed
 * and nothing has to be retrofitted.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.REACH_VERSION = exports.COLLECTIONS = exports.RANKER_VERSION = exports.SCHEMA_VERSION = void 0;
/** Bump when the substrate shape changes in a non-additive way. */
exports.SCHEMA_VERSION = 1;
/** Bump when the ranking/merit logic changes; stamped on served results. */
exports.RANKER_VERSION = 1;
/** Firestore collection names - single source of truth. */
exports.COLLECTIONS = {
    // Search corpus (Phase 1/2)
    searchQueries: 'searchQueries',
    searchResultsServed: 'searchResultsServed',
    searchEvents: 'searchEvents', // clicks + page snapshots
    searchCache: 'searchCache',
    blypIndexDocs: 'blypIndexDocs',
    // Unit economics (Phase 0/2/7)
    costRevenueLedger: 'costRevenueLedger',
    contributionLedger: 'contributionLedger',
    // Distribution / content merit (Phase 5)
    impressionEvents: 'impressionEvents',
    postVersions: 'postVersions',
    boostLedger: 'boostLedger',
    // Trust & safety (Phase 8)
    trustRecords: 'trustRecords',
    moderationActions: 'moderationActions',
    // Posts (existing, owned by the app) - distribution state lives under post.reach
    posts: 'posts',
    // Small singleton docs for job cursors etc.
    platformState: 'platformState',
    // Abuse rate-limiting (one tiny fixed-window counter doc per caller key).
    rateLimits: 'rateLimits',
};
/** Bump when the reach state shape changes non-additively. */
exports.REACH_VERSION = 1;
//# sourceMappingURL=types.js.map