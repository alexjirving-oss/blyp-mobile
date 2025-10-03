const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
// Note: This requires a service account key JSON file
// For now, let's try to use the existing Firebase config
try {
  // Try to initialize admin if not already done
  if (!admin.apps.length) {
    // This will work if you have FIREBASE_CONFIG environment variable or default credentials
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      databaseURL: 'https://your-project.firebaseio.com'
    });
  }
} catch (error) {
  console.log('⚠️ Admin SDK initialization failed, trying alternative method...');
  
  // Alternative: Use regular Firebase with authentication
  const { initializeApp } = require('firebase/app');
  const { getAuth, signInAnonymously } = require('firebase/auth');
  const { getFirestore } = require('firebase/firestore');
  
  // Use your existing Firebase config
  const firebaseConfig = {
    // Add your Firebase config here from src/config/firebase.js
    apiKey: "your-api-key",
    authDomain: "your-project.firebaseapp.com",
    projectId: "your-project-id",
    storageBucket: "your-project.appspot.com",
    messagingSenderId: "123456789",
    appId: "your-app-id"
  };
  
  console.log('📱 Using client SDK with authentication...');
  process.exit(1);
}

async function removeFakeFollowers() {
  console.log('🔍 Starting fake followers cleanup with Admin SDK...');
  
  try {
    const db = admin.firestore();
    
    // Get current user ID - you'll need to replace this with your actual user ID
    const userId = 'your-user-id-here'; // Replace with your actual user ID
    
    console.log(`👤 Cleaning followers for user: ${userId}`);
    
    const followersRef = db.collection('users').doc(userId).collection('followers');
    
    // Get all followers
    console.log('📊 Fetching all followers...');
    const snapshot = await followersRef.get();
    
    console.log(`📈 Total followers found: ${snapshot.size}`);
    
    if (snapshot.empty) {
      console.log('✅ No followers found.');
      return;
    }
    
    let fakeFollowersCount = 0;
    let realFollowersCount = 0;
    let deletedCount = 0;
    const batch = db.batch();
    let batchOperations = 0;
    const maxBatchSize = 500; // Firestore batch limit
    
    console.log('🔍 Analyzing followers...');
    
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const docId = doc.id;
      
      // Check if this is a fake follower
      const isFakeFollower = 
        data.isBot === true ||
        docId.startsWith('fake_follower_') ||
        (data.displayName && data.displayName.startsWith('Fake User')) ||
        (data.username && data.username.startsWith('fake_user_'));
      
      if (isFakeFollower) {
        fakeFollowersCount++;
        
        // Add to batch delete
        batch.delete(doc.ref);
        batchOperations++;
        
        // Execute batch if we hit the limit
        if (batchOperations >= maxBatchSize) {
          console.log(`🗑️ Executing batch delete (${batchOperations} operations)...`);
          await batch.commit();
          deletedCount += batchOperations;
          
          // Create new batch
          const newBatch = db.batch();
          batchOperations = 0;
          
          console.log(`✅ Deleted ${deletedCount} fake followers so far...`);
          
          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
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
    
    console.log('\n📊 CLEANUP SUMMARY:');
    console.log(`👥 Total followers processed: ${snapshot.size}`);
    console.log(`🤖 Fake followers found: ${fakeFollowersCount}`);
    console.log(`👤 Real followers found: ${realFollowersCount}`);
    console.log(`🗑️ Fake followers deleted: ${deletedCount}`);
    console.log(`✅ Cleanup completed successfully!`);
    
    if (realFollowersCount > 0) {
      console.log(`\n🎉 Your account now has ${realFollowersCount} real followers!`);
    } else {
      console.log('\n💡 Your account now has 0 followers (all fake followers removed).');
    }
    
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    
    if (error.code === 'permission-denied') {
      console.log('\n🔧 PERMISSION FIX NEEDED:');
      console.log('1. Make sure your Firestore security rules allow deletes for authenticated users');
      console.log('2. Or run this script with proper Firebase Admin credentials');
      console.log('3. Check the Firestore rules in your Firebase console');
    }
  }
}

// Check if user provided their user ID as command line argument
const userId = process.argv[2];

if (!userId) {
  console.log('❌ Please provide your user ID as an argument:');
  console.log('   node remove-fake-followers-admin.js YOUR_USER_ID');
  console.log('\n💡 To find your user ID:');
  console.log('   1. Open your app and go to Profile screen');
  console.log('   2. Check the console logs - your user ID should be printed');
  console.log('   3. Or check Firebase Authentication in your Firebase console');
  process.exit(1);
}

// Update the script to use the provided user ID
removeFakeFollowers(userId).catch(console.error);