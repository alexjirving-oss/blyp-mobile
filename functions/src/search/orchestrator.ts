/**
 * Search orchestrator - blends providers into one Blyp response, caches it, and
 * harvests everything into the substrate (queries/results-served/cost ledger).
 *
 * Provider preference for web: Blyp's own index first, paid supplier only to fill
 * the gap, free fallbacks last. This is deliberate: every served result feeds the
 * corpus so the index grows and the paid dependency shrinks over time.
 */

import { BlypSearchResponse, GeoBucket, NormalizedResult, SCHEMA_VERSION, RANKER_VERSION } from '../platform/types';
import { queryHash, hashSession, normalizeQuery } from '../platform/util';
import { logSearchQuery, logResultsServed, logCostRevenue } from '../platform/substrate';
import { answerProvider } from './answerProvider';
import { blypIndexProvider, braveProvider, wikipediaProvider, ddgProvider } from './webProviders';
import { placesProvider } from './placesProvider';
import { searchPosts, searchCreators } from './postsProvider';
import { getCache, setCache } from './cache';
import { ProviderRun } from './net';

function dedupWeb(...lists: NormalizedResult[][]): NormalizedResult[] {
  const out: NormalizedResult[] = [];
  const seenUrl = new Set<string>();
  const seenFp = new Set<string>();
  for (const list of lists) {
    for (const r of list) {
      const u = r.provenance?.canonicalUrl || r.url || '';
      const fp = r.provenance?.fingerprint || '';
      if (u && seenUrl.has(u)) continue;
      if (fp && seenFp.has(fp)) continue;
      if (u) seenUrl.add(u);
      if (fp) seenFp.add(fp);
      out.push(r);
    }
  }
  return out;
}

async function gatherWeb(query: string, country?: string): Promise<{ web: NormalizedResult[]; runs: ProviderRun[] }> {
  const runs: ProviderRun[] = [];
  const idx = await blypIndexProvider(query);
  runs.push(idx);
  let web = idx.results;
  if (web.length < 5) {
    const brave = await braveProvider(query, country);
    runs.push(brave);
    web = dedupWeb(web, brave.results);
  }
  if (web.length < 3) {
    const [wiki, ddg] = await Promise.all([wikipediaProvider(query), ddgProvider(query)]);
    runs.push(wiki, ddg);
    web = dedupWeb(web, ddg.results, wiki.results);
  }
  return { web, runs };
}

export interface BlypSearchInput {
  query: string;
  session?: string; // raw session/user id - hashed before storage
  geo?: GeoBucket;
}

export async function runBlypSearch(input: BlypSearchInput): Promise<BlypSearchResponse> {
  const query = normalizeQuery(input.query);
  const country = input.geo?.country;
  const qhash = queryHash(query, country);
  const sessionHash = hashSession(input.session || 'anon');

  // Always log the query (corpus + transparency); cheap and high-value.
  void logSearchQuery({ query, queryHash: qhash, intent: 'info', sessionHash, geo: input.geo });

  const cached = await getCache(qhash);
  if (cached) {
    void logCostRevenue({ queryHash: qhash, cacheHit: true, costMicros: 0, costBreakdown: {} });
    return { ...cached, meta: { ...cached.meta, cacheHit: true } };
  }

  const answer = await answerProvider(query);
  const intent = answer.intent;

  const [webGathered, places, posts, creators] = await Promise.all([
    gatherWeb(query, country),
    intent === 'place'
      ? placesProvider(answer.placeName || query, country, input.geo?.geohash5)
      : Promise.resolve<ProviderRun>({ provider: 'osm', results: [], costMicros: 0 }),
    searchPosts(query),
    searchCreators(query),
  ]);

  const allRuns: ProviderRun[] = [...webGathered.runs, places];
  const costBreakdown: Record<string, number> = {};
  let costMicros = answer.costMicros;
  if (answer.costMicros) costBreakdown.gemini = answer.costMicros;
  for (const run of allRuns) {
    if (run.costMicros) {
      costBreakdown[run.provider] = (costBreakdown[run.provider] || 0) + run.costMicros;
      costMicros += run.costMicros;
    }
  }

  const response: BlypSearchResponse = {
    query,
    intent,
    answer: answer.answer,
    related: answer.related,
    web: webGathered.web.slice(0, 12),
    places: places.results,
    posts,
    creators,
    sponsored: [],
    meta: { schemaVersion: SCHEMA_VERSION, rankerVersion: RANKER_VERSION, providers: allRuns.map((r) => r.provider), cacheHit: false },
  };

  // Harvest: served list (in display priority) + cost ledger. Fire-and-forget.
  const served = orderForLogging(response);
  void logResultsServed({ queryHash: qhash, sessionHash, results: served });
  void logCostRevenue({ queryHash: qhash, cacheHit: false, costMicros, costBreakdown });
  void setCache(qhash, response);

  return response;
}

/** Flatten sections into the order the user is most likely to see, for de-biasing. */
function orderForLogging(r: BlypSearchResponse): NormalizedResult[] {
  if (r.intent === 'place') return [...r.places, ...r.web, ...r.posts, ...r.creators];
  if (r.intent === 'content') return [...r.posts, ...r.creators, ...r.web];
  return [...r.web, ...r.posts, ...r.creators];
}
