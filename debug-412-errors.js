// debug-412-errors.js - Find the real cause of 412 errors
const { db, storage } = require('./src/config/firebase');
const { collection, query, limit, getDocs, orderBy } = require('firebase/firestore');

async function debug412Errors() {
  console.log('🔍 Debugging 412 errors - checking actual video URLs...');
  
  try {
    // Get some recent posts
    const postsRef = collection(db, 'posts');
    const q = query(postsRef, orderBy('date', 'desc'), limit(5));
    const snapshot = await getDocs(q);
    
    console.log(`Found ${snapshot.size} posts to test`);
    
    for (const doc of snapshot.docs) {
      const post = doc.data();
      console.log(`\n=== Post ${doc.id} ===`);
      
      // Test video URLs
      if (post.videoUrl) {
        await testUrl(post.videoUrl, 'videoUrl');
      }
      
      // Test media URLs
      if (post.media && Array.isArray(post.media)) {
        for (let i = 0; i < post.media.length; i++) {
          const media = post.media[i];
          if (media.url) {
            await testUrl(media.url, `media[${i}].url`);
          }
          if (media.thumbnail) {
            await testUrl(media.thumbnail, `media[${i}].thumbnail`);
          }
        }
      }
      
      // Test thumbnail
      if (post.thumbnail) {
        await testUrl(post.thumbnail, 'thumbnail');
      }
    }
    
  } catch (error) {
    console.error('❌ Debug failed:', error);
  }
}

async function testUrl(url, type) {
  try {
    console.log(`Testing ${type}: ${url.substring(0, 60)}...`);
    
    // Try HEAD request first
    const headResponse = await fetch(url, { method: 'HEAD' });
    console.log(`  HEAD: ${headResponse.status}`);
    
    if (headResponse.status === 412) {
      console.log('  ❌ 412 PRECONDITION FAILED on HEAD request');
      
      // Try GET request
      const getResponse = await fetch(url, { method: 'GET' });
      console.log(`  GET:  ${getResponse.status}`);
      
      if (getResponse.status === 412) {
        console.log('  ❌ 412 PRECONDITION FAILED on GET request too');
        console.log('  Headers sent:', [...headResponse.headers.entries()]);
      }
    }
    
    // Check if it's a Firebase Storage URL
    if (url.includes('firebasestorage.googleapis.com')) {
      console.log('  ✅ Firebase Storage URL detected');
      
      // Check for download tokens
      if (url.includes('token=')) {
        console.log('  ✅ Has download token');
      } else {
        console.log('  ⚠️  Missing download token - this might cause 412 errors');
      }
    }
    
  } catch (error) {
    console.log(`  ❌ Network error: ${error.message}`);
  }
}

// Run the debug
debug412Errors();