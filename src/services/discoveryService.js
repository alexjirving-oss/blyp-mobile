// discoveryService.js
//
// Read-only helpers that power the personalized Home base rails with real data:
//   - trending posts (Firestore `posts`)
//   - suggested creators (Firestore `users`)
//   - live now (reuses the existing HLS live-stream service)
//
// Everything is best-effort and never throws; callers render whatever comes
// back (often an empty array when Firebase is disabled).

import { db, firebaseEnabled } from '../config/firebase';
import { fixStorageUrl } from '../utils/urlUtils';
import { attachAccountFeedPriority, filterSuppressedAccounts } from './feedRankingService';
import {
  attachPromoteBoost,
  applyPromoteFairCap,
  promoteBoostAdjust,
} from './promoteBoostService';
import { filterForYouPosts } from '../utils/forYouFeedFilter';
import { shufflePostsVaried } from '../utils/forYouFeedList';
import { filterBlocked, loadBlockedUsers } from './BlockService';

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);

/** Drop blocked authors and moderation.hidden posts before any HomeBase rail renders. */
async function visiblePosts(posts) {
  await loadBlockedUsers().catch(() => {});
  return filterBlocked(posts || [], (p) => p?.userId || p?.uid || p?.authorId);
}

/** Drop blocked creators from suggestion rails. */
async function visibleUsers(users) {
  await loadBlockedUsers().catch(() => {});
  return filterBlocked(users || [], (u) => u?.id || u?.uid || u?.userId);
}

function engagement(post) {
  // `likes` and `likeCount` are kept in sync by LikeService, and `views`/`viewCount`
  // by PostViewService — so take the max of each pair rather than summing them
  // (summing double-counted every like/view and skewed ranking).
  const likes = Math.max(num(post.likeCount), num(post.likes), num(post.likedBy?.length));
  const comments = Math.max(num(post.commentCount), num(post.comments));
  const views = Math.max(num(post.viewCount), num(post.views), num(post.playCount));
  return likes * 2 + comments + views * 0.1 + num(post.shares) * 3;
}

/** Top posts by engagement, optionally biased toward the user's interest terms. */
export async function getTrendingPosts(limit = 10, interestTerms = []) {
  if (!firebaseEnabled || !db?.collection) return [];
  try {
    const snap = await db.collection('posts').orderBy('date', 'desc').limit(80).get();
    const all = (snap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
    const terms = (interestTerms || []).map((t) => String(t).toLowerCase()).filter(Boolean);

    const visible = await visiblePosts(all);
    const withAccount = await attachAccountFeedPriority(visible);
    const withPromote = await attachPromoteBoost(withAccount);
    const scored = withPromote.map((p) => {
      let score = engagement(p);
      if (terms.length) {
        const hay = [p.title, p.caption, p.description, p.category, (p.hashtags || []).join(' ')]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        for (const t of terms) if (hay.includes(t)) score += 25; // interest boost
      }
      score += promoteBoostAdjust(p);
      return { p, score };
    });

    const ranked = applyPromoteFairCap(
      scored.sort((a, b) => b.score - a.score).map((x) => x.p),
    );
    // Over-fetch then filter so hidden/blocked/suppressed posts do not shrink the rail below `limit`.
    return filterSuppressedAccounts(ranked).slice(0, limit);
  } catch (e) {
    console.warn('[DISCOVERY] trending failed', e?.message || String(e));
    return [];
  }
}

/**
 * Posts matching a topic's terms, ranked by relevance then engagement.
 * Optional sportTags / teamIds boost (and best-effort array-contains merge)
 * so upload-time tagging fills Football / F1 rails reliably.
 *
 * @param {string[]} terms
 * @param {number} [limit]
 * @param {{ sportTags?: string[], teamIds?: string[] }} [opts]
 */
export async function getTopicPosts(terms = [], limit = 30, opts = {}) {
  if (!firebaseEnabled || !db?.collection) return [];
  const t = (terms || []).map((x) => String(x).toLowerCase()).filter(Boolean);
  const sportTags = (opts.sportTags || []).map((x) => String(x).toLowerCase()).filter(Boolean);
  const teamIds = new Set((opts.teamIds || []).map((x) => String(x)).filter(Boolean));
  if (t.length === 0 && sportTags.length === 0 && teamIds.size === 0) return [];
  try {
    const byId = new Map();
    const snap = await db.collection('posts').orderBy('date', 'desc').limit(120).get();
    for (const d of snap?.docs || []) byId.set(d.id, { id: d.id, ...d.data() });

    // Best-effort indexed pull for tagged posts (no composite index needed).
    for (const tag of sportTags.slice(0, 2)) {
      try {
        const tagged = await db.collection('posts').where('sportTags', 'array-contains', tag).limit(40).get();
        for (const d of tagged?.docs || []) {
          if (!byId.has(d.id)) byId.set(d.id, { id: d.id, ...d.data() });
        }
      } catch (e) {
        console.warn('[DISCOVERY] sportTags query skipped', e?.message || String(e));
      }
    }

    const matched = Array.from(byId.values())
      .map((p) => {
        const hay = [p.title, p.caption, p.description, p.category, (p.hashtags || []).join(' '), p.username, p.userDisplayName]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        let score = 0;
        for (const term of t) if (hay.includes(term)) score += 1;
        const postTags = (Array.isArray(p.sportTags) ? p.sportTags : []).map((x) => String(x).toLowerCase());
        for (const tag of sportTags) if (postTags.includes(tag)) score += 8;
        const postTeams = (Array.isArray(p.teamIds) ? p.teamIds : []).map((x) => String(x));
        for (const tid of postTeams) if (teamIds.has(tid)) score += 12;
        return { p, score };
      })
      .filter((x) => x.score > 0);
    const visible = await visiblePosts(matched.map((x) => x.p));
    const withAccount = await attachAccountFeedPriority(visible);
    const withPromote = await attachPromoteBoost(withAccount);
    const scoreById = new Map(matched.map((x) => [x.p.id, x.score]));
    const ranked = applyPromoteFairCap(
      withPromote
        .map((p) => ({
          p,
          score: (scoreById.get(p.id) || 0) + promoteBoostAdjust(p),
          eng: engagement(p),
        }))
        .sort((a, b) => b.score - a.score || b.eng - a.eng)
        .map((x) => x.p),
    );
    return filterSuppressedAccounts(ranked).slice(0, limit);
  } catch (e) {
    console.warn('[DISCOVERY] topic posts failed', e?.message || String(e));
    return [];
  }
}

/**
 * Home carousel "For You" rail: recent playable videos, shuffled per reload.
 * `terms` / `followingIds` kept for call-site compatibility; order is not ranked.
 */
export async function getForYouPosts(terms = [], followingIds = [], limit = 12) {
  if (!firebaseEnabled || !db?.collection) return [];
  void terms;
  void followingIds;
  try {
    const snap = await db.collection('posts').orderBy('date', 'desc').limit(80).get();
    const all = await visiblePosts((snap?.docs || []).map((d) => ({ id: d.id, ...d.data() })));
    const withAccount = await attachAccountFeedPriority(all);
    const visible = filterSuppressedAccounts(withAccount);
    const playable = filterForYouPosts(visible);
    return shufflePostsVaried(playable, { avoidCount: 3 }).slice(0, limit);
  } catch (e) {
    console.warn('[DISCOVERY] for-you failed', e?.message || String(e));
    return [];
  }
}

/** Recent posts authored by people the user follows. */
export async function getFollowingPosts(ownerIds = [], limit = 40) {
  if (!firebaseEnabled || !db?.collection) return [];
  const owners = new Set((ownerIds || []).filter(Boolean));
  if (owners.size === 0) return [];
  try {
    const snap = await db.collection('posts').orderBy('date', 'desc').limit(150).get();
    const all = (snap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
    const owned = all.filter((p) => owners.has(p.userId || p.uid || p.authorId));
    return (await visiblePosts(owned)).slice(0, limit);
  } catch (e) {
    console.warn('[DISCOVERY] following posts failed', e?.message || String(e));
    return [];
  }
}

/** Suggested creators, lightly biased toward interests and follower count. */
export async function getSuggestedCreators(limit = 12, interestTerms = [], excludeUid = null) {
  if (!firebaseEnabled || !db?.collection) return [];
  try {
    const snap = await db.collection('users').limit(120).get();
    const all = (snap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
    const terms = (interestTerms || []).map((t) => String(t).toLowerCase()).filter(Boolean);

    const withPromote = await attachPromoteBoost(
      all.map((u) => ({ ...u, userId: u.id || u.uid || u.userId })),
    );
    const ranked = withPromote
      .filter((u) => (excludeUid ? (u.id || u.userId) !== excludeUid : true))
      .filter((u) => u.username || u.displayName || u.name)
      .filter((u) => {
        const tier = String(u.feedPriorityAccount || u.creatorFeedWeight || 'standard').toLowerCase();
        return tier !== 'suppress';
      })
      .map((u) => {
        let score = num(u.followersCount) + num(u.followers) * 1;
        const tier = String(u.feedPriorityAccount || u.creatorFeedWeight || 'standard').toLowerCase();
        if (tier === 'boost') score += 80;
        else if (tier === 'high') score += 40;
        else if (tier === 'low' || tier === 'less') score -= 30;
        score += promoteBoostAdjust(u);
        if (terms.length) {
          const hay = [u.bio, u.category, (u.interests || []).join(' ')]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          for (const t of terms) if (hay.includes(t)) score += 20;
        }
        return { u, score };
      })
      .sort((a, b) => b.score - a.score)
      .map((x) => x.u);
    return applyPromoteFairCap(await visibleUsers(ranked)).slice(0, limit);
  } catch (e) {
    console.warn('[DISCOVERY] creators failed', e?.message || String(e));
    return [];
  }
}

/** Currently-live streams (reuses the production live-stream service). */
export async function getLiveNow(limit = 10) {
  try {
    const mod = await import('./HLSLiveStreamService');
    const svc = mod?.default;
    if (!svc?.getActiveStreams) return [];
    const streams = await svc.getActiveStreams(limit);
    if (!Array.isArray(streams)) return [];
    await loadBlockedUsers().catch(() => {});
    return filterBlocked(streams, (s) => s?.hostUid || s?.userId || s?.user?.uid);
  } catch (e) {
    console.warn('[DISCOVERY] live now failed', e?.message || String(e));
    return [];
  }
}

export function creatorAvatar(user) {
  return fixStorageUrl(user?.avatar || user?.photoURL || user?.userPhotoURL || user?.profilePicture);
}

export function streamThumbnail(stream) {
  return fixStorageUrl(stream?.thumbnail || stream?.thumbnailUrl || stream?.posterUrl || stream?.hostAvatar);
}

export default {
  getTrendingPosts,
  getTopicPosts,
  getForYouPosts,
  getFollowingPosts,
  getSuggestedCreators,
  getLiveNow,
  creatorAvatar,
  streamThumbnail,
};
