// feedRankingService.js
//
// Pure ranking for the "For You" feed. Orders posts by freshness, follows,
// interests, engagement/gifts, aggregate watch quality, recent-seen state,
// earn-your-reach, admin priority, and active coin-promote boosts; a final
// diversity pass mixes creators and followed/discovery sources.
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
const MAX_SOURCE_STREAK = 2;

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
  return 32 * Math.pow(0.5, ageHours / FRESHNESS_HALF_LIFE_HOURS);
}

function interestAdjust(post, terms) {
  if (!terms?.length) return 0;
  const hay = [
    post?.title,
    post?.caption,
    post?.description,
    post?.category,
    post?.topic,
    post?.topicId,
    Array.isArray(post?.hashtags) ? post.hashtags.join(' ') : post?.hashtags,
    Array.isArray(post?.sportTags) ? post.sportTags.join(' ') : post?.sportTags,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  let matches = 0;
  for (const term of terms) {
    if (term && hay.includes(String(term).toLowerCase())) matches += 1;
  }
  return Math.min(24, matches * 8);
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
  const seenIds = context.seenIds || new Set();
  const now = Number.isFinite(context.now) ? context.now : Date.now();
  const owner = postOwner(post);
  let score = 0;
  if (owner && following.has(owner)) score += 26;
  score += interestAdjust(post, terms);
  score += freshnessAdjust(post, now);
  score += engagementAdjust(post);
  score += watchAdjust(post);
  score += reachAdjust(post);
  score += feedPriorityAdjust(post);
  score += promoteBoostAdjust(post);
  score += seenIds.has(post?.id) ? -24 : 10;
  return score;
}

function diversifyRanked(scored, following) {
  const remaining = [...scored];
  const result = [];
  let lastOwner = '';
  let lastSource = '';
  let sourceStreak = 0;

  while (remaining.length > 0) {
    let pick = remaining.findIndex(({ p }) => {
      const owner = postOwner(p);
      const source = owner && following.has(owner) ? 'followed' : 'discovery';
      return owner !== lastOwner && !(source === lastSource && sourceStreak >= MAX_SOURCE_STREAK);
    });
    if (pick < 0) {
      pick = remaining.findIndex(({ p }) => postOwner(p) !== lastOwner);
    }
    if (pick < 0) pick = 0;

    const [{ p }] = remaining.splice(pick, 1);
    const owner = postOwner(p);
    const source = owner && following.has(owner) ? 'followed' : 'discovery';
    sourceStreak = source === lastSource ? sourceStreak + 1 : 1;
    lastSource = source;
    lastOwner = owner;
    result.push(p);
  }
  return result;
}

/**
 * @param {any[]} posts
 * @param {string[]} terms  lowercased interest terms
 * @param {Set<string>} following  ids the user follows
 * @param {{ fairCap?: boolean, seenIds?: Set<string>, now?: number }} [opts]
 */
export function rankPosts(posts, terms = [], following = new Set(), opts = {}) {
  if (!Array.isArray(posts) || posts.length === 0) return posts || [];
  const visible = filterSuppressedAccounts(posts);
  const safeFollowing = following instanceof Set ? following : new Set(following || []);
  const context = {
    terms: (terms || []).map((term) => String(term).trim().toLowerCase()).filter(Boolean),
    following: safeFollowing,
    seenIds: opts.seenIds instanceof Set ? opts.seenIds : new Set(opts.seenIds || []),
    now: Number.isFinite(opts.now) ? opts.now : Date.now(),
  };
  const scored = visible
    .map((p, index) => ({ p, index, s: scorePost(p, context) }))
    .sort((a, b) => b.s - a.s || a.index - b.index);
  const ranked = diversifyRanked(scored, safeFollowing);
  if (opts.fairCap === false) return ranked;
  return applyPromoteFairCap(ranked);
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
 *   getContext?: () => ({ terms?: string[], following?: Set<string>|string[], seenIds?: Set<string>|string[], now?: number }),
 *   terms?: string[],
 *   following?: Set<string>|string[],
 *   seenIds?: Set<string>|string[],
 *   now?: number,
 * }} opts
 */
export function resolveRankContext(opts = {}) {
  const live = typeof opts.getContext === 'function' ? (opts.getContext() || {}) : {};
  return {
    terms: live.terms ?? opts.terms ?? [],
    following: live.following ?? opts.following ?? new Set(),
    seenIds: live.seenIds ?? opts.seenIds,
    now: live.now ?? opts.now,
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
        now: ctx.now,
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
        now: ctx.now,
      });
    }
    return fallback;
  }
}

export default {
  rankPosts,
  scorePost,
  reachAdjust,
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
