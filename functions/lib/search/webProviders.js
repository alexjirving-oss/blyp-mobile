"use strict";
/**
 * Web result providers. Order of preference at the orchestrator:
 *   1) blypIndex  - Blyp's OWN growing corpus (the endgame: no permanent partner)
 *   2) brave      - paid supplier, real coverage, used while we build the index
 *   3) wikipedia  - free encyclopaedic fallback
 *   4) ddg        - free instant-answer fallback / official-site detection
 *
 * Every provider returns provenance so results can be harvested into our corpus.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.blypIndexProvider = blypIndexProvider;
exports.braveProvider = braveProvider;
exports.wikipediaProvider = wikipediaProvider;
exports.ddgProvider = ddgProvider;
const firebaseAdmin_1 = require("../firebaseAdmin");
const types_1 = require("../platform/types");
const util_1 = require("../platform/util");
const net_1 = require("./net");
const now = () => Date.now();
const faviconFor = (url) => {
    const host = (0, util_1.hostOf)(url || '');
    return host ? `https://icons.duckduckgo.com/ip3/${host}.ico` : undefined;
};
function webResult(provider, providerVersion, r) {
    const url = (0, util_1.canonicalUrl)(r.url);
    return {
        kind: 'web',
        title: r.title,
        snippet: r.snippet,
        url,
        source: (0, util_1.hostOf)(url),
        favicon: faviconFor(url),
        provenance: {
            provider,
            providerVersion,
            canonicalUrl: url,
            contentHash: (0, util_1.sha256)(`${r.title}\n${r.snippet || ''}`),
            fingerprint: (0, util_1.fingerprint)(`${r.title} ${r.snippet || ''}`),
            fetchedAt: now(),
            ownerType: r.official ? 'business' : 'publisher',
        },
    };
}
/** Blyp's own index - reads harvested pages. Empty until the corpus grows. */
async function blypIndexProvider(query, limit = 8) {
    try {
        (0, firebaseAdmin_1.initFirebaseAdmin)();
        const tokens = query
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter((t) => t.length > 2)
            .slice(0, 8);
        if (!tokens.length)
            return { provider: 'blypIndex', results: [], costMicros: 0 };
        const snap = await firebaseAdmin_1.admin
            .firestore()
            .collection(types_1.COLLECTIONS.blypIndexDocs)
            .where('keywords', 'array-contains-any', tokens.slice(0, 10))
            .limit(limit)
            .get();
        const results = snap.docs.map((d) => {
            const data = d.data();
            return webResult('blypIndex', '1', { title: data.title || data.url, url: data.url, snippet: data.excerpt || data.description });
        });
        return { provider: 'blypIndex', results, costMicros: 0 };
    }
    catch (_a) {
        return { provider: 'blypIndex', results: [], costMicros: 0 };
    }
}
async function braveProvider(query, country, limit = 10) {
    var _a;
    const key = process.env.BRAVE_SEARCH_API_KEY;
    if (!key)
        return { provider: 'brave', results: [], costMicros: 0 };
    const params = new URLSearchParams({ q: query, count: String(limit) });
    if (country)
        params.set('country', country.toUpperCase());
    const data = await (0, net_1.fetchJson)(`https://api.search.brave.com/res/v1/web/search?${params.toString()}`, {
        headers: { 'X-Subscription-Token': key, Accept: 'application/json' },
    });
    const raw = ((_a = data === null || data === void 0 ? void 0 : data.web) === null || _a === void 0 ? void 0 : _a.results) || [];
    const results = raw.slice(0, limit).map((r) => webResult('brave', '1', { title: r.title, url: r.url, snippet: r.description }));
    // Brave Data-for-Search is ~$5/1000 queries => 5000 micro-USD per call.
    return { provider: 'brave', results, costMicros: results.length ? 5000 : 0 };
}
async function wikipediaProvider(query, limit = 3) {
    var _a;
    const params = new URLSearchParams({
        action: 'query',
        list: 'search',
        srsearch: query,
        format: 'json',
        srlimit: String(limit),
        origin: '*',
    });
    const data = await (0, net_1.fetchJson)(`https://en.wikipedia.org/w/api.php?${params.toString()}`);
    const hits = ((_a = data === null || data === void 0 ? void 0 : data.query) === null || _a === void 0 ? void 0 : _a.search) || [];
    const results = hits.slice(0, limit).map((h) => webResult('wikipedia', '1', {
        title: h.title,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(h.title).replace(/\s/g, '_'))}`,
        snippet: String(h.snippet || '').replace(/<[^>]+>/g, ''),
    }));
    return { provider: 'wikipedia', results, costMicros: 0 };
}
async function ddgProvider(query) {
    const params = new URLSearchParams({ q: query, format: 'json', no_html: '1', skip_disambig: '1' });
    const data = await (0, net_1.fetchJson)(`https://api.duckduckgo.com/?${params.toString()}`);
    const results = [];
    if (data === null || data === void 0 ? void 0 : data.AbstractURL) {
        results.push(webResult('ddg', '1', {
            title: data.Heading || query,
            url: data.AbstractURL,
            snippet: data.AbstractText || 'Official website',
            official: true,
        }));
    }
    ((data === null || data === void 0 ? void 0 : data.RelatedTopics) || []).slice(0, 4).forEach((t) => {
        if ((t === null || t === void 0 ? void 0 : t.FirstURL) && (t === null || t === void 0 ? void 0 : t.Text))
            results.push(webResult('ddg', '1', { title: t.Text, url: t.FirstURL, snippet: t.Text }));
    });
    return { provider: 'ddg', results, costMicros: 0 };
}
//# sourceMappingURL=webProviders.js.map