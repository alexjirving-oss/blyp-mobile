import { 
  collection, 
  doc, 
  getDocs, 
  getDoc,
  getCountFromServer,
  onSnapshot 
} from 'firebase/firestore';
import { firestore as db } from '../config/firebase';
import { ensureFirebaseAuthReady } from './firebaseAuthHelper';
import { followUserApi, unfollowUserApi } from '../api/economyLiveApi';

/**
 * Follow a user (server-authoritative via live-service).
 */
export const followUser = async (currentUserId, targetUserId) => {
  try {
    void currentUserId; // actor is derived from Cognito JWT on the server
    await followUserApi(targetUserId);
    console.log(`User followed ${targetUserId}`);
    return { success: true };
  } catch (error) {
    console.error('Error following user:', error);
    return { success: false, error };
  }
};

/**
 * Unfollow a user (server-authoritative via live-service).
 */
export const unfollowUser = async (currentUserId, targetUserId) => {
  try {
    void currentUserId;
    await unfollowUserApi(targetUserId);
    console.log(`User unfollowed ${targetUserId}`);
    return { success: true };
  } catch (error) {
    console.error('Error unfollowing user:', error);
    return { success: false, error };
  }
};

/**
 * Check if current user is following target user
 */
export const isFollowing = async (currentUserId, targetUserId) => {
  try {
    await ensureFirebaseAuthReady({ uid: currentUserId });
    const followingDoc = await getDoc(doc(db, 'users', currentUserId, 'following', targetUserId));
    return followingDoc.exists();
  } catch (error) {
    console.error('Error checking follow status:', error);
    return false;
  }
};

/**
 * Get the set of userIds a user follows (one-shot read).
 */
export const getFollowingIds = async (userId) => {
  try {
    const snap = await getDocs(collection(db, 'users', userId, 'following'));
    return snap.docs.map((d) => d.id);
  } catch (error) {
    console.error('Error loading following ids:', error);
    return [];
  }
};

/**
 * Count people that BOTH users follow (mutual follows). Bounded one-shot reads.
 */
export const getMutualFollowCount = async (userIdA, userIdB) => {
  try {
    const [a, b] = await Promise.all([getFollowingIds(userIdA), getFollowingIds(userIdB)]);
    const setA = new Set(a);
    return b.reduce((n, id) => (setA.has(id) ? n + 1 : n), 0);
  } catch (error) {
    console.error('Error computing mutual follows:', error);
    return 0;
  }
};

/**
 * Get followers count for a user
 */
export const getFollowersCount = async (userId) => {
  try {
    await ensureFirebaseAuthReady();
    const followersRef = collection(db, 'users', userId, 'followers');
    // Prefer server-side aggregation (1 read, no doc transfer); fall back to a
    // full read only if the aggregate API is unavailable.
    try {
      const agg = await getCountFromServer(followersRef);
      return agg.data().count;
    } catch {
      const snapshot = await getDocs(followersRef);
      return snapshot.size;
    }
  } catch (error) {
    console.error('❌ Error getting followers count:', error);
    return 0;
  }
};

/**
 * Get following count for a user
 */
export const getFollowingCount = async (userId) => {
  try {
    await ensureFirebaseAuthReady();
    const followingRef = collection(db, 'users', userId, 'following');
    try {
      const agg = await getCountFromServer(followingRef);
      return agg.data().count;
    } catch {
      const snapshot = await getDocs(followingRef);
      return snapshot.size;
    }
  } catch (error) {
    console.error('Error getting following count:', error);
    return 0;
  }
};

/**
 * Subscribe to followers count changes
 */
export const subscribeToFollowersCount = (userId, callback) => {
  console.log('🔗 subscribeToFollowersCount called for userId:', userId);
  let unsub = null;
  let cancelled = false;

  (async () => {
    try {
      await ensureFirebaseAuthReady();
      if (cancelled) return;
      const followersRef = collection(db, 'users', userId, 'followers');
      console.log('📁 Followers collection path:', `users/${userId}/followers`);

      unsub = onSnapshot(followersRef, (snapshot) => {
        console.log('🔔 Followers snapshot received. Size:', snapshot.size);
        console.log('🔔 Followers snapshot docs:', snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() })));
        callback(snapshot.size);
      }, (error) => {
        console.error('❌ Followers subscription error:', error);
      });
    } catch (e) {
      console.error('❌ Followers subscription setup error:', e);
    }
  })();

  return () => {
    cancelled = true;
    try { unsub && unsub(); } catch {}
  };
};

/**
 * Subscribe to following count changes
 */
export const subscribeToFollowingCount = (userId, callback) => {
  let unsub = null;
  let cancelled = false;

  (async () => {
    try {
      await ensureFirebaseAuthReady();
      if (cancelled) return;
      const followingRef = collection(db, 'users', userId, 'following');
      unsub = onSnapshot(followingRef, (snapshot) => {
        callback(snapshot.size);
      });
    } catch (e) {
      console.error('❌ Following subscription setup error:', e);
    }
  })();

  return () => {
    cancelled = true;
    try { unsub && unsub(); } catch {}
  };
};

/**
 * Subscribe to the set of user IDs that follow `userId` (i.e. their followers).
 * Mirrors subscribeToFollowingList; used to detect mutual follows.
 */
export const subscribeToFollowersList = (userId, callback) => {
  let unsub = null;
  let cancelled = false;

  (async () => {
    try {
      await ensureFirebaseAuthReady({ uid: userId });
      if (cancelled) return;
      const followersRef = collection(db, 'users', userId, 'followers');
      unsub = onSnapshot(followersRef, (snapshot) => {
        const followersSet = new Set(snapshot.docs.map(doc => doc.id));
        callback(followersSet);
      }, (error) => {
        console.error('❌ subscribeToFollowersList error:', error);
      });
    } catch (e) {
      console.error('❌ subscribeToFollowersList setup error:', e);
    }
  })();

  return () => {
    cancelled = true;
    try { unsub && unsub(); } catch {}
  };
};

/**
 * Subscribe to current user's following list
 */
export const subscribeToFollowingList = (userId, callback) => {
  let unsub = null;
  let cancelled = false;

  (async () => {
    try {
      await ensureFirebaseAuthReady({ uid: userId });
      if (cancelled) return;
      const followingRef = collection(db, 'users', userId, 'following');
      unsub = onSnapshot(followingRef, (snapshot) => {
        const followingSet = new Set(snapshot.docs.map(doc => doc.id));
        callback(followingSet);
      });
    } catch (e) {
      console.error('❌ subscribeToFollowingList setup error:', e);
    }
  })();

  return () => {
    cancelled = true;
    try { unsub && unsub(); } catch {}
  };
};