// Quick script to add test followers to verify the followers display is working
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, setDoc } = require('firebase/firestore');

// Firebase config - using your project
const firebaseConfig = {
  apiKey: "AIzaSyB6f7vGYUXUQkHttn_ChcIVGLWfkqL4mOY",
  authDomain: "blyp-master.firebaseapp.com",
  projectId: "blyp-master",
  storageBucket: "blyp-master.firebasestorage.app",
  messagingSenderId: "113412060939",
  appId: "1:113412060939:web:2f585b6f7b8daefd60a95c",
  measurementId: "G-MSBNHBXEZ4"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function addTestFollowers() {
  const YOUR_USER_ID = 'JvX9baS41LOSFKj7kx9T99obgVy1'; // Your user ID from the logs
  
  // Add 3 test followers
  const testFollowers = [
    { id: 'test_follower_1', name: 'Alice Cooper' },
    { id: 'test_follower_2', name: 'Bob Smith' },
    { id: 'test_follower_3', name: 'Charlie Brown' }
  ];

  console.log('Adding test followers...');

  try {
    for (const follower of testFollowers) {
      await setDoc(doc(db, 'users', YOUR_USER_ID, 'followers', follower.id), {
        timestamp: new Date(),
        userId: follower.id,
        name: follower.name
      });
      console.log(`✅ Added follower: ${follower.name}`);
    }
    
    console.log('\n🎉 Successfully added 3 test followers!');
    console.log('Now check your profile screen - you should see 3 followers.');
    
  } catch (error) {
    console.error('❌ Error adding test followers:', error);
  }
  
  process.exit(0);
}

addTestFollowers();