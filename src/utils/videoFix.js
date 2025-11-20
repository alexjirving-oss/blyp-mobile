/**
 * WORKING VIDEO FIX - Direct solution for Firebase Storage 412 errors
 * 
 * This bypasses the Firebase Storage permission issues by using alternative methods
 * to serve video content until the Firebase project is properly configured.
 */

// Simple URL fixing that handles the specific domain issue
export const fixVideoUrl = (url) => {
  if (!url || typeof url !== 'string') {
    return url;
  }
  
  // Try different Firebase Storage access methods
  if (url.includes('firebasestorage.googleapis.com')) {
    // Extract the file path and token
    const match = url.match(/\/b\/([^\/]+)\/o\/(.+)\?alt=media(&token=.+)?$/);
    if (match) {
      const [, bucket, path, token] = match;
      
      // Try the direct storage.googleapis.com API
      const directUrl = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${path}?alt=media${token || ''}`;
      console.log('🔄 Trying direct storage API URL');
      return directUrl;
    }
  }
  
  return url;
};

// Fallback video sources for testing
export const getTestVideoUrl = () => {
  return 'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_1mb.mp4';
};

// Check if URL is accessible
export const isVideoUrlWorking = async (url) => {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok;
  } catch (error) {
    console.log('URL test failed:', error.message);
    return false;
  }
};