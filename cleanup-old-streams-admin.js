import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, updateDoc, doc, query, where, orderBy, limit } from 'firebase/firestore';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDWzQ5gR4x_k_yuosDH-ap8OO7SAj-PG8A",
  authDomain: "blyp-master.firebaseapp.com", 
  projectId: "blyp-master",
  storageBucket: "blyp-master.appspot.com",
  messagingSenderId: "969068801647",
  appId: "1:969068801647:web:4fdcba717a011a3e9dc424"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

async function cleanupOldStreams() {
  console.log('🧹 Starting cleanup of old livestreams...');
  
  try {
    // First authenticate as a user (we'll need actual credentials)
    // For now, let's just query and see what we can do
    
    const streamsRef = collection(db, 'liveStreams');
    
    // Get all streams
    const querySnapshot = await getDocs(streamsRef);
    console.log(`📊 Found ${querySnapshot.size} total streams in database`);
    
    let oldLiveStreams = [];
    const cutoffTime = Date.now() - (1 * 60 * 60 * 1000); // 1 hour ago
    
    querySnapshot.forEach((docSnapshot) => {
      const data = docSnapshot.data();
      const streamId = docSnapshot.id;
      
      console.log(`🔍 Stream ${streamId}: status="${data.status}", title="${data.title}"`);
      
      if (data.status === 'live') {
        const createdAt = data.createdAt?.toMillis() || data.timestamp || 0;
        const ageHours = (Date.now() - createdAt) / (1000 * 60 * 60);
        
        if (createdAt < cutoffTime) {
          oldLiveStreams.push({
            id: streamId,
            title: data.title,
            userId: data.userId,
            ageHours: ageHours.toFixed(1),
            createdAt
          });
        }
      }
    });
    
    console.log(`\n📈 Summary:`);
    console.log(`- Total streams: ${querySnapshot.size}`);
    console.log(`- Old "live" streams found: ${oldLiveStreams.length}`);
    
    if (oldLiveStreams.length > 0) {
      console.log(`\n🔧 Old streams that should be cleaned up:`);
      oldLiveStreams.forEach(stream => {
        console.log(`- ${stream.id}: "${stream.title}" (${stream.ageHours}h old)`);
      });
      
      console.log(`\n⚠️  To clean these up, we need proper admin permissions.`);
      console.log(`For now, these streams will continue to appear as "live" until:`);
      console.log(`1. The stream creator manually stops them`);
      console.log(`2. We implement admin cleanup with proper permissions`);
      console.log(`3. We add automatic cleanup logic to the app`);
    }
    
    console.log('🎉 Analysis completed');
    
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
  }
}

// Run the cleanup
cleanupOldStreams().then(() => {
  console.log('Script completed');
}).catch(console.error);