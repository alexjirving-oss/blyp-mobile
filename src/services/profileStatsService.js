// profileStatsService.js
//
// Aggregates a personal "Your Blyp" recap from real data + local activity:
//   - posts, likes received (from posts.likedBy)
//   - followers / following counts
//   - saved, watched, searches (local services)
//   - top interests
// Best-effort; missing pieces resolve to 0.

import { db, firebaseEnabled } from '../config/firebase';
import { getFollowersCount, getFollowingCount } from '../utils/followUtils';
import { getPreferences, interestLabels } from './userPreferencesService';
import { getBookmarks } from './bookmarkService';
import { getWatchHistory } from './watchHistoryService';

const ready = () => firebaseEnabled && !!db?.collection;

// Cap high enough to count a real creator's whole catalogue (orderBy is avoided
// on purpose so posts missing a `date` field are still counted).
const STATS_POSTS_CAP = 1000;

async function getPostStats(uid) {
  if (!ready() || !uid) return { posts: 0, likes: 0 };
  try {
    const snap = await db.collection('posts').where('userId', '==', uid).limit(STATS_POSTS_CAP).get();
    const docs = snap?.docs || [];
    let likes = 0;
    docs.forEach((d) => {
      const data = d.data() || {};
      likes += Array.isArray(data.likedBy) ? data.likedBy.length : Number(data.likeCount || data.likes || 0);
    });
    return { posts: docs.length, likes };
  } catch (e) {
    console.warn('[STATS] posts failed', e?.message || String(e));
    return { posts: 0, likes: 0 };
  }
}

export async function getProfileStats(uid) {
  const safeUid = uid || 'anon';
  const [postStats, followers, following, prefs, bookmarks, watch] = await Promise.all([
    getPostStats(uid),
    (async () => {
      try {
        return await getFollowersCount(uid);
      } catch {
        return 0;
      }
    })(),
    (async () => {
      try {
        return await getFollowingCount(uid);
      } catch {
        return 0;
      }
    })(),
    getPreferences(safeUid),
    getBookmarks(safeUid),
    getWatchHistory(safeUid),
  ]);

  return {
    posts: postStats.posts,
    likes: postStats.likes,
    followers: followers || 0,
    following: following || 0,
    saved: (bookmarks || []).length,
    watched: (watch || []).length,
    searches: (prefs?.recentSearches || []).length,
    interests: interestLabels(prefs?.interests || []),
  };
}

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);

function postLikes(p) {
  return Array.isArray(p.likedBy) ? p.likedBy.length : num(p.likeCount || p.likes);
}
function postViews(p) {
  return num(p.views || p.viewCount || p.playCount);
}
function postComments(p) {
  return num(p.commentCount || p.comments);
}
function postThumb(p) {
  return (
    p.thumbnail || p.imageUrl || p.media?.[0]?.thumbnail || p.media?.[0]?.url || p.videoUrl || p.mediaUrl || null
  );
}

/** Deeper creator analytics: best post, totals, recent cadence, avg engagement. */
export async function getCreatorAnalytics(uid) {
  const empty = {
    hasPosts: false,
    totalLikes: 0,
    totalViews: 0,
    totalComments: 0,
    avgLikes: 0,
    postsLast30: 0,
    bestPost: null,
  };
  if (!ready() || !uid) return empty;
  try {
    const snap = await db.collection('posts').where('userId', '==', uid).limit(STATS_POSTS_CAP).get();
    const posts = (snap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
    if (posts.length === 0) return empty;

    let totalLikes = 0;
    let totalViews = 0;
    let totalComments = 0;
    let best = posts[0];
    let bestScore = -1;
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    let postsLast30 = 0;

    for (const p of posts) {
      const likes = postLikes(p);
      totalLikes += likes;
      totalViews += postViews(p);
      totalComments += postComments(p);
      const score = likes * 2 + postComments(p) * 3 + postViews(p) * 0.1;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
      const ts =
        (p.date?.toMillis && p.date.toMillis()) ||
        (typeof p.date === 'number' ? p.date : 0) ||
        (p.createdAt?.toMillis && p.createdAt.toMillis()) ||
        0;
      if (ts && ts >= cutoff) postsLast30 += 1;
    }

    return {
      hasPosts: true,
      totalLikes,
      totalViews,
      totalComments,
      avgLikes: Math.round(totalLikes / posts.length),
      postsLast30,
      bestPost: best
        ? {
            id: best.id,
            title: best.title || best.caption || best.description || 'Post',
            thumbnail: postThumb(best),
            likes: postLikes(best),
            comments: postComments(best),
            views: postViews(best),
            type: best.type || (best.videoUrl ? 'video' : 'post'),
            videoUrl: best.videoUrl || null,
          }
        : null,
    };
  } catch (e) {
    console.warn('[STATS] analytics failed', e?.message || String(e));
    return empty;
  }
}

export default { getProfileStats, getCreatorAnalytics };
