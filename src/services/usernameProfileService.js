import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { firebaseNative, firestore } from '../config/firebase';
import { hydrateOwnProfile } from './ownProfileCache';

const PENDING_PROFILE_KEY = '@blyp/auth/pending-profile-v1';
const USERNAME_DEFERRED_PREFIX = '@blyp/auth/username-deferred-v1:';
const USERNAME_PATTERN = /^[A-Za-z0-9_.]{3,20}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function deferredKey(uid) {
  return `${USERNAME_DEFERRED_PREFIX}${String(uid || '').trim()}`;
}

export function normalizeUsername(value) {
  return String(value || '').trim().replace(/^@/, '');
}

export function usernameKey(value) {
  return normalizeUsername(value).toLowerCase();
}

export function validateUsername(value, uid = '') {
  const username = normalizeUsername(value);
  if (!USERNAME_PATTERN.test(username)) {
    return {
      ok: false,
      message: 'Use 3–20 letters, numbers, underscores, or dots.',
    };
  }
  if (UUID_PATTERN.test(username) || (uid && username.toLowerCase() === String(uid).toLowerCase())) {
    return {
      ok: false,
      message: 'Choose a public username, not an account ID.',
    };
  }
  return { ok: true, username, key: username.toLowerCase() };
}

export function hasValidPublicUsername(profile, uid = '') {
  const candidate = profile?.username || profile?.handle || '';
  return validateUsername(candidate, uid).ok;
}

export async function rememberPendingProfile(data = {}) {
  const email = String(data.email || '').trim().toLowerCase();
  const payload = {
    source: data.source === 'social' ? 'social' : 'signup',
    username: normalizeUsername(data.username),
    ...(email ? { email } : {}),
    createdAt: Date.now(),
  };
  await AsyncStorage.setItem(PENDING_PROFILE_KEY, JSON.stringify(payload));
}

export async function readPendingProfile() {
  try {
    const raw = await AsyncStorage.getItem(PENDING_PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || Date.now() - Number(parsed.createdAt || 0) > 7 * 24 * 60 * 60 * 1000) {
      await AsyncStorage.removeItem(PENDING_PROFILE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Pending signup/social payload only when it belongs to this signed-in identity. */
export async function readPendingProfileForUser({ email } = {}) {
  const pending = await readPendingProfile();
  if (!pending) return null;
  const pendingEmail = String(pending.email || '').trim().toLowerCase();
  const userEmail = String(email || '').trim().toLowerCase();
  // Shared-device safety: never apply another account's pending username.
  if (pendingEmail && userEmail && pendingEmail !== userEmail) return null;
  return pending;
}

export async function clearPendingProfile() {
  await AsyncStorage.removeItem(PENDING_PROFILE_KEY);
}

/** One-time "not now" for legacy accounts missing a public username — durable across launches. */
export async function markUsernameDeferred(uid) {
  if (!uid) return;
  await AsyncStorage.setItem(deferredKey(uid), JSON.stringify({ deferredAt: Date.now() }));
}

export async function isUsernameDeferred(uid) {
  if (!uid) return false;
  try {
    const raw = await AsyncStorage.getItem(deferredKey(uid));
    return !!raw;
  } catch {
    return false;
  }
}

export async function clearUsernameDeferred(uid) {
  if (!uid) return;
  await AsyncStorage.removeItem(deferredKey(uid));
}

/**
 * After email signup (or when pending carries a username), claim the handle once
 * during AuthScreen success. There is no post-login username overlay.
 */
export async function claimPendingUsernameIfNeeded({ uid, email, photoURL, username } = {}) {
  if (!uid) return null;
  const pending = await readPendingProfileForUser({ email });
  const candidate = normalizeUsername(username) || normalizeUsername(pending?.username);
  if (!candidate) return null;
  return claimUsername({ uid, username: candidate, email, photoURL });
}

async function findLegacyCollision(uid, username, key) {
  if (firebaseNative) {
    const users = firestore.collection('users');
    const snapshots = await Promise.all([
      users.where('usernameKey', '==', key).limit(2).get(),
      users.where('username', '==', username).limit(2).get(),
      users.where('handle', '==', username).limit(2).get(),
    ]);
    return snapshots.some((snap) => snap.docs.some((item) => item.id !== uid));
  }

  const users = collection(firestore, 'users');
  const snapshots = await Promise.all([
    getDocs(query(users, where('usernameKey', '==', key), limit(2))),
    getDocs(query(users, where('username', '==', username), limit(2))),
    getDocs(query(users, where('handle', '==', username), limit(2))),
  ]);
  return snapshots.some((snap) => snap.docs.some((item) => item.id !== uid));
}

export async function claimUsername({ uid, username, email, photoURL } = {}) {
  if (!uid) throw new Error('You must be signed in to choose a username.');
  const validated = validateUsername(username, uid);
  if (!validated.ok) throw new Error(validated.message);

  const { username: publicUsername, key } = validated;
  if (await findLegacyCollision(uid, publicUsername, key)) {
    const error = new Error('That username is already in use. Pick another.');
    error.code = 'USERNAME_TAKEN';
    throw error;
  }

  if (firebaseNative) {
    const userRef = firestore.collection('users').doc(uid);
    const claimRef = firestore.collection('usernameClaims').doc(key);
    await firestore.runTransaction(async (tx) => {
      const [userSnap, claimSnap] = await Promise.all([tx.get(userRef), tx.get(claimRef)]);
      const ownerUid = claimSnap.exists ? claimSnap.data()?.uid : null;
      if (ownerUid && ownerUid !== uid) {
        const error = new Error('That username is already in use. Pick another.');
        error.code = 'USERNAME_TAKEN';
        throw error;
      }
      const oldKey = String(userSnap.data()?.usernameKey || '').toLowerCase();
      const oldRef = oldKey && oldKey !== key
        ? firestore.collection('usernameClaims').doc(oldKey)
        : null;
      const oldSnap = oldRef ? await tx.get(oldRef) : null;

      tx.set(claimRef, { uid, username: publicUsername, updatedAt: new Date() }, { merge: true });
      tx.set(userRef, {
        sub: uid,
        username: publicUsername,
        usernameKey: key,
        handle: publicUsername,
        displayName: publicUsername,
        ...(email ? { email } : {}),
        ...(photoURL ? { photoURL } : {}),
        updatedAt: new Date(),
      }, { merge: true });
      if (oldRef && oldSnap?.exists && oldSnap.data()?.uid === uid) tx.delete(oldRef);
    });
  } else {
    const userRef = doc(firestore, 'users', uid);
    const claimRef = doc(firestore, 'usernameClaims', key);
    await runTransaction(firestore, async (tx) => {
      const [userSnap, claimSnap] = await Promise.all([tx.get(userRef), tx.get(claimRef)]);
      const ownerUid = claimSnap.exists() ? claimSnap.data()?.uid : null;
      if (ownerUid && ownerUid !== uid) {
        const error = new Error('That username is already in use. Pick another.');
        error.code = 'USERNAME_TAKEN';
        throw error;
      }
      const oldKey = String(userSnap.data()?.usernameKey || '').toLowerCase();
      const oldRef = oldKey && oldKey !== key ? doc(firestore, 'usernameClaims', oldKey) : null;
      const oldSnap = oldRef ? await tx.get(oldRef) : null;

      tx.set(claimRef, { uid, username: publicUsername, updatedAt: serverTimestamp() }, { merge: true });
      tx.set(userRef, {
        sub: uid,
        username: publicUsername,
        usernameKey: key,
        handle: publicUsername,
        displayName: publicUsername,
        ...(email ? { email } : {}),
        ...(photoURL ? { photoURL } : {}),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      if (oldRef && oldSnap?.exists() && oldSnap.data()?.uid === uid) tx.delete(oldRef);
    });
  }

  await clearPendingProfile();
  await clearUsernameDeferred(uid);
  await hydrateOwnProfile(uid).catch(() => {});
  return { username: publicUsername, usernameKey: key };
}
