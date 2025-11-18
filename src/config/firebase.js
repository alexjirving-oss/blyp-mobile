// Web SDK imports (fallback when native not available)
import { initializeApp } from 'firebase/app';
import { getAuth, initializeAuth, getReactNativePersistence } from 'firebase/auth';
import {
  getFirestore,
  collection as firestoreCollection,
  doc as firestoreDoc,
  addDoc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where as firestoreWhere,
  orderBy as firestoreOrderBy,
  limit as firestoreLimit,
  onSnapshot
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Allow disabling Firebase during auth testing or when not needed in a given build
const DISABLE_FIREBASE = (() => {
  try {
    const v = String(process.env?.EXPO_PUBLIC_DISABLE_FIREBASE ?? '').toLowerCase();
    return v === '1' || v === 'true';
  } catch {
    return false;
  }
})();

// Firebase configuration (env → optional JSON → optional local file → defaults)
let firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || "",
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || "blyp-master.firebaseapp.com",
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || "blyp-master",
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || "blyp-master.appspot.com",
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "929105034040",
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || "1:929105034040:web:3f725bb93e50e9d8bb9fcd"
};

// Allow JSON-based override (useful in CI or local dev without many env vars)
try {
  const json = process.env?.EXPO_PUBLIC_FIREBASE_JSON;
  if (json && typeof json === 'string' && json.trim().startsWith('{')) {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object') {
      firebaseConfig = { ...firebaseConfig, ...parsed };
    }
  }
} catch {}

// Allow local file override for developer machines (not committed)
try {
  const local = require('./firebase.local');
  const localConfig = local?.firebaseConfig || local?.default || local;
  if (localConfig && typeof localConfig === 'object') {
    firebaseConfig = { ...firebaseConfig, ...localConfig };
  }
} catch {}

export { firebaseConfig };

// Determine if Firebase should be effectively disabled (env flag OR invalid config)
let EFFECTIVE_DISABLE = DISABLE_FIREBASE;
try {
  if (!EFFECTIVE_DISABLE) {
    const missingKey = !firebaseConfig || !firebaseConfig.apiKey || firebaseConfig.apiKey.trim() === '';
    if (missingKey) {
      EFFECTIVE_DISABLE = true;
      console.warn?.('🔥 Firebase config missing/invalid. Running with Firebase disabled (stub mode).');
    }
  }
} catch {
  // Fail safe to disabled mode on any unexpected error
  EFFECTIVE_DISABLE = true;
}

let app;
let auth;
let firestore;
let storage;
let USING_NATIVE = false;

// Attempt to load native Firebase (@react-native-firebase/*) when present.
// This enables Crashlytics, Performance, Messaging, etc. without changing callers.
let nativeFirebaseApp = null;
let nativeAuth = null;
let nativeFirestore = null;
let nativeStorage = null;
let nativeCrashlytics = null;
let nativePerf = null;
try {
  // Lazy require so bundler doesn't fail if modules missing.
  const nfApp = require('@react-native-firebase/app').default;
  // If no default export, skip.
  if (nfApp) {
    nativeFirebaseApp = nfApp;
    nativeAuth = require('@react-native-firebase/auth').default;
    nativeFirestore = require('@react-native-firebase/firestore').default;
    nativeStorage = require('@react-native-firebase/storage').default;
    // Optional modules
    try { nativeCrashlytics = require('@react-native-firebase/crashlytics').default; } catch {}
    try { nativePerf = require('@react-native-firebase/perf').default; } catch {}
    USING_NATIVE = true;
    console.log('🔥 Using native Firebase SDK');
  }
} catch {
  // Native modules not installed; continue with Web SDK.
}

// Helpers for stubbed Firestore when EFFECTIVE_DISABLE is true
const __EMPTY_COLLECTION_SNAPSHOT__ = { docs: [] };
const __DOC_SNAPSHOT__ = (id) => ({ exists: false, id, data: () => null });
const __callOnSnapshot__ = (callback, payload) => {
  try {
    setTimeout(() => {
      try { callback(payload); } catch {}
    }, 0);
  } catch {}
  return () => {};
};

if (!EFFECTIVE_DISABLE && !USING_NATIVE) {
  // Initialize Firebase
  app = initializeApp(firebaseConfig);

  // Normalize storage bucket if misconfigured (developers sometimes paste download domain)
  try {
    const bucket = firebaseConfig.storageBucket || '';
    if (bucket.endsWith('.firebasestorage.app')) {
      const project = firebaseConfig.projectId || bucket.split('.')[0];
      const corrected = `${project}.appspot.com`;
      console.warn?.(`⚠️ Correcting storageBucket from "${bucket}" to "${corrected}"`);
      // This doesn't change the initialized app's internal bucket, but informs devs and avoids future misconfig.
    }
  } catch {}

  // Initialize Auth with AsyncStorage persistence for React Native
  try {
    auth = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage)
    });
  } catch (e) {
    // If auth is already initialized, get the existing instance
    auth = getAuth(app);
  }

  // Get Firestore instance
  firestore = getFirestore(app);
  // console.debug to reduce terminal noise
  console.debug?.('🔥 Firebase initialized');
} else if (USING_NATIVE) {
  // Initialize native instances (already initialized by module import)
  auth = nativeAuth();
  firestore = nativeFirestore();
  storage = nativeStorage();
  try { nativeCrashlytics?.setCrashlyticsCollectionEnabled(true); } catch {}
  try { nativePerf?.setPerformanceCollectionEnabled?.(true); } catch {}
} else {
  console.debug?.('🔥 Firebase disabled via EXPO_PUBLIC_DISABLE_FIREBASE');
  // Provide minimal auth stub so app code can subscribe without crashing
  auth = {
    currentUser: null,
    onAuthStateChanged: (callback) => {
      try { callback(null); } catch {}
      return () => {};
    },
    // Common auth methods stubbed to avoid accidental usage during demo
    signInWithEmailAndPassword: async () => { throw new Error('Firebase auth disabled'); },
    createUserWithEmailAndPassword: async () => { throw new Error('Firebase auth disabled'); },
    signOut: async () => {}
  };
}

// Create a compatibility wrapper for the old Firestore API
// Build compat wrapper abstracting Web vs Native
const buildCompat = (isDisabled, isNative) => {
  if (isDisabled) {
    return {
      collection: () => ({
        doc: () => ({
          get: async () => null,
          set: async () => undefined,
          update: async () => undefined,
          delete: async () => undefined,
          onSnapshot: (cb) => __callOnSnapshot__(cb, __DOC_SNAPSHOT__('disabled')),
          collection: () => ({})
        }),
        add: async () => null,
        get: async () => ({ docs: [] }),
        where: () => ({ get: async () => ({ docs: [] }) }),
        onSnapshot: (cb) => __callOnSnapshot__(cb, __EMPTY_COLLECTION_SNAPSHOT__)
      })
    };
  }
  if (isNative) {
    const fs = firestore;
    return {
      collection: (path) => ({
        doc: (id) => ({
          get: () => fs.collection(path).doc(id).get(),
          set: (data, opts) => fs.collection(path).doc(id).set(data, opts || {}),
          update: (data) => fs.collection(path).doc(id).update(data),
          delete: () => fs.collection(path).doc(id).delete(),
          onSnapshot: (cb) => fs.collection(path).doc(id).onSnapshot(cb),
          collection: (sub) => buildCompat(false, true).collection(`${path}/${id}/${sub}`)
        }),
        add: (data) => fs.collection(path).add(data),
        get: () => fs.collection(path).get(),
        where: (...args) => ({
          get: () => fs.collection(path).where(...args).get(),
          onSnapshot: (cb) => fs.collection(path).where(...args).onSnapshot(cb)
        }),
        onSnapshot: (cb) => fs.collection(path).onSnapshot(cb)
      })
    };
  }
  // Web SDK path (existing implementation)
  return {
    collection: (collectionPath) => ({
      doc: (docId) => ({
        get: () => getDoc(firestoreDoc(firestore, collectionPath, docId)),
        set: (data, options) => setDoc(firestoreDoc(firestore, collectionPath, docId), data, options || {}),
        update: (data) => updateDoc(firestoreDoc(firestore, collectionPath, docId), data),
        delete: () => deleteDoc(firestoreDoc(firestore, collectionPath, docId)),
        onSnapshot: (callback) => onSnapshot(firestoreDoc(firestore, collectionPath, docId), callback),
        collection: (subCollectionPath) => db.collection(`${collectionPath}/${docId}/${subCollectionPath}`)
      }),
      add: (data) => addDoc(firestoreCollection(firestore, collectionPath), data),
      get: () => getDocs(firestoreCollection(firestore, collectionPath)),
      where: (...args) => ({
        get: async () => {
          const q = query(firestoreCollection(firestore, collectionPath), firestoreWhere(...args));
          return getDocs(q);
        },
        onSnapshot: (callback) => {
          const q = query(firestoreCollection(firestore, collectionPath), firestoreWhere(...args));
          return onSnapshot(q, callback);
        }
      }),
      onSnapshot: (callback) => onSnapshot(firestoreCollection(firestore, collectionPath), callback)
    })
  };
};

export const db = buildCompat(EFFECTIVE_DISABLE, USING_NATIVE);
  // Stubbed Firestore that proactively invokes callbacks with empty snapshots
  collection: (/* collectionPath */) => ({
    doc: (docId) => ({
      get: async () => null,
      set: async () => undefined,
      update: async () => undefined,
      delete: async () => undefined,
      onSnapshot: (callback) => __callOnSnapshot__(callback, __DOC_SNAPSHOT__(docId)),
      collection: () => ({})
    }),
    add: async () => null,
    get: async () => ({ docs: [] }),
    where: () => ({
      get: async () => ({ docs: [] }),
      orderBy: () => ({
        get: async () => ({ docs: [] }),
        limit: () => ({
          get: async () => ({ docs: [] }),
          onSnapshot: (callback) => __callOnSnapshot__(callback, __EMPTY_COLLECTION_SNAPSHOT__),
        }),
        onSnapshot: (callback) => __callOnSnapshot__(callback, __EMPTY_COLLECTION_SNAPSHOT__),
      }),
      limit: () => ({
        get: async () => ({ docs: [] }),
        onSnapshot: (callback) => __callOnSnapshot__(callback, __EMPTY_COLLECTION_SNAPSHOT__),
      }),
      onSnapshot: (callback) => __callOnSnapshot__(callback, __EMPTY_COLLECTION_SNAPSHOT__),
    }),
    orderBy: () => ({
      get: async () => ({ docs: [] }),
      limit: () => ({
        get: async () => ({ docs: [] }),
        onSnapshot: (callback) => __callOnSnapshot__(callback, __EMPTY_COLLECTION_SNAPSHOT__),
      }),
      onSnapshot: (callback) => __callOnSnapshot__(callback, __EMPTY_COLLECTION_SNAPSHOT__),
    }),
    limit: () => ({
      get: async () => ({ docs: [] }),
      onSnapshot: (callback) => __callOnSnapshot__(callback, __EMPTY_COLLECTION_SNAPSHOT__),
    }),
    onSnapshot: (callback) => __callOnSnapshot__(callback, __EMPTY_COLLECTION_SNAPSHOT__),
  })
} : {
  collection: (collectionPath) => ({
    doc: (docId) => ({
      get: () => getDoc(firestoreDoc(firestore, collectionPath, docId)),
      set: (data, options) => setDoc(firestoreDoc(firestore, collectionPath, docId), data, options || {}),
      update: (data) => updateDoc(firestoreDoc(firestore, collectionPath, docId), data),
      delete: () => deleteDoc(firestoreDoc(firestore, collectionPath, docId)),
      onSnapshot: (callback) => onSnapshot(firestoreDoc(firestore, collectionPath, docId), callback),
      collection: (subCollectionPath) => db.collection(`${collectionPath}/${docId}/${subCollectionPath}`)
    }),
    add: (data) => addDoc(firestoreCollection(firestore, collectionPath), data),
    get: () => getDocs(firestoreCollection(firestore, collectionPath)),
    where: (...args) => ({
      get: async () => {
        const q = query(firestoreCollection(firestore, collectionPath), firestoreWhere(...args));
        return getDocs(q);
      },
      orderBy: (...orderArgs) => ({
        get: async () => {
          const q = query(firestoreCollection(firestore, collectionPath), firestoreWhere(...args), firestoreOrderBy(...orderArgs));
          return getDocs(q);
        },
        limit: (limitNum) => ({
          get: async () => {
            const q = query(firestoreCollection(firestore, collectionPath), firestoreWhere(...args), firestoreOrderBy(...orderArgs), firestoreLimit(limitNum));
            return getDocs(q);
          },
          onSnapshot: (callback) => {
            const q = query(firestoreCollection(firestore, collectionPath), firestoreWhere(...args), firestoreOrderBy(...orderArgs), firestoreLimit(limitNum));
            return onSnapshot(q, callback);
          }
        }),
        onSnapshot: (callback) => {
          const q = query(firestoreCollection(firestore, collectionPath), firestoreWhere(...args), firestoreOrderBy(...orderArgs));
          return onSnapshot(q, callback);
        }
      }),
      limit: (limitNum) => ({
        get: async () => {
          const q = query(firestoreCollection(firestore, collectionPath), firestoreWhere(...args), firestoreLimit(limitNum));
          return getDocs(q);
        },
        onSnapshot: (callback) => {
          const q = query(firestoreCollection(firestore, collectionPath), firestoreWhere(...args), firestoreLimit(limitNum));
          return onSnapshot(q, callback);
        }
      }),
      onSnapshot: (callback) => {
        const q = query(firestoreCollection(firestore, collectionPath), firestoreWhere(...args));
        return onSnapshot(q, callback);
      }
    }),
    orderBy: (...args) => ({
      get: async () => {
        const q = query(firestoreCollection(firestore, collectionPath), firestoreOrderBy(...args));
        return getDocs(q);
      },
      limit: (limitNum) => ({
        get: async () => {
          const q = query(firestoreCollection(firestore, collectionPath), firestoreOrderBy(...args), firestoreLimit(limitNum));
          return getDocs(q);
        },
        onSnapshot: (callback) => {
          const q = query(firestoreCollection(firestore, collectionPath), firestoreOrderBy(...args), firestoreLimit(limitNum));
          return onSnapshot(q, callback);
        }
      }),
      onSnapshot: (callback) => {
        const q = query(firestoreCollection(firestore, collectionPath), firestoreOrderBy(...args));
        return onSnapshot(q, callback);
      }
    }),
    limit: (limitNum) => ({
      get: async () => {
        const q = query(firestoreCollection(firestore, collectionPath), firestoreLimit(limitNum));
        return getDocs(q);
      },
      onSnapshot: (callback) => {
        const q = query(firestoreCollection(firestore, collectionPath), firestoreLimit(limitNum));
        return onSnapshot(q, callback);
      }
    }),
    onSnapshot: (callback) => onSnapshot(firestoreCollection(firestore, collectionPath), callback)
  })
};

// Initialize Firebase services
export { auth };
if (!EFFECTIVE_DISABLE && app) {
  storage = getStorage(app);
}
// Export real firestore instance for files using modular API directly
export { firestore };
export { storage };

// Public flag for feature gating in UI
export const firebaseEnabled = !EFFECTIVE_DISABLE;
export const firebaseNative = USING_NATIVE;

// Compat-style default export for modules expecting firebase.auth()
function authCompat() {
  return auth;
}
function firestoreCompat() {
  return firestore;
}
function storageCompat() {
  return storage;
}

const firebaseCompat = {
  auth: authCompat,
  firestore: firestoreCompat,
  storage: storageCompat,
};

export default firebaseCompat;

// Gemini API configuration
// Prefer Expo extra (app.config.js / app.json) so the key is always available
// in the dev client and production builds, then fall back to process.env.
let resolvedGeminiKey = "";
try {
  // Lazy require to avoid bundler issues if expo-constants is unavailable in some environments
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  const Constants = require('expo-constants').default || require('expo-constants');
  const extra = Constants?.expoConfig?.extra || Constants?.manifest?.extra || {};
  if (extra.EXPO_PUBLIC_GEMINI_API_KEY) {
    resolvedGeminiKey = String(extra.EXPO_PUBLIC_GEMINI_API_KEY);
  }
} catch {
  // Swallow and fall back to env below
}

if (!resolvedGeminiKey) {
  resolvedGeminiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY || "";
}

export const geminiApiKey = resolvedGeminiKey;
export const geminiApiUrl = process.env.EXPO_PUBLIC_GEMINI_API_URL || (geminiApiKey
  ? `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${geminiApiKey}`
  : "");