/**
 * EMERGENCY VIDEO FIX - URL Proxy for Firebase 412 Errors
 * 
 * This fixes the Firebase Storage service account permission issue
 * by providing alternative access methods for video URLs
 */

// Create a simple URL proxy/fallback system
export const getWorkingVideoUrl = async (originalUrl) => {
  if (!originalUrl) return null;
  
  try {
    // Try direct URL first
    const response = await fetch(originalUrl, { method: 'HEAD' });
    if (response.ok) {
      return originalUrl; // URL works fine
    }
    
    console.log(`🔄 URL returned ${response.status}, trying alternatives...`);
    
    // Try alternative bucket domains
    const alternatives = [];
    
    if (originalUrl.includes('firebasestorage.app')) {
      // Try converting to appspot.com
      alternatives.push(originalUrl.replace('firebasestorage.app', 'appspot.com'));
    } else if (originalUrl.includes('appspot.com')) {
      // Try converting to firebasestorage.app
      alternatives.push(originalUrl.replace('appspot.com', 'firebasestorage.app'));
    }
    
    // Try direct Firebase Storage REST API
    const urlParts = originalUrl.match(/\/b\/([^\/]+)\/o\/(.+)\?alt=media(&token=.+)?$/);
    if (urlParts) {
      const [, bucket, path, token] = urlParts;
      const directUrl = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${path}?alt=media${token || ''}`;
      alternatives.push(directUrl);
    }
    
    // Test alternatives
    for (const altUrl of alternatives) {
      try {
        const altResponse = await fetch(altUrl, { method: 'HEAD' });
        if (altResponse.ok) {
          console.log(`✅ Found working alternative URL`);
          return altUrl;
        }
      } catch (error) {
        console.log(`❌ Alternative failed: ${error.message}`);
      }
    }
    
    // If all fails, return original URL (let ExoPlayer handle the error)
    console.log(`🚨 No working URL found, returning original`);
    return originalUrl;
    
  } catch (error) {
    console.log(`🚨 URL proxy error: ${error.message}`);
    return originalUrl; // Return original on any error
  }
};

// Enhanced video URL fixer for the Video component
export const fixVideoUrlForPlayback = (url) => {
  if (!url) return null;
  
  // For immediate use without async, try the most likely working format
  if (url.includes('firebasestorage.googleapis.com/v0/b/blyp-master.firebasestorage.app')) {
    // This is the problematic format - try direct storage API
    const match = url.match(/\/o\/(.+)\?alt=media(&token=.+)?$/);
    if (match) {
      const [, path, token] = match;
      return `https://storage.googleapis.com/storage/v1/b/blyp-master.firebasestorage.app/o/${path}?alt=media${token || ''}`;
    }
  }
  
  return url; // Return as-is if no changes needed
};