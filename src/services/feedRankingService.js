// feedRankingService.js
//
// Pure ranking for the "For You" feed. Orders posts by score (follows,
// interests/hashtags, engagement/gifts, watch quality, mild freshness,
// recent-seen, earn-your-reach, admin priority, coin-promote) then a
// diversity pass (hard no creator stack + preferred gap, hashtag spacing,
// followed/discovery alternation). Display order is never pure date-desc.
//
// Admin priority rule (documented):
//   effectiveAdjust = accountAdjust(feedPriorityAccount) + postAdjust(feedPriority)
//   Tiers (both account + post): suppress | low | standard | high | boost
//   Legacy aliases: less → low; creatorFeedWeight on user docs also accepted.
//   Account `suppress` ≈ practically don't show (filtered from For You /
//   discovery rails; remaining weight is extreme bottom if still present).
//
// Promote boost (paid): attachPromoteBoost → promoteBoostAdjust; fair-capped
// via applyPromoteFairCap so organic content is not buried.

import { db, firebaseEnabled } from '../config/firebase';
import {
  attachPromoteBoost,
  applyPromoteFairCap,
  promoteBoostAdjust,
  isPromotedPost,
} from './promoteBoostService';

const HOUR_MS = 60 * 60 * 1000;
const FRESHNESS_HALF_LIFE_HOURS = 24;
/** Alternate followed vs discovery sooner so the mix does not read as one rail. */
const MAX_SOURCE_STREAK = 1;
/** Prefer at least this many other creators between repeats from the same author. */
const MIN_CREATOR_GAP = 4;
/**
 * Freshness is a mild signal — keep well below follow (+26) and multi-tag affinity
 * (up to HASHTAG_MATCH_CAP) so the feed does not feel newest-first.
 */
const FRESHNESS_SCALE = 14;
/** Soft: prefer not to re-use a tag within this many prior posts. */
const MIN_HASHTAG_GAP = 4;
/** Soft: prefer not to re-use the same topic cluster within this many prior posts. */
const MIN_TOPIC_GAP = 3;
/** In the last TOPIC_DENSITY_WINDOW picks, prefer ≤ this many from one cluster. */
const TOPIC_DENSITY_WINDOW = 6;
const MAX_TOPIC_IN_WINDOW = 2;
const HASHTAG_MATCH_WEIGHT = 14;
const HASHTAG_MATCH_CAP = 36;
const TOPIC_MATCH_WEIGHT = 8;
const TOPIC_MATCH_CAP = 24;
/** Older-than-window seen: still beats a single niche stack, not a follow+tag pile. */
const SEEN_PENALTY = -42;
const UNSEEN_BONUS = 10;
/** Most recently watched clip — must lose to any unseen alternative. */
const JUST_WATCHED_PENALTY = -120;
/** Recency gradient over this many latest impressions (oldest→newest seenOrder). */
const RECENT_SEEN_WINDOW = 12;
const RECENT_SEEN_FLOOR = -48;
/** Same-creator fatigue after a watch in this session. */
const CREATOR_JUST_WATCHED_PENALTY = -40;
const CREATOR_RECENT_WINDOW = 3;
/** Unseen clip from a creator not in the recent watch window. */
const EXPLORATION_BONUS = 22;

function finiteCount(...values) {
  return Math.max(
    0,
    ...values.map((value) => {
      const n = Array.isArray(value) ? value.length : Number(value);
      return Number.isFinite(n) ? n : 0;
    }),
  );
}

function postOwner(post) {
  return String(post?.userId || post?.uid || post?.authorId || '').trim();
}

function postId(post) {
  return post?.id != null ? String(post.id) : '';
}

/**
 * Oldest → newest watch/impression ids. Prefer explicit `seenOrder`;
 * a Set/array of `seenIds` is last-resort (no recency).
 * @param {string[]|Set<string>|undefined} seenIds
 * @param {string[]|undefined} seenOrder
 * @returns {string[]}
 */
export function normalizeSeenOrder(seenIds, seenOrder) {
  if (Array.isArray(seenOrder) && seenOrder.length) {
    return seenOrder.map((id) => String(id || '')).filter(Boolean);
  }
  if (seenIds instanceof Set) {
    return [...seenIds].map((id) => String(id || '')).filter(Boolean);
  }
  if (Array.isArray(seenIds)) {
    return seenIds.map((id) => String(id || '')).filter(Boolean);
  }
  return [];
}

/**
 * Recency-weighted watch penalty. Just-watched is far below unseen;
 * the last RECENT_SEEN_WINDOW impressions fade toward SEEN_PENALTY.
 */
export function seenAdjust(post, seenOrder = []) {
  const id = postId(post);
  if (!id || !seenOrder.length) return UNSEEN_BONUS;
  const idx = seenOrder.lastIndexOf(id);
  if (idx < 0) return UNSEEN_BONUS;
  const fromEnd = seenOrder.length - 1 - idx;
  if (fromEnd >= RECENT_SEEN_WINDOW) return SEEN_PENALTY;
  const span = Math.max(1, RECENT_SEEN_WINDOW - 1);
  const t = fromEnd / span;
  return JUST_WATCHED_PENALTY + t * (RECENT_SEEN_FLOOR - JUST_WATCHED_PENALTY);
}

/**
 * Down-rank other clips from a creator the viewer just watched.
 * @param {any} post
 * @param {string[]} recentCreators oldest → newest creator ids
 */
export function creatorFatigueAdjust(post, recentCreators = []) {
  const owner = postOwner(post);
  if (!owner || !recentCreators.length) return 0;
  const idx = recentCreators.lastIndexOf(owner);
  if (idx < 0) return 0;
  const fromEnd = recentCreators.length - 1 - idx;
  if (fromEnd === 0) return CREATOR_JUST_WATCHED_PENALTY;
  if (fromEnd < CREATOR_RECENT_WINDOW) {
    return Math.round(CREATOR_JUST_WATCHED_PENALTY / 2);
  }
  return 0;
}

/** Lift unseen clips whose creator is not in the recent watch window. */
export function explorationAdjust(post, seenOrder = [], recentCreators = []) {
  const id = postId(post);
  if (!id || seenOrder.lastIndexOf(id) >= 0) return 0;
  const owner = postOwner(post);
  if (owner && recentCreators.slice(-CREATOR_RECENT_WINDOW).includes(owner)) {
    return 0;
  }
  return EXPLORATION_BONUS;
}

function recentCreatorsFromSeen(posts, seenOrder, explicit) {
  if (Array.isArray(explicit) && explicit.length) {
    return explicit.map((id) => String(id || '').trim()).filter(Boolean);
  }
  const ownerById = new Map();
  for (const p of posts || []) {
    const id = postId(p);
    const owner = postOwner(p);
    if (id && owner) ownerById.set(id, owner);
  }
  return seenOrder.map((id) => ownerById.get(String(id))).filter(Boolean);
}

/** First-occurrence id wins so ranking never re-emits the same clip twice. */
export function dedupeRankCandidates(posts) {
  if (!Array.isArray(posts) || posts.length === 0) return posts || [];
  const out = [];
  const seen = new Set();
  for (const p of posts) {
    const id = postId(p);
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    out.push(p);
  }
  return out;
}

/** Normalize a hashtag / interest token for matching. */
export function normalizeTagToken(raw) {
  return String(raw || '')
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '');
}

/**
 * Collect post hashtags from dedicated fields plus `#tokens` in title/caption.
 * @param {any} post
 * @returns {string[]}
 */
export function extractPostHashtags(post) {
  const out = new Set();
  const add = (value) => {
    const token = normalizeTagToken(value);
    if (token.length >= 2) out.add(token);
  };
  for (const list of [post?.hashtags, post?.tags, post?.sportTags]) {
    if (Array.isArray(list)) {
      list.forEach(add);
    } else if (list != null && list !== '') {
      String(list).split(/[\s,]+/).forEach(add);
    }
  }
  const text = [post?.title, post?.caption, post?.description]
    .filter(Boolean)
    .join(' ');
  const matches = text.match(/#[a-zA-Z0-9_]+/g) || [];
  matches.forEach(add);
  return [...out];
}

function postTimeMs(post) {
  const raw = post?.date ?? post?.createdAt ?? post?.publishedAt ?? post?.timestamp;
  if (raw?.toMillis) return raw.toMillis();
  if (raw?.seconds != null) return Number(raw.seconds) * 1000;
  if (raw instanceof Date) return raw.getTime();
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n < 10_000_000_000 ? n * 1000 : n;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function engagementAdjust(post) {
  const likes = finiteCount(post?.likeCount, post?.likes, post?.likedBy);
  const comments = finiteCount(
    post?.commentCount,
    post?.commentsCount,
    post?.comments,
  );
  const shares = finiteCount(post?.shareCount, post?.sharesCount, post?.shares);
  const gifts = finiteCount(post?.giftCoins, post?.coinsReceived, post?.giftTotalCoins);
  const weighted = likes + comments * 2 + shares * 4;
  return Math.min(24, Math.log1p(weighted) * 4) + Math.min(10, Math.log1p(gifts) * 1.5);
}

function watchAdjust(post) {
  const reach = post?.reach || {};
  const e = reach.engagements || {};
  const impressions = finiteCount(reach.impressions);
  if (impressions < 1) return 0;
  const completionRate = Math.min(1, finiteCount(e.completions) / impressions);
  const averageDwellSeconds = Math.min(
    20,
    finiteCount(e.dwellMsTotal) / 1000 / impressions,
  );
  return completionRate * 14 + averageDwellSeconds * 0.35;
}

function freshnessAdjust(post, now) {
  const timestamp = postTimeMs(post);
  if (!timestamp) return 0;
  const ageHours = Math.max(0, (now - timestamp) / HOUR_MS);
  return FRESHNESS_SCALE * Math.pow(0.5, ageHours / FRESHNESS_HALF_LIFE_HOURS);
}

function interestAdjust(post, terms) {
  if (!terms?.length) return 0;
  const tags = extractPostHashtags(post);
  const hay = [
    post?.title,
    post?.caption,
    post?.description,
    post?.category,
    post?.topic,
    post?.topicId,
    Array.isArray(post?.hashtags) ? post.hashtags.join(' ') : post?.hashtags,
    Array.isArray(post?.tags) ? post.tags.join(' ') : post?.tags,
    Array.isArray(post?.sportTags) ? post.sportTags.join(' ') : post?.sportTags,
    tags.join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  let matches = 0;
  for (const term of terms) {
    const needle = String(term || '').trim().toLowerCase();
    if (needle && hay.includes(needle)) matches += 1;
  }
  return Math.min(TOPIC_MATCH_CAP, matches * TOPIC_MATCH_WEIGHT);
}

/**
 * Dedicated hashtag / tag affinity — stronger than lexical topic substring hits
 * so For You mixes toward interest-tagged content instead of pure recency.
 */
export function hashtagAffinityAdjust(post, terms) {
  if (!terms?.length) return 0;
  const tags = extractPostHashtags(post);
  if (!tags.length) return 0;
  const termTokens = [
    ...new Set(
      (terms || [])
        .map((term) => normalizeTagToken(term))
        .filter((term) => term.length >= 2),
    ),
  ];
  if (!termTokens.length) return 0;

  let matches = 0;
  for (const tag of tags) {
    let hit = false;
    for (const term of termTokens) {
      if (tag === term || tag.includes(term) || term.includes(tag)) {
        hit = true;
        break;
      }
    }
    if (hit) matches += 1;
  }
  return Math.min(HASHTAG_MATCH_CAP, matches * HASHTAG_MATCH_WEIGHT);
}

const AUDITION_BOOST = 18; // guaranteed early sampling for fresh posts
const AUDITION_SETTLE = 40; // impressions over which the audition boost fades

/** Score weights for the 5 admin feed tiers. */
export const FEED_PRIORITY_WEIGHTS = Object.freeze({
  suppress: -500,
  low: -60,
  standard: 0,
  high: 80,
  boost: 150,
});

const ACCOUNT_CACHE_TTL_MS = 60_000;
/** @type {Map<string, { tier: string, at: number }>} */
const accountPriorityCache = new Map();

/**
 * Normalize any raw admin priority string to a canonical 5-tier value.
 * @param {unknown} raw
 * @returns {'suppress'|'low'|'standard'|'high'|'boost'}
 */
export function normalizeFeedPriorityTier(raw) {
  const v = String(raw || 'standard').trim().toLowerCase();
  if (v === 'less') return 'low';
  if (v === 'suppress' || v === 'low' || v === 'standard' || v === 'high' || v === 'boost') {
    return v;
  }
  return 'standard';
}

export function feedPriorityWeight(tier) {
  const t = normalizeFeedPriorityTier(tier);
  return FEED_PRIORITY_WEIGHTS[t] ?? 0;
}

/**
 * Earn-your-reach adjustment (see BLYP_CHARTER.md). This is what makes reach EARNED:
 *  - a brand-new post gets a temporary "audition" lift so it is actually seen,
 *    which decays as it gathers its first impressions;
 *  - posts that earned a wave rank by their Blyp Score (merit, not payment);
 *  - resting posts are gently down-weighted — never hidden, always able to recover.
 * Legacy posts with no reach state get 0 (behaviour unchanged).
 */
export function reachAdjust(post) {
  const r = post && post.reach;
  if (!r || typeof r !== 'object') return 0;
  const score = Number(r.score || 0);
  if (r.stage === 'resting') return -12 + score * 0.1;
  if (r.stage === 'audition') {
    const seen = Number(r.waveImpressions || 0);
    const fade = Math.max(0, 1 - Math.min(seen / AUDITION_SETTLE, 1));
    return AUDITION_BOOST * fade + score * 0.15;
  }
  // rising / graduated: ranked on earned merit.
  return score * 0.25;
}

/** Per-post admin priority bump. */
export function postFeedPriorityAdjust(post) {
  return feedPriorityWeight(post?.feedPriority || post?.adminPriority || 'standard');
}

/** Account-wide admin priority bump (expects feedPriorityAccount on the post). */
export function accountFeedPriorityAdjust(post) {
  return feedPriorityWeight(
    post?.feedPriorityAccount || post?.creatorFeedWeight || 'standard',
  );
}

/**
 * Combined admin bump: account + post (additive).
 * A boost account + high post stacks; suppress + high still lands near the bottom.
 */
export function feedPriorityAdjust(post) {
  return accountFeedPriorityAdjust(post) + postFeedPriorityAdjust(post);
}

/** True when the author's account tier is suppress (practically don't show). */
export function isAccountFeedSuppressed(post) {
  return normalizeFeedPriorityTier(post?.feedPriorityAccount || post?.creatorFeedWeight) === 'suppress';
}

/**
 * Effective shuffle bucket after combining account + post.
 * Uses the stronger absolute demotion, else the stronger promotion.
 * @returns {'boost'|'high'|'standard'|'low'|'suppress'}
 */
export function effectiveFeedBucket(post) {
  const account = normalizeFeedPriorityTier(
    post?.feedPriorityAccount || post?.creatorFeedWeight || 'standard',
  );
  const postTier = normalizeFeedPriorityTier(post?.feedPriority || post?.adminPriority || 'standard');
  const a = feedPriorityWeight(account);
  const p = feedPriorityWeight(postTier);
  const combined = a + p;
  if (combined <= FEED_PRIORITY_WEIGHTS.suppress / 2) return 'suppress';
  if (combined <= FEED_PRIORITY_WEIGHTS.low / 2) return 'low';
  if (combined >= FEED_PRIORITY_WEIGHTS.boost) return 'boost';
  if (combined >= FEED_PRIORITY_WEIGHTS.high / 2) return 'high';
  return 'standard';
}

/**
 * Batch-attach authors' feedPriorityAccount onto posts (cached ~60s).
 * Safe no-op when Firebase is disabled.
 * @param {any[]} posts
 * @returns {Promise<any[]>}
 */
export async function attachAccountFeedPriority(posts) {
  if (!Array.isArray(posts) || posts.length === 0) return posts || [];
  if (!firebaseEnabled || !db?.collection) {
    return posts.map((p) => ({
      ...p,
      feedPriorityAccount: normalizeFeedPriorityTier(p?.feedPriorityAccount || 'standard'),
    }));
  }

  const now = Date.now();
  const authorIds = [
    ...new Set(
      posts
        .map((p) => String(p?.userId || p?.uid || p?.authorId || '').trim())
        .filter(Boolean),
    ),
  ];
  const missing = authorIds.filter((id) => {
    const hit = accountPriorityCache.get(id);
    return !hit || now - hit.at > ACCOUNT_CACHE_TTL_MS;
  });

  try {
    for (let i = 0; i < missing.length; i += 30) {
      const chunk = missing.slice(i, i + 30);
      const refs = chunk.map((id) => db.collection('users').doc(id));
      // Prefer getAll when available (RN Firebase / web admin); else sequential get.
      let snaps = [];
      if (typeof db.getAll === 'function') {
        snaps = await db.getAll(...refs);
      } else {
        snaps = await Promise.all(refs.map((ref) => ref.get()));
      }
      for (let j = 0; j < chunk.length; j += 1) {
        const snap = snaps[j];
        const data = snap?.exists
          ? typeof snap.data === 'function'
            ? snap.data() || {}
            : snap.data || {}
          : {};
        const tier = normalizeFeedPriorityTier(
          data.feedPriorityAccount || data.creatorFeedWeight || 'standard',
        );
        accountPriorityCache.set(chunk[j], { tier, at: now });
      }
    }
  } catch (e) {
    console.warn('[FEED_RANK] account priority hydrate failed', e?.message || String(e));
  }

  return posts.map((p) => {
    const authorId = String(p?.userId || p?.uid || p?.authorId || '').trim();
    const cached = authorId ? accountPriorityCache.get(authorId) : null;
    const tier = cached?.tier
      || normalizeFeedPriorityTier(p?.feedPriorityAccount || p?.creatorFeedWeight || 'standard');
    return { ...p, feedPriorityAccount: tier };
  });
}

/** Drop account-suppressed authors from discovery / For You candidate sets. */
export function filterSuppressedAccounts(posts) {
  if (!Array.isArray(posts)) return [];
  return posts.filter((p) => !isAccountFeedSuppressed(p));
}

export function scorePost(post, context = {}) {
  const terms = context.terms || [];
  const following = context.following || new Set();
  const seenOrder = normalizeSeenOrder(context.seenIds, context.seenOrder);
  const recentCreators = Array.isArray(context.recentCreators)
    ? context.recentCreators.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const now = Number.isFinite(context.now) ? context.now : Date.now();
  const owner = postOwner(post);
  let score = 0;
  if (owner && following.has(owner)) score += 26;
  score += interestAdjust(post, terms);
  score += hashtagAffinityAdjust(post, terms);
  score += freshnessAdjust(post, now);
  score += engagementAdjust(post);
  score += watchAdjust(post);
  score += reachAdjust(post);
  score += feedPriorityAdjust(post);
  score += promoteBoostAdjust(post);
  score += seenAdjust(post, seenOrder);
  score += creatorFatigueAdjust(post, recentCreators);
  score += explorationAdjust(post, seenOrder, recentCreators);
  return score;
}

function postTagSet(post) {
  return new Set(extractPostHashtags(post));
}

/**
 * Soft topic families for diversity spacing only — never a hard suppress list.
 * Kids/stories content still ranks in; it just cannot dominate consecutive slots.
 */
const TOPIC_FAMILY_PATTERNS = [
  {
    key: 'kids_stories',
    re: /\b(kids?|children|childrens|nursery|bedtime|fairy\s*tales?|story\s*time|storytime|bedtime\s*stor(?:y|ies)|kids?\s*stor(?:y|ies)|children'?s?\s*stor(?:y|ies))\b/i,
  },
  { key: 'gaming', re: /\b(gaming|gamer|gameplay|esports?|fortnite|minecraft|roblox)\b/i },
  { key: 'sports', re: /\b(sports?|football|soccer|nba|nfl|f1|formula\s*1|cricket|tennis)\b/i },
  { key: 'music', re: /\b(music|song|rap|hiphop|concert|dj)\b/i },
  { key: 'comedy', re: /\b(comedy|funny|skit|meme|humor|humour)\b/i },
  { key: 'food', re: /\b(food|recipe|cooking|bake|baking|restaurant)\b/i },
];

function mapTopicFamily(token) {
  const t = normalizeTagToken(token);
  if (!t) return '';
  if (/^(kids?|children|childrens|nursery|bedtime|fairytale|fairytales|storytime|story|stories)$/.test(t)) {
    return 'kids_stories';
  }
  if (/^(gaming|gamer|gameplay|esports?)$/.test(t)) return 'gaming';
  if (/^(sports?|football|soccer|nba|nfl|f1|formula1|cricket|tennis)$/.test(t)) return 'sports';
  if (/^(music|song|hiphop|rap|concert)$/.test(t)) return 'music';
  if (/^(comedy|funny|skit|meme|humor|humour)$/.test(t)) return 'comedy';
  if (/^(food|recipe|cooking|bake|baking)$/.test(t)) return 'food';
  return t;
}

/**
 * Stable topic cluster for diversity spacing (category / topic / hashtag / soft lexical).
 * @param {any} post
 * @returns {string}
 */
export function topicClusterKey(post) {
  const explicit = normalizeTagToken(post?.category || post?.topic || post?.topicId || '');
  if (explicit) {
    const family = mapTopicFamily(explicit);
    if (family) return family;
  }
  const tags = extractPostHashtags(post);
  for (const tag of tags) {
    const family = mapTopicFamily(tag);
    if (family && family !== tag) return family;
  }
  const hay = [post?.title, post?.caption, post?.description, tags.join(' ')]
    .filter(Boolean)
    .join(' ');
  for (const { key, re } of TOPIC_FAMILY_PATTERNS) {
    if (re.test(hay)) return key;
  }
  if (tags[0]) return mapTopicFamily(tags[0]) || tags[0];
  return 'untagged';
}

function tagsOverlapRecent(tags, recentTagWindows) {
  if (!tags?.size || !recentTagWindows?.length) return false;
  for (const prior of recentTagWindows) {
    for (const tag of tags) {
      if (prior.has(tag)) return true;
    }
  }
  return false;
}

function topicDensityExceeded(cluster, recentClusters, windowSize, maxInWindow) {
  if (!cluster || cluster === 'untagged' || !recentClusters?.length) return false;
  const slice = recentClusters.slice(-Math.max(1, windowSize));
  let n = 0;
  for (const c of slice) {
    if (c === cluster) n += 1;
  }
  return n >= maxInWindow;
}

/**
 * Greedy creator / source / hashtag / topic diversity.
 * Hard rule: never place the same creator back-to-back when another creator exists.
 * Soft rules: prefer MIN_CREATOR_GAP between same author; alternate followed/discovery;
 * prefer not stacking the same hashtag / topic cluster; cap niche density in a window.
 * `recentOwners` seeds the lookback so appended pages do not restack the feed tail.
 */
export function diversifyRanked(scored, following, opts = {}) {
  const remaining = [...scored];
  const result = [];
  const recentOwners = (Array.isArray(opts.recentOwners) ? opts.recentOwners : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  const recentTagWindows = Array.isArray(opts.recentTagWindows)
    ? opts.recentTagWindows.map((set) => (set instanceof Set ? set : new Set(set || [])))
    : [];
  const recentClusters = Array.isArray(opts.recentClusters)
    ? opts.recentClusters.map((c) => String(c || '').trim()).filter(Boolean)
    : [];
  let lastSource = '';
  let sourceStreak = 0;
  const minGap = Number.isFinite(opts.minCreatorGap) ? opts.minCreatorGap : MIN_CREATOR_GAP;
  const minTagGap = Number.isFinite(opts.minHashtagGap) ? opts.minHashtagGap : MIN_HASHTAG_GAP;
  const minTopicGap = Number.isFinite(opts.minTopicGap) ? opts.minTopicGap : MIN_TOPIC_GAP;
  const topicWindow = Number.isFinite(opts.topicDensityWindow)
    ? opts.topicDensityWindow
    : TOPIC_DENSITY_WINDOW;
  const maxTopicInWindow = Number.isFinite(opts.maxTopicInWindow)
    ? opts.maxTopicInWindow
    : MAX_TOPIC_IN_WINDOW;
  const maxSourceStreak = Number.isFinite(opts.maxSourceStreak)
    ? opts.maxSourceStreak
    : MAX_SOURCE_STREAK;

  const sourceOk = (source) => !(source === lastSource && sourceStreak >= maxSourceStreak);
  const topicOk = (cluster) => {
    if (!cluster || cluster === 'untagged') return true;
    const gapWindow = recentClusters.slice(-Math.max(1, minTopicGap));
    if (gapWindow.includes(cluster)) return false;
    if (topicDensityExceeded(cluster, recentClusters, topicWindow, maxTopicInWindow)) {
      return false;
    }
    return true;
  };

  while (remaining.length > 0) {
    const lastOwner = recentOwners.length ? recentOwners[recentOwners.length - 1] : '';
    const gapWindow = recentOwners.slice(-Math.max(1, minGap));
    const tagWindow = recentTagWindows.slice(-Math.max(1, minTagGap));

    let pick = remaining.findIndex(({ p }) => {
      const owner = postOwner(p);
      const source = owner && following.has(owner) ? 'followed' : 'discovery';
      const cluster = topicClusterKey(p);
      if (owner && gapWindow.includes(owner)) return false;
      if (!sourceOk(source)) return false;
      if (tagsOverlapRecent(postTagSet(p), tagWindow)) return false;
      if (!topicOk(cluster)) return false;
      return true;
    });
    // Prefer topic + hashtag spacing over source alternation when both cannot be met.
    if (pick < 0) {
      pick = remaining.findIndex(({ p }) => {
        const owner = postOwner(p);
        if (owner && gapWindow.includes(owner)) return false;
        if (tagsOverlapRecent(postTagSet(p), tagWindow)) return false;
        return topicOk(topicClusterKey(p));
      });
    }
    // Soft: creator gap + topic density; allow hashtag repeats.
    if (pick < 0) {
      pick = remaining.findIndex(({ p }) => {
        const owner = postOwner(p);
        if (owner && gapWindow.includes(owner)) return false;
        return topicOk(topicClusterKey(p));
      });
    }
    // Soft: topic density only (allow creator gap / source / tag to slip).
    // Keeps one niche from filling the head when any other cluster remains.
    if (pick < 0) {
      pick = remaining.findIndex(({ p }) => topicOk(topicClusterKey(p)));
    }
    // Soft fallback: keep creator gap + source mix; allow tag/topic repeats.
    if (pick < 0) {
      pick = remaining.findIndex(({ p }) => {
        const owner = postOwner(p);
        const source = owner && following.has(owner) ? 'followed' : 'discovery';
        if (owner && gapWindow.includes(owner)) return false;
        return sourceOk(source);
      });
    }
    // Soft fallback: keep creator gap even if source streak must continue.
    if (pick < 0) {
      pick = remaining.findIndex(({ p }) => {
        const owner = postOwner(p);
        return !(owner && gapWindow.includes(owner));
      });
    }
    // Hard anti-stack: different creator than the immediate predecessor.
    if (pick < 0) {
      pick = remaining.findIndex(({ p }) => {
        const owner = postOwner(p);
        return !owner || owner !== lastOwner;
      });
    }
    if (pick < 0) pick = 0;

    const [{ p }] = remaining.splice(pick, 1);
    const owner = postOwner(p);
    const source = owner && following.has(owner) ? 'followed' : 'discovery';
    sourceStreak = source === lastSource ? sourceStreak + 1 : 1;
    lastSource = source;
    if (owner) recentOwners.push(owner);
    recentTagWindows.push(postTagSet(p));
    recentClusters.push(topicClusterKey(p));
    result.push(p);
  }
  return result;
}

/**
 * @param {any[]} posts
 * @param {string[]} terms  lowercased interest terms
 * @param {Set<string>} following  ids the user follows
 * @param {{ fairCap?: boolean, seenIds?: Set<string>|string[], seenOrder?: string[], recentCreators?: string[], now?: number, recentOwners?: string[], recentClusters?: string[], minCreatorGap?: number, minHashtagGap?: number, minTopicGap?: number, topicDensityWindow?: number, maxTopicInWindow?: number, maxSourceStreak?: number }} [opts]
 */
export function rankPosts(posts, terms = [], following = new Set(), opts = {}) {
  if (!Array.isArray(posts) || posts.length === 0) return posts || [];
  const unique = dedupeRankCandidates(posts);
  const visible = filterSuppressedAccounts(unique);
  const safeFollowing = following instanceof Set ? following : new Set(following || []);
  const seenOrder = normalizeSeenOrder(opts.seenIds, opts.seenOrder);
  const recentCreators = recentCreatorsFromSeen(visible, seenOrder, opts.recentCreators);
  const context = {
    terms: (terms || []).map((term) => String(term).trim().toLowerCase()).filter(Boolean),
    following: safeFollowing,
    seenIds: opts.seenIds instanceof Set ? opts.seenIds : new Set(opts.seenIds || seenOrder),
    seenOrder,
    recentCreators,
    now: Number.isFinite(opts.now) ? opts.now : Date.now(),
  };
  const scored = visible
    .map((p, index) => ({ p, index, s: scorePost(p, context) }))
    .sort((a, b) => b.s - a.s || a.index - b.index);
  const diversityOpts = {
    recentOwners: opts.recentOwners,
    recentClusters: opts.recentClusters,
    minCreatorGap: opts.minCreatorGap,
    minHashtagGap: opts.minHashtagGap,
    minTopicGap: opts.minTopicGap,
    topicDensityWindow: opts.topicDensityWindow,
    maxTopicInWindow: opts.maxTopicInWindow,
    maxSourceStreak: opts.maxSourceStreak,
  };
  const ranked = diversifyRanked(scored, safeFollowing, diversityOpts);
  if (opts.fairCap === false) return ranked;
  // Fair-cap can re-adjacent same authors; re-apply hard creator destack while
  // preserving the capped preference order as the score signal.
  const capped = applyPromoteFairCap(ranked);
  const reseored = capped.map((p, index) => ({
    p,
    index,
    s: capped.length - index,
  }));
  return diversifyRanked(reseored, safeFollowing, diversityOpts);
}

/**
 * Bucket for shuffle: paid promote lifts into `high` (not admin `boost`) so
 * organic + admin-boosted content can still lead, then fair-cap interleaves.
 */
export function effectiveOrderBucket(post) {
  const admin = effectiveFeedBucket(post);
  if (admin === 'suppress' || admin === 'low') return admin;
  if (admin === 'boost') return 'boost';
  if (isPromotedPost(post)) return 'high';
  return admin;
}

/**
 * Bucketed shuffle for Home For You: boost → high → standard → low → suppress.
 * Prefer filtering suppress via attachAccountFeedPriority + filterSuppressedAccounts
 * before calling; leftover suppress still lands in the bottom bucket.
 * Applies promote fair-cap after the bucket shuffle.
 */
export function shufflePostsByFeedPriority(posts, opts = {}) {
  const buckets = {
    boost: [],
    high: [],
    standard: [],
    low: [],
    suppress: [],
  };
  for (const p of posts || []) {
    const bucket = effectiveOrderBucket(p);
    buckets[bucket].push(p);
  }
  const shuffleBucket = (arr) => {
    const next = [...arr];
    for (let i = next.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = next[i];
      next[i] = next[j];
      next[j] = tmp;
    }
    return next;
  };
  const ordered = [
    ...shuffleBucket(buckets.boost),
    ...shuffleBucket(buckets.high),
    ...shuffleBucket(buckets.standard),
    ...shuffleBucket(buckets.low),
    ...shuffleBucket(buckets.suppress),
  ];
  if (opts.fairCap === false) return ordered;
  return applyPromoteFairCap(ordered);
}

/**
 * Resolve ranking signals. Prefer `getContext()` after awaits so follows /
 * interests that hydrate during enrichment are not frozen at call start.
 * @param {{
 *   getContext?: () => ({ terms?: string[], following?: Set<string>|string[], seenIds?: Set<string>|string[], seenOrder?: string[], recentCreators?: string[], now?: number, recentOwners?: string[] }),
 *   terms?: string[],
 *   following?: Set<string>|string[],
 *   seenIds?: Set<string>|string[],
 *   seenOrder?: string[],
 *   recentCreators?: string[],
 *   now?: number,
 *   recentOwners?: string[],
 *   recentClusters?: string[],
 *   minCreatorGap?: number,
 *   minHashtagGap?: number,
 *   minTopicGap?: number,
 *   topicDensityWindow?: number,
 *   maxTopicInWindow?: number,
 *   maxSourceStreak?: number,
 * }} opts
 */
export function resolveRankContext(opts = {}) {
  const live = typeof opts.getContext === 'function' ? (opts.getContext() || {}) : {};
  return {
    terms: live.terms ?? opts.terms ?? [],
    following: live.following ?? opts.following ?? new Set(),
    seenIds: live.seenIds ?? opts.seenIds,
    seenOrder: live.seenOrder ?? opts.seenOrder,
    recentCreators: live.recentCreators ?? opts.recentCreators,
    now: live.now ?? opts.now,
    recentOwners: live.recentOwners ?? opts.recentOwners,
    recentClusters: live.recentClusters ?? opts.recentClusters,
    minCreatorGap: live.minCreatorGap ?? opts.minCreatorGap,
    minHashtagGap: live.minHashtagGap ?? opts.minHashtagGap,
    minTopicGap: live.minTopicGap ?? opts.minTopicGap,
    topicDensityWindow: live.topicDensityWindow ?? opts.topicDensityWindow,
    maxTopicInWindow: live.maxTopicInWindow ?? opts.maxTopicInWindow,
    maxSourceStreak: live.maxSourceStreak ?? opts.maxSourceStreak,
  };
}

/** Dedupe by id, preserving first-seen order (organic page before extras). */
export function mergeCandidatePosts(primary = [], extra = []) {
  const byId = new Map();
  for (const post of [...(primary || []), ...(extra || [])]) {
    if (post?.id == null || byId.has(post.id)) continue;
    byId.set(post.id, post);
  }
  return [...byId.values()];
}

export function countFollowedPosts(posts, following) {
  const set = following instanceof Set ? following : new Set(following || []);
  if (!set.size) return 0;
  return (posts || []).reduce((n, post) => (set.has(postOwner(post)) ? n + 1 : n), 0);
}

/**
 * When the newest organic page has too few followed creators, pull recent
 * followed posts from a wider date scan so scoring/diversity can mix them in.
 * Fail-open: returns organic unchanged on empty follows, Firebase off, or errors.
 */
export async function ensureFollowMixCandidates(posts, following, opts = {}) {
  const organic = Array.isArray(posts) ? posts : [];
  const set = following instanceof Set ? following : new Set(following || []);
  const minFollowed = Number.isFinite(opts.minFollowed) ? opts.minFollowed : 3;
  const maxInject = Number.isFinite(opts.maxInject) ? opts.maxInject : 6;
  const scanLimit = Number.isFinite(opts.scanLimit) ? opts.scanLimit : 120;
  const isEligible = typeof opts.isEligible === 'function' ? opts.isEligible : () => true;

  if (!set.size || countFollowedPosts(organic, set) >= minFollowed) return organic;
  if (!firebaseEnabled || !db?.collection) return organic;

  try {
    const snap = await db.collection('posts').orderBy('date', 'desc').limit(scanLimit).get();
    const scanned = (snap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
    const have = new Set(organic.map((p) => p?.id).filter(Boolean));
    const injected = [];
    for (const post of scanned) {
      if (injected.length >= maxInject) break;
      if (!post?.id || have.has(post.id)) continue;
      if (!set.has(postOwner(post))) continue;
      if (!isEligible(post)) continue;
      injected.push(post);
      have.add(post.id);
    }
    return injected.length ? mergeCandidatePosts(organic, injected) : organic;
  } catch (error) {
    console.warn('[FEED_RANK] follow mix hydrate failed', error?.message || String(error));
    return organic;
  }
}

/**
 * Hydrate admin account tiers + active promote boosts, drop suppress, then
 * score (mode:'rank') or bucket-shuffle. Shared by Home For You + discovery.
 *
 * For rank mode, personalization signals are resolved AFTER enrichment via
 * `getContext` so a slow promote/account hydrate cannot freeze empty follows.
 */
export async function prepareRankedFeed(posts, opts = {}) {
  const fallback = filterSuppressedAccounts(posts || []);
  try {
    const withAccount = await attachAccountFeedPriority(posts || []);
    const withPromote = await attachPromoteBoost(withAccount);
    const visible = filterSuppressedAccounts(withPromote);
    if (opts.mode === 'rank') {
      const ctx = resolveRankContext(opts);
      return rankPosts(visible, ctx.terms, ctx.following, {
        fairCap: opts.fairCap !== false,
        seenIds: ctx.seenIds,
        seenOrder: ctx.seenOrder,
        recentCreators: ctx.recentCreators,
        now: ctx.now,
        recentOwners: ctx.recentOwners,
        recentClusters: ctx.recentClusters,
        minCreatorGap: ctx.minCreatorGap,
        minHashtagGap: ctx.minHashtagGap,
        minTopicGap: ctx.minTopicGap,
        topicDensityWindow: ctx.topicDensityWindow,
        maxTopicInWindow: ctx.maxTopicInWindow,
        maxSourceStreak: ctx.maxSourceStreak,
      });
    }
    return shufflePostsByFeedPriority(visible, { fairCap: opts.fairCap !== false });
  } catch (error) {
    console.warn('[FEED_RANK] enrichment failed; using organic candidates', error?.message || String(error));
    if (opts.mode === 'rank') {
      const ctx = resolveRankContext(opts);
      return rankPosts(fallback, ctx.terms, ctx.following, {
        fairCap: false,
        seenIds: ctx.seenIds,
        seenOrder: ctx.seenOrder,
        recentCreators: ctx.recentCreators,
        now: ctx.now,
        recentOwners: ctx.recentOwners,
        recentClusters: ctx.recentClusters,
        minCreatorGap: ctx.minCreatorGap,
        minHashtagGap: ctx.minHashtagGap,
        minTopicGap: ctx.minTopicGap,
        topicDensityWindow: ctx.topicDensityWindow,
        maxTopicInWindow: ctx.maxTopicInWindow,
        maxSourceStreak: ctx.maxSourceStreak,
      });
    }
    return fallback;
  }
}

export default {
  rankPosts,
  scorePost,
  seenAdjust,
  creatorFatigueAdjust,
  explorationAdjust,
  normalizeSeenOrder,
  dedupeRankCandidates,
  reachAdjust,
  hashtagAffinityAdjust,
  extractPostHashtags,
  normalizeTagToken,
  topicClusterKey,
  diversifyRanked,
  feedPriorityAdjust,
  postFeedPriorityAdjust,
  accountFeedPriorityAdjust,
  attachAccountFeedPriority,
  filterSuppressedAccounts,
  shufflePostsByFeedPriority,
  prepareRankedFeed,
  resolveRankContext,
  mergeCandidatePosts,
  countFollowedPosts,
  ensureFollowMixCandidates,
  normalizeFeedPriorityTier,
  effectiveFeedBucket,
  effectiveOrderBucket,
  FEED_PRIORITY_WEIGHTS,
};
