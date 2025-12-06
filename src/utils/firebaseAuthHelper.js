/**
 * Firebase Auth Bridge Stub
 * 
 * DEV: No Firebase auth needed (relies on DEV-OPEN Firestore rules).
 * PRODUCTION: Proper Firebase Custom Token bridge from Cognito must be implemented.
 */

/**
 * Ensure Firebase authentication for Firestore/Storage access.
 * Currently a stub that does nothing in DEV and warns in production.
 * 
 * @param {...any} _args - Ignored arguments (cognitoUser, uid, firebaseNative, etc.)
 * @returns {Promise<void>}
 */
export async function ensureFirebaseAuth(..._args) {
  // DEV: we rely on dev-open Firestore rules, so no Firebase auth bridge is needed.
  if (__DEV__) {
    console.log('[LIVE][AUTH] Skipping Firebase ↔️ Cognito Firebase auth in DEV (rules are open)');
    return;
  }

  // PRODUCTION TODO:
  // Proper Firebase custom-token bridge from Cognito must be implemented
  // before enabling this in a real environment.
  console.warn('[LIVE][AUTH] Firebase auth bridge not configured for PRODUCTION; continuing without it.');
  return;
}
