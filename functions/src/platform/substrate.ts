/**
 * Substrate writers - the only place that persists events/ledgers to Firestore.
 *
 * Everything is fire-and-forget and failure-tolerant: logging must NEVER break a
 * user-facing search. Each writer stamps schema versions and a retention expiry
 * so the corpus can be anonymised/pruned on schedule (Charter: maximum safe data,
 * minimum kept longer than needed).
 */

import { admin, initFirebaseAdmin } from '../firebaseAdmin';
import {
  COLLECTIONS,
  SCHEMA_VERSION,
  RANKER_VERSION,
  SearchQueryDoc,
  ServedResultDoc,
  SearchEventDoc,
  CostRevenueLedgerDoc,
  GeoBucket,
  SearchIntent,
  NormalizedResult,
  ImpressionEventDoc,
} from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Providers whose RESULT CONTENT we are not licensed to store (e.g. Brave's free
 * plan forbids storing API results). For these we log only position/kind/provider
 * for de-biasing - never the title or URL. Blyp's own corpus is built solely from
 * first-party page snapshots + on-platform content, which we DO own.
 */
const NO_STORE_PROVIDERS = new Set(['brave']);

/** Retention windows (days). Raw event detail is short-lived; aggregates are not. */
export const RETENTION = {
  searchQueriesDays: 180,
  resultsServedDays: 180,
  searchEventsDays: 180,
  impressionEventsDays: 30, // raw post signals are short-lived; merit is kept on the post
  ledgerDays: 1825, // 5y - unit economics are kept for audited transparency
};

function db(): FirebaseFirestore.Firestore {
  initFirebaseAdmin();
  return admin.firestore();
}

function expiry(days: number): number {
  return Date.now() + days * DAY_MS;
}

/** Strip undefined values - Firestore rejects them. */
function clean<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  Object.keys(obj).forEach((k) => {
    const v = obj[k];
    if (v !== undefined) out[k] = v;
  });
  return out as T;
}

export async function logSearchQuery(params: {
  query: string;
  queryHash: string;
  intent: SearchIntent;
  sessionHash: string;
  geo?: GeoBucket;
}): Promise<void> {
  try {
    const doc: SearchQueryDoc = clean({
      schemaVersion: SCHEMA_VERSION,
      queryHash: params.queryHash,
      query: params.query,
      intent: params.intent,
      geo: params.geo,
      sessionHash: params.sessionHash,
      ts: Date.now(),
      retentionExpiresAt: expiry(RETENTION.searchQueriesDays),
    });
    await db().collection(COLLECTIONS.searchQueries).add(doc);
  } catch (e) {
    console.warn('[substrate] logSearchQuery failed', (e as Error)?.message);
  }
}

export async function logResultsServed(params: {
  queryHash: string;
  sessionHash: string;
  results: NormalizedResult[];
  explorationUrls?: Set<string>;
}): Promise<void> {
  try {
    const doc: ServedResultDoc = {
      schemaVersion: SCHEMA_VERSION,
      rankerVersion: RANKER_VERSION,
      queryHash: params.queryHash,
      sessionHash: params.sessionHash,
      ts: Date.now(),
      results: params.results.map((r, position) => {
        const provider = r.provenance?.provider || 'unknown';
        const noStore = NO_STORE_PROVIDERS.has(provider);
        return clean({
          position,
          kind: r.kind,
          // Licensing guard: never persist content/URL for no-store suppliers.
          url: noStore ? undefined : r.url,
          title: noStore ? undefined : r.title,
          provider,
          exploration: params.explorationUrls?.has(r.url || '') || undefined,
        });
      }),
      retentionExpiresAt: expiry(RETENTION.resultsServedDays),
    };
    await db().collection(COLLECTIONS.searchResultsServed).add(doc);
  } catch (e) {
    console.warn('[substrate] logResultsServed failed', (e as Error)?.message);
  }
}

export async function logSearchEvent(doc: Omit<SearchEventDoc, 'schemaVersion' | 'ts' | 'retentionExpiresAt'>): Promise<void> {
  try {
    const full = clean({
      ...doc,
      schemaVersion: SCHEMA_VERSION,
      ts: Date.now(),
      retentionExpiresAt: expiry(RETENTION.searchEventsDays),
    } as unknown as Record<string, unknown>);
    await db().collection(COLLECTIONS.searchEvents).add(full);
  } catch (e) {
    console.warn('[substrate] logSearchEvent failed', (e as Error)?.message);
  }
}

/**
 * Persist a batch of post interaction signals (impressions/likes/shares/etc.) that
 * feed the earn-your-reach engine. PII firewall: sessionHash only. Fire-and-forget.
 */
export async function logPostEvents(
  events: Array<Omit<ImpressionEventDoc, 'schemaVersion' | 'ts' | 'retentionExpiresAt'> & { ts?: number }>
): Promise<void> {
  if (!events.length) return;
  try {
    const database = db();
    const coll = database.collection(COLLECTIONS.impressionEvents);
    const now = Date.now();
    const retentionExpiresAt = expiry(RETENTION.impressionEventsDays);
    let batch = database.batch();
    let inBatch = 0;
    for (const ev of events) {
      const doc = clean({
        ...ev,
        schemaVersion: SCHEMA_VERSION,
        ts: ev.ts || now,
        retentionExpiresAt,
      } as unknown as Record<string, unknown>);
      batch.set(coll.doc(), doc);
      inBatch += 1;
      if (inBatch >= 400) {
        // eslint-disable-next-line no-await-in-loop
        await batch.commit();
        batch = database.batch();
        inBatch = 0;
      }
    }
    if (inBatch > 0) await batch.commit();
  } catch (e) {
    console.warn('[substrate] logPostEvents failed', (e as Error)?.message);
  }
}

export async function logCostRevenue(params: {
  queryHash: string;
  cacheHit: boolean;
  costMicros: number;
  costBreakdown?: Record<string, number>;
}): Promise<void> {
  try {
    const doc: CostRevenueLedgerDoc = clean({
      schemaVersion: SCHEMA_VERSION,
      queryHash: params.queryHash,
      ts: Date.now(),
      cacheHit: params.cacheHit,
      costMicros: params.costMicros,
      costBreakdown: params.costBreakdown,
      retentionExpiresAt: expiry(RETENTION.ledgerDays),
    });
    await db().collection(COLLECTIONS.costRevenueLedger).add(doc);
  } catch (e) {
    console.warn('[substrate] logCostRevenue failed', (e as Error)?.message);
  }
}
