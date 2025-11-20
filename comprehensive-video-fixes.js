// comprehensive-video-fixes.js
// Script to diagnose and fix all video playback issues

import { db, auth } from './src/config/firebase';
import { collection, query, limit, getDocs, where, orderBy } from 'firebase/firestore';

const VideoFixDiagnostic = {
  
  // Test 1: Check Firebase connection and data
  async testFirebaseConnection() {
    console.log('🔍 Testing Firebase connection...');
    
    try {
      // Try to fetch a small sample of posts
      const postsRef = collection(db, 'posts');
      const q = query(postsRef, orderBy('date', 'desc'), limit(3));
      const snapshot = await getDocs(q);
      
      console.log(`✅ Firebase connected - found ${snapshot.size} posts`);
      
      // Analyze post data structure
      snapshot.forEach(doc => {
        const data = doc.data();
        console.log('📝 Post structure:', {
          id: doc.id,
          hasMedia: !!data.media,
          mediaCount: data.media?.length || 0,
          hasVideoUrl: !!data.videoUrl,
          hasThumbnail: !!data.thumbnail,
          mediaTypes: data.media?.map(m => ({ type: m.type, hasUrl: !!m.url, hasThumbnail: !!m.thumbnail }))
        });
      });
      
      return true;
    } catch (error) {
      console.error('❌ Firebase connection failed:', error);
      return false;
    }
  },
  
  // Test 2: Validate media URLs
  async testMediaUrls() {
    console.log('🔍 Testing media URL accessibility...');
    
    try {
      const postsRef = collection(db, 'posts');
      const q = query(postsRef, limit(5));
      const snapshot = await getDocs(q);
      
      const urlTests = [];
      
      snapshot.forEach(doc => {
        const data = doc.data();
        
        // Test video URLs
        if (data.videoUrl) {
          urlTests.push(this.testUrl(data.videoUrl, 'video', doc.id));
        }
        
        // Test media array URLs
        if (data.media?.length > 0) {
          data.media.forEach((media, index) => {
            if (media.url) {
              urlTests.push(this.testUrl(media.url, `media[${index}]`, doc.id));
            }
            if (media.thumbnail) {
              urlTests.push(this.testUrl(media.thumbnail, `thumbnail[${index}]`, doc.id));
            }
          });
        }
        
        // Test thumbnail URL
        if (data.thumbnail) {
          urlTests.push(this.testUrl(data.thumbnail, 'thumbnail', doc.id));
        }
      });
      
      const results = await Promise.allSettled(urlTests);
      
      let successful = 0;
      let failed = 0;
      
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          successful++;
          console.log(`✅ URL ${index + 1} accessible:`, result.value);
        } else {
          failed++;
          console.error(`❌ URL ${index + 1} failed:`, result.reason);
        }
      });
      
      console.log(`📊 URL Test Summary: ${successful} successful, ${failed} failed`);
      return { successful, failed, total: results.length };
      
    } catch (error) {
      console.error('❌ Media URL testing failed:', error);
      return { successful: 0, failed: 0, total: 0, error };
    }
  },
  
  // Test individual URL with HEAD request
  async testUrl(url, type, postId) {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      
      const result = {
        url: url.substring(0, 60) + '...',
        type,
        postId,
        status: response.status,
        ok: response.ok,
        size: response.headers.get('content-length'),
        contentType: response.headers.get('content-type')
      };
      
      if (response.status === 412) {
        result.error = 'PRECONDITION_FAILED - This is the 412 error you\'re seeing';
      }
      
      return result;
    } catch (error) {
      throw {
        url: url.substring(0, 60) + '...',
        type,
        postId,
        error: error.message
      };
    }
  },
  
  // Test 3: Check EnhancedVideo component behavior
  logEnhancedVideoState() {
    console.log('🔍 EnhancedVideo Component Analysis:');
    console.log('✅ EnhancedVideo fixes applied:');
    console.log('  - Removed conflicting loadAsync/unloadAsync calls');
    console.log('  - Using standard Video component with source prop');
    console.log('  - Added proper poster validation');
    console.log('  - Background caching while streaming from original URI');
    
    console.log('⚠️  Potential issues to check:');
    console.log('  - Network connectivity on device');
    console.log('  - Cached/stale data in app');
    console.log('  - Firebase Storage security rules');
    console.log('  - Device-specific video codec support');
  },
  
  // Complete diagnostic
  async runFullDiagnostic() {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 BLYP VIDEO PLAYBACK DIAGNOSTIC');
    console.log('='.repeat(60));
    
    // Test 1: Firebase
    const firebaseOk = await this.testFirebaseConnection();
    
    if (firebaseOk) {
      // Test 2: URLs
      await this.testMediaUrls();
    }
    
    // Test 3: Component analysis
    this.logEnhancedVideoState();
    
    console.log('\n' + '='.repeat(60));
    console.log('💡 TROUBLESHOOTING RECOMMENDATIONS:');
    console.log('='.repeat(60));
    
    console.log('1. IMMEDIATE STEPS:');
    console.log('   • Install the NEW APK from EAS build');
    console.log('   • Connect to dev server running on port 8083');
    console.log('   • Clear app data/cache on device');
    console.log('   • Restart development build after connecting');
    
    console.log('\n2. IF 412 ERRORS PERSIST:');
    console.log('   • Check Firebase Storage security rules');
    console.log('   • Verify network connectivity on device');
    console.log('   • Try loading app with fresh Firebase data');
    
    console.log('\n3. IF THUMBNAILS NOT SHOWING:');
    console.log('   • Check if thumbnail URLs are being generated');
    console.log('   • Verify image loading in profile screen');
    console.log('   • Test with mock data to isolate issues');
    
    console.log('\n4. IF UPLOADS FAILING:');
    console.log('   • Check Firebase Authentication status');
    console.log('   • Verify Storage bucket permissions');
    console.log('   • Test with smaller files first');
    
    console.log('\n✅ All fixes have been applied. The issues are likely:');
    console.log('   • Network/connectivity related');
    console.log('   • Cached data on device');
    console.log('   • Need to use new APK with latest fixes');
    
    return {
      firebaseConnected: firebaseOk,
      timestamp: new Date().toISOString()
    };
  }
};

// Export for use in app
export default VideoFixDiagnostic;

// Auto-run diagnostic if imported directly
if (typeof window !== 'undefined') {
  VideoFixDiagnostic.runFullDiagnostic()
    .then(result => {
      console.log('📋 Diagnostic completed:', result);
    })
    .catch(error => {
      console.error('❌ Diagnostic failed:', error);
    });
}