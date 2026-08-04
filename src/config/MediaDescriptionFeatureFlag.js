/**
 * Media Description Service Feature Flag
 * 
 * Controls whether Gemini AI descriptions are enabled for media items.
 * If disabled, all descriptions fall back to neutral copy.
 * 
 * Remote config key: appConfig/mediaDescription.enabled
 */

import { db } from './firebase';
import { snapExists } from '../utils/firestoreSnap';

let cachedFlag = null;
let lastFetchTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minute cache

/**
 * Prime the feature flag on app startup
 * Fetch the remote flag once to warm cache
 */
export async function primeMediaDescriptionFlag() {
  try {
    console.log('🚀 Priming media description feature flag...');
    const enabled = await isMediaDescriptionEnabledAsync();
    console.log(`✅ Media description feature flag primed: ${enabled}`);
  } catch (error) {
    console.log('⚠️ Could not prime media description flag:', error.message);
    // Default to enabled if fetch fails (graceful fallback)
  }
}

/**
 * Get the feature flag state (optimistic - uses cache)
 * Suitable for hot path decision making
 */
export function isMediaDescriptionEnabled() {
  // If we have cached value and it's fresh, use it
  if (cachedFlag !== null && (Date.now() - lastFetchTime) < CACHE_TTL) {
    return cachedFlag;
  }
  // Default to enabled if cache is stale (fetch in background)
  return true;
}

/**
 * Get the feature flag state (authoritative - fetches remote)
 * Use sparingly, as this hits Firestore
 */
export async function isMediaDescriptionEnabledAsync() {
  try {
    const configRef = db.collection('appConfig').doc('mediaDescription');
    const doc = await configRef.get();
    
    if (!snapExists(doc)) {
      console.log('⚠️ Media description config not found; defaulting to enabled');
      cachedFlag = true;
      lastFetchTime = Date.now();
      return true;
    }
    
    const enabled = doc.data()?.enabled ?? true;
    cachedFlag = enabled;
    lastFetchTime = Date.now();
    
    console.log(`✅ Media description feature flag fetched: ${enabled}`);
    return enabled;
    
  } catch (error) {
    console.error('❌ Error fetching media description feature flag:', error.message);
    // Default to enabled on error (graceful degradation)
    return true;
  }
}

/**
 * Force refresh the cache (useful for testing or admin UI)
 */
export function invalidateMediaDescriptionCache() {
  cachedFlag = null;
  lastFetchTime = 0;
  console.log('🔄 Media description flag cache invalidated');
}

/**
 * Set the feature flag remotely (admin/testing only)
 */
export async function setMediaDescriptionEnabled(enabled) {
  try {
    console.log(`📝 Setting media description flag to: ${enabled}`);
    const configRef = db.collection('appConfig').doc('mediaDescription');
    await configRef.set({ enabled, updatedAt: new Date() });
    
    // Clear cache to pick up new value
    invalidateMediaDescriptionCache();
    
    console.log('✅ Media description flag updated');
  } catch (error) {
    console.error('❌ Error updating media description flag:', error.message);
    throw error;
  }
}
