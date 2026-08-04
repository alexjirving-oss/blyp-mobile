import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CognitoUserPool } from 'amazon-cognito-identity-js';
import Logger from '../utils/Logger';
import { cognitoStorage, removeFromCognitoStorageCache } from '../lib/auth/cognitoStorage';
// Optional Firebase auth fallback (previous working backup used Firebase auth)
import { auth as firebaseAuth, firebaseEnabled, db } from '../config/firebase';
import { snapData } from '../utils/firestoreSnap';
import awsconfig from '../aws-exports';
import { ensureFirebaseAuth, setFirebaseAuthBridgeContext } from '../utils/firebaseAuthHelper';
import { ensureUserProfile } from '../services/LiveService';

export const userPool = new CognitoUserPool({
  UserPoolId: awsconfig.aws_user_pools_id,
  ClientId: awsconfig.aws_user_pools_web_client_id,
  Storage: cognitoStorage, // must be synchronous for amazon-cognito-identity-js
});

// External trigger to refresh auth immediately (set by useAuth on mount)
// Optionally accepts a CognitoUser to set immediately after auth success
export let refreshAuthNow = (_maybeUser) => { };

// Short-term optimistic auth window to avoid bounce-back right after login
let optimisticUser = null;
let optimisticHoldUntil = 0;
let lastKnownUser = null; // survive beyond the optimistic window
let suppressInvalidationUntil = 0; // grace window to avoid bounce-back after login
// Hard-logout latch: when true, every auth recovery/hysteresis path is bypassed
// and the user is treated as signed-out until an explicit, valid re-login. This
// is what makes "Log out" instantly drop to the sign-in screen instead of being
// kept alive by the optimistic / last-known / last-stable windows below.
let forceLoggedOut = false;

const isLiveSessionActive = () => {
  try {
    return !!global.__BLYP_LIVE_ACTIVE__;
  } catch {
    return false;
  }
};

const isCognitoTokenCorruptionError = (e) => {
  try {
    const msg = String(e?.message || e || '');
    return msg.includes('jwtToken.split') || msg.includes('split is not a function');
  } catch {
    return false;
  }
};

// Helper to clear any Cognito session artifacts in AsyncStorage
export const clearCognitoSessions = async () => {
  try {
    // Also clear in-memory auth caches so UI can't remain "sticky" after sign-out.
    optimisticUser = null;
    optimisticHoldUntil = 0;
    lastKnownUser = null;
    suppressInvalidationUntil = 0;

    const keys = await AsyncStorage.getAllKeys();
    const cognitoKeys = keys.filter((k) => k.includes('CognitoIdentityServiceProvider'));
    if (cognitoKeys.length) {
      await AsyncStorage.multiRemove(cognitoKeys);
      removeFromCognitoStorageCache(cognitoKeys);
    }
  } catch { }
};

// Full, intentional sign-out. Unlike clearCognitoSessions (which only wipes
// storage + a couple of caches), this latches `forceLoggedOut` and clears every
// in-memory window that the auth engine uses to keep a user alive, so the UI
// drops to the sign-in screen immediately and stays there until a real re-login.
export const hardLogout = async () => {
  forceLoggedOut = true;
  optimisticUser = null;
  optimisticHoldUntil = 0;
  lastKnownUser = null;
  suppressInvalidationUntil = 0;
  lastStableAuth = { user: null, uid: null, at: 0 };
  lastBridgedUid = null;
  lastReadyLogUid = null;
  try {
    const current = userPool.getCurrentUser();
    current?.signOut?.();
  } catch { }
  try { await clearCognitoSessions(); } catch { }
  try {
    if (firebaseEnabled && firebaseAuth && typeof firebaseAuth.signOut === 'function') {
      await firebaseAuth.signOut();
    }
  } catch { }
  applyAuthUpdate({ user: null, uid: null, loading: false, authReady: true });
  notifyAuthListeners();
};

// Helper to get Cognito ID token (JWT) for API calls
export const getCognitoIdToken = async (options = {}) => {
  const autoClearOnCorruption =
    typeof options?.autoClearOnCorruption === 'boolean'
      ? options.autoClearOnCorruption
      : !isLiveSessionActive(); // default: auto-clear unless we're actively live (avoid mid-live sign-out)
  return new Promise((resolve, reject) => {
    try {
      // Prefer an explicit Cognito user when provided.
      // This avoids transient `userPool.getCurrentUser() === null` windows right after login,
      // which can break the Firebase auth bridge even when the UI auth state is already set.
      const explicitUser = options?.user;
      const currentUser =
        (explicitUser && typeof explicitUser.getSession === 'function' ? explicitUser : null) ||
        userPool.getCurrentUser() ||
        optimisticUser ||
        lastKnownUser;

      // Avoid repeated sign-out loops if multiple callers ask for a token at once.
      if (!global.__blypForcedCognitoSignOut) {
        global.__blypForcedCognitoSignOut = false;
      }

      if (!currentUser) {
        reject(new Error('No authenticated user'));
        return;
      }

      currentUser.getSession((err, session) => {
        if (err) {
          Logger.error('[AUTH][GET_TOKEN_ERROR]', err);
          // Known corruption signature from amazon-cognito-identity-js:
          // "this.jwtToken.split is not a function (it is undefined)"
          // When this happens, AsyncStorage contains malformed token data.
          try {
            const msg = String(err?.message || err || '');
            if (msg.includes('jwtToken.split') || msg.includes('split is not a function')) {
              if (autoClearOnCorruption && !global.__blypForcedCognitoSignOut) {
                global.__blypForcedCognitoSignOut = true;
                clearCognitoSessions()
                  .then(() => console.log('🧹 Cleared corrupted Cognito session after token error'))
                  .catch(() => { });
                try { currentUser.signOut?.(); } catch { }
              }
              reject(new Error('COGNITO_SESSION_CORRUPTED_RELOGIN'));
              return;
            }
          } catch { }
          reject(err);
          return;
        }

        if (!session) {
          reject(new Error('No session available'));
          return;
        }

        if (typeof session.isValid !== 'function' || !session.isValid()) {
          reject(new Error('Invalid or expired session'));
          return;
        }

        try {
          // Safely extract token with guards against Cognito library issues
          const idToken = session.getIdToken?.();

          if (!idToken) {
            reject(new Error('No ID token in session'));
            return;
          }

          // Defensive guard: getJwtToken may crash if token is malformed
          let jwtToken;
          try {
            jwtToken = idToken.getJwtToken?.();
          } catch (e) {
            Logger.error('[AUTH][COGNITO_JWT_ERROR]', e);
            try {
              const msg = String(e?.message || e || '');
              if (msg.includes('jwtToken.split') || msg.includes('split is not a function')) {
                if (autoClearOnCorruption && !global.__blypForcedCognitoSignOut) {
                  global.__blypForcedCognitoSignOut = true;
                  clearCognitoSessions()
                    .then(() => console.log('🧹 Cleared corrupted Cognito session after JWT extraction crash'))
                    .catch(() => { });
                  try { currentUser.signOut?.(); } catch { }
                }
                reject(new Error('COGNITO_SESSION_CORRUPTED_RELOGIN'));
                return;
              }
            } catch { }
            reject(new Error(`Cognito JWT extraction failed: ${e?.message || String(e)}`));
            return;
          }

          if (!jwtToken) {
            reject(new Error('ID token has no JWT payload'));
            return;
          }

          if (typeof jwtToken !== 'string') {
            reject(new Error(`JWT token is not a string: ${typeof jwtToken}`));
            return;
          }

          // Validate JWT structure (minimal check to avoid split-based crashes)
          if (!jwtToken.includes('.')) {
            reject(new Error('Malformed JWT token: missing dot separators'));
            return;
          }

          resolve(jwtToken);
        } catch (error) {
          Logger.error('[AUTH][TOKEN_EXTRACTION_ERROR]', error);
          reject(error);
        }
      });
    } catch (error) {
      Logger.error('[AUTH][GET_TOKEN_OUTER_ERROR]', error);
      try {
        const msg = String(error?.message || error || '');
        if (msg.includes('jwtToken.split') || msg.includes('split is not a function')) {
          if (autoClearOnCorruption && !global.__blypForcedCognitoSignOut) {
            global.__blypForcedCognitoSignOut = true;
            clearCognitoSessions()
              .then(() => console.log('🧹 Cleared corrupted Cognito session after outer token error'))
              .catch(() => { });
            try {
              const currentUser = userPool.getCurrentUser();
              currentUser?.signOut?.();
            } catch { }
          }
          reject(new Error('COGNITO_SESSION_CORRUPTED_RELOGIN'));
          return;
        }
      } catch { }
      reject(error);
    }
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Singleton auth engine
//
// `useAuth` used to be a plain hook, so EVERY component that called it ran its
// own Cognito session restore, 5s poll, Firebase bridge and `ensureUserProfile`
// write. With 25+ call sites that meant dozens of duplicate restores and a
// constant stream of `ensureUserProfile` writes. We now run the engine ONCE at
// module scope and let `useAuth` subscribe to a shared store. The Firebase
// bridge + profile ensure only run when the resolved `uid` actually changes,
// which eliminates the write loop.
// ─────────────────────────────────────────────────────────────────────────────

const preferFirebase = (() => {
  try {
    const v1 = String(process.env?.EXPO_PUBLIC_AUTH_PROVIDER || '').toLowerCase();
    const v2 = String(process.env?.EXPO_PUBLIC_PREFER_FIREBASE_AUTH || '').toLowerCase();
    return v1 === 'firebase' || v2 === '1' || v2 === 'true';
  } catch {
    return false;
  }
})();

let authState = {
  user: undefined,
  uid: null,
  loading: true,
  authReady: false, // Starts false, becomes true once, never flips back
  error: null,
};
const authListeners = new Set();
let lastStableAuth = { user: null, uid: null, at: 0 };
const restoreLog = { started: false, finished: false };
let lastBridgedUid = null;
let authEngineStarted = false;
// Only log "auth stabilized" on an actual session transition, not on every
// 5s engine tick (otherwise it spams the console, even at WARN level in release).
let lastReadyLogUid = null;

// Extract uid from user object (Cognito or Firebase). Prefer the Cognito `sub`.
function extractUid(user) {
  if (!user) return null;

  if (firebaseEnabled && preferFirebase && user.uid) {
    return user.uid;
  }

  try {
    const directSub = user.attributes?.sub;
    if (directSub) return directSub;

    const session =
      user.signInUserSession ||
      (typeof user.getSignInUserSession === 'function' ? user.getSignInUserSession() : null) ||
      null;

    const payload = session?.getIdToken?.()?.payload;
    const subFromPayload = payload?.sub;
    if (subFromPayload) return subFromPayload;

    if (user.username) return user.username;
    if (typeof user.getUsername === 'function') {
      const username = user.getUsername();
      if (username) return username;
    }
  } catch (err) {
    console.error('[AUTH] Error extracting uid:', err);
  }

  return null;
}

function notifyAuthListeners() {
  for (const l of Array.from(authListeners)) {
    try { l(); } catch { }
  }
}

// Apply an update to the shared auth state, enforce invariants, run the Firebase
// bridge once per uid, and notify subscribers only when something changed.
function applyAuthUpdate(updates) {
  const prev = authState;
  const nextUser = updates.user !== undefined ? updates.user : prev.user;
  const nextUid =
    updates.uid !== undefined ? updates.uid : (nextUser ? extractUid(nextUser) : prev.uid);
  const nextLoading = updates.loading !== undefined ? updates.loading : prev.loading;
  const nextError = updates.error !== undefined ? updates.error : prev.error;
  // INVARIANT: authReady can only transition false → true, never back
  const nextAuthReady = updates.authReady === true ? true : prev.authReady;

  const next = {
    user: nextUser,
    uid: nextUid,
    loading: nextLoading,
    authReady: nextAuthReady,
    error: nextError,
  };

  if (next.user && next.uid) {
    lastStableAuth = { user: next.user, uid: next.uid, at: Date.now() };
  }

  const changed =
    prev.user !== next.user ||
    prev.uid !== next.uid ||
    prev.loading !== next.loading ||
    prev.authReady !== next.authReady ||
    prev.error !== next.error;

  authState = next;

  // One-shot restore logging (engine runs once, so this logs once).
  if (!restoreLog.finished && next.authReady) {
    restoreLog.finished = true;
    const hasUser = !!next.user && !!next.uid;
    if (next.error && !hasUser) console.warn('[AUTH_RESTORE_FAILED]', { error: String(next.error) });
    else console.log('[AUTH_RESTORE_SUCCESS]', { hasUser });
  }

  // Run the Firebase bridge + profile ensure ONLY when uid changes. This is the
  // key fix for the previous `ensureUserProfile` write loop.
  if (next.uid && next.user && next.uid !== lastBridgedUid) {
    lastBridgedUid = next.uid;
    runFirebaseBridge(next.uid, next.user);
  }
  if (!next.uid) lastBridgedUid = null;

  if (changed) notifyAuthListeners();
}

// Decode the claims (payload) from a Cognito JWT. The ID token always carries
// identity claims (email, preferred_username, name, ...) even when the in-memory
// `user.attributes` object hasn't been hydrated yet (common on session restore),
// so this is a reliable identity source.
function decodeJwtClaims(jwt) {
  try {
    if (typeof jwt !== 'string') return null;
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    let t = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (t.length % 4 !== 0) t += '=';
    const g = global;
    let json = null;
    if (g?.Buffer && typeof g.Buffer.from === 'function') {
      json = g.Buffer.from(t, 'base64').toString('utf8');
    } else if (typeof atob === 'function') {
      json = atob(t);
    }
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}

// Sign into Firebase Auth with a Cognito custom token so request.auth.uid lines
// up with the Cognito `sub`, then ensure the user's Firestore profile exists.
async function runFirebaseBridge(uid, user) {
  try {
    if (!firebaseEnabled) return;

    setFirebaseAuthBridgeContext({
      firebaseAuth,
      getUid: () => authState.uid,
      getCognitoIdToken,
    });

    const fbUid = firebaseAuth?.currentUser?.uid || null;
    let cognitoIdToken = null;
    if (fbUid !== uid) {
      cognitoIdToken = await getCognitoIdToken({ autoClearOnCorruption: false, user });
      await ensureFirebaseAuth({ cognitoIdToken, uid, firebaseAuth });
    }

    // Resolve identity from Cognito attributes AND the decoded ID token claims.
    // `user.attributes` is frequently empty on a session restore, which used to
    // make us fall back to writing the raw uid as the display name (and that
    // value then stuck). The token claims are always present, so merging them
    // means we get the real name/handle/email and never persist the uid.
    const attrs = user?.attributes || {};
    let claims = {};
    try {
      if (!cognitoIdToken) {
        cognitoIdToken = await getCognitoIdToken({ autoClearOnCorruption: false, user });
      }
      claims = decodeJwtClaims(cognitoIdToken) || {};
    } catch {
      /* claims are best-effort */
    }

    const isUuidLike = (s) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || '').trim());
    const pick = (...vals) => {
      for (const v of vals) {
        if (typeof v === 'string' && v.trim()) return v.trim();
      }
      return '';
    };
    // Like pick(), but skips UUID/sub-shaped values (some pools set
    // cognito:username to the raw sub, which is not a real handle).
    const pickName = (...vals) => {
      for (const v of vals) {
        if (typeof v === 'string' && v.trim() && !isUuidLike(v)) return v.trim();
      }
      return '';
    };

    const emailFromToken = pick(attrs.email, claims.email);
    const pictureFromToken = pick(attrs.picture, claims.picture);
    const preferredUsername = pickName(
      attrs.preferred_username,
      attrs['cognito:username'],
      claims.preferred_username,
      claims['cognito:username']
    );
    const nameFromToken = pick(attrs.name, claims.name);
    const emailPrefix = emailFromToken ? emailFromToken.split('@')[0] : '';
    const resolvedDisplayName = pick(preferredUsername, nameFromToken, emailPrefix);

    await ensureUserProfile({
      userId: uid,
      // Never persist the raw uid as a display name. When we genuinely have no
      // identity, leave displayName undefined so ensureUserProfile keeps it
      // replaceable instead of cementing the uid.
      displayName: resolvedDisplayName || undefined,
      photoURL: pictureFromToken || undefined,
      email: emailFromToken || undefined,
      username: preferredUsername || undefined,
    });
  } catch (e) {
    console.warn('[AUTH][FIREBASE_BRIDGE] failed', e?.message || String(e));
    // Allow a retry on the next poll if the bridge didn't actually establish.
    if (authState.uid === uid && firebaseAuth?.currentUser?.uid !== uid) {
      lastBridgedUid = null;
    }
  }
}

async function setFromSession() {
  try {
    if (!restoreLog.started) {
      restoreLog.started = true;
      console.log('[AUTH_RESTORE_START]');
    }
    // Hard-logout latch: skip every hysteresis/recovery path and report signed-out.
    if (forceLoggedOut) {
      applyAuthUpdate({ user: null, uid: null, loading: false, authReady: true });
      return;
    }
    const current = userPool.getCurrentUser();

    if (!current) {
      // Hysteresis: if we *just* had a stable user/uid, keep it briefly.
      try {
        const last = lastStableAuth;
        const withinMs = 120000;
        if (last?.user && last?.uid && Date.now() - (last.at || 0) < withinMs) {
          applyAuthUpdate({
            user: last.user,
            uid: last.uid,
            loading: false,
            authReady: true,
            error: 'AUTH_UNSTABLE_DEFERRED',
          });
          return;
        }
      } catch { }

      if (isLiveSessionActive() && lastKnownUser) {
        const uid = extractUid(lastKnownUser);
        applyAuthUpdate({
          user: lastKnownUser,
          uid,
          loading: false,
          authReady: true,
          error: 'AUTH_UNSTABLE_DEFERRED',
        });
        return;
      }

      if (optimisticUser && Date.now() < optimisticHoldUntil) {
        try {
          optimisticUser.getSession((err, session) => {
            let sessionValid = false;
            try { sessionValid = !!session?.isValid?.(); } catch { sessionValid = false; }
            if (!err && sessionValid) {
              const uid = extractUid(optimisticUser);
              applyAuthUpdate({ user: optimisticUser, uid, loading: false, authReady: true });
              return;
            }
            if (Date.now() < suppressInvalidationUntil && lastKnownUser) {
              const uid = extractUid(lastKnownUser);
              applyAuthUpdate({ user: lastKnownUser, uid, loading: false, authReady: true });
              return;
            }
            applyAuthUpdate({ user: null, uid: null, loading: false, authReady: true });
          });
          return;
        } catch { }
      }

      if (lastKnownUser && Date.now() < suppressInvalidationUntil) {
        try {
          lastKnownUser.getSession((err, session) => {
            let sessionValid = false;
            try { sessionValid = !!session?.isValid?.(); } catch { sessionValid = false; }
            if (!err && sessionValid) {
              const uid = extractUid(lastKnownUser);
              applyAuthUpdate({ user: lastKnownUser, uid, loading: false, authReady: true });
              return;
            }
            const uid = extractUid(lastKnownUser);
            applyAuthUpdate({ user: lastKnownUser, uid, loading: false, authReady: true });
          });
          return;
        } catch { }
      }

      try {
        const candidate = lastKnownUser || lastStableAuth?.user || null;
        if (candidate && typeof candidate.getSession === 'function') {
          const kept = await new Promise((resolve) => {
            try {
              candidate.getSession((err, session) => {
                let sessionValid = false;
                try { sessionValid = !!session?.isValid?.(); } catch { sessionValid = false; }
                if (!err && sessionValid) {
                  lastKnownUser = candidate;
                  const uid = extractUid(candidate);
                  applyAuthUpdate({ user: candidate, uid, loading: false, authReady: true, error: 'AUTH_REHYDRATED_FROM_LASTKNOWN' });
                  resolve(true);
                  return;
                }
                resolve(false);
              });
            } catch {
              resolve(false);
            }
          });
          if (kept) return;
        }
      } catch { }

      applyAuthUpdate({ user: null, uid: null, loading: false, authReady: true });
      lastReadyLogUid = null;
      console.log('[AUTH][READY] Cognito auth stabilized (no user)');
      return;
    }

    current.getSession(async (err, session) => {
      const invalidate = async (reason = 'INVALID_SESSION') => {
        if (Date.now() < suppressInvalidationUntil && lastKnownUser) {
          const uid = extractUid(lastKnownUser);
          applyAuthUpdate({ user: lastKnownUser, uid, loading: false, authReady: true });
          return;
        }

        if (isLiveSessionActive() || reason === 'COGNITO_TOKEN_CORRUPTION' || isCognitoTokenCorruptionError(err)) {
          const keepUser = lastKnownUser || current;
          const uid = keepUser ? extractUid(keepUser) : null;
          applyAuthUpdate({
            user: keepUser || null,
            uid,
            loading: false,
            authReady: true,
            error: 'COGNITO_SESSION_CORRUPTED_RELOGIN',
          });
          console.warn('[AUTH][SOFT_INVALIDATE] deferred hard logout', {
            reason,
            liveActive: isLiveSessionActive(),
          });
          return;
        }

        try { current.signOut?.(); } catch { }
        await clearCognitoSessions();
        applyAuthUpdate({ user: null, uid: null, loading: false, authReady: true });
      };

      let sessionValid = false;
      try { sessionValid = !!session?.isValid?.(); } catch { sessionValid = false; }
      if (err || !sessionValid) return void invalidate(isCognitoTokenCorruptionError(err) ? 'COGNITO_TOKEN_CORRUPTION' : 'INVALID_SESSION');

      try {
        const idToken = session.getIdToken?.();
        const raw = idToken?.getJwtToken?.();
        if (!raw || typeof raw !== 'string') return void invalidate('COGNITO_TOKEN_CORRUPTION');
        if (!/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(raw)) return void invalidate('COGNITO_TOKEN_CORRUPTION');
      } catch {
        return void invalidate('COGNITO_TOKEN_CORRUPTION');
      }

      const uid = extractUid(current);
      lastKnownUser = current;
      applyAuthUpdate({ user: current, uid, loading: false, authReady: true });
      if (lastReadyLogUid !== uid) {
        lastReadyLogUid = uid;
        console.warn('[AUTH][READY] Cognito auth stabilized with valid session');
      }
    });
  } catch (e) {
    const looksLikeCorruption = isCognitoTokenCorruptionError(e);

    if (looksLikeCorruption) {
      await clearCognitoSessions();
      applyAuthUpdate({
        user: null,
        uid: null,
        loading: false,
        authReady: true,
        error: 'COGNITO_SESSION_CORRUPTED_RELOGIN',
      });
      console.warn('[AUTH][HARD_SESSION_ERROR] cleared corrupted Cognito session; forcing re-login', {
        message: String(e?.message || e || ''),
      });
      return;
    }

    if ((Date.now() < suppressInvalidationUntil && lastKnownUser) || isLiveSessionActive()) {
      const keepUser = lastKnownUser || null;
      const uid = keepUser ? extractUid(keepUser) : null;
      applyAuthUpdate({ user: keepUser, uid, loading: false, authReady: true });
      console.warn('[AUTH][SOFT_SESSION_ERROR] keeping user to avoid mid-flow logout', {
        liveActive: isLiveSessionActive(),
        looksLikeCorruption,
        message: String(e?.message || e || ''),
      });
      return;
    }

    await clearCognitoSessions();
    applyAuthUpdate({ user: null, uid: null, loading: false, authReady: true });
    console.log('[AUTH][READY] Cognito auth stabilized (cleared corrupted session)');
  }
}

// Start the singleton engine exactly once (first time any component mounts a
// useAuth subscriber).
function startAuthEngine() {
  if (authEngineStarted) return;
  authEngineStarted = true;

  // Fast-path: Firebase auth (if enabled and preferred)
  if (firebaseEnabled && preferFirebase && firebaseAuth && typeof firebaseAuth.onAuthStateChanged === 'function') {
    try {
      firebaseAuth.onAuthStateChanged((fbUser) => {
        applyAuthUpdate({
          user: fbUser || null,
          uid: fbUser?.uid || null,
          loading: false,
          authReady: true,
        });
        console.log('[AUTH][READY] Firebase auth stabilized', { hasUser: !!fbUser });
      });
      return;
    } catch {
      // Fall through to Cognito path on any Firebase subscription error
    }
  }

  // Initial load
  setFromSession();

  // Refresh when the app returns to the foreground (replaces 5s polling).
  AppState.addEventListener('change', (nextState) => {
    if (nextState === 'active') setFromSession();
  });

  // Expose external refresh trigger (for post-login callbacks)
  refreshAuthNow = async (maybeUser) => {
    if (maybeUser) {
      try {
        maybeUser.getSession((err, session) => {
          let sessionValid = false;
          try { sessionValid = !!session?.isValid?.(); } catch { sessionValid = false; }
          if (err || !sessionValid) return setFromSession();
          // A real, valid login clears the hard-logout latch.
          forceLoggedOut = false;
          optimisticUser = maybeUser;
          optimisticHoldUntil = Date.now() + 120000;
          lastKnownUser = maybeUser;
          suppressInvalidationUntil = Date.now() + 120000;

          const uid = extractUid(maybeUser);
          applyAuthUpdate({ user: maybeUser, uid, loading: false, authReady: true });
          console.warn('[AUTH][READY] Explicit refresh with valid user');
        });
        return;
      } catch {
        // Fallback to regular flow
      }
    }
    return setFromSession();
  };
}

const authDebugEnabled =
  __DEV__ === true &&
  ['1', 'true', 'yes'].includes(String(process?.env?.EXPO_PUBLIC_AUTH_DEBUG || process?.env?.EXPO_PUBLIC_ENABLE_DEVTOOLS || '').toLowerCase());

// Custom hook for authentication state — thin subscriber over the singleton.
export const useAuth = () => {
  const [, forceRender] = useState(0);

  useEffect(() => {
    startAuthEngine();
    const listener = () => forceRender((n) => (n + 1) % 1000000);
    authListeners.add(listener);
    // Sync immediately in case the engine resolved before we subscribed.
    listener();
    return () => {
      authListeners.delete(listener);
    };
  }, []);

  const { user, uid, loading, authReady, error } = authState;
  const hasUser = !!user && !!uid;
  const isAuthenticated = authReady && hasUser;

  useEffect(() => {
    if (!authDebugEnabled) return;
    console.log('[AUTH DEBUG]', {
      uid,
      hasUser,
      authReady,
      isAuthenticated,
      loading,
      devBypass: process.env.EXPO_PUBLIC_DEV_FORCE_NO_AUTH,
    });
  }, [uid, hasUser, authReady, isAuthenticated, loading]);

  const getDisplayName = useCallback(() => {
    if (!user) return null;

    if (firebaseEnabled && preferFirebase && user.displayName) {
      return user.displayName;
    }

    try {
      if (user.attributes?.name && typeof user.attributes.name === 'string' && user.attributes.name.trim()) {
        return user.attributes.name.trim();
      }
      if (user.attributes?.preferred_username && typeof user.attributes.preferred_username === 'string' && user.attributes.preferred_username.trim()) {
        return user.attributes.preferred_username.trim();
      }
      if (user.attributes?.email && typeof user.attributes.email === 'string' && user.attributes.email.trim()) {
        return user.attributes.email.split('@')[0];
      }
    } catch (err) {
      console.error('[AUTH] Error extracting display name from attributes:', err);
    }

    try {
      const rawUsername =
        (typeof user?.getUsername === 'function' ? user.getUsername() : null) ||
        user?.username ||
        null;
      const u = String(rawUsername || '').trim();
      if (u) {
        return u.includes('@') ? u.split('@')[0] : u;
      }
    } catch { }

    console.warn('[AUTH] No display name available, all fallbacks exhausted');
    return null;
  }, [user]);

  return {
    user,
    uid,
    loading,
    authReady,
    error,
    isAuthenticated,
    hasUser,
    getDisplayName,
    currentUser: user,
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
          const sd = snapData(snapshot);
          if (sd) {
            setData({ id: snapshot.id, ...sd });
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
