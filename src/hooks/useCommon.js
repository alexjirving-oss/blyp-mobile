import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import Logger from '../utils/Logger';
import { userPool } from '../lib/auth/userPool';
import {
  clearCognitoSession,
  getCognitoSessionSnapshot,
  refreshCognitoSession,
  subscribeCognitoSession,
} from '../lib/auth/cognitoSession';

export { userPool };

// Login, confirmation, and sign-out flows call these explicit session transitions.
export const refreshAuthNow = (maybeUser) => refreshCognitoSession(maybeUser || null);
export const clearCognitoSessions = () => clearCognitoSession();

// Cognito `sub` is the sole runtime identity authority. Firebase is only accepted
// by the backend as a short-lived, verified proof during the account-link operation.
export const useAuth = () => {
  const [authState, setAuthState] = useState(() => getCognitoSessionSnapshot());

  useEffect(() => {
    const unsubscribe = subscribeCognitoSession(setAuthState);
    refreshCognitoSession().catch(() => {});

    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        refreshCognitoSession().catch(() => {});
      }
    });

    return () => {
      unsubscribe();
      appStateSubscription.remove();
    };
  }, []);

  return {
    user: authState.user,
    canonicalUserId: authState.canonicalUserId,
    loading: authState.status === 'loading',
    error: authState.error,
    isAuthenticated: authState.status === 'authenticated',
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
