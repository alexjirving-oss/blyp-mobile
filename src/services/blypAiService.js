// blypAiService.js
//
// The "blyp it" answer engine. Powers the AI bar on Home: a user asks anything
// in natural language and gets back:
//   - a concise AI answer (Gemini), and
//   - blended, real in-app results (posts + creators from Firestore).
//
// Everything degrades gracefully: no Gemini key -> results-only; Firebase
// disabled -> answer-only. Nothing here throws to the caller.

import { db, firebaseEnabled, geminiApiKey, geminiApiUrl, geminiAuthHeaders } from '../config/firebase';
import { fixStorageUrl } from '../utils/urlUtils';
import { searchPlace } from './placesService';
import { backendSearch, isBackendSearchEnabled } from './blypSearchClient';

const ANSWER_TIMEOUT_MS = 20000;

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'her',
  'was', 'one', 'our', 'out', 'has', 'what', 'whats', 'who', 'how', 'why',
  'when', 'where', 'show', 'me', 'find', 'a', 'an', 'of', 'to', 'in', 'on',
  'is', 'it', 'my', 'do', 'i', 'with', 'near', 'best', 'top', 'some', 'this',
]);

// "Generic" modifier words that should NOT, on their own, make a post relevant.
// Searching "arsenal latest news" must match on "arsenal", not on "news".
const GENERIC_TERMS = new Set([
  'news', 'latest', 'update', 'updates', 'video', 'videos', 'clip', 'clips',
  'post', 'posts', 'watch', 'today', 'live', 'new', 'recent', 'trending',
  'highlight', 'highlights', 'review', 'reviews', 'guide', 'tips', 'info',
  'about', 'near', 'open', 'opening', 'hours', 'store', 'shop',
]);

// Words that signal the user wants in-app posts/videos rather than a place/site.
const CONTENT_HINT = /\b(video|videos|clip|clips|funny|meme|memes|watch|highlight|highlights|tutorial|how to|recipe|recipes|song|songs|music|dance|trend|trending|creator|creators|tiktok|reel|reels|vlog|gameplay)\b/i;
// Words that signal a place / business / local intent.
const PLACE_HINT = /\b(shop|store|restaurant|cafe|coffee|pub|bar|hotel|near\s*me|nearby|nearest|closest|around\s*me|address|directions|phone number|opening hours|open now|branch|store near|petrol|garage|pharmacy|supermarket|takeaway|menu|mcdonald'?s?)\b/i;

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[#@]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

// A cheap, deterministic intent guess used to (a) decide whether to do a place
// lookup and (b) order result sections when the AI is unavailable.
function guessIntent(query) {
  const q = String(query || '');
  if (CONTENT_HINT.test(q)) return 'content';
  if (PLACE_HINT.test(q)) return 'place';
  return 'info';
}

/**
 * Ask Gemini for a short, friendly, useful answer. Returns '' on any failure
 * or when no key is configured (caller then shows results only).
 */
// Pull a JSON object out of a model response that may be wrapped in prose or
// ```json fences. Returns null if nothing parseable is found.
function stripFences(text) {
  return String(text || '')
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim();
}

function extractJson(text) {
  if (!text) return null;
  const candidate = stripFences(text);
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

// Last-resort salvage for when the model returns truncated/invalid JSON: pull
// the "answer" string (even if its closing quote is missing) and any "related"
// items via regex, so the user still sees a clean answer instead of raw JSON.
function salvageAnswer(text) {
  const cleaned = stripFences(text);
  let answer = '';
  const m = cleaned.match(/"answer"\s*:\s*"((?:[^"\\]|\\.)*)/);
  if (m && m[1]) {
    try {
      answer = JSON.parse('"' + m[1].replace(/"+$/, '') + '"');
    } catch {
      answer = m[1].replace(/\\"/g, '"').replace(/\\n/g, ' ').trim();
    }
  }
  const related = [];
  const rel = cleaned.match(/"related"\s*:\s*\[([\s\S]*?)\]/);
  if (rel && rel[1]) {
    const items = rel[1].match(/"((?:[^"\\]|\\.)*)"/g) || [];
    for (const it of items) {
      try {
        related.push(JSON.parse(it));
      } catch {
        /* ignore */
      }
    }
  }
  // If there was no JSON shape at all, treat the whole cleaned text as the answer
  // (model occasionally answers in plain prose), but never echo raw JSON braces.
  if (!answer && !/[{}[\]"]/.test(cleaned)) answer = cleaned;
  return { answer: answer.trim(), related: related.slice(0, 3) };
}

function buildContext(posts, creators) {
  const lines = [];
  if (creators?.length) {
    lines.push(
      'Creators on Blyp: ' +
        creators
          .slice(0, 5)
          .map((u) => `@${u.username || u.displayName || 'user'}`)
          .join(', ')
    );
  }
  if (posts?.length) {
    lines.push(
      'Posts on Blyp: ' +
        posts
          .slice(0, 5)
          .map((p) => `"${(p.title || p.caption || p.description || 'post').slice(0, 60)}"`)
          .join('; ')
    );
  }
  return lines.join('\n');
}

async function getAnswer(queryText, context = '', history = []) {
  if (!geminiApiKey || !geminiApiUrl) return { text: '', usedAI: false, related: [], intent: '', placeName: '' };

  const grounding = context
    ? `\n\nHere is real, relevant content currently on Blyp you can reference naturally in your answer (don't list it verbatim, the app shows it below):\n${context}`
    : '';

  const convo =
    Array.isArray(history) && history.length
      ? `\n\nThis is an ongoing conversation. Earlier turns (oldest first):\n` +
        history
          .slice(-4)
          .map((t) => `User: ${t.q}\nBlyp: ${t.a}`)
          .join('\n') +
        `\n\nUse this context to resolve references like "it", "they", "that one" in the new question.`
      : '';

  const nowLocal = new Date().toString();
  const prompt = `You are Blyp's assistant — a helpful, conversational AI like ChatGPT, living inside the Blyp app. A user typed this in:

"${queryText}"${convo}${grounding}

Current local date and time: ${nowLocal}.
Treat that timestamp as "now" / "today" for any time-sensitive question (dates, schedules, "what day is it", news, sports fixtures). Never invent an outdated year from training data when answering about the present.

Respond ONLY with a JSON object of this exact shape:
{"answer": "<a genuinely helpful, conversational answer>", "intent": "<one of: place | content | info>", "place": "<if intent is place, the business/place name to look up, else empty>", "related": ["<follow-up>", "<follow-up>", "<follow-up>"]}

Rules:
- "answer": actually answer the question like a knowledgeable assistant would. Aim for a short paragraph (2-5 sentences); go a little longer only if the question genuinely needs it. Be direct and natural — no markdown headings, no bullet symbols, no "as an AI" preamble. If you're unsure or info may be out of date, say so briefly.
- "intent" = "place" only when the query is clearly a specific shop/business/restaurant/local place to find (e.g. "B&Q", "Nando's near me"). "content" when the user explicitly wants videos/posts/clips to watch (e.g. "funny videos"). Otherwise "info" (the default for normal questions).
- "related" = 3 short follow-up questions the user might ask next, each under 6 words.
- If Blyp content is provided above, you may reference it naturally, but never just list it.`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 2048, responseMimeType: 'application/json' },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ANSWER_TIMEOUT_MS);
  try {
    const res = await fetch(geminiApiUrl, {
      method: 'POST',
      headers: await geminiAuthHeaders(),
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn('[BLYP_AI] answer request failed', res.status);
      let errBody = null;
      try {
        errBody = await res.json();
      } catch {
        /* ignore */
      }
      if (res.status === 402) {
        return {
          text: '',
          usedAI: false,
          related: [],
          intent: '',
          placeName: '',
          error: errBody?.error || errBody || { message: 'subscription_required' },
        };
      }
      return { text: '', usedAI: false, related: [], intent: '', placeName: '' };
    }
    const json = await res.json();
    const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    const parsed = extractJson(raw);
    if (parsed && typeof parsed.answer === 'string') {
      const related = Array.isArray(parsed.related)
        ? parsed.related.map((s) => String(s).trim()).filter(Boolean).slice(0, 4)
        : [];
      const intent = ['place', 'content', 'info'].includes(parsed.intent) ? parsed.intent : '';
      const placeName = typeof parsed.place === 'string' ? parsed.place.trim() : '';
      return { text: parsed.answer.trim(), usedAI: !!parsed.answer.trim(), related, intent, placeName };
    }
    // Fallback: salvage a clean answer from malformed/truncated output so the
    // user never sees raw JSON or code fences.
    const salvaged = salvageAnswer(raw);
    return { text: salvaged.answer, usedAI: !!salvaged.answer, related: salvaged.related, intent: '', placeName: '' };
  } catch (e) {
    clearTimeout(timer);
    console.warn('[BLYP_AI] answer error', e?.message || String(e));
    return { text: '', usedAI: false, related: [], intent: '', placeName: '' };
  }
}

function scoreHaystack(haystack, coreTerms, genericTerms) {
  let core = 0;
  let generic = 0;
  for (const term of coreTerms) if (haystack.includes(term)) core += 1;
  for (const term of genericTerms) if (haystack.includes(term)) generic += 1;
  return { core, generic };
}

function scorePost(post, coreTerms, genericTerms) {
  const haystack = [
    post.title,
    post.captionTitle,
    post.caption,
    post.description,
    post.username,
    post.userDisplayName,
    Array.isArray(post.hashtags) ? post.hashtags.join(' ') : post.hashtags,
    post.category,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return scoreHaystack(haystack, coreTerms, genericTerms);
}

// Split tokens into "core" (entity-defining) vs "generic" modifiers. A result
// is only relevant if it matches a CORE term — this stops "arsenal latest news"
// from pulling in random posts that merely contain "news".
function splitTerms(terms) {
  const core = terms.filter((t) => !GENERIC_TERMS.has(t));
  const generic = terms.filter((t) => GENERIC_TERMS.has(t));
  return { core, generic };
}

// Normalise a raw query for exact/phrase matching: lowercase, strip #/@, collapse
// whitespace. Used to boost handle / hashtag / category / title hits so the most
// obvious result ranks first regardless of tokenisation.
function normalizeQuery(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[#@]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// How many recent docs to scan. We have no server-side text index, so we pull a
// generous recent window and rank in memory. These are one-shot reads on submit
// (not per-keystroke), and match the server search providers' windows.
const POST_SCAN_LIMIT = 200;
const USER_SCAN_LIMIT = 300;

async function searchPosts(terms, rawQuery = '') {
  if (!firebaseEnabled || !db?.collection) return [];
  try {
    const snap = await db.collection('posts').orderBy('date', 'desc').limit(POST_SCAN_LIMIT).get();
    const all = (snap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
    if (terms.length === 0 && !rawQuery) return all.slice(0, 12);
    const { core, generic } = splitTerms(terms);
    const requireCore = core.length > 0;
    const ql = normalizeQuery(rawQuery);
    return all
      .map((p) => {
        const { core: c, generic: g } = scorePost(p, requireCore ? core : terms, requireCore ? generic : []);
        // Exact/phrase boosts: an exact hashtag, category or handle hit is the
        // strongest possible relevance signal and must outrank loose token hits.
        let boost = 0;
        if (ql && ql.length >= 2) {
          const tags = Array.isArray(p.hashtags)
            ? p.hashtags.map((h) => String(h).toLowerCase().replace(/^#/, ''))
            : [];
          if (tags.includes(ql)) boost += 4;
          if (String(p.category || '').toLowerCase() === ql) boost += 4;
          if (String(p.username || '').toLowerCase() === ql) boost += 3;
          if (String(p.userDisplayName || '').toLowerCase().includes(ql)) boost += 2;
          if (String(p.title || p.caption || p.description || '').toLowerCase().includes(ql)) boost += 1;
        }
        return { p, core: c, generic: g, boost };
      })
      .filter((x) => (requireCore ? x.core > 0 || x.boost > 0 : x.core + x.generic + x.boost > 0))
      .sort((a, b) => b.core + b.boost - (a.core + a.boost) || b.generic - a.generic)
      .slice(0, 30)
      .map((x) => x.p);
  } catch (e) {
    console.warn('[BLYP_AI] post search failed', e?.message || String(e));
    return [];
  }
}

async function searchCreators(terms, rawQuery = '') {
  if (!firebaseEnabled || !db?.collection) return [];
  const { core } = splitTerms(terms);
  const ql = normalizeQuery(rawQuery);
  // Allow short queries the tokenizer drops (e.g. "dj", "pk", a 2-char handle) to
  // still find a creator via the raw-query path.
  if (core.length === 0 && ql.length < 2) return [];
  try {
    const snap = await db.collection('users').limit(USER_SCAN_LIMIT).get();
    const all = (snap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
    return all
      .map((u) => {
        const uname = String(u.username || '').toLowerCase();
        const dname = String(u.displayName || u.name || '').toLowerCase();
        const bio = String(u.bio || '').toLowerCase();
        let score = 0;
        // Token hits: a username/displayName hit means more than a bio mention.
        for (const term of core) {
          if (uname.includes(term) || dname.includes(term)) score += 2;
          else if (bio.includes(term)) score += 1;
        }
        // Whole-query handle/name match dominates: exact > prefix > substring.
        if (ql.length >= 2) {
          if (uname === ql || dname === ql) score += 8;
          else if (uname.startsWith(ql) || dname.startsWith(ql)) score += 5;
          else if (uname.includes(ql) || dname.includes(ql)) score += 3;
        }
        return { u, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((x) => x.u);
  } catch (e) {
    console.warn('[BLYP_AI] creator search failed', e?.message || String(e));
    return [];
  }
}

/** Convenience for the UI: a usable thumbnail URL for a post. */
export function postThumbnail(post) {
  return fixStorageUrl(
    post?.thumbnail ||
      post?.imageUrl ||
      post?.media?.[0]?.thumbnail ||
      post?.media?.[0]?.url ||
      post?.videoUrl ||
      post?.mediaUrl
  );
}

function buildSources(creators, posts) {
  return [
    ...creators.slice(0, 2).map((u) => ({ type: 'creator', item: u })),
    ...posts.slice(0, 3).map((p) => ({ type: 'post', item: p })),
  ];
}

/**
 * Fast, AI-free content search: real in-app posts + creators, a heuristic intent,
 * and (for place intent) a keyless OSM place lookup. This is what the search bar
 * shows IMMEDIATELY — no waiting on Gemini. Returns instantly-renderable results.
 */
export async function blypContent(queryText, options = {}) {
  const query = String(queryText || '').trim();
  if (!query) {
    return { query: '', posts: [], creators: [], sources: [], web: [], intent: 'info', place: null };
  }
  const terms = tokenize(query);
  const [posts, creators] = await Promise.all([
    searchPosts(terms, query),
    searchCreators(terms, query),
  ]);
  const intent = guessIntent(query);
  let place = null;
  if (intent === 'place' || options.forcePlace) {
    place = await searchPlace(query, options.geo);
  }
  return {
    query,
    posts,
    creators,
    sources: buildSources(creators, posts),
    web: [],
    intent: place ? 'place' : intent,
    place,
  };
}

/**
 * Merge backend + on-device results so a sparse/failed section never blanks the UI.
 * Prefer backend web/answer/place; fill posts/creators/place from local when missing.
 */
export function mergeSearchResults(backend, local) {
  if (!backend && !local) {
    return { query: '', posts: [], creators: [], sources: [], web: [], intent: 'info', place: null };
  }
  if (!backend) return { ...local, web: local?.web || [] };
  if (!local) return backend;
  const posts = backend.posts?.length ? backend.posts : local.posts || [];
  const creators = backend.creators?.length ? backend.creators : local.creators || [];
  const place = backend.place || local.place || null;
  const web = Array.isArray(backend.web) ? backend.web : [];
  let intent = backend.intent || local.intent || 'info';
  if (place && intent !== 'content') intent = 'place';
  return {
    ...backend,
    posts,
    creators,
    place,
    web,
    intent,
    sources: backend.sources?.length ? backend.sources : local.sources || [],
    related: backend.related?.length ? backend.related : local.related || [],
  };
}

/**
 * The conversational AI answer for a query, grounded on the content we already
 * found. Returns { text, usedAI, related, intent, placeName }. Empty/no-AI safe.
 */
export async function blypAnswer(queryText, options = {}) {
  const query = String(queryText || '').trim();
  if (!query) return { text: '', usedAI: false, related: [], intent: '', placeName: '' };
  const history = Array.isArray(options.history) ? options.history : [];
  const context = buildContext(options.posts, options.creators);
  return getAnswer(query, context, history);
}

/**
 * Main entry point. Returns blended AI answer + real in-app results.
 * @param {string} queryText
 * @param {{ history?: any[], wantAnswer?: boolean }} options
 *   wantAnswer=false skips the (slow, Plus-only) Gemini call entirely so free
 *   users get instant results instead of waiting on an answer they won't see.
 */
export async function blypIt(queryText, options = {}) {
  const query = String(queryText || '').trim();
  if (!query) {
    return { query: '', answer: '', usedAI: false, related: [], posts: [], creators: [], sources: [], web: [], intent: 'info', place: null };
  }

  // Prefer Blyp's own backend (hides keys, blends sources, builds our corpus).
  // Falls back transparently to the on-device path if it's unconfigured/unreachable.
  if (isBackendSearchEnabled()) {
    const backend = await backendSearch(query, { session: options.session, geo: options.geo });
    if (backend) return backend;
  }

  const history = Array.isArray(options.history) ? options.history : [];
  const wantAnswer = options.wantAnswer !== false;
  const terms = tokenize(query);

  // Run content search and the AI answer concurrently so total latency is the
  // slower of the two, not their sum. Conversational by design: no web results.
  const contentPromise = Promise.all([searchPosts(terms, query), searchCreators(terms, query)]);
  const answerPromise = wantAnswer
    ? getAnswer(query, '', history)
    : Promise.resolve({ text: '', usedAI: false, related: [], intent: '', placeName: '' });
  const [[posts, creators], answerRes] = await Promise.all([contentPromise, answerPromise]);

  const intent = answerRes.intent || guessIntent(query);
  let place = null;
  if (intent === 'place') {
    place = await searchPlace(answerRes.placeName || query, options.geo);
  }

  return {
    query,
    answer: answerRes.text,
    usedAI: answerRes.usedAI,
    related: answerRes.related || [],
    posts,
    creators,
    sources: buildSources(creators, posts),
    web: [],
    intent,
    place,
  };
}

export const isBlypAiAvailable = () => Boolean(geminiApiKey && geminiApiUrl);

export default { blypIt, blypContent, blypAnswer, mergeSearchResults, postThumbnail, isBlypAiAvailable };
