/**
 * Cleanup script for old livestreams in Firebase
 */

import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  getDocs, 
  updateDoc, 
  doc, 
  query, 
  where,
  serverTimestamp 
} from 'firebase/firestore';

// Firebase config (same as your app)
const firebaseConfig = {
  apiKey: "AIzaSyC1rZaAd2xgkkLanFGVxj3qJ9E8WrjWY3c",
  authDomain: "blyp-master.firebaseapp.com",
  projectId: "blyp-master",
  storageBucket: "blyp-master.appspot.com",
  messagingSenderId: "494998136284",
  appId: "1:494998136284:web:5f0b7b8b7f8b7b8b7f8b7b"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function cleanupOldStreams() {
  console.log('🧹 Starting cleanup of old livestreams...');
  
  try {
    // Get all live streams
    const streamsRef = collection(db, 'liveStreams');
    const snapshot = await getDocs(streamsRef);
    
    console.log(`📊 Found ${snapshot.size} total streams in database`);
    
    let liveCount = 0;
    let endedCount = 0;
    let fixedCount = 0;
    
    for (const streamDoc of snapshot.docs) {
      const data = streamDoc.data();
      const streamId = streamDoc.id;
      
      console.log(`🔍 Stream ${streamId}: status="${data.status}", title="${data.title || 'No title'}"`);
      
      if (data.status === 'live') {
        liveCount++;
        
        // Check if it's actually old (more than 1 hour old)
        const startedAt = data.startedAt?.toDate?.() || data.createdAt?.toDate?.();
        if (startedAt) {
          const ageInHours = (Date.now() - startedAt.getTime()) / (1000 * 60 * 60);
          
          if (ageInHours > 1) {
            console.log(`🔧 Fixing old "live" stream ${streamId} (${ageInHours.toFixed(1)} hours old)`);
            
            // Mark as ended
            await updateDoc(doc(db, 'liveStreams', streamId), {
              status: 'ended',
              endedAt: serverTimestamp(),
              endReason: 'cleanup_old_stream'
            });
            
            fixedCount++;
          }
        }
      } else if (data.status === 'ended') {
        endedCount++;
      }
    }
    
    console.log(`\n📊 Cleanup Summary:`);
    console.log(`   Live streams: ${liveCount}`);
    console.log(`   Ended streams: ${endedCount}`);
    console.log(`   Fixed old streams: ${fixedCount}`);
    console.log(`\n✅ Cleanup completed!`);
    
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
  }
}

// Run the cleanup
cleanupOldStreams().then(() => {
  console.log('🎉 Script completed');
  process.exit(0);
});