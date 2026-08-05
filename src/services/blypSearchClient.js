// blypSearchClient.js
//
// Thin client for Blyp's OWN search backend (Firebase function `blypSearch`).
// The backend hides all supplier keys, blends sources, caches, and - critically -
// harvests every query/result into Blyp's proprietary corpus (see BLYP_CHARTER.md).
//
// Cutover is safe: if EXPO_PUBLIC_BLYP_SEARCH_URL is not set (e.g. before the
// functions are deployed), backendSearch() returns null and blypAiService falls
// back to the legacy on-device path. Nothing breaks.

const FUNCTIONS_BASE = String(
  process.env.EXPO_PUBLIC_FUNCTIONS_BASE_URL ||
    process.env.EXPO_PUBLIC_FIREBASE_BRIDGE_BASE_URL ||
    '',
)
  .trim()
  .replace(/\/$/, '');

const SEARCH_URL =
  String(process.env.EXPO_PUBLIC_BLYP_SEARCH_URL || '').trim() ||
  (FUNCTIONS_BASE ? `${FUNCTIONS_BASE}/blypSearch` : '');
const EVENT_URL =
  String(process.env.EXPO_PUBLIC_BLYP_SEARCH_EVENT_URL || '').trim() ||
  (SEARCH_URL ? SEARCH_URL.replace(/blypSearch(?!Event)/, 'blypSearchEvent') : '');

const TIMEOUT_MS = 12000;

export const isBackendSearchEnabled = () => Boolean(SEARCH_URL);

function mapWeb(r) {
  return {
    title: r.title,
    url: r.url,
    snippet: r.snippet,
    source: r.source,
    favicon: r.favicon,
    official: r?.provenance?.ownerType === 'business',
    provider: r?.provenance?.provider,
  };
}

// Score a place by how *actionable* it is — the whole point of a place search is
// to call, navigate to, or open the website. The most contactable result wins the
// hero card, not just whichever OSM returned first.
function placeScore(place) {
  if (!place) return -1;
  return (
    (place.precise ? 3 : 0) +
    (place.phone ? 2 : 0) +
    (place.website ? 2 : 0) +
    (place.openingHours ? 1 : 0) +
    (place.address ? 1 : 0)
  );
}

// Map the backend response into the exact shape blypAiService.blypIt returns, so
// BlypScreen needs no knowledge of where results came from.
function mapResponse(query, data) {
  const places = Array.isArray(data.places) ? data.places : [];
  const firstPlace =
    places
      .map((p) => p.place)
      .filter(Boolean)
      .sort((a, b) => placeScore(b) - placeScore(a))[0] || null;
  return {
    query,
    answer: String(data.answer || ''),
    usedAI: Boolean(data.answer),
    related: Array.isArray(data.related) ? data.related : [],
    posts: (Array.isArray(data.posts) ? data.posts : []).map((r) => r.entity || {}).filter((p) => p && p.id),
    creators: (Array.isArray(data.creators) ? data.creators : []).map((r) => r.entity || {}).filter((c) => c && c.id),
    sources: [],
    web: (Array.isArray(data.web) ? data.web : []).map(mapWeb),
    intent: data.intent || 'info',
    place: firstPlace,
    sponsored: (Array.isArray(data.sponsored) ? data.sponsored : []).map(mapWeb),
    _backend: true,
    _meta: data.meta || null,
  };
}

/**
 * Run a search against the Blyp backend. Returns the mapped result, or null if
 * the backend is unconfigured/unreachable (caller should fall back).
 */
export async function backendSearch(query, options = {}) {
  if (!SEARCH_URL) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        session: options.session || 'anon',
        geo: options.geo || undefined,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data !== 'object') return null;
    return mapResponse(query, data);
  } catch (e) {
    clearTimeout(timer);
    console.warn('[blypSearchClient] backend search failed, falling back', e?.message || String(e));
    return null;
  }
}

/**
 * Report a click or in-app page snapshot back to the corpus. Fire-and-forget;
 * never throws. Snapshots are how Blyp grows its own index.
 */
export function reportSearchEvent(payload) {
  if (!EVENT_URL || !payload) return;
  try {
    fetch(EVENT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch {
    /* non-fatal */
  }
}

export default { backendSearch, reportSearchEvent, isBackendSearchEnabled };
