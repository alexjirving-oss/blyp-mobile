import { firestore, firebaseEnabled } from '../config/firebase';
import { doc as webDoc, runTransaction as runWebTransaction } from 'firebase/firestore';
import { ensureFirebaseAuthReady } from '../utils/firebaseAuthHelper';
import { snapExists, snapData } from '../utils/firestoreSnap';

function toLikeInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

// Exported for unit tests — mirrors Firestore canTogglePostLike baseline logic.
export function computePostLikeNext(data, userId) {
  const beforeLikes = toLikeInt(data?.likes);
  const beforeLikeCount = Number.isInteger(data?.likeCount) ? data.likeCount : beforeLikes;
  const baseline = Math.max(beforeLikes, beforeLikeCount, 0);

  const arr = Array.isArray(data?.likedBy) ? data.likedBy.filter((x) => typeof x === 'string') : [];
  const beforeLiked = arr.includes(userId);
  const nextLiked = !beforeLiked;
  const delta = beforeLiked ? -1 : 1;
  const nextCount = Math.max(0, baseline + delta);
  const nextArr = beforeLiked ? arr.filter((x) => x !== userId) : [...arr, userId];

  return {
    payload: { likedBy: nextArr, likes: nextCount, likeCount: nextCount },
    liked: nextLiked,
    count: nextCount,
  };
}

// Toggle the current user's like on a post.
//
// Implemented as a transaction that derives the new state from the SERVER's
// current data, because the Firestore security rule (canTogglePostLike) is strict:
//   - `likes` and `likeCount` must both exist, be equal, and be exactly
//     baseline ± 1 (baseline = max(likes, likeCount));
//   - `likedBy` may only add/remove the caller.
//
// IMPORTANT: this runs against the RAW `firestore` instance, NOT the compat
// `db` wrapper from config/firebase. The compat wrapper only implements
// `.collection()` — it has NO `runTransaction`, so calling `db.runTransaction`
// threw a TypeError on every tap and the catch silently reverted the optimistic
// heart ("likes flash on then turn off"). Mirrors CommentsModal's dual path:
// native SDK when available, web modular SDK otherwise.
export async function setPostLiked({ postId, userId }) {
  if (!postId || typeof postId !== 'string') {
    return { ok: false, reason: 'INVALID_POST_ID' };
  }
  if (!userId || typeof userId !== 'string') {
    return { ok: false, reason: 'INVALID_USER_ID' };
  }
  if (!firebaseEnabled || !firestore) {
    return { ok: false, reason: 'FIREBASE_DISABLED' };
  }

  // Ensure Firebase Auth is signed in with uid == userId (Cognito sub).
  // Firestore rules depend on request.auth.uid.
  try {
    await ensureFirebaseAuthReady({ uid: userId, timeoutMs: 8000 });
  } catch (e) {
    return { ok: false, reason: e?.code || 'FIREBASE_AUTH_NOT_READY', error: e };
  }

  // Compute the only write the rule will accept, from the server's snapshot.
  const computeNext = (data) => computePostLikeNext(data, userId);

  try {
    let result;
    if (typeof firestore.runTransaction === 'function' && typeof firestore.collection === 'function') {
      // Native (@react-native-firebase) instance.
      const ref = firestore.collection('posts').doc(postId);
      result = await firestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snapExists(snap)) throw new Error('POST_NOT_FOUND');
        const next = computeNext(snapData(snap) || {});
        tx.update(ref, next.payload);
        return { liked: next.liked, count: next.count };
      });
    } else {
      // Web modular instance (the path release builds actually take).
      const ref = webDoc(firestore, 'posts', postId);
      result = await runWebTransaction(firestore, async (tx) => {
        const snap = await tx.get(ref);
        if (!snapExists(snap)) throw new Error('POST_NOT_FOUND');
        const next = computeNext(snapData(snap) || {});
        tx.update(ref, next.payload);
        return { liked: next.liked, count: next.count };
      });
    }
    return { ok: true, liked: result.liked, count: result.count };
  } catch (e) {
    console.warn('[LikeService] setPostLiked failed', e?.code || '', e?.message || String(e));
    return { ok: false, reason: 'WRITE_FAILED', error: e };
  }
}
