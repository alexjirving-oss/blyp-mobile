// activityService.js
//
// Derives the Activity feed from live graph + tracked events:
//   - new followers   (users/{uid}/followers)
//   - comments on my posts (posts/{id}/comments)
//   - likes           (activities collection via trackActivity — real timestamps;
//                      posts.likedBy is fallback only when no tracked like exists)
//
// Actors always resolve through user profiles so Activity can show real circular
// photoURL avatars (same people language as Stage Top Circle). Top Circle +
// following are used only to rank / tag — not a new social graph.
//
// Read-bounded and best-effort: never throws, returns [] when Firebase is off.

import { db, firebaseEnabled } from '../config/firebase';
import { fixStorageUrl } from '../utils/urlUtils';
import { looksLikeRawId, pickPublicLabel } from '../utils/publicLabel';

const ready = () => firebaseEnabled && !!db?.collection;

function toMillis(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return isNaN(t) ? 0 : t;
  }
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  if (v instanceof Date) return v.getTime();
  return 0;
}

const profileCache = new Map();

async function getProfile(id) {
  if (!id) return null;
  if (profileCache.has(id)) return profileCache.get(id);
  try {
    const snap = await db.collection('users').doc(id).get();
    const d = snap?.data?.() || {};
    let username = pickPublicLabel(d, { uid: id, fallback: '' });
    let avatar =
      fixStorageUrl(d.avatar || d.photoURL || d.profilePicture || d.userPhotoURL) || null;
    if (!username || !avatar) {
      try {
        const pSnap = await db.collection('userProfiles').doc(id).get();
        const p = pSnap?.data?.() || {};
        if (!username) username = pickPublicLabel(p, { uid: id, fallback: '' });
        if (!avatar) {
          avatar =
            fixStorageUrl(p.avatar || p.photoURL || p.profilePicture || p.userPhotoURL) || null;
        }
      } catch {
        /* ignore */
      }
    }
    const profile = {
      id,
      username: username || 'Someone',
      displayName: pickPublicLabel(
        { displayName: d.displayName, name: d.name },
        { uid: id, fallback: username || 'Someone' }
      ),
      avatar,
    };
    profileCache.set(id, profile);
    return profile;
  } catch {
    const fallback = { id, username: 'Someone', displayName: 'Someone', avatar: null };
    profileCache.set(id, fallback);
    return fallback;
  }
}

function denormalizedActorLabel(data, actorId) {
  return pickPublicLabel(
    {
      username: data?.username || data?.actorUsername,
      handle: data?.handle,
      displayName: data?.displayName || data?.actorDisplayName,
      name: data?.name,
      userName: data?.userName,
    },
    { uid: actorId, fallback: '' }
  );
}

function postKind(post) {
  if (!post) return 'post';
  if (post.type === 'video' || post.videoUrl || post.media?.[0]?.type === 'video') return 'video';
  return 'post';
}

/** Owner Top Circle + following — for ranking / badges only. */
async function getCircleContext(uid) {
  const topCircle = new Set();
  const following = new Set();
  try {
    const snap = await db.collection('users').doc(uid).get();
    const d = snap?.data?.() || {};
    const raw = d?.stage?.topCircle;
    const ids = Array.isArray(raw) ? raw : [];
    for (const id of ids) {
      const s = String(id || '').trim();
      if (s) topCircle.add(s);
    }
  } catch {
    /* ignore */
  }
  try {
    const snap = await db.collection('users').doc(uid).collection('following').limit(200).get();
    for (const d of snap?.docs || []) {
      following.add(d.id);
    }
  } catch {
    /* ignore */
  }
  return { topCircle, following };
}

function annotateGraph(item, ctx) {
  const id = String(item?.actorId || '');
  const inTopCircle = !!(id && ctx.topCircle.has(id));
  const inFollowing = !!(id && ctx.following.has(id));
  return {
    ...item,
    inTopCircle,
    inFollowing,
    // Rank boost: Top Circle first, then people you follow, then everyone else.
    _rank: inTopCircle ? 2 : inFollowing ? 1 : 0,
  };
}

async function resolveActor(actorId, denormData = {}) {
  const fromDoc = denormalizedActorLabel(denormData, actorId);
  const fromAvatar =
    fixStorageUrl(
      denormData.avatar || denormData.photoURL || denormData.profilePicture || denormData.userPhotoURL
    ) || null;
  // Always load profile so Activity rows get real circular photos like Top Circle.
  // Denormalized labels alone often lack photoURL (followers docs, likes).
  const profile = await getProfile(actorId);
  let username = fromDoc || profile?.username || 'Someone';
  if (looksLikeRawId(username)) username = profile?.username || 'Someone';
  if (looksLikeRawId(username)) username = 'Someone';
  return {
    actorId,
    username,
    displayName: profile?.displayName || username,
    avatar: fromAvatar || profile?.avatar || null,
  };
}

async function getFollowerActivity(uid) {
  try {
    let snap;
    try {
      snap = await db
        .collection('users')
        .doc(uid)
        .collection('followers')
        .orderBy('timestamp', 'desc')
        .limit(20)
        .get();
    } catch {
      snap = await db.collection('users').doc(uid).collection('followers').limit(20).get();
    }
    const docs = snap?.docs || [];
    const items = await Promise.all(
      docs.map(async (d) => {
        const data = d.data() || {};
        const followerId = data.userId || d.id;
        const actor = await resolveActor(followerId, data);
        return {
          id: `follow_${followerId}`,
          type: 'follow',
          actorId: followerId,
          username: actor.username,
          displayName: actor.displayName,
          avatar: actor.avatar,
          ts: toMillis(data.timestamp),
        };
      })
    );
    return items;
  } catch (e) {
    console.warn('[ACTIVITY] followers failed', e?.message || String(e));
    return [];
  }
}

async function getPostActivity(uid) {
  try {
    const postsSnap = await db
      .collection('posts')
      .where('userId', '==', uid)
      .orderBy('date', 'desc')
      .limit(8)
      .get();
    const myPosts = (postsSnap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
    if (myPosts.length === 0) return [];

    const items = [];

    // Comments on my posts
    await Promise.all(
      myPosts.map(async (post) => {
        try {
          const cSnap = await db
            .collection('posts')
            .doc(post.id)
            .collection('comments')
            .orderBy('createdAt', 'desc')
            .limit(4)
            .get();
          await Promise.all(
            (cSnap?.docs || []).map(async (c) => {
              const cd = c.data() || {};
              const commenterId = cd.userId || cd.uid;
              if (!commenterId || commenterId === uid) return;
              const actor = await resolveActor(commenterId, cd);
              items.push({
                id: `comment_${c.id}`,
                type: 'comment',
                actorId: commenterId,
                username: actor.username,
                displayName: actor.displayName,
                avatar: actor.avatar,
                text: cd.text || '',
                post,
                postKind: postKind(post),
                thumbnail: postThumb(post),
                ts: toMillis(cd.createdAt) || toMillis(post.date),
              });
            })
          );
        } catch {
          /* one post's comments failing shouldn't kill the feed */
        }
      })
    );

    // Prefer tracked like events (real timestamps). Fall back to likedBy only
    // for pairs missing from activities — never invent post.date as "liked at".
    const trackedLikes = await getTrackedLikeActivity(uid, myPosts);
    const trackedKeys = new Set(trackedLikes.map((x) => `${x.actorId}::${x.post?.id || ''}`));
    items.push(...trackedLikes);

    const likerIds = new Set();
    const likeSeed = [];
    for (const post of myPosts) {
      const likedBy = Array.isArray(post.likedBy) ? post.likedBy : [];
      // likedBy appends on like — tip of array is the most recent liker.
      for (const likerId of likedBy.slice(-6).reverse()) {
        if (likerId === uid || likerIds.has(likerId)) continue;
        if (trackedKeys.has(`${likerId}::${post.id}`)) continue;
        likerIds.add(likerId);
        likeSeed.push({ likerId, post });
        if (likerIds.size >= 8) break;
      }
      if (likerIds.size >= 8) break;
    }
    await Promise.all(
      likeSeed.map(async ({ likerId, post }) => {
        const actor = await resolveActor(likerId);
        items.push({
          id: `like_${post.id}_${likerId}`,
          type: 'like',
          actorId: likerId,
          username: actor.username,
          displayName: actor.displayName,
          avatar: actor.avatar,
          post,
          postKind: postKind(post),
          thumbnail: postThumb(post),
          // No event time on likedBy — omit fake clocks; sort after real events.
          ts: 0,
          _likeTsSoft: true,
        });
      })
    );

    return items;
  } catch (e) {
    console.warn('[ACTIVITY] posts failed', e?.message || String(e));
    return [];
  }
}

function postThumb(post) {
  return (
    fixStorageUrl(
      post?.thumbnail ||
        post?.imageUrl ||
        post?.media?.[0]?.thumbnail ||
        post?.media?.[0]?.url ||
        post?.videoUrl ||
        post?.mediaUrl
    ) || null
  );
}

/** Likes written by trackActivity — real server timestamps. */
async function getTrackedLikeActivity(uid, myPosts = []) {
  try {
    let snap;
    try {
      snap = await db
        .collection('activities')
        .where('targetUserId', '==', uid)
        .where('type', '==', 'like')
        .orderBy('timestamp', 'desc')
        .limit(24)
        .get();
    } catch {
      // Missing composite index — fall back to target-only then filter.
      snap = await db
        .collection('activities')
        .where('targetUserId', '==', uid)
        .orderBy('timestamp', 'desc')
        .limit(40)
        .get();
    }
    const byPostId = new Map((myPosts || []).map((p) => [p.id, p]));
    const out = [];
    for (const d of snap?.docs || []) {
      const data = d.data() || {};
      if (data.type && data.type !== 'like') continue;
      const actorId = data.actorId;
      if (!actorId || actorId === uid) continue;
      const postId = data.metadata?.postId || data.postId || null;
      const post = (postId && byPostId.get(postId)) || (postId ? { id: postId, ...(data.metadata?.post || {}) } : null);
      const actor = await resolveActor(actorId, data);
      out.push({
        id: `like_tracked_${d.id}`,
        type: 'like',
        actorId,
        username: actor.username,
        displayName: actor.displayName,
        avatar: actor.avatar,
        post,
        postKind: postKind(post),
        thumbnail: postThumb(post) || fixStorageUrl(data.metadata?.thumbnail) || null,
        ts: toMillis(data.timestamp) || toMillis(data.createdAt),
      });
    }
    return out;
  } catch (e) {
    console.warn('[ACTIVITY] tracked likes failed', e?.message || String(e));
    return [];
  }
}

/** Returns a merged, time-sorted activity list for the user. */
export async function getActivity(uid) {
  if (!ready() || !uid || uid === 'anon') return [];
  const [follows, postActivity, ctx] = await Promise.all([
    getFollowerActivity(uid),
    getPostActivity(uid),
    getCircleContext(uid),
  ]);
  return [...follows, ...postActivity]
    .map((item) => annotateGraph(item, ctx))
    .sort((a, b) => {
      // Recent Top Circle / following activity rises without inventing a new graph.
      if ((b._rank || 0) !== (a._rank || 0)) return (b._rank || 0) - (a._rank || 0);
      // Prefer hard event times over soft likedBy floors.
      const aSoft = a._likeTsSoft ? 1 : 0;
      const bSoft = b._likeTsSoft ? 1 : 0;
      if (aSoft !== bSoft) return aSoft - bSoft;
      return (b.ts || 0) - (a.ts || 0);
    })
    .slice(0, 60)
    .map(({ _rank, _likeTsSoft, ...rest }) => rest);
}

export function countUnread(items, lastSeenAt = 0) {
  return (items || []).filter((i) => (i.ts || 0) > (lastSeenAt || 0)).length;
}

export default { getActivity, countUnread };
