import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CognitoUserPool } from 'amazon-cognito-identity-js';
import Logger from '../utils/Logger';
// Optional Firebase auth fallback (previous working backup used Firebase auth)
import { auth as firebaseAuth, firebaseEnabled } from '../config/firebase';
import awsconfig from '../aws-exports';

export const userPool = new CognitoUserPool({
  UserPoolId: awsconfig.aws_user_pools_id,
  ClientId: awsconfig.aws_user_pools_web_client_id,
  Storage: AsyncStorage, // persist sessions so users stay logged in
});

// External trigger to refresh auth immediately (set by useAuth on mount)
// Optionally accepts a CognitoUser to set immediately after auth success
export let refreshAuthNow = (_maybeUser) => {};

// Short-term optimistic auth window to avoid bounce-back right after login
let optimisticUser = null;
let optimisticHoldUntil = 0;
let lastKnownUser = null; // survive beyond the optimistic window
let suppressInvalidationUntil = 0; // grace window to avoid bounce-back after login

// Helper to clear any Cognito session artifacts in AsyncStorage
export const clearCognitoSessions = async () => {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const cognitoKeys = keys.filter((k) => k.includes('CognitoIdentityServiceProvider'));
    if (cognitoKeys.length) await AsyncStorage.multiRemove(cognitoKeys);
  } catch {}
};

// Custom hook for authentication state
export const useAuth = () => {
  // Internal state: store only raw values, derive isAuthenticated at the end
  const [state, setState] = useState({
    user: undefined,
    uid: null,
    loading: true,
    authReady: false, // Starts false, becomes true once, never flips back
    error: null,
  });
  
  // Prefer Firebase auth if explicitly requested via env, else use Cognito as default
  const preferFirebase = (() => {
    try {
      const v1 = String(process.env?.EXPO_PUBLIC_AUTH_PROVIDER || '').toLowerCase();
      const v2 = String(process.env?.EXPO_PUBLIC_PREFER_FIREBASE_AUTH || '').toLowerCase();
      return v1 === 'firebase' || v2 === '1' || v2 === 'true';
    } catch {
      return false;
    }
  })();
  
  // Helper: Extract uid from user object (Cognito or Firebase)
  const extractUid = useCallback((user) => {
    if (!user) return null;
    
    // Firebase user path
    if (firebaseEnabled && preferFirebase && user.uid) {
      return user.uid;
    }
    
    // Cognito user path
    try {
      if (user.attributes?.sub) return user.attributes.sub;
      if (user.username) return user.username;
      if (typeof user.getUsername === 'function') {
        const username = user.getUsername();
        if (username) return username;
      }
    } catch (err) {
      console.error('[AUTH] Error extracting uid:', err);
    }
    
    return null;
  }, [preferFirebase]);
  
  // Helper: Set auth state atomically (enforces invariants)
  const setAuthState = useCallback((updates) => {
    setState((prev) => {
      const nextUser = updates.user !== undefined ? updates.user : prev.user;
      const nextUid = updates.uid !== undefined ? updates.uid : (nextUser ? extractUid(nextUser) : prev.uid);
      const nextLoading = updates.loading !== undefined ? updates.loading : prev.loading;
      const nextError = updates.error !== undefined ? updates.error : prev.error;
      
      // INVARIANT 1: authReady can only transition false → true, never back
      const nextAuthReady = updates.authReady === true ? true : prev.authReady;
      
      return {
        user: nextUser,
        uid: nextUid,
        loading: nextLoading,
        authReady: nextAuthReady,
        error: nextError,
      };
    });
  }, [extractUid]);
  
  useEffect(() => {
    // Fast-path: Firebase auth (if enabled and preferred)
    if (firebaseEnabled && preferFirebase && firebaseAuth && typeof firebaseAuth.onAuthStateChanged === 'function') {
      try {
        const unsub = firebaseAuth.onAuthStateChanged((fbUser) => {
          // Firebase callback: set user + mark ready atomically
          setAuthState({
            user: fbUser || null,
            uid: fbUser?.uid || null,
            loading: false,
            authReady: true, // Always mark ready after first Firebase callback
          });
          console.log('[AUTH][READY] Firebase auth stabilized', { hasUser: !!fbUser });
        });
        return () => {
          try { unsub && unsub(); } catch {}
        };
      } catch {
        // Fall through to Cognito path on any Firebase subscription error
      }
    }
    const setFromSession = async () => {
      try {
        const current = userPool.getCurrentUser();
        
        if (!current) {
          // Optimistic window: if we just logged in, keep that user briefly
          if (optimisticUser && Date.now() < optimisticHoldUntil) {
            try {
              optimisticUser.getSession((err, session) => {
                if (!err && session?.isValid?.()) {
                  const uid = extractUid(optimisticUser);
                  setAuthState({ user: optimisticUser, uid, loading: false, authReady: true });
                  return;
                }
                // Session invalid but within grace window: keep lastKnownUser if present
                if (Date.now() < suppressInvalidationUntil && lastKnownUser) {
                  const uid = extractUid(lastKnownUser);
                  setAuthState({ user: lastKnownUser, uid, loading: false, authReady: true });
                  return;
                }
                // Outside grace: clear to logged-out state
                setAuthState({ user: null, uid: null, loading: false, authReady: true });
              });
              return;
            } catch {}
          }
          
          // Grace window: use lastKnownUser if still within window
          if (lastKnownUser && Date.now() < suppressInvalidationUntil) {
            try {
              lastKnownUser.getSession((err, session) => {
                if (!err && session?.isValid?.()) {
                  const uid = extractUid(lastKnownUser);
                  setAuthState({ user: lastKnownUser, uid, loading: false, authReady: true });
                  return;
                }
                // Keep lastKnownUser sticky during grace even if session check lags
                const uid = extractUid(lastKnownUser);
                setAuthState({ user: lastKnownUser, uid, loading: false, authReady: true });
              });
              return;
            } catch {}
          }
          
          // No current user, no optimistic hold: stable logged-out state
          setAuthState({ user: null, uid: null, loading: false, authReady: true });
          console.log('[AUTH][READY] Cognito auth stabilized (no user)');
          return;
        }
        
        // We have a current user from pool: validate session
        current.getSession(async (err, session) => {
          const invalidate = async () => {
            // Respect grace window to reduce post-login bounce
            if (Date.now() < suppressInvalidationUntil && lastKnownUser) {
              const uid = extractUid(lastKnownUser);
              setAuthState({ user: lastKnownUser, uid, loading: false, authReady: true });
              return;
            }
            // Outside grace: invalidate and clear
            try { current.signOut?.(); } catch {}
            await clearCognitoSessions();
            setAuthState({ user: null, uid: null, loading: false, authReady: true });
          };

          if (err || !session?.isValid?.()) {
            return void invalidate();
          }
          
          // Guard against malformed tokens (prevents jwtToken.split errors)
          try {
            const idToken = session.getIdToken?.();
            const raw = idToken?.getJwtToken?.();
            if (!raw || typeof raw !== 'string') return void invalidate();
            // Ensure JWT shape a.b.c
            if (!/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(raw)) return void invalidate();
          } catch {
            return void invalidate();
          }
          
          // Valid session: set user + mark ready
          const uid = extractUid(current);
          setAuthState({ user: current, uid, loading: false, authReady: true });
          console.log('[AUTH][READY] Cognito auth stabilized with valid session');
        });
      } catch (e) {
        // Library threw during session construction: clear corrupted tokens
        if (Date.now() < suppressInvalidationUntil && lastKnownUser) {
          const uid = extractUid(lastKnownUser);
          setAuthState({ user: lastKnownUser, uid, loading: false, authReady: true });
        } else {
          await clearCognitoSessions();
          setAuthState({ user: null, uid: null, loading: false, authReady: true });
          console.log('[AUTH][READY] Cognito auth stabilized (cleared corrupted session)');
        }
      }
    };

    // Initial load
    setFromSession();

    // Expose external refresh trigger (for post-login callbacks)
    refreshAuthNow = async (maybeUser) => {
      if (maybeUser) {
        try {
          // Validate the provided user has a valid session
          maybeUser.getSession((err, session) => {
            if (err || !session?.isValid?.()) {
              return setFromSession();
            }
            // Set optimistic window to avoid immediate poll-based logout
            optimisticUser = maybeUser;
            optimisticHoldUntil = Date.now() + 120000; // 120s hold
            lastKnownUser = maybeUser; // remember beyond hold window
            suppressInvalidationUntil = Date.now() + 180000; // 180s grace
            
            const uid = extractUid(maybeUser);
            setAuthState({ user: maybeUser, uid, loading: false, authReady: true });
            console.log('[AUTH][READY] Explicit refresh with valid user');
          });
          return;
        } catch {
          // Fallback to regular flow
        }
      }
      return setFromSession();
    };

    // Poll every 2 seconds to reflect background auth changes
    const interval = setInterval(setFromSession, 2000);
    return () => clearInterval(interval);
  }, [setAuthState, extractUid]);
  
  // Derive final values from state (INVARIANT 2 & 3)
  const { user, uid, loading, authReady, error } = state;
  const hasUser = !!user && !!uid; // INVARIANT 2: hasUser iff we have both user and uid
  const isAuthenticated = authReady && hasUser; // INVARIANT 3: authenticated = ready AND has user+uid
  
  // Log invariant violation if user exists but uid is missing
  useEffect(() => {
    if (user && !uid && !loading && authReady) {
      console.error('[AUTH][INVARIANT VIOLATION] User exists but no uid extracted', {
        hasUser: !!user,
        userKeys: user ? Object.keys(user).slice(0, 10) : [],
        preferFirebase,
        firebaseEnabled,
        authReady
      });
    }
  }, [user, uid, loading, preferFirebase, authReady]);
  
  // Log race detection when components access before ready (warning only)
  useEffect(() => {
    if (!authReady && !loading) {
      console.warn('[AUTH][RACE_DETECTED] Auth accessed before stabilization complete');
    }
  }, [authReady, loading]);
  
  // Temporary debug log to confirm real auth state after login
  if (__DEV__) {
    console.log('[AUTH DEBUG]', {
      uid,
      hasUser,
      authReady,
      isAuthenticated,
      loading,
      devBypass: process.env.EXPO_PUBLIC_DEV_FORCE_NO_AUTH,
    });
  }
  
  return { 
    user, 
    uid, 
    loading, 
    authReady,
    error, 
    isAuthenticated,
    hasUser, // NEW: expose derived hasUser
    // Aliases for compatibility
    currentUser: user
  };
};

// Custom hook for Firestore document
export const useFirestoreDoc = (collection, docId) => {
  const [data, setData] = useState(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  useEffect(() => {
    if (!docId) {
      setData(null);
      setLoading(false);
      return;
    }
    
    const unsubscribe = db
      .collection(collection)
      .doc(docId)
      .onSnapshot(
        (snapshot) => {
          if (snapshot.exists) {
            setData({ id: snapshot.id, ...snapshot.data() });
          } else {
            setData(null);
          }
          setLoading(false);
          setError(null);
        },
        (err) => {
          Logger.error('firebase', `Error fetching ${collection}/${docId}:`, err);
          setError(err);
          setLoading(false);
        }
      );
    
    return unsubscribe;
  }, [collection, docId]);
  
  return { data, loading, error };
};

// Custom hook for debounced values (search, etc.)
export const useDebounce = (value, delay) => {
  const [debouncedValue, setDebouncedValue] = useState(value);
  
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);
  
  return debouncedValue;
};

// Custom hook for previous value
export const usePrevious = (value) => {
  const ref = useRef();
  
  useEffect(() => {
    ref.current = value;
  });
  
  return ref.current;
};

// Custom hook for toggle state
export const useToggle = (initialValue = false) => {
  const [value, setValue] = useState(initialValue);
  
  const toggle = useCallback(() => setValue(v => !v), []);
  const setTrue = useCallback(() => setValue(true), []);
  const setFalse = useCallback(() => setValue(false), []);
  
  return [value, toggle, setTrue, setFalse];
};

// Custom hook for array state management
export const useArray = (initialValue = []) => {
  const [array, setArray] = useState(initialValue);
  
  const push = useCallback((element) => {
    setArray(arr => [...arr, element]);
  }, []);
  
  const filter = useCallback((callback) => {
    setArray(arr => arr.filter(callback));
  }, []);
  
  const update = useCallback((index, newElement) => {
    setArray(arr => arr.map((item, i) => i === index ? newElement : item));
  }, []);
  
  const remove = useCallback((index) => {
    setArray(arr => arr.filter((_, i) => i !== index));
  }, []);
  
  const clear = useCallback(() => setArray([]), []);
  
  return { array, set: setArray, push, filter, update, remove, clear };
};

// Custom hook for local storage (AsyncStorage in React Native)
export const useLocalStorage = (key, initialValue) => {
  const [storedValue, setStoredValue] = useState(initialValue);
  
  const setValue = useCallback(async (value) => {
    try {
      setStoredValue(value);
      // In a real app, you'd use AsyncStorage here
      // await AsyncStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      Logger.error('cache', `Error setting localStorage key "${key}":`, error);
    }
  }, [key]);
  
  return [storedValue, setValue];
};