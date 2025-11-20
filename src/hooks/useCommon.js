import { useState, useEffect, useCallback, useRef } from 'react';
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
  const [user, setUser] = useState(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
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
  
  useEffect(() => {
    // Fast-path: if Firebase is enabled and preferred, mirror the previous working auth behavior
    if (firebaseEnabled && preferFirebase && firebaseAuth && typeof firebaseAuth.onAuthStateChanged === 'function') {
      try {
        const unsub = firebaseAuth.onAuthStateChanged((fbUser) => {
          setUser(fbUser || null);
          setLoading(false);
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
          // If we recently logged in, hold the authenticated state briefly
          if (optimisticUser && Date.now() < optimisticHoldUntil) {
            try {
              optimisticUser.getSession((err, session) => {
                if (!err && session?.isValid?.()) {
                  setUser(optimisticUser);
                  setLoading(false);
                  return;
                }
                // While within the grace window, avoid flipping to null to prevent UI bounce
                if (Date.now() < suppressInvalidationUntil && lastKnownUser) {
                  setUser((prev) => prev ?? lastKnownUser);
                  setLoading(false);
                  return;
                }
                setUser((prev) => (prev === null ? prev : null));
                setLoading(false);
              });
              return;
            } catch {}
          }
          // If we have a lastKnownUser with a valid session, use it to avoid flicker
          if (lastKnownUser) {
            try {
              lastKnownUser.getSession((err, session) => {
                if (!err && session?.isValid?.()) {
                  setUser(lastKnownUser);
                  setLoading(false);
                  return;
                }
                // During grace window keep lastKnownUser to avoid bounce
                if (Date.now() < suppressInvalidationUntil) {
                  setUser((prev) => prev ?? lastKnownUser);
                  setLoading(false);
                  return;
                }
                setUser((prev) => (prev === null ? prev : null));
                setLoading(false);
              });
              return;
            } catch {}
          }
          // During the grace window, prefer lastKnownUser even if current not yet loaded
          if (lastKnownUser && Date.now() < suppressInvalidationUntil) {
            try {
              lastKnownUser.getSession((err, session) => {
                if (!err && session?.isValid?.()) {
                  setUser(lastKnownUser);
                  setLoading(false);
                  return;
                }
                // Keep user sticky during grace even if session check is lagging
                setUser((prev) => prev ?? lastKnownUser);
                setLoading(false);
              });
              return;
            } catch {}
          }
          setUser((prev) => (prev === null ? prev : null));
          setLoading(false);
          return;
        }
        current.getSession(async (err, session) => {
          const invalidate = async () => {
            // Respect grace window to reduce post-login bounce; keep user sticky
            if (Date.now() < suppressInvalidationUntil && lastKnownUser) {
              setUser((prev) => prev ?? lastKnownUser);
              setLoading(false);
              return;
            }
            try {
              current.signOut?.();
            } catch {}
            await clearCognitoSessions();
            setUser((prev) => (prev === null ? prev : null));
            setLoading(false);
          };

          if (err || !session?.isValid?.()) {
            return void invalidate();
          }
          // Guard against malformed session tokens (prevents jwtToken.split errors)
          try {
            const idToken = session.getIdToken?.();
            const raw = idToken?.getJwtToken?.();
            if (!raw || typeof raw !== 'string') {
              return void invalidate();
            }
            // Also ensure looks like a JWT a.b.c
            if (!/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(raw)) {
              return void invalidate();
            }
          } catch {
            return void invalidate();
          }
          setUser((prev) => (prev === current ? prev : current));
          setLoading(false);
        });
      } catch (e) {
        // If library throws while constructing session, nuke cached tokens and proceed unauthenticated
        // During grace window, don't immediately clear to avoid bounce
        if (Date.now() < suppressInvalidationUntil && lastKnownUser) {
          setUser((prev) => prev ?? lastKnownUser);
          setLoading(false);
        } else {
          await clearCognitoSessions();
          setUser((prev) => (prev === null ? prev : null));
          setLoading(false);
        }
      }
    };

    // initial
    setFromSession();

    // expose external refresh trigger; allow fast-path with provided CognitoUser
    refreshAuthNow = async (maybeUser) => {
      if (maybeUser) {
        try {
          // Ensure the provided user actually has a valid session
          maybeUser.getSession((err, session) => {
            if (err || !session?.isValid?.()) {
              return setFromSession();
            }
            // Set optimistic window to avoid immediate poll-based logout
            optimisticUser = maybeUser;
            optimisticHoldUntil = Date.now() + 120000; // 120s hold
            lastKnownUser = maybeUser; // remember beyond hold window
            suppressInvalidationUntil = Date.now() + 180000; // 180s grace
            setUser(maybeUser);
            setLoading(false);
          });
          return;
        } catch {
          // fallback to regular flow
        }
      }
      return setFromSession();
    };

    // Poll every 2 seconds to reflect background auth changes
    const interval = setInterval(setFromSession, 2000);
    return () => clearInterval(interval);
  }, []);
  
  return { user, loading, error, isAuthenticated: !!user };
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