/**
 * Firebase Storage URL utilities
 */

/**
 * Firebase Storage URL utilities - Just return the original URL without any changes
 */
export const fixStorageUrl = (url) => {
  return url;
  
  return url;
};

/**
 * Fixes storage URLs in media arrays
 * @param {Array} mediaArray - Array of media objects with url property
 * @returns {Array} - Array with fixed URLs
 */
export const fixMediaUrls = (mediaArray) => {
  if (!Array.isArray(mediaArray)) {
    return mediaArray;
  }
  
  return mediaArray.map(media => ({
    ...media,
    url: fixStorageUrl(media.url)
  }));
};

/**
 * Fixes storage URLs in post/item objects
 * @param {Object} item - Post or item object
 * @returns {Object} - Object with fixed URLs
 */
export const fixItemUrls = (item) => {
  if (!item || typeof item !== 'object') {
    return item;
  }
  
  return {
    ...item,
    videoUrl: fixStorageUrl(item.videoUrl),
    imageUrl: fixStorageUrl(item.imageUrl),
    media: fixMediaUrls(item.media)
  };
};