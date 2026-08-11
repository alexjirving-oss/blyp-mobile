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
  startAfter as firestoreStartAfter,
  startAt as firestoreStartAt,
  onSnapshot
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Env flags:
// EXPO_PUBLIC_DISABLE_FIREBASE=1           -> full stub mode (no network calls)
// EXPO_PUBLIC_FORCE_WEB_FIREBASE=1         -> always use Web SDK even if native modules present
// EXPO_PUBLIC_USE_NATIVE_FIREBASE=1        -> force native path (fail safe to web if modules incomplete)
const readBool = (name) => {
  try { return ['1','true','yes'].includes(String(process.env?.[name] ?? '').toLowerCase()); } catch { return false; }
};

function readExpoExtra(key) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const Constants = require('expo-constants').default || require('expo-constants');
    const extra = Constants?.expoConfig?.extra || Constants?.manifest?.extra || {};
    const v = extra?.[key];
    return v == null ? '' : String(v);
  } catch {
    return '';
  }
}

function pickEnv(key, fallback = '') {
  try {
    const fromProcess = process.env?.[key];
    if (fromProcess != null && String(fromProcess).trim() !== '') return String(fromProcess).trim();
  } catch {}
  const fromExtra = readExpoExtra(key);
  if (fromExtra.trim() !== '') return fromExtra.trim();
  return fallback;
}

const DISABLE_FIREBASE = readBool('EXPO_PUBLIC_DISABLE_FIREBASE');
const FORCE_WEB = readBool('EXPO_PUBLIC_FORCE_WEB_FIREBASE');
const FORCE_NATIVE = readBool('EXPO_PUBLIC_USE_NATIVE_FIREBASE');

// Firebase configuration (env → expo.extra → optional JSON → optional local file → defaults)
let firebaseConfig = {
  apiKey: pickEnv('EXPO_PUBLIC_FIREBASE_API_KEY', 'AIzaSyAScxM-7tnuD0532VhY6bvaXvoWVEyDSF8'),
  authDomain: pickEnv('EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN', 'blyp-master.firebaseapp.com'),
  projectId: pickEnv('EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'blyp-master'),
  storageBucket: pickEnv('EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET', 'blyp-master.firebasestorage.app'),
  messagingSenderId: pickEnv('EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID', '929105034040'),
  appId: pickEnv('EXPO_PUBLIC_FIREBASE_APP_ID', '1:929105034040:web:3f725bb93e50e9d8bb9fcd'),
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
if (!DISABLE_FIREBASE && !FORCE_WEB) {
  try {
    // Lazy require so bundler doesn't fail if modules missing.
    const nfApp = require('@react-native-firebase/app')?.default;
    if (nfApp) {
      // Probe required native modules; any failure → fallback to web.
      const authMod = (() => { try { return require('@react-native-firebase/auth').default; } catch { return null; } })();
      const fsMod = (() => { try { return require('@react-native-firebase/firestore').default; } catch { return null; } })();
      const stMod = (() => { try { return require('@react-native-firebase/storage').default; } catch { return null; } })();
      if (authMod && fsMod && stMod && (FORCE_NATIVE || !FORCE_WEB)) {
        nativeFirebaseApp = nfApp;
        nativeAuth = authMod;
        nativeFirestore = fsMod;
        nativeStorage = stMod;
        try { nativeCrashlytics = require('@react-native-firebase/crashlytics').default; } catch {}
        try { nativePerf = require('@react-native-firebase/perf').default; } catch {}
        USING_NATIVE = true;
        console.log('[firebase] Using native Firebase SDK');
      } else if (FORCE_NATIVE) {
        console.warn('[firebase] FORCE_NATIVE requested but native modules incomplete; falling back to web SDK');
      }
    }
  } catch (e) {
    // Native modules not installed or failed; continue with Web SDK.
    console.warn('[firebase] Native detection failed:', e?.message);
  }
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
  // Default bucket for this project is blyp-master.firebasestorage.app.
  // Remap legacy *.appspot.com before init so Storage hits a real bucket.
  try {
    const bucket = String(firebaseConfig.storageBucket || '');
    if (bucket.endsWith('.appspot.com')) {
      const project = firebaseConfig.projectId || bucket.split('.')[0] || 'blyp-master';
      const corrected = `${project}.firebasestorage.app`;
      console.warn?.(`⚠️ Remapping storageBucket from "${bucket}" to "${corrected}"`);
      firebaseConfig.storageBucket = corrected;
    }
  } catch {}

  // Initialize Firebase
  app = initializeApp(firebaseConfig);

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
  // Disabled stub: provide chainable orderBy/limit with empty snapshots to avoid runtime errors
  if (isDisabled) {
    const makeDisabledQueryBuilder = () => ({
      orderBy: () => makeDisabledQueryBuilder(),
      limit: () => makeDisabledQueryBuilder(),
      where: () => makeDisabledQueryBuilder(),
      onSnapshot: (cb) => __callOnSnapshot__(cb, __EMPTY_COLLECTION_SNAPSHOT__),
      get: async () => ({ docs: [] })
    });
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
        where: () => makeDisabledQueryBuilder(),
        orderBy: () => makeDisabledQueryBuilder(),
        limit: () => makeDisabledQueryBuilder(),
        onSnapshot: (cb) => __callOnSnapshot__(cb, __EMPTY_COLLECTION_SNAPSHOT__)
      })
    };
  }
  // Native compat path (wraps @react-native-firebase/* which already supports orderBy/limit)
  if (isNative) {
    const fs = firestore;
    const makeNativeQueryBuilder = (baseRef, chainFn) => ({
      orderBy: (field, dir='asc') => makeNativeQueryBuilder(baseRef.orderBy(field, dir), chainFn),
      limit: (n) => makeNativeQueryBuilder(baseRef.limit(n), chainFn),
      where: (...args) => makeNativeQueryBuilder(baseRef.where(...args), chainFn),
      startAfter: (...args) => makeNativeQueryBuilder(baseRef.startAfter(...args), chainFn),
      startAt: (...args) => makeNativeQueryBuilder(baseRef.startAt(...args), chainFn),
      onSnapshot: (cb, onError) => baseRef.onSnapshot(cb, onError),
      get: () => baseRef.get()
    });
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
        where: (...args) => makeNativeQueryBuilder(fs.collection(path).where(...args)),
        orderBy: (field, dir='asc') => makeNativeQueryBuilder(fs.collection(path).orderBy(field, dir)),
        limit: (n) => makeNativeQueryBuilder(fs.collection(path).limit(n)),
        onSnapshot: (cb) => fs.collection(path).onSnapshot(cb)
      })
    };
  }
  // Web SDK compat path with chain builder
  return {
    collection: (collectionPath) => {
      const collRef = firestoreCollection(firestore, collectionPath);
      const makeWebQueryBuilder = (constraints = []) => ({
        orderBy: (field, dir='asc') => makeWebQueryBuilder([...constraints, firestoreOrderBy(field, dir)]),
        limit: (n) => makeWebQueryBuilder([...constraints, firestoreLimit(n)]),
        where: (field, op, value) => makeWebQueryBuilder([...constraints, firestoreWhere(field, op, value)]),
        startAfter: (...args) => makeWebQueryBuilder([...constraints, firestoreStartAfter(...args)]),
        startAt: (...args) => makeWebQueryBuilder([...constraints, firestoreStartAt(...args)]),
        onSnapshot: (callback, onError) => {
          const q = query(collRef, ...constraints);
          return onSnapshot(q, callback, onError);
        },
        get: async () => {
          const q = query(collRef, ...constraints);
            return getDocs(q);
        }
      });
      return {
        doc: (docId) => ({
          get: () => getDoc(firestoreDoc(firestore, collectionPath, docId)),
          set: (data, options) => setDoc(firestoreDoc(firestore, collectionPath, docId), data, options || {}),
          update: (data) => updateDoc(firestoreDoc(firestore, collectionPath, docId), data),
          delete: () => deleteDoc(firestoreDoc(firestore, collectionPath, docId)),
          onSnapshot: (callback, onError) => onSnapshot(firestoreDoc(firestore, collectionPath, docId), callback, onError),
          collection: (subCollectionPath) => db.collection(`${collectionPath}/${docId}/${subCollectionPath}`)
        }),
        add: (data) => addDoc(collRef, data),
        get: () => getDocs(collRef),
        where: (field, op, value) => makeWebQueryBuilder([firestoreWhere(field, op, value)]),
        orderBy: (field, dir='asc') => makeWebQueryBuilder([firestoreOrderBy(field, dir)]),
        limit: (n) => makeWebQueryBuilder([firestoreLimit(n)]),
        onSnapshot: (callback, onError) => onSnapshot(collRef, callback, onError)
      };
    }
  };
};

export const db = buildCompat(EFFECTIVE_DISABLE, USING_NATIVE);

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
// P7.4: the Gemini API key is NO LONGER shipped to the client. All client Gemini
// traffic goes through the authenticated server proxy (functions/geminiProxy),
// which holds the key server-side, verifies a Firebase ID token, and rate-limits.
// `geminiApiKey` is kept as a non-secret availability sentinel so the many call
// sites that gate on `if (geminiApiKey)` continue to treat AI as enabled.
const FUNCTIONS_BASE = (
  process.env.EXPO_PUBLIC_FUNCTIONS_BASE_URL || 'https://us-central1-blyp-master.cloudfunctions.net'
).replace(/\/+$/, '');

export const geminiProxyBaseUrl = `${FUNCTIONS_BASE}/geminiProxy`;
export const geminiApiKey = 'managed-by-proxy';
export const geminiApiUrl = `${geminiProxyBaseUrl}?model=gemini-flash-latest`;

/**
 * Build the headers for a proxied Gemini request, attaching the caller's Firebase
 * ID token. Returns just Content-Type if no signed-in user (the proxy will then
 * reject with 401 and the feature degrades, exactly as it would with no key).
 */
export async function geminiAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  try {
    const user = auth?.currentUser;
    if (user && typeof user.getIdToken === 'function') {
      const token = await user.getIdToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
  } catch {
    // No token -> proxy returns 401 -> caller degrades gracefully.
  }
  return headers;
}

/** Proxy URL for a specific model (defaults handled server-side). */
export function geminiProxyUrlForModel(model) {
  const m = String(model || '').replace(/^models\//, '').trim();
  return m ? `${geminiProxyBaseUrl}?model=${encodeURIComponent(m)}` : geminiProxyBaseUrl;
}