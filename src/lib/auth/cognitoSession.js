import AsyncStorage from '@react-native-async-storage/async-storage';
import { userPool } from './userPool';

const listeners = new Set();
let refreshRevision = 0;
let snapshot = {
  status: 'loading',
  user: null,
  session: null,
  canonicalUserId: null,
  error: null,
};

function notify() {
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch {}
  }
}

function commit(nextSnapshot) {
  snapshot = Object.freeze(nextSnapshot);
  notify();
  return snapshot;
}

function readUserSession(user) {
  return new Promise((resolve, reject) => {
    if (!user || typeof user.getSession !== 'function') {
      reject(new Error('No Cognito user session is available.'));
      return;
    }
    user.getSession((error, session) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(session);
    });
  });
}

function validatedAccessIdentity(session) {
  if (!session?.isValid?.()) {
    throw new Error('The Cognito session is invalid or expired.');
  }
  const accessToken = session.getAccessToken?.();
  const jwt = accessToken?.getJwtToken?.();
  const payload = accessToken?.payload || {};
  if (!jwt || typeof jwt !== 'string' || !/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(jwt)) {
    throw new Error('The Cognito access token is malformed.');
  }
  if (payload.token_use !== 'access' || typeof payload.sub !== 'string' || !payload.sub) {
    throw new Error('The Cognito access token has no canonical subject.');
  }
  return { jwt, canonicalUserId: payload.sub };
}

export function getCognitoSessionSnapshot() {
  return snapshot;
}

export function subscribeCognitoSession(listener) {
  listeners.add(listener);
  listener(snapshot);
  return () => listeners.delete(listener);
}

export async function refreshCognitoSession(preferredUser = null) {
  const revision = ++refreshRevision;
  const user = preferredUser || userPool.getCurrentUser();
  if (!user) {
    if (revision !== refreshRevision) return snapshot;
    return commit({
      status: 'unauthenticated',
      user: null,
      session: null,
      canonicalUserId: null,
      error: null,
    });
  }

  try {
    const session = await readUserSession(user);
    const identity = validatedAccessIdentity(session);
    if (revision !== refreshRevision) return snapshot;
    return commit({
      status: 'authenticated',
      user,
      session,
      canonicalUserId: identity.canonicalUserId,
      error: null,
    });
  } catch (error) {
    if (revision !== refreshRevision) return snapshot;
    return commit({
      status: 'unauthenticated',
      user: null,
      session: null,
      canonicalUserId: null,
      error: error instanceof Error ? error : new Error(String(error)),
    });
  }
}

export async function clearCognitoSession({ signOut = true } = {}) {
  refreshRevision += 1;
  const user = snapshot.user || userPool.getCurrentUser();
  if (signOut) {
    try {
      user?.signOut?.();
    } catch {}
  }
  try {
    const keys = await AsyncStorage.getAllKeys();
    const cognitoKeys = keys.filter((key) => key.includes('CognitoIdentityServiceProvider'));
    if (cognitoKeys.length > 0) await AsyncStorage.multiRemove(cognitoKeys);
  } catch {}
  return commit({
    status: 'unauthenticated',
    user: null,
    session: null,
    canonicalUserId: null,
    error: null,
  });
}

export async function getCanonicalAccessToken() {
  const current = await refreshCognitoSession();
  if (current.status !== 'authenticated') {
    const error = new Error('Authentication is required.');
    error.code = 'AUTH_REQUIRED';
    throw error;
  }
  return validatedAccessIdentity(current.session).jwt;
}

export async function getCanonicalUserId() {
  const current = await refreshCognitoSession();
  if (current.status !== 'authenticated' || !current.canonicalUserId) {
    const error = new Error('Authentication is required.');
    error.code = 'AUTH_REQUIRED';
    throw error;
  }
  return current.canonicalUserId;
}
