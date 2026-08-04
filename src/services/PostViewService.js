import AsyncStorage from '@react-native-async-storage/async-storage';
import { increment } from 'firebase/firestore';
import { db, firebaseEnabled } from '../config/firebase';

// Tracks unique post views the way mainstream short-video platforms do: a single
// post counts at most one view per user (per device), regardless of how many
// times it scrolls back into frame. We persist the dedup key so re-opening the
// app never double-counts, and we use an atomic Firestore increment so concurrent
// viewers can never clobber each other's writes.

const VIEW_KEY_PREFIX = 'post_viewed:';

// In-memory guard so rapid re-entries within a single session don't even hit
// AsyncStorage repeatedly.
const sessionSeen = new Set();
// De-dupe concurrent in-flight writes for the same post+user.
const inFlight = new Set();

function viewKey(postId, viewerId) {
  return `${VIEW_KEY_PREFIX}${postId}:${viewerId || 'anon'}`;
}

/**
 * Record a unique view for a post. Safe to call on every viewable/active event;
 * it self-dedupes and never throws.
 *
 * @param {string} postId
 * @param {string} [viewerId] - current user id (Cognito sub); 'anon' fallback used otherwise
 * @returns {Promise<boolean>} true if a new view was counted, false otherwise
 */
export async function recordPostView(postId, viewerId) {
  if (!postId || typeof postId !== 'string') return false;
  if (!firebaseEnabled || !db || typeof db.collection !== 'function') return false;

  const key = viewKey(postId, viewerId);

  if (sessionSeen.has(key) || inFlight.has(key)) return false;
  inFlight.add(key);

  try {
    let alreadyCounted = false;
    try {
      alreadyCounted = !!(await AsyncStorage.getItem(key));
    } catch {
      // If storage is unavailable, fall back to the in-memory guard only.
    }

    if (alreadyCounted) {
      sessionSeen.add(key);
      return false;
    }

    try {
      await db.collection('posts').doc(postId).update({
        viewCount: increment(1),
        views: increment(1),
      });
    } catch (e) {
      // Post may be missing or rules may reject; do not mark as seen so a later
      // attempt can retry.
      return false;
    }

    sessionSeen.add(key);
    try {
      await AsyncStorage.setItem(key, String(Date.now()));
    } catch {
      // Non-fatal: worst case we may recount once in a future cold start.
    }
    return true;
  } finally {
    inFlight.delete(key);
  }
}

/** Normalized read of a post's view count across legacy field names. */
export function getPostViewCount(post) {
  if (!post || typeof post !== 'object') return 0;
  const value = post.viewCount ?? post.views ?? post.playCount ?? 0;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
