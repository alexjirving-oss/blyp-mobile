/**
 * Global + per-person notification preferences.
 *
 * Firestore is authoritative (Cloud Functions enforce before FCM).
 * AsyncStorage is a fast local mirror for the global settings doc.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { db, firebaseEnabled } from '../config/firebase';
import {
  DEFAULT_CATEGORY_ENABLED,
  NOTIFICATION_CATEGORIES,
} from '../constants/notificationCategories';

const SETTINGS_SUB = 'notificationSettings';
const SETTINGS_DOC = 'global';
const OVERRIDES_SUB = 'notificationOverrides';

const globalCache = new Map();
const globalListeners = new Map();
const overrideCache = new Map();
const overrideListeners = new Map();

const storageKey = (uid) => `@blyp/notificationSettings/${uid || 'anon'}`;
const overrideStoreKey = (uid, targetUid) => `${uid || 'anon'}:${targetUid}`;

function emptyGlobal(uid) {
  return {
    userId: uid || '',
    pushEnabled: true,
    categories: { ...DEFAULT_CATEGORY_ENABLED },
    updatedAt: 0,
  };
}

function normalizeCategories(raw) {
  const out = { ...DEFAULT_CATEGORY_ENABLED };
  if (!raw || typeof raw !== 'object') return out;
  for (const key of NOTIFICATION_CATEGORIES) {
    if (raw[key] === true) out[key] = true;
    else if (raw[key] === false) out[key] = false;
  }
  return out;
}

function normalizeGlobal(uid, data) {
  const base = emptyGlobal(uid);
  if (!data || typeof data !== 'object') return base;
  return {
    userId: String(data.userId || uid || ''),
    pushEnabled: data.pushEnabled !== false,
    categories: normalizeCategories(data.categories),
    updatedAt: Number(data.updatedAt) || 0,
  };
}

function normalizeOverride(uid, targetUid, data) {
  const mode =
    data?.mode === 'everything' || data?.mode === 'nothing' || data?.mode === 'custom'
      ? data.mode
      : 'custom';
  const categories = {};
  if (data?.categories && typeof data.categories === 'object') {
    for (const key of NOTIFICATION_CATEGORIES) {
      if (data.categories[key] === true) categories[key] = true;
      else if (data.categories[key] === false) categories[key] = false;
    }
  }
  return {
    userId: String(data?.userId || uid || ''),
    targetUid: String(data?.targetUid || targetUid || ''),
    mode,
    categories,
    updatedAt: Number(data?.updatedAt) || 0,
    exists: data != null,
  };
}

async function ensurePreferenceAuth(uid) {
  const { ensureFirebaseAuthReady } = await import('../utils/firebaseAuthHelper');
  await ensureFirebaseAuthReady({ uid, timeoutMs: 15000 });
}

function settingsDoc(uid) {
  return db.collection('users').doc(uid).collection(SETTINGS_SUB).doc(SETTINGS_DOC);
}

function overrideDoc(uid, targetUid) {
  return db.collection('users').doc(uid).collection(OVERRIDES_SUB).doc(targetUid);
}

function emitGlobal(uid, settings) {
  globalCache.set(uid, settings);
  const set = globalListeners.get(uid);
  if (!set) return;
  set.forEach((cb) => {
    try {
      cb(settings);
    } catch {
      // ignore listener errors
    }
  });
}

function emitOverride(uid, targetUid, override) {
  const key = overrideStoreKey(uid, targetUid);
  overrideCache.set(key, override);
  const set = overrideListeners.get(key);
  if (!set) return;
  set.forEach((cb) => {
    try {
      cb(override);
    } catch {
      // ignore
    }
  });
}

async function mirrorGlobalLocal(uid, settings) {
  try {
    await AsyncStorage.setItem(storageKey(uid), JSON.stringify(settings));
  } catch {
    // non-fatal
  }
}

async function readGlobalLocal(uid) {
  if (globalCache.has(uid)) return globalCache.get(uid);
  try {
    const raw = await AsyncStorage.getItem(storageKey(uid));
    if (raw) {
      const parsed = normalizeGlobal(uid, JSON.parse(raw));
      globalCache.set(uid, parsed);
      return parsed;
    }
  } catch {
    // fall through
  }
  const empty = emptyGlobal(uid);
  globalCache.set(uid, empty);
  return empty;
}

/**
 * Subscribe to global notification settings for the signed-in user.
 */
export function subscribeNotificationSettings(uid, callback) {
  if (typeof callback !== 'function') return () => {};
  if (!globalListeners.has(uid)) globalListeners.set(uid, new Set());
  globalListeners.get(uid).add(callback);

  let cancelled = false;
  let remoteResolved = false;
  let unsubscribeRemote = () => {};

  readGlobalLocal(uid).then((settings) => {
    if (!cancelled && !remoteResolved) emitGlobal(uid, settings);
  });

  if (firebaseEnabled && uid && uid !== 'anon') {
    (async () => {
      try {
        await ensurePreferenceAuth(uid);
        if (cancelled) return;
        unsubscribeRemote = settingsDoc(uid).onSnapshot(
          (snapshot) => {
            if (cancelled) return;
            remoteResolved = true;
            const exists =
              typeof snapshot?.exists === 'function'
                ? snapshot.exists()
                : snapshot?.exists === true;
            const settings = normalizeGlobal(uid, exists ? snapshot.data() : null);
            emitGlobal(uid, settings);
            mirrorGlobalLocal(uid, settings);
          },
          (error) => {
            console.warn('[notificationPrefs] global subscribe failed', error?.message || String(error));
          }
        );
      } catch (error) {
        console.warn('[notificationPrefs] auth unavailable', error?.message || String(error));
      }
    })();
  }

  return () => {
    cancelled = true;
    try {
      unsubscribeRemote();
    } catch {
      // no-op
    }
    const set = globalListeners.get(uid);
    set?.delete(callback);
    if (set?.size === 0) globalListeners.delete(uid);
  };
}

export async function setPushEnabled(uid, enabledValue) {
  if (!uid || uid === 'anon') throw new Error('Sign in to change notification settings.');
  if (!firebaseEnabled) throw new Error('Notification preferences are unavailable right now.');

  const enabled = enabledValue === true;
  const previous = await readGlobalLocal(uid);
  const next = { ...previous, pushEnabled: enabled, userId: uid, updatedAt: Date.now() };
  emitGlobal(uid, next);
  await mirrorGlobalLocal(uid, next);

  try {
    await ensurePreferenceAuth(uid);
    await settingsDoc(uid).set(
      {
        userId: uid,
        pushEnabled: enabled,
        categories: previous.categories,
        updatedAt: next.updatedAt,
      },
      { merge: true }
    );
    return { settings: next, synced: true };
  } catch (error) {
    emitGlobal(uid, previous);
    await mirrorGlobalLocal(uid, previous);
    throw error;
  }
}

export async function setCategoryEnabled(uid, category, enabledValue) {
  if (!uid || uid === 'anon') throw new Error('Sign in to change notification settings.');
  if (!NOTIFICATION_CATEGORIES.includes(category)) throw new Error('Unknown notification category.');
  if (!firebaseEnabled) throw new Error('Notification preferences are unavailable right now.');

  const enabled = enabledValue === true;
  const previous = await readGlobalLocal(uid);
  const categories = { ...previous.categories, [category]: enabled };
  const next = { ...previous, categories, userId: uid, updatedAt: Date.now() };
  emitGlobal(uid, next);
  await mirrorGlobalLocal(uid, next);

  try {
    await ensurePreferenceAuth(uid);
    await settingsDoc(uid).set(
      {
        userId: uid,
        pushEnabled: previous.pushEnabled !== false,
        categories,
        updatedAt: next.updatedAt,
      },
      { merge: true }
    );
    return { settings: next, synced: true };
  } catch (error) {
    emitGlobal(uid, previous);
    await mirrorGlobalLocal(uid, previous);
    throw error;
  }
}

/**
 * Subscribe to one person's override for the signed-in user.
 */
export function subscribePersonOverride(uid, targetUidValue, callback) {
  const targetUid = String(targetUidValue || '').trim();
  if (!targetUid || typeof callback !== 'function') return () => {};

  const key = overrideStoreKey(uid, targetUid);
  if (!overrideListeners.has(key)) overrideListeners.set(key, new Set());
  overrideListeners.get(key).add(callback);

  let cancelled = false;
  let unsubscribeRemote = () => {};

  const cached = overrideCache.get(key);
  if (cached) callback(cached);
  else callback(normalizeOverride(uid, targetUid, null));

  if (firebaseEnabled && uid && uid !== 'anon') {
    (async () => {
      try {
        await ensurePreferenceAuth(uid);
        if (cancelled) return;
        unsubscribeRemote = overrideDoc(uid, targetUid).onSnapshot(
          (snapshot) => {
            if (cancelled) return;
            const exists =
              typeof snapshot?.exists === 'function'
                ? snapshot.exists()
                : snapshot?.exists === true;
            const override = normalizeOverride(
              uid,
              targetUid,
              exists ? snapshot.data() : null
            );
            override.exists = exists;
            emitOverride(uid, targetUid, override);
          },
          (error) => {
            console.warn('[notificationPrefs] override subscribe failed', error?.message || String(error));
          }
        );
      } catch (error) {
        console.warn('[notificationPrefs] override auth unavailable', error?.message || String(error));
      }
    })();
  }

  return () => {
    cancelled = true;
    try {
      unsubscribeRemote();
    } catch {
      // no-op
    }
    const set = overrideListeners.get(key);
    set?.delete(callback);
    if (set?.size === 0) overrideListeners.delete(key);
  };
}

export async function setPersonOverride(uid, targetUidValue, { mode, categories } = {}) {
  const targetUid = String(targetUidValue || '').trim();
  if (!uid || uid === 'anon') throw new Error('Sign in to change notification settings.');
  if (!targetUid || targetUid === uid) throw new Error('Pick someone else to customize.');
  if (!firebaseEnabled) throw new Error('Notification preferences are unavailable right now.');

  const nextMode =
    mode === 'everything' || mode === 'nothing' || mode === 'custom' ? mode : 'custom';
  const nextCategories = {};
  if (categories && typeof categories === 'object') {
    for (const key of NOTIFICATION_CATEGORIES) {
      if (categories[key] === true) nextCategories[key] = true;
      else if (categories[key] === false) nextCategories[key] = false;
    }
  }

  const payload = {
    userId: uid,
    targetUid,
    mode: nextMode,
    categories: nextCategories,
    updatedAt: Date.now(),
  };

  const optimistic = normalizeOverride(uid, targetUid, payload);
  optimistic.exists = true;
  emitOverride(uid, targetUid, optimistic);

  try {
    await ensurePreferenceAuth(uid);
    await overrideDoc(uid, targetUid).set(payload, { merge: true });
    return { override: optimistic, synced: true };
  } catch (error) {
    throw error;
  }
}

export async function clearPersonOverride(uid, targetUidValue) {
  const targetUid = String(targetUidValue || '').trim();
  if (!uid || uid === 'anon') throw new Error('Sign in to change notification settings.');
  if (!targetUid) throw new Error('Missing person.');
  if (!firebaseEnabled) throw new Error('Notification preferences are unavailable right now.');

  await ensurePreferenceAuth(uid);
  await overrideDoc(uid, targetUid).delete();
  const cleared = normalizeOverride(uid, targetUid, null);
  cleared.exists = false;
  emitOverride(uid, targetUid, cleared);
  return { cleared: true };
}

/**
 * List people the user has customized (for the settings "People" section).
 */
export function subscribePersonOverridesList(uid, callback) {
  if (!uid || uid === 'anon' || typeof callback !== 'function') return () => {};
  if (!firebaseEnabled) {
    callback([]);
    return () => {};
  }

  let cancelled = false;
  let unsubscribe = () => {};

  (async () => {
    try {
      await ensurePreferenceAuth(uid);
      if (cancelled) return;
      unsubscribe = db
        .collection('users')
        .doc(uid)
        .collection(OVERRIDES_SUB)
        .orderBy('updatedAt', 'desc')
        .limit(100)
        .onSnapshot(
          (snap) => {
            if (cancelled) return;
            const rows = (snap?.docs || []).map((doc) =>
              normalizeOverride(uid, doc.id, doc.data())
            );
            callback(rows);
          },
          (error) => {
            console.warn('[notificationPrefs] list subscribe failed', error?.message || String(error));
            callback([]);
          }
        );
    } catch (error) {
      console.warn('[notificationPrefs] list auth unavailable', error?.message || String(error));
      callback([]);
    }
  })();

  return () => {
    cancelled = true;
    try {
      unsubscribe();
    } catch {
      // no-op
    }
  };
}

export default {
  subscribeNotificationSettings,
  setPushEnabled,
  setCategoryEnabled,
  subscribePersonOverride,
  setPersonOverride,
  clearPersonOverride,
  subscribePersonOverridesList,
};
