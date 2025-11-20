// Script to remove all fake followers from your Blyp account
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, deleteDoc, doc } = require('firebase/firestore');

// Firebase config - using your project
const firebaseConfig = {
  apiKey: "AIzaSyB6f7vGYUXUQkHttn_ChcIVGLWfkqL4mOY",
  authDomain: "blyp-master.firebaseapp.com",
  projectId: "blyp-master",
  storageBucket: "blyp-master.appspot.com",
  messagingSenderId: "113412060939",
  appId: "1:113412060939:web:2f585b6f7b8daefd60a95c",
  measurementId: "G-MSBNHBXEZ4"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function removeAllFakeFollowers() {
  const YOUR_USER_ID = 'JvX9baS41LOSFKj7kx9T99obgVy1'; // Your user ID from the logs
  
  console.log('🔍 Checking followers collection...');
  
  try {
    const followersRef = collection(db, 'users', YOUR_USER_ID, 'followers');
    const snapshot = await getDocs(followersRef);
    
    console.log(`📊 Found ${snapshot.size} followers to process`);
    
    if (snapshot.size === 0) {
      console.log('✅ No followers found - database is already clean!');
      return;
    }

    console.log('🗑️ Starting to remove fake followers...');
    
    let deletedCount = 0;
    const batchSize = 50; // Process in batches to avoid overwhelming Firebase
    const followers = snapshot.docs;
    
    for (let i = 0; i < followers.length; i += batchSize) {
      const batch = followers.slice(i, i + batchSize);
      
      console.log(`🔄 Processing batch ${Math.floor(i/batchSize) + 1} (followers ${i + 1}-${Math.min(i + batchSize, followers.length)})`);
      
      const deletePromises = batch.map(async (followerDoc) => {
        const followerId = followerDoc.id;
        const followerData = followerDoc.data();
        
        // Check if this is a fake follower (has isBot flag or follows the fake_follower pattern)
        if (followerData.isBot || followerId.startsWith('fake_follower_') || followerData.displayName?.startsWith('Fake User')) {
          await deleteDoc(doc(db, 'users', YOUR_USER_ID, 'followers', followerId));
          deletedCount++;
          console.log(`❌ Removed fake follower: ${followerData.displayName || followerId}`);
        } else {
          console.log(`✅ Kept real follower: ${followerData.displayName || followerId}`);
        }
      });
      
      await Promise.all(deletePromises);
      
      // Small delay between batches to be gentle on Firebase
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log('\n🎉 Fake follower cleanup completed!');
    console.log(`📊 Removed ${deletedCount} fake followers`);
    console.log(`📊 Kept ${followers.length - deletedCount} real followers`);
    
    // Verify the cleanup
    const verifySnapshot = await getDocs(followersRef);
    console.log(`✅ Current follower count: ${verifySnapshot.size}`);
    
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
  }
  
  process.exit(0);
}

removeAllFakeFollowers();