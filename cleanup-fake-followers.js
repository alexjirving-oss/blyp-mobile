// Simple fake followers cleanup script for Node.js
const { initializeApp } = require('firebase/app');
const { getAuth, signInAnonymously } = require('firebase/auth');
const { getFirestore, collection, doc, getDocs, deleteDoc, writeBatch } = require('firebase/firestore');

// Your Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAScxM-7tnuD0532VhY6bvaXvoWVEyDSF8",
  authDomain: "blyp-master.firebaseapp.com",
  projectId: "blyp-master",
  storageBucket: "blyp-master.appspot.com",
  messagingSenderId: "929105034040",
  appId: "1:929105034040:web:3f725bb93e50e9d8bb9fcd"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

async function removeFakeFollowers(userId) {
  console.log('🔍 Starting fake followers cleanup...');
  
  try {
    // Sign in anonymously for authentication
    console.log('🔐 Authenticating...');
    await signInAnonymously(auth);
    console.log('✅ Authenticated successfully');
    
    console.log(`👤 Cleaning followers for user: ${userId}`);
    
    const followersRef = collection(doc(db, 'users', userId), 'followers');
    
    // Get all followers
    console.log('📊 Fetching all followers...');
    const snapshot = await getDocs(followersRef);
    
    console.log(`📈 Total followers found: ${snapshot.size}`);
    
    if (snapshot.empty) {
      console.log('✅ No followers found.');
      return;
    }
    
    let fakeFollowersCount = 0;
    let realFollowersCount = 0;
    let deletedCount = 0;
    let batch = writeBatch(db);
    let batchOperations = 0;
    const maxBatchSize = 450; // Firestore batch limit (keeping some margin)
    
    console.log('🔍 Analyzing followers...');
    
    const allDocs = [];
    snapshot.forEach(docSnap => {
      allDocs.push(docSnap);
    });
    
    for (let i = 0; i < allDocs.length; i++) {
      const docSnap = allDocs[i];
      const data = docSnap.data();
      const docId = docSnap.id;
      
      // Check if this is a fake follower
      const isFakeFollower = 
        data.isBot === true ||
        docId.startsWith('fake_follower_') ||
        (data.displayName && data.displayName.startsWith('Fake User')) ||
        (data.username && data.username.startsWith('fake_user_'));
      
      if (isFakeFollower) {
        fakeFollowersCount++;
        
        // Add to batch delete
        batch.delete(docSnap.ref);
        batchOperations++;
        
        // Execute batch if we hit the limit
        if (batchOperations >= maxBatchSize) {
          console.log(`🗑️ Executing batch delete (${batchOperations} operations)...`);
          await batch.commit();
          deletedCount += batchOperations;
          
          // Create new batch
          batch = writeBatch(db);
          batchOperations = 0;
          
          console.log(`✅ Deleted ${deletedCount} fake followers so far...`);
          
          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        // Progress indicator
        if (fakeFollowersCount % 100 === 0) {
          console.log(`📊 Processed ${i + 1}/${allDocs.length} followers (${fakeFollowersCount} fake found)`);
        }
      } else {
        realFollowersCount++;
      }
    }
    
    // Execute remaining batch operations
    if (batchOperations > 0) {
      console.log(`🗑️ Executing final batch delete (${batchOperations} operations)...`);
      await batch.commit();
      deletedCount += batchOperations;
    }
    
    console.log('\n🎉 CLEANUP COMPLETED! 🎉');
    console.log('='.repeat(40));
    console.log(`👥 Total followers processed: ${snapshot.size}`);
    console.log(`🤖 Fake followers found: ${fakeFollowersCount}`);
    console.log(`👤 Real followers found: ${realFollowersCount}`);
    console.log(`🗑️ Fake followers deleted: ${deletedCount}`);
    console.log('='.repeat(40));
    
    if (realFollowersCount > 0) {
      console.log(`\n🌟 Your account now has ${realFollowersCount} real followers!`);
    } else {
      console.log('\n🎯 Your account now has 0 followers (all fake followers removed).');
      console.log('💡 You can now build genuine followers organically!');
    }
    
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    
    if (error.code === 'permission-denied') {
      console.log('\n🔧 PERMISSION FIX NEEDED:');
      console.log('1. Check your Firestore security rules allow deletes');
      console.log('2. Make sure authentication is working');
      console.log('3. Verify the user ID is correct');
    }
  }
}

// Get user ID from command line arguments
const userId = process.argv[2];

if (!userId) {
  console.log('❌ Please provide your user ID as an argument:');
  console.log('   node cleanup-fake-followers.js YOUR_USER_ID');
  console.log('\n💡 To find your user ID:');
  console.log('   1. Open your app and check the Profile screen logs');
  console.log('   2. Look for "👤 Current user ID:" in the console');
  console.log('   3. Or check Firebase Authentication in Firebase console');
  process.exit(1);
}

console.log('🚀 Starting cleanup process...');
removeFakeFollowers(userId).catch(console.error);