// activityService.js
//
// Derives a real "activity" / notifications feed for the current user from
// existing data (there is no dedicated notifications collection):
//   - new followers   (users/{uid}/followers)
//   - comments on my posts (posts/{id}/comments)
//   - likes on my posts    (posts.likedBy)
//
// Read-bounded and best-effort: never throws, returns [] when Firebase is off.
// Actor labels skip Cognito-sub / UUID-shaped usernames and resolve profiles
// on read so the Activity UI never shows a raw uid as @handle.

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
    if (!username) {
      try {
        const pSnap = await db.collection('userProfiles').doc(id).get();
        const p = pSnap?.data?.() || {};
        username = pickPublicLabel(p, { uid: id, fallback: '' });
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
      avatar: fixStorageUrl(d.avatar || d.photoURL || d.profilePicture || d.userPhotoURL) || null,
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

async function getFollowerActivity(uid) {
  try {
    let snap;
    try {
      snap = await db.collection('users').doc(uid).collection('followers').orderBy('timestamp', 'desc').limit(20).get();
    } catch {
      snap = await db.collection('users').doc(uid).collection('followers').limit(20).get();
    }
    const docs = snap?.docs || [];
    const items = await Promise.all(
      docs.map(async (d) => {
        const data = d.data() || {};
        const followerId = data.userId || d.id;
        const fromDoc = denormalizedActorLabel(data, followerId);
        const profile = fromDoc ? null : await getProfile(followerId);
        const username = fromDoc || profile?.username || 'Someone';
        return {
          id: `follow_${followerId}`,
          type: 'follow',
          actorId: followerId,
          username,
          displayName: profile?.displayName || username,
          avatar: profile?.avatar || fixStorageUrl(data.avatar || data.photoURL) || null,
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
    const postsSnap = await db.collection('posts').where('userId', '==', uid).orderBy('date', 'desc').limit(8).get();
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
              if (!commenterId || commenterId === uid) return; // skip my own comments
              let username = denormalizedActorLabel(cd, commenterId);
              let avatar = fixStorageUrl(cd.avatar || cd.photoURL || cd.profilePicture) || null;
              if (!username || looksLikeRawId(username)) {
                const profile = await getProfile(commenterId);
                username = profile?.username || 'Someone';
                avatar = avatar || profile?.avatar || null;
              }
              items.push({
                id: `comment_${c.id}`,
                type: 'comment',
                actorId: commenterId,
                username,
                displayName: username,
                avatar,
                text: cd.text || '',
                post,
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

    // Likes on my posts (no per-like timestamp, so we attribute the post date)
    const likerIds = new Set();
    const likeSeed = [];
    for (const post of myPosts) {
      const likedBy = Array.isArray(post.likedBy) ? post.likedBy : [];
      for (const likerId of likedBy.slice(-6).reverse()) {
        if (likerId === uid || likerIds.has(likerId)) continue;
        likerIds.add(likerId);
        likeSeed.push({ likerId, post });
        if (likerIds.size >= 14) break;
      }
      if (likerIds.size >= 14) break;
    }
    await Promise.all(
      likeSeed.map(async ({ likerId, post }) => {
        const profile = await getProfile(likerId);
        items.push({
          id: `like_${post.id}_${likerId}`,
          type: 'like',
          actorId: likerId,
          username: profile?.username || 'Someone',
          displayName: profile?.displayName || profile?.username || 'Someone',
          avatar: profile?.avatar || null,
          post,
          thumbnail: postThumb(post),
          ts: toMillis(post.date),
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

/** Returns a merged, time-sorted activity list for the user. */
export async function getActivity(uid) {
  if (!ready() || !uid || uid === 'anon') return [];
  const [follows, postActivity] = await Promise.all([getFollowerActivity(uid), getPostActivity(uid)]);
  return [...follows, ...postActivity].sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 60);
}

export function countUnread(items, lastSeenAt = 0) {
  return (items || []).filter((i) => (i.ts || 0) > (lastSeenAt || 0)).length;
}

export default { getActivity, countUnread };
