// firestoreSnap — normalize Firestore DocumentSnapshot access across SDKs.
//
// The app talks to Firestore through a compat wrapper (src/config/firebase.js)
// that, in release builds, resolves to the WEB MODULAR SDK (@firebase/firestore).
// In the modular SDK, DocumentSnapshot.exists is a METHOD: `snap.exists()`.
// In the v8/compat and @react-native-firebase SDKs it's a boolean PROPERTY:
// `snap.exists`.
//
// A lot of older code reads `snap.exists` as a property. On the modular SDK that
// is a function reference, which is ALWAYS truthy — so `if (snap.exists)` passes
// even for a document that does not exist, and the following `snap.data()`
// returns undefined. Reading a field off that undefined (e.g. data.segments)
// throws "Cannot read property 'X' of undefined" and hard-crashes the app.
//
// These helpers make existence/data access correct regardless of which SDK is
// active, so a missing/just-created doc can never crash a snapshot handler.

/** True iff the snapshot represents an existing document (SDK-agnostic). */
export function snapExists(snap) {
  if (!snap) return false;
  try {
    return typeof snap.exists === 'function' ? !!snap.exists() : !!snap.exists;
  } catch {
    return false;
  }
}

/**
 * Returns the document data, or null when the document doesn't exist / has no
 * data. Never throws. Use this instead of `snap.data()` when the doc may be
 * missing.
 */
export function snapData(snap) {
  if (!snapExists(snap)) return null;
  try {
    return (typeof snap.data === 'function' ? snap.data() : null) || null;
  } catch {
    return null;
  }
}

export default { snapExists, snapData };
