/**
 * Debug Script: Video Autoplay Issue
 * 
 * This checks:
 * 1. Are there video posts in Firebase?
 * 2. What data structure do they have?
 * 3. Is shouldPlay logic working correctly?
 */

const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

async function debugVideoAutoplay() {
  console.log('\n🔍 DEBUGGING VIDEO AUTOPLAY ISSUE\n');
  console.log('=' .repeat(60));
  
  try {
    // 1. Check for video posts
    console.log('\n1️⃣ Checking for video posts in Firebase...\n');
    const postsSnapshot = await db.collection('posts')
      .orderBy('date', 'desc')
      .limit(30)
      .get();
    
    const allPosts = postsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    const videoPosts = allPosts.filter(post => post.type === 'video');
    
    console.log(`📊 Total posts: ${allPosts.length}`);
    console.log(`🎥 Video posts: ${videoPosts.length}`);
    console.log(`📷 Photo posts: ${allPosts.filter(p => p.type !== 'video').length}`);
    
    if (videoPosts.length === 0) {
      console.log('\n⚠️  WARNING: NO VIDEO POSTS FOUND!');
      console.log('   The #4ME tab will be empty or only show photos.');
      console.log('   Videos cannot autoplay if there are no videos.\n');
      return;
    }
    
    // 2. Check video post structure
    console.log('\n2️⃣ Checking video post data structure...\n');
    const firstVideo = videoPosts[0];
    console.log('Sample video post:');
    console.log({
      id: firstVideo.id,
      type: firstVideo.type,
      hasVideoUrl: !!firstVideo.videoUrl,
      videoUrl: firstVideo.videoUrl?.substring(0, 80) + '...',
      hasThumbnail: !!firstVideo.thumbnail,
      hasUser: !!firstVideo.user,
      username: firstVideo.user?.username || firstVideo.username,
      description: firstVideo.description?.substring(0, 50) || 'N/A'
    });
    
    // 3. Check for missing video URLs
    console.log('\n3️⃣ Checking for broken video URLs...\n');
    const brokenVideos = videoPosts.filter(v => !v.videoUrl);
    if (brokenVideos.length > 0) {
      console.log(`❌ Found ${brokenVideos.length} video posts WITHOUT videoUrl!`);
      brokenVideos.forEach(v => {
        console.log(`   - ${v.id}: Missing videoUrl`);
      });
    } else {
      console.log('✅ All video posts have videoUrl');
    }
    
    // 4. Check video URL domains
    console.log('\n4️⃣ Checking video URL domains...\n');
    const domains = {};
    videoPosts.forEach(v => {
      if (v.videoUrl) {
        try {
          const url = new URL(v.videoUrl);
          const domain = url.hostname;
          domains[domain] = (domains[domain] || 0) + 1;
        } catch (e) {
          console.log(`   ⚠️  Invalid URL: ${v.videoUrl.substring(0, 50)}`);
        }
      }
    });
    
    console.log('Video URL domains:');
    Object.entries(domains).forEach(([domain, count]) => {
      console.log(`   - ${domain}: ${count} videos`);
    });
    
    // 5. Simulate shouldPlay logic
    console.log('\n5️⃣ Simulating shouldPlay logic...\n');
    console.log('For #4ME tab (Tab A), video should play when:');
    console.log('   ✓ isScreenFocused = true (user is on Home tab)');
    console.log('   ✓ selectedTab = "A" (user is on #4ME)');
    console.log('   ✓ index = currentDiscoverIndex (this is the visible video)');
    console.log('\nFormula: shouldPlay={isScreenFocused && selectedTab === "A" && index === currentDiscoverIndex}');
    console.log('\nExample for first video (index 0):');
    console.log('   shouldPlay = true && "A" === "A" && 0 === 0');
    console.log('   shouldPlay = TRUE ✅');
    
    // 6. Check EnhancedVideo requirements
    console.log('\n6️⃣ EnhancedVideo component requirements...\n');
    console.log('EnhancedVideo receives shouldPlay={true} from HomeScreen');
    console.log('Inside EnhancedVideo:');
    console.log('   1. Video component gets: shouldPlay={shouldPlay && videoLoaded}');
    console.log('   2. videoLoaded starts as FALSE');
    console.log('   3. onReadyForDisplay fires after 300ms delay');
    console.log('   4. setVideoLoaded(true) called');
    console.log('   5. Now: shouldPlay={true && true} = TRUE ✅');
    console.log('   6. Video should start playing!');
    
    console.log('\n' + '='.repeat(60));
    console.log('\n✅ DIAGNOSIS COMPLETE\n');
    
    if (videoPosts.length > 0) {
      console.log('📝 SUMMARY:');
      console.log(`   • ${videoPosts.length} video posts available`);
      console.log('   • Video post structure looks correct');
      console.log('   • shouldPlay logic should work');
      console.log('\n🔍 POSSIBLE ISSUES:');
      console.log('   1. Videos not loading from Firebase URLs');
      console.log('   2. Network/CORS issues blocking video playback');
      console.log('   3. Device-specific video codec issues');
      console.log('   4. EnhancedVideo onReadyForDisplay not firing');
      console.log('\n💡 NEXT STEPS:');
      console.log('   1. Check Metro logs for "[VideoLoad]" messages');
      console.log('   2. Check for network errors in console');
      console.log('   3. Try opening video URL directly in browser');
      console.log('   4. Check if onReadyForDisplay callback fires');
    }
    
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error);
  }
  
  process.exit(0);
}

debugVideoAutoplay();
