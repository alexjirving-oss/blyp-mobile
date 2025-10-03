import { 
  collection, 
  doc, 
  setDoc, 
  getDocs 
} from 'firebase/firestore';
import { db } from '../config/firebase';

/**
 * Add fake followers to boost a user's follower count
 * This creates fake follower documents in Firebase
 */
export const addFakeFollowers = async (targetUserId, count = 1000) => {
  try {
    console.log(`🚀 Adding ${count} fake followers to user: ${targetUserId}`);
    
    const promises = [];
    
    for (let i = 1; i <= count; i++) {
      const fakeFollowerId = `fake_follower_${i}_${Date.now()}`;
      
      // Add to target user's followers collection
      const followerPromise = setDoc(doc(db, 'users', targetUserId, 'followers', fakeFollowerId), {
        timestamp: new Date(),
        userId: fakeFollowerId,
        displayName: `Fake User ${i}`,
        username: `fake_user_${i}`,
        avatar: `https://images.unsplash.com/photo-${1500000000000 + (i % 100)}?w=100&h=100&fit=crop&crop=face`,
        isBot: true // Flag to identify fake followers if needed
      });
      
      promises.push(followerPromise);
      
      // Process in batches of 50 to avoid overwhelming Firebase
      if (i % 50 === 0) {
        await Promise.all(promises);
        promises.length = 0;
        console.log(`✅ Added ${i}/${count} fake followers...`);
      }
    }
    
    // Process remaining promises
    if (promises.length > 0) {
      await Promise.all(promises);
    }
    
    console.log(`🎉 Successfully added ${count} fake followers to user ${targetUserId}!`);
    
    // Return the new follower count
    const followersRef = collection(db, 'users', targetUserId, 'followers');
    const snapshot = await getDocs(followersRef);
    
    return {
      success: true,
      newFollowerCount: snapshot.size,
      addedCount: count
    };
    
  } catch (error) {
    console.error('❌ Error adding fake followers:', error);
    return {
      success: false,
      error: error.message
    };
  }
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