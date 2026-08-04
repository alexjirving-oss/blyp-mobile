/**
 * Web result providers. Order of preference at the orchestrator:
 *   1) blypIndex  - Blyp's OWN growing corpus (the endgame: no permanent partner)
 *   2) brave      - paid supplier, real coverage, used while we build the index
 *   3) wikipedia  - free encyclopaedic fallback
 *   4) ddg        - free instant-answer fallback / official-site detection
 *
 * Every provider returns provenance so results can be harvested into our corpus.
 */

import { admin, initFirebaseAdmin } from '../firebaseAdmin';
import { COLLECTIONS, NormalizedResult } from '../platform/types';
import { canonicalUrl, fingerprint, hostOf, sha256 } from '../platform/util';
import { fetchJson, ProviderRun } from './net';

const now = () => Date.now();
const faviconFor = (url?: string) => {
  const host = hostOf(url || '');
  return host ? `https://icons.duckduckgo.com/ip3/${host}.ico` : undefined;
};

function webResult(provider: string, providerVersion: string, r: { title: string; url: string; snippet?: string; official?: boolean }): NormalizedResult {
  const url = canonicalUrl(r.url);
  return {
    kind: 'web',
    title: r.title,
    snippet: r.snippet,
    url,
    source: hostOf(url),
    favicon: faviconFor(url),
    provenance: {
      provider,
      providerVersion,
      canonicalUrl: url,
      contentHash: sha256(`${r.title}\n${r.snippet || ''}`),
      fingerprint: fingerprint(`${r.title} ${r.snippet || ''}`),
      fetchedAt: now(),
      ownerType: r.official ? 'business' : 'publisher',
    },
  };
}

/** Blyp's own index - reads harvested pages. Empty until the corpus grows. */
export async function blypIndexProvider(query: string, limit = 8): Promise<ProviderRun> {
  try {
    initFirebaseAdmin();
    const tokens = query
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2)
      .slice(0, 8);
    if (!tokens.length) return { provider: 'blypIndex', results: [], costMicros: 0 };
    const snap = await admin
      .firestore()
      .collection(COLLECTIONS.blypIndexDocs)
      .where('keywords', 'array-contains-any', tokens.slice(0, 10))
      .limit(limit)
      .get();
    const results = snap.docs.map((d) => {
      const data = d.data() as any;
      return webResult('blypIndex', '1', { title: data.title || data.url, url: data.url, snippet: data.excerpt || data.description });
    });
    return { provider: 'blypIndex', results, costMicros: 0 };
  } catch {
    return { provider: 'blypIndex', results: [], costMicros: 0 };
  }
}

export async function braveProvider(query: string, country?: string, limit = 10): Promise<ProviderRun> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return { provider: 'brave', results: [], costMicros: 0 };
  const params = new URLSearchParams({ q: query, count: String(limit) });
  if (country) params.set('country', country.toUpperCase());
  const data = await fetchJson<any>(`https://api.search.brave.com/res/v1/web/search?${params.toString()}`, {
    headers: { 'X-Subscription-Token': key, Accept: 'application/json' },
  });
  const raw = data?.web?.results || [];
  const results: NormalizedResult[] = raw.slice(0, limit).map((r: any) =>
    webResult('brave', '1', { title: r.title, url: r.url, snippet: r.description })
  );
  // Brave Data-for-Search is ~$5/1000 queries => 5000 micro-USD per call.
  return { provider: 'brave', results, costMicros: results.length ? 5000 : 0 };
}

export async function wikipediaProvider(query: string, limit = 3): Promise<ProviderRun> {
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    format: 'json',
    srlimit: String(limit),
    origin: '*',
  });
  const data = await fetchJson<any>(`https://en.wikipedia.org/w/api.php?${params.toString()}`);
  const hits = data?.query?.search || [];
  const results: NormalizedResult[] = hits.slice(0, limit).map((h: any) =>
    webResult('wikipedia', '1', {
      title: h.title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(h.title).replace(/\s/g, '_'))}`,
      snippet: String(h.snippet || '').replace(/<[^>]+>/g, ''),
    })
  );
  return { provider: 'wikipedia', results, costMicros: 0 };
}

export async function ddgProvider(query: string): Promise<ProviderRun> {
  const params = new URLSearchParams({ q: query, format: 'json', no_html: '1', skip_disambig: '1' });
  const data = await fetchJson<any>(`https://api.duckduckgo.com/?${params.toString()}`);
  const results: NormalizedResult[] = [];
  if (data?.AbstractURL) {
    results.push(
      webResult('ddg', '1', {
        title: data.Heading || query,
        url: data.AbstractURL,
        snippet: data.AbstractText || 'Official website',
        official: true,
      })
    );
  }
  (data?.RelatedTopics || []).slice(0, 4).forEach((t: any) => {
    if (t?.FirstURL && t?.Text) results.push(webResult('ddg', '1', { title: t.Text, url: t.FirstURL, snippet: t.Text }));
  });
  return { provider: 'ddg', results, costMicros: 0 };
}
