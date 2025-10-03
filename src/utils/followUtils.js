import { 
  collection, 
  doc, 
  setDoc, 
  deleteDoc, 
  getDocs, 
  getDoc,
  onSnapshot 
} from 'firebase/firestore';
import { db } from '../config/firebase';

/**
 * Follow a user
 */
export const followUser = async (currentUserId, targetUserId) => {
  try {
    // Add to current user's following
    await setDoc(doc(db, 'users', currentUserId, 'following', targetUserId), {
      timestamp: new Date(),
      userId: targetUserId
    });

    // Add to target user's followers
    await setDoc(doc(db, 'users', targetUserId, 'followers', currentUserId), {
      timestamp: new Date(),
      userId: currentUserId
    });

    console.log(`User ${currentUserId} followed ${targetUserId}`);
    return { success: true };
  } catch (error) {
    console.error('Error following user:', error);
    return { success: false, error };
  }
};

/**
 * Unfollow a user
 */
export const unfollowUser = async (currentUserId, targetUserId) => {
  try {
    // Remove from current user's following
    await deleteDoc(doc(db, 'users', currentUserId, 'following', targetUserId));

    // Remove from target user's followers
    await deleteDoc(doc(db, 'users', targetUserId, 'followers', currentUserId));

    console.log(`User ${currentUserId} unfollowed ${targetUserId}`);
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
    const followingDoc = await getDoc(doc(db, 'users', currentUserId, 'following', targetUserId));
    return followingDoc.exists();
  } catch (error) {
    console.error('Error checking follow status:', error);
    return false;
  }
};

/**
 * Get followers count for a user
 */
export const getFollowersCount = async (userId) => {
  try {
    console.log('📊 Direct fetch followers count for userId:', userId);
    const followersRef = collection(db, 'users', userId, 'followers');
    console.log('📁 Direct fetch - collection path:', `users/${userId}/followers`);
    const snapshot = await getDocs(followersRef);
    console.log('📊 Direct fetch - snapshot size:', snapshot.size);
    console.log('📊 Direct fetch - snapshot docs:', snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() })));
    return snapshot.size;
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
    const followingRef = collection(db, 'users', userId, 'following');
    const snapshot = await getDocs(followingRef);
    return snapshot.size;
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
  const followersRef = collection(db, 'users', userId, 'followers');
  console.log('📁 Followers collection path:', `users/${userId}/followers`);
  
  return onSnapshot(followersRef, (snapshot) => {
    console.log('🔔 Followers snapshot received. Size:', snapshot.size);
    console.log('🔔 Followers snapshot docs:', snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() })));
    callback(snapshot.size);
  }, (error) => {
    console.error('❌ Followers subscription error:', error);
  });
};

/**
 * Subscribe to following count changes
 */
export const subscribeToFollowingCount = (userId, callback) => {
  const followingRef = collection(db, 'users', userId, 'following');
  return onSnapshot(followingRef, (snapshot) => {
    callback(snapshot.size);
  });
};

/**
 * Subscribe to current user's following list
 */
export const subscribeToFollowingList = (userId, callback) => {
  const followingRef = collection(db, 'users', userId, 'following');
  return onSnapshot(followingRef, (snapshot) => {
    const followingSet = new Set(snapshot.docs.map(doc => doc.id));
    callback(followingSet);
  });
};