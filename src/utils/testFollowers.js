// Internal utility to add followers from within the app (use in developer mode)
import { doc, setDoc, collection, getDocs } from 'firebase/firestore';
import { firestore as db } from '../config/firebase';

export const addTestFollowersInternal = async (userId) => {
  const testFollowers = [
    { id: 'test_follower_1', name: 'Alice Cooper' },
    { id: 'test_follower_2', name: 'Bob Smith' },
    { id: 'test_follower_3', name: 'Charlie Brown' }
  ];

  console.log('🔄 Adding test followers...');

  try {
    for (const follower of testFollowers) {
      await setDoc(doc(db, 'users', userId, 'followers', follower.id), {
        timestamp: new Date(),
        userId: follower.id,
        name: follower.name
      });
      console.log(`✅ Added follower: ${follower.name}`);
    }
    
    console.log('🎉 Successfully added 3 test followers!');
    return { success: true, count: testFollowers.length };
    
  } catch (error) {
    console.error('❌ Error adding test followers:', error);
    return { success: false, error };
  }
};

export const checkFollowersData = async (userId) => {
  try {
    console.log('🔍 Checking existing followers data...');
    const followersRef = collection(db, 'users', userId, 'followers');
    const snapshot = await getDocs(followersRef);
    
    console.log('📊 Current followers count:', snapshot.size);
    console.log('📊 Current followers:', snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })));
    
    return {
      count: snapshot.size,
      followers: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
    };
    
  } catch (error) {
    console.error('❌ Error checking followers:', error);
    return { count: 0, followers: [] };
  }
};