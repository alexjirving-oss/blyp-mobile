// webSearchService.js
//
// Real web results for the Blyp "search the web" experience, rendered as a
// Google-style list of sites (title, snippet, url, favicon) that open inside
// the in-app browser.
//
// Source strategy (best available, always degrades gracefully to []):
//   1. Google Programmable Search (JSON API) when EXPO_PUBLIC_GOOGLE_CSE_KEY +
//      EXPO_PUBLIC_GOOGLE_CSE_CX are configured. This is a true SERP and the
//      foundation for a monetisable search product.
//   2. Keyless blend otherwise: DuckDuckGo Instant Answer + Wikipedia search.
//      Reliable, no API key, CORS-free on native.
//
// For the full results page we always expose webSearchUrl(), which the in-app
// browser opens (a real WebView session is not bot-blocked the way server-side
// scraping is).

const IA_ENDPOINT = 'https://api.duckduckgo.com/';
const WIKI_ENDPOINT = 'https://en.wikipedia.org/w/api.php';
const CSE_ENDPOINT = 'https://www.googleapis.com/customsearch/v1';
const WEB_TIMEOUT_MS = 7000;

/** A full SERP URL for the query, openable in the in-app browser. */
export function webSearchUrl(query) {
  return `https://duckduckgo.com/?q=${encodeURIComponent(String(query || ''))}`;
}

function hostOf(url) {
  try {
    return String(url || '')
      .replace(/^https?:\/\//i, '')
      .split('/')[0]
      .replace(/^www\./i, '');
  } catch {
    return '';
  }
}

/** A real favicon for a site, so the list reads like a search engine. */
export function faviconFor(url) {
  const host = hostOf(url);
  if (!host) return null;
  return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(host)}`;
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

async function fetchJson(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEB_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, ...opts });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    clearTimeout(timer);
    return null;
  }
}

function withFavicon(r) {
  return { ...r, favicon: faviconFor(r.url), source: r.source || hostOf(r.url) };
}

// ---- Source: Google Programmable Search (real SERP) -----------------------
async function googleCse(q, limit) {
  const key = process.env.EXPO_PUBLIC_GOOGLE_CSE_KEY;
  const cx = process.env.EXPO_PUBLIC_GOOGLE_CSE_CX;
  if (!key || !cx) return null; // not configured

  const url = `${CSE_ENDPOINT}?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(
    cx
  )}&num=${Math.min(10, limit)}&q=${encodeURIComponent(q)}`;
  const data = await fetchJson(url);
  if (!data || !Array.isArray(data.items)) return null;
  return data.items.map((it) =>
    withFavicon({
      title: it.title || it.displayLink || q,
      snippet: it.snippet || '',
      url: it.link,
      source: it.displayLink || hostOf(it.link),
    })
  );
}

// ---- Source: DuckDuckGo Instant Answer ------------------------------------
function pushTopic(out, t) {
  if (!t) return;
  if (Array.isArray(t.Topics)) {
    for (const sub of t.Topics) pushTopic(out, sub);
    return;
  }
  const url = t.FirstURL;
  const text = t.Text;
  if (!url || !text) return;
  const dash = text.indexOf(' - ');
  const title = dash > 0 ? text.slice(0, dash) : text;
  const snippet = dash > 0 ? text.slice(dash + 3) : '';
  out.push({ title: title.trim(), snippet: snippet.trim(), url });
}

async function ddgInstant(q) {
  const url = `${IA_ENDPOINT}?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1&t=blyp`;
  const data = await fetchJson(url);
  if (!data) return [];
  const out = [];
  if (data.AbstractText && data.AbstractURL) {
    out.push({
      title: data.Heading || q,
      snippet: data.AbstractText,
      url: data.AbstractURL,
      source: data.AbstractSource || hostOf(data.AbstractURL),
    });
  }
  // DDG "Results" are the entity's official site(s) — tag them so the UI can
  // surface the official web address as a primary action.
  if (Array.isArray(data.Results)) {
    for (const r of data.Results) {
      const before = out.length;
      pushTopic(out, r);
      for (let i = before; i < out.length; i += 1) {
        out[i].official = true;
        if (!out[i].title || /official\s*site/i.test(out[i].title)) {
          out[i].title = data.Heading || q;
        }
        if (!out[i].snippet) out[i].snippet = 'Official website';
      }
    }
  }
  if (Array.isArray(data.RelatedTopics)) for (const t of data.RelatedTopics) pushTopic(out, t);
  return out;
}

// ---- Source: Wikipedia (reliable keyless results) -------------------------
async function wikiSearch(q, limit) {
  const url = `${WIKI_ENDPOINT}?action=query&list=search&srsearch=${encodeURIComponent(
    q
  )}&format=json&srlimit=${Math.min(10, limit)}&origin=*`;
  const data = await fetchJson(url);
  const items = data?.query?.search;
  if (!Array.isArray(items)) return [];
  return items.map((it) => {
    const slug = encodeURIComponent(String(it.title).replace(/ /g, '_'));
    return {
      title: it.title,
      snippet: decodeEntities(it.snippet),
      url: `https://en.wikipedia.org/wiki/${slug}`,
      source: 'Wikipedia',
    };
  });
}

/**
 * Fetch web results for a query as a Google-style list.
 * @returns {Promise<Array<{title:string, snippet:string, url:string, favicon?:string, source?:string}>>}
 */
export async function searchWeb(query, limit = 12) {
  const q = String(query || '').trim();
  if (!q) return [];

  try {
    // 1) Real SERP via Google CSE when configured.
    const cse = await googleCse(q, limit);
    if (cse && cse.length) return cse.slice(0, limit);

    // 2) Keyless blend.
    const [ddg, wiki] = await Promise.all([ddgInstant(q), wikiSearch(q, limit)]);
    const merged = [];
    // Lead with a DDG abstract if present (often the most on-topic summary).
    if (ddg[0] && ddg[0].source) merged.push(ddg[0]);
    for (const r of wiki) merged.push(r);
    for (const r of ddg) merged.push(r);

    const seen = new Set();
    const out = [];
    for (const r of merged) {
      if (!r?.url || seen.has(r.url)) continue;
      seen.add(r.url);
      out.push(withFavicon(r));
      if (out.length >= limit) break;
    }
    return out;
  } catch (e) {
    console.warn('[WEB_SEARCH] failed', e?.message || String(e));
    return [];
  }
}

export default { searchWeb, webSearchUrl, faviconFor };
