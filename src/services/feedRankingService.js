// feedRankingService.js
//
// Pure ranking for the "For You" feed. Orders posts by a blend of: who you
// follow, your interests, light engagement, earn-your-reach, admin
// feed priority (account-wide + per-post), and active coin-promote boosts.
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

function engagement(post) {
  return (
    Number(post.likeCount || post.likes || post.likedBy?.length || 0) +
    Number(post.commentCount || post.comments || 0) * 2
  );
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

function scorePost(post, terms, following) {
  let s = 0;
  const owner = post.userId || post.uid || post.authorId;
  if (owner && following.has(owner)) s += 50; // strong: people you follow
  if (terms.length) {
    const hay = [
      post.title,
      post.caption,
      post.description,
      post.category,
      Array.isArray(post.hashtags) ? post.hashtags.join(' ') : post.hashtags,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    for (const t of terms) if (hay.includes(t)) s += 8; // interest match
  }
  s += Math.min(engagement(post), 24) * 0.5; // mild popularity nudge
  s += reachAdjust(post); // earn-your-reach: audition lift / earned score / resting
  s += feedPriorityAdjust(post); // account + post admin tiers
  s += promoteBoostAdjust(post); // paid promote (battle / slot / spotlight)
  s += Math.random() * 6; // freshness jitter
  return s;
}

/**
 * @param {any[]} posts
 * @param {string[]} terms  lowercased interest terms
 * @param {Set<string>} following  ids the user follows
 * @param {{ fairCap?: boolean }} [opts]
 */
export function rankPosts(posts, terms = [], following = new Set(), opts = {}) {
  if (!Array.isArray(posts) || posts.length === 0) return posts || [];
  const visible = filterSuppressedAccounts(posts);
  const noSignal = (!terms || terms.length === 0) && (!following || following.size === 0);
  let ranked;
  if (noSignal) {
    // Still honour earn-your-reach + admin priority + promote when we have no personalization.
    ranked = [...visible]
      .map((p) => ({
        p,
        s: reachAdjust(p) + feedPriorityAdjust(p) + promoteBoostAdjust(p) + Math.random() * 12,
      }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.p);
  } else {
    ranked = [...visible]
      .map((p) => ({ p, s: scorePost(p, terms, following) }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.p);
  }
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
 * Hydrate admin account tiers + active promote boosts, drop suppress, then
 * bucket-shuffle with fair promote caps. Shared by Home For You + discovery.
 */
export async function prepareRankedFeed(posts, opts = {}) {
  const withAccount = await attachAccountFeedPriority(posts || []);
  const withPromote = await attachPromoteBoost(withAccount);
  const visible = filterSuppressedAccounts(withPromote);
  if (opts.mode === 'rank') {
    return rankPosts(visible, opts.terms || [], opts.following || new Set(), {
      fairCap: opts.fairCap !== false,
    });
  }
  return shufflePostsByFeedPriority(visible, { fairCap: opts.fairCap !== false });
}

export default {
  rankPosts,
  reachAdjust,
  feedPriorityAdjust,
  postFeedPriorityAdjust,
  accountFeedPriorityAdjust,
  attachAccountFeedPriority,
  filterSuppressedAccounts,
  shufflePostsByFeedPriority,
  prepareRankedFeed,
  normalizeFeedPriorityTier,
  effectiveFeedBucket,
  effectiveOrderBucket,
  FEED_PRIORITY_WEIGHTS,
};
