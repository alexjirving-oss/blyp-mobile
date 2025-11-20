import { collection, getDocs } from 'firebase/firestore';
import { db, auth } from '../config/firebase';

// Quick debug function to check Firestore structure
export const debugFollowersStructure = async () => {
  const user = auth.currentUser;
  if (!user) {
    console.log('❌ No authenticated user');
    return;
  }

  console.log('🔍 Debugging followers structure for user:', user.uid);
  
  try {
    // Check followers collection
    const followersRef = collection(db, 'users', user.uid, 'followers');
    const followersSnapshot = await getDocs(followersRef);
    
    console.log('📊 Followers collection:');
    console.log('  - Path:', `users/${user.uid}/followers`);
    console.log('  - Count:', followersSnapshot.size);
    console.log('  - Documents:');
    
    followersSnapshot.forEach((doc) => {
      console.log('    -', doc.id, ':', doc.data());
    });

    // Check following collection
    const followingRef = collection(db, 'users', user.uid, 'following');
    const followingSnapshot = await getDocs(followingRef);
    
    console.log('📊 Following collection:');
    console.log('  - Path:', `users/${user.uid}/following`);
    console.log('  - Count:', followingSnapshot.size);
    console.log('  - Documents:');
    
    followingSnapshot.forEach((doc) => {
      console.log('    -', doc.id, ':', doc.data());
    });

    return {
      followersCount: followersSnapshot.size,
      followingCount: followingSnapshot.size
    };
    
  } catch (error) {
    console.error('❌ Error debugging followers structure:', error);
    return null;
  }
};

// Function to manually create a test follower
export const createTestFollower = async (targetUserId = null) => {
  const user = auth.currentUser;
  if (!user) {
    console.log('❌ No authenticated user');
    return;
  }

  // Use the other user ID if provided, or create a dummy one
  const followerId = targetUserId || 'test-follower-123';
  
  try {
    const { followUser } = require('./followUtils');
    await followUser(followerId, user.uid);
    console.log('✅ Test follower created:', followerId, '-> follows ->', user.uid);
  } catch (error) {
    console.error('❌ Error creating test follower:', error);
  }
};