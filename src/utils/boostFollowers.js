import { 
  collection, 
  doc, 
  setDoc, 
  getDocs 
} from 'firebase/firestore';
import { firestore as db } from '../config/firebase';

/**
 * Add fake followers to boost a user's follower count
 * This creates fake follower documents in Firebase
 */
export const addFakeFollowers = async (_targetUserId, _count = 1000) => {
  // Wave 0 containment: client fake-follower minting is disabled.
  return { success: false, error: 'FAKE_FOLLOWERS_DISABLED' };
};

/**
 * Get current follower count for verification
 */
export const getCurrentFollowerCount = async (userId) => {
  try {
    const followersRef = collection(db, 'users', userId, 'followers');
    const snapshot = await getDocs(followersRef);
    return snapshot.size;
  } catch (error) {
    console.error('Error getting follower count:', error);
    return 0;
  }
};

/**
 * Remove fake followers (cleanup function)
 */
export const removeFakeFollowers = async (targetUserId) => {
  try {
    console.log(`🧹 Removing fake followers from user: ${targetUserId}`);
    
    const followersRef = collection(db, 'users', targetUserId, 'followers');
    const snapshot = await getDocs(followersRef);
    
    const deletePromises = [];
    let removedCount = 0;
    
    snapshot.docs.forEach((docSnapshot) => {
      const data = docSnapshot.data();
      // Remove documents that have the isBot flag or fake_follower prefix
      if (data.isBot || docSnapshot.id.startsWith('fake_follower_')) {
        deletePromises.push(deleteDoc(docSnapshot.ref));
        removedCount++;
      }
    });
    
    await Promise.all(deletePromises);
    
    console.log(`🎉 Successfully removed ${removedCount} fake followers!`);
    return {
      success: true,
      removedCount
    };
    
  } catch (error) {
    console.error('❌ Error removing fake followers:', error);
    return {
      success: false,
      error: error.message
    };
  }
};