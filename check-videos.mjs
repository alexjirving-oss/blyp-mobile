/**
 * Simple Firebase Video Check
 * Uses the existing Firebase client setup
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, orderBy, limit, getDocs } from 'firebase/firestore';

// Your Firebase config (from firebase.js)
const firebaseConfig = {
  apiKey: "AIzaSyANm85RG5eWcxVODYJKB1HxYjYvCvb5Jxo",
  authDomain: "blyp-app.firebaseapp.com",
  projectId: "blyp-app",
  storageBucket: "blyp-app.firebasestorage.app",
  messagingSenderId: "1042798824443",
  appId: "1:1042798824443:web:1ab5afbfe2775de9aad2b1"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkVideos() {
  console.log('\n🔍 Checking Firebase for video posts...\n');
  
  try {
    const postsQuery = query(
      collection(db, 'posts'),
      orderBy('date', 'desc'),
      limit(30)
    );
    
    const snapshot = await getDocs(postsQuery);
    const allPosts = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    const videoPosts = allPosts.filter(post => post.type === 'video');
    
    console.log(`📊 Total posts found: ${allPosts.length}`);
    console.log(`🎥 Video posts: ${videoPosts.length}`);
    console.log(`📷 Other posts: ${allPosts.length - videoPosts.length}\n`);
    
    if (videoPosts.length === 0) {
      console.log('❌ NO VIDEO POSTS FOUND!');
      console.log('   This is why videos aren\'t playing - there are no videos!\n');
      console.log('💡 Solution: Upload some video posts to Firebase\n');
    } else {
      console.log('✅ Video posts exist in Firebase\n');
      console.log('First video:');
      const first = videoPosts[0];
      console.log({
        id: first.id,
        type: first.type,
        videoUrl: first.videoUrl?.substring(0, 60) + '...',
        hasUser: !!first.user,
        username: first.user?.username || first.username || 'Unknown'
      });
      
      console.log('\n💡 Videos exist but not playing? Check:');
      console.log('   1. Are you on the #4ME tab?');
      console.log('   2. Check Metro console for [VideoLoad] messages');
      console.log('   3. Check if video URLs are accessible');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
  
  process.exit(0);
}

checkVideos();
