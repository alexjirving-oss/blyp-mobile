"use strict";
/**
 * Search orchestrator - blends providers into one Blyp response, caches it, and
 * harvests everything into the substrate (queries/results-served/cost ledger).
 *
 * Provider preference for web: Blyp's own index first, paid supplier only to fill
 * the gap, free fallbacks last. This is deliberate: every served result feeds the
 * corpus so the index grows and the paid dependency shrinks over time.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runBlypSearch = void 0;
const types_1 = require("../platform/types");
const util_1 = require("../platform/util");
const substrate_1 = require("../platform/substrate");
const answerProvider_1 = require("./answerProvider");
const webProviders_1 = require("./webProviders");
const placesProvider_1 = require("./placesProvider");
const postsProvider_1 = require("./postsProvider");
const cache_1 = require("./cache");
function dedupWeb(...lists) {
    var _a, _b;
    const out = [];
    const seenUrl = new Set();
    const seenFp = new Set();
    for (const list of lists) {
        for (const r of list) {
            const u = ((_a = r.provenance) === null || _a === void 0 ? void 0 : _a.canonicalUrl) || r.url || '';
            const fp = ((_b = r.provenance) === null || _b === void 0 ? void 0 : _b.fingerprint) || '';
            if (u && seenUrl.has(u))
                continue;
            if (fp && seenFp.has(fp))
                continue;
            if (u)
                seenUrl.add(u);
            if (fp)
                seenFp.add(fp);
            out.push(r);
        }
    }
    return out;
}
async function gatherWeb(query, country) {
    const runs = [];
    const idx = await (0, webProviders_1.blypIndexProvider)(query);
    runs.push(idx);
    let web = idx.results;
    if (web.length < 5) {
        const brave = await (0, webProviders_1.braveProvider)(query, country);
        runs.push(brave);
        web = dedupWeb(web, brave.results);
    }
    if (web.length < 3) {
        const [wiki, ddg] = await Promise.all([(0, webProviders_1.wikipediaProvider)(query), (0, webProviders_1.ddgProvider)(query)]);
        runs.push(wiki, ddg);
        web = dedupWeb(web, ddg.results, wiki.results);
    }
    return { web, runs };
}
async function runBlypSearch(input) {
    var _a, _b;
    const query = (0, util_1.normalizeQuery)(input.query);
    const country = (_a = input.geo) === null || _a === void 0 ? void 0 : _a.country;
    const qhash = (0, util_1.queryHash)(query, country);
    const sessionHash = (0, util_1.hashSession)(input.session || 'anon');
    // Always log the query (corpus + transparency); cheap and high-value.
    void (0, substrate_1.logSearchQuery)({ query, queryHash: qhash, intent: 'info', sessionHash, geo: input.geo });
    const cached = await (0, cache_1.getCache)(qhash);
    if (cached) {
        void (0, substrate_1.logCostRevenue)({ queryHash: qhash, cacheHit: true, costMicros: 0, costBreakdown: {} });
        return Object.assign(Object.assign({}, cached), { meta: Object.assign(Object.assign({}, cached.meta), { cacheHit: true }) });
    }
    const answer = await (0, answerProvider_1.answerProvider)(query);
    const intent = answer.intent;
    const [webGathered, places, posts, creators] = await Promise.all([
        gatherWeb(query, country),
        intent === 'place'
            ? (0, placesProvider_1.placesProvider)(answer.placeName || query, country, (_b = input.geo) === null || _b === void 0 ? void 0 : _b.geohash5)
            : Promise.resolve({ provider: 'osm', results: [], costMicros: 0 }),
        (0, postsProvider_1.searchPosts)(query),
        (0, postsProvider_1.searchCreators)(query),
    ]);
    const allRuns = [...webGathered.runs, places];
    const costBreakdown = {};
    let costMicros = answer.costMicros;
    if (answer.costMicros)
        costBreakdown.gemini = answer.costMicros;
    for (const run of allRuns) {
        if (run.costMicros) {
            costBreakdown[run.provider] = (costBreakdown[run.provider] || 0) + run.costMicros;
            costMicros += run.costMicros;
        }
    }
    const response = {
        query,
        intent,
        answer: answer.answer,
        related: answer.related,
        web: webGathered.web.slice(0, 12),
        places: places.results,
        posts,
        creators,
        sponsored: [],
        meta: { schemaVersion: types_1.SCHEMA_VERSION, rankerVersion: types_1.RANKER_VERSION, providers: allRuns.map((r) => r.provider), cacheHit: false },
    };
    // Harvest: served list (in display priority) + cost ledger. Fire-and-forget.
    const served = orderForLogging(response);
    void (0, substrate_1.logResultsServed)({ queryHash: qhash, sessionHash, results: served });
    void (0, substrate_1.logCostRevenue)({ queryHash: qhash, cacheHit: false, costMicros, costBreakdown });
    void (0, cache_1.setCache)(qhash, response);
    return response;
}
exports.runBlypSearch = runBlypSearch;
/** Flatten sections into the order the user is most likely to see, for de-biasing. */
function orderForLogging(r) {
    if (r.intent === 'place')
        return [...r.places, ...r.web, ...r.posts, ...r.creators];
    if (r.intent === 'content')
        return [...r.posts, ...r.creators, ...r.web];
    return [...r.web, ...r.posts, ...r.creators];
}
//# sourceMappingURL=orchestrator.js.map