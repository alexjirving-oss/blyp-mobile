/**
 * Test Script for Live Streaming
 * 
 * Run this to verify your Firebase setup and streaming service
 * Usage: node test-livestream.js
 */

const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc, serverTimestamp } = require('firebase/firestore');
const { getStorage, ref } = require('firebase/storage');

// Import your Firebase config
// Note: Update this path if your firebase config is elsewhere
const firebaseConfig = {
  // Copy from src/config/firebase.js
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

async function testLiveStreamSetup() {
  console.log('🧪 Testing Live Stream Setup...\n');

  try {
    // Initialize Firebase
    console.log('1️⃣ Initializing Firebase...');
    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);
    const storage = getStorage(app);
    console.log('✅ Firebase initialized\n');

    // Test Firestore connection
    console.log('2️⃣ Testing Firestore connection...');
    const testDoc = await addDoc(collection(db, 'test_collection'), {
      test: true,
      timestamp: serverTimestamp()
    });
    console.log('✅ Firestore working:', testDoc.id, '\n');

    // Test Storage reference
    console.log('3️⃣ Testing Storage setup...');
    const storageRef = ref(storage, 'streams/test_user/test_stream/segment_0.mp4');
    console.log('✅ Storage reference created:', storageRef.fullPath, '\n');

    console.log('🎉 All tests passed!\n');
    console.log('📝 Next steps:');
    console.log('   1. Update your firestore.rules with the rules from firestore-livestream-rules.txt');
    console.log('   2. Update your storage.rules with the rules from storage-livestream-rules.txt');
    console.log('   3. Deploy rules: firebase deploy --only firestore:rules,storage');
    console.log('   4. Test the app: npm start');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('\n💡 Make sure:');
    console.error('   - Firebase config is correct');
    console.error('   - Firestore is enabled in Firebase Console');
    console.error('   - Storage is enabled in Firebase Console');
    console.error('   - You have internet connection');
  }

  process.exit(0);
}

testLiveStreamSetup();
