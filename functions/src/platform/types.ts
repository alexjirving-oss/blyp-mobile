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

/** Bump when the substrate shape changes in a non-additive way. */
export const SCHEMA_VERSION = 1;

/** Bump when the ranking/merit logic changes; stamped on served results. */
export const RANKER_VERSION = 1;

/** Firestore collection names - single source of truth. */
export const COLLECTIONS = {
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
} as const;

/** Coarse, privacy-preserving location. Never a precise coordinate. */
export interface GeoBucket {
  country?: string; // ISO-3166 alpha-2, e.g. "GB"
  region?: string; // coarse admin area when known
  geohash5?: string; // ~5km cell, used only to bias local results
}

/** Where a harvested record came from - required on everything external. */
export interface Provenance {
  provider: string; // 'brave' | 'osm' | 'wikipedia' | 'ddg' | 'gemini' | 'blypIndex'
  providerVersion: string;
  canonicalUrl?: string;
  contentHash?: string; // sha256 of the snippet/content we stored
  fingerprint?: string; // near-dup fingerprint (simhash-style)
  fetchedAt: number; // epoch ms
  robotsStatus?: 'allowed' | 'disallowed' | 'unknown';
  ownerType?: 'publisher' | 'creator' | 'business' | 'unknown';
  ownerId?: string; // Blyp creator id / domain / place id when known
}

/** A normalized search result, provider-agnostic. */
export interface NormalizedResult {
  kind: 'web' | 'place' | 'post' | 'creator';
  title: string;
  snippet?: string;
  url?: string;
  source?: string; // display host / label
  favicon?: string;
  // place-specific (kind === 'place')
  place?: {
    name: string;
    address?: string;
    phone?: string;
    website?: string;
    openingHours?: string;
    lat?: string;
    lon?: string;
    mapUrl?: string;
    directionsUrl?: string;
    precise?: boolean; // true only when a single, contactable location resolved
  };
  // post/creator-specific (kind === 'post' | 'creator'): carries the raw Firestore
  // doc so the app can render cards + navigate without a second fetch.
  entityId?: string;
  entity?: Record<string, unknown>;
  provenance: Provenance;
}

export type SearchIntent = 'place' | 'content' | 'info';

/** One logged search. PII firewall: sessionHash, not userId. */
export interface SearchQueryDoc {
  schemaVersion: number;
  queryHash: string; // hash of normalized query (+geo bucket) - also the cache key
  query: string;
  intent: SearchIntent;
  geo?: GeoBucket;
  sessionHash: string;
  ts: number;
  retentionExpiresAt: number;
}

/** The results we actually served, with rank/position for de-biasing later. */
export interface ServedResultDoc {
  schemaVersion: number;
  rankerVersion: number;
  queryHash: string;
  sessionHash: string;
  ts: number;
  results: Array<{
    position: number; // 0-based rank as shown
    kind: NormalizedResult['kind'];
    url?: string;
    title?: string; // omitted for no-store providers (licensing guard)
    provider: string;
    exploration?: boolean; // true if injected by the exploration bucket
  }>;
  retentionExpiresAt: number;
}

/** Click + page-snapshot events reported by the app (Phase 2). */
export interface SearchEventDoc {
  schemaVersion: number;
  type: 'click' | 'snapshot';
  queryHash?: string;
  sessionHash: string;
  ts: number;
  // click
  url?: string;
  position?: number;
  provider?: string;
  // snapshot (in-app browser harvest -> seed of our own index)
  snapshot?: {
    url: string;
    canonicalUrl?: string;
    title?: string;
    description?: string;
    excerpt?: string; // short visible-text excerpt only, never the full page
    contentHash?: string;
    fingerprint?: string;
  };
  retentionExpiresAt: number;
}

/** Per-query unit economics: what it cost us and what it earned. */
export interface CostRevenueLedgerDoc {
  schemaVersion: number;
  queryHash: string;
  ts: number;
  cacheHit: boolean;
  // cost (micro-USD to keep integers; 1 USD = 1_000_000)
  costMicros: number;
  costBreakdown?: Record<string, number>; // { brave, gemini, infra }
  // revenue (filled later by ad/affiliate events)
  revenueMicros?: number;
  retentionExpiresAt: number;
}

/** Cached, blended response for a query (Phase 1). */
export interface SearchCacheDoc {
  schemaVersion: number;
  queryHash: string;
  ts: number;
  expiresAt: number;
  payload: BlypSearchResponse;
}

// ---------------------------------------------------------------------------
// Distribution / earn-your-reach (Phase 5)
// ---------------------------------------------------------------------------

/** Lifecycle stages a post moves through as it earns (or loses) reach. */
export type ReachStage = 'audition' | 'rising' | 'graduated' | 'resting';

/** Bump when the reach state shape changes non-additively. */
export const REACH_VERSION = 1;

/**
 * Distribution state stamped on every post (post.reach). Reach is EARNED:
 *  - wave 0 = audition (guaranteed small sampling so it's seen at all)
 *  - waves 1..3 = rising (each judged on merit before the next)
 *  - wave 4 = graduated (full organic eligibility)
 *  - resting = failed its audition; down-weighted, never hidden, can recover
 * `version` increments when the post is edited -> the post re-auditions fairly.
 */
export interface PostReach {
  v: number; // REACH_VERSION
  wave: number; // 0..4
  stage: ReachStage;
  exposure: number; // 0..1 share of eligible audience this wave is sampled to (transparency)
  score: number; // Blyp Score 0..100
  impressions: number; // lifetime counted impressions
  waveImpressions: number; // impressions since entering the current wave
  engagements: {
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    completions: number;
    dwellMsTotal: number;
  };
  version: number; // content version; bumped on edit -> re-audition
  boosted?: boolean; // a paid audition is active (bigger/faster sampling, NOT guaranteed reach)
  enteredWaveAt: number;
  lastScoredAt: number;
  updatedAt: number;
}

/** One reported post interaction. PII firewall: sessionHash, never a raw uid. */
export interface ImpressionEventDoc {
  schemaVersion: number;
  type: 'impression' | 'like' | 'comment' | 'share' | 'save' | 'watch';
  postId: string;
  ownerId?: string; // post author, for per-creator aggregates later
  sessionHash: string;
  dwellMs?: number; // watch events
  completion?: number; // 0..1 fraction watched (watch events)
  ts: number;
  retentionExpiresAt: number;
}

/** The response shape returned to the app. */
export interface BlypSearchResponse {
  query: string;
  intent: SearchIntent;
  answer: string;
  related: string[];
  web: NormalizedResult[];
  places: NormalizedResult[];
  posts: NormalizedResult[];
  creators: NormalizedResult[];
  sponsored: NormalizedResult[]; // empty until monetisation is live
  meta: {
    schemaVersion: number;
    rankerVersion: number;
    providers: string[];
    cacheHit: boolean;
  };
}
