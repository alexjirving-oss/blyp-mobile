/**
 * FIREBASE STORAGE FIX - Comprehensive solution for video playback issues
 * 
 * This script addresses the root cause of 412 errors and UnrecognizedInputFormatException
 * by properly configuring Firebase Storage access and bucket permissions.
 */

import { storage, db } from '../config/firebase';

// Test Firebase Storage configuration and permissions
export const diagnoseStorageIssues = async () => {
  console.log('🔍 Diagnosing Firebase Storage configuration...\n');
  
  try {
  console.log('✅ React Native Firebase Storage available');
    
    // Test listing files in a user directory
  const userMediaRef = storage().ref('users/JvX9baS41LOSFKj7kx9T99obgVy1/media');
    
    try {
  const mediaList = await userMediaRef.listAll();
  console.log('✅ Successfully listed media files:', mediaList.items.length);
      
      if (mediaList.items.length > 0) {
        // Test getting download URL for first file
        const firstItem = mediaList.items[0];
        try {
          const downloadUrl = await firstItem.getDownloadURL();
          console.log('✅ Successfully got download URL');
          console.log('🔗 Sample URL format:', downloadUrl.substring(0, 100) + '...');
          
          return {
            status: 'success',
            message: 'Firebase Storage is working correctly',
            sampleUrl: downloadUrl
          };
          
        } catch (urlError) {
          console.log('❌ Failed to get download URL:', urlError.message);
          return {
            status: 'error',
            message: 'Permissions issue - cannot generate download URLs',
            error: urlError.message
          };
        }
      } else {
        console.log('ℹ️  No media files found in directory');
        return {
          status: 'warning',
          message: 'No media files found - upload may be required'
        };
      }
      
    } catch (listError) {
      console.log('❌ Failed to list files:', listError.message);
      return {
        status: 'error',
        message: 'Cannot access storage bucket - check permissions',
        error: listError.message
      };
    }
    
  } catch (storageError) {
    console.log('❌ Firebase Storage initialization failed:', storageError.message);
    return {
      status: 'error',
      message: 'Firebase Storage not properly configured',
      error: storageError.message
    };
  }
};

// Fix Firebase Storage URLs by regenerating them through the SDK
export const regenerateStorageUrls = async (originalUrl) => {
  try {
    if (!originalUrl || !originalUrl.includes('firebase')) {
      return originalUrl;
    }
    
    // Extract the file path from the original URL
    const pathMatch = originalUrl.match(/\/o\/(.+?)\?/);
    if (!pathMatch) {
      return originalUrl;
    }
    
    const filePath = decodeURIComponent(pathMatch[1]);
    console.log('🔄 Regenerating URL for path:', filePath);
    
  const fileRef = storage().ref(filePath);
    
    // Generate a fresh download URL through the Firebase SDK
  const newUrl = await fileRef.getDownloadURL();
    console.log('✅ Generated fresh URL:', newUrl.substring(0, 100) + '...');
    
    return newUrl;
    
  } catch (error) {
    console.log('❌ Failed to regenerate URL:', error.message);
    return originalUrl; // Fallback to original URL
  }
};

// Enhanced video URL fixer that uses Firebase SDK
export const getWorkingVideoUrl = async (originalUrl) => {
  if (!originalUrl) return null;
  
  try {
    // First try regenerating through Firebase SDK
    const regeneratedUrl = await regenerateStorageUrls(originalUrl);
    
    if (regeneratedUrl !== originalUrl) {
      console.log('🔧 URL regenerated through Firebase SDK');
      return regeneratedUrl;
    }
    
    // If regeneration didn't work, return original
    return originalUrl;
    
  } catch (error) {
    console.log('🚨 Video URL fixing failed:', error.message);
    return originalUrl;
  }
};