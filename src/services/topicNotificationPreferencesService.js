// Per-user, per-topic notification preferences.
//
// Firestore is authoritative because Cloud Functions must be able to enforce the
// choice before FCM delivery. AsyncStorage is only a fast local mirror.
// Missing documents mean OFF, so every topic is opt-in by default.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { db, firebaseEnabled } from '../config/firebase';

const TOPIC_ID_RE = /^[a-z0-9_-]{1,64}$/;
const cache = new Map();
const listeners = new Map();

const storeKey = (uid, topicId) => `${uid || 'anon'}:${topicId}`;
const storageKey = (uid, topicId) => `@blyp/topicNotifications/${uid || 'anon'}/${topicId}`;

export function normalizeTopicNotificationId(value) {
  const topicId = String(value || '').trim().toLowerCase();
  return TOPIC_ID_RE.test(topicId) ? topicId : '';
}

function emit(uid, topicId, enabled) {
  const key = storeKey(uid, topicId);
  cache.set(key, enabled === true);
  const topicListeners = listeners.get(key);
  if (!topicListeners) return;
  topicListeners.forEach((callback) => {
    try {
      callback(enabled === true);
    } catch {
      // One screen listener must not break the others.
    }
  });
}

async function mirrorLocal(uid, topicId, enabled) {
  try {
    await AsyncStorage.setItem(storageKey(uid, topicId), enabled ? '1' : '0');
  } catch {
    // Firestore remains authoritative; a cache miss is non-fatal.
  }
}

async function readLocal(uid, topicId) {
  const key = storeKey(uid, topicId);
  if (cache.has(key)) return cache.get(key) === true;
  try {
    const stored = await AsyncStorage.getItem(storageKey(uid, topicId));
    const enabled = stored === '1';
    cache.set(key, enabled);
    return enabled;
  } catch {
    cache.set(key, false);
    return false;
  }
}

function topicPreferenceDoc(uid, topicId) {
  return db.collection('users').doc(uid).collection('topicNotifications').doc(topicId);
}

async function ensurePreferenceAuth(uid) {
  const { ensureFirebaseAuthReady } = await import('../utils/firebaseAuthHelper');
  await ensureFirebaseAuthReady({ uid, timeoutMs: 15000 });
}

/**
 * Subscribe to one topic's preference. The local mirror paints immediately,
 * then the Firestore snapshot reconciles it across devices.
 */
export function subscribeTopicNotifications(uid, topicIdValue, callback) {
  const topicId = normalizeTopicNotificationId(topicIdValue);
  if (!topicId || typeof callback !== 'function') return () => {};

  const key = storeKey(uid, topicId);
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(callback);

  let cancelled = false;
  let remoteResolved = false;
  let unsubscribeRemote = () => {};

  readLocal(uid, topicId).then((enabled) => {
    if (!cancelled && !remoteResolved) emit(uid, topicId, enabled);
  });

  if (firebaseEnabled && uid && uid !== 'anon') {
    (async () => {
      try {
        await ensurePreferenceAuth(uid);
        if (cancelled) return;
        unsubscribeRemote = topicPreferenceDoc(uid, topicId).onSnapshot(
          (snapshot) => {
            if (cancelled) return;
            remoteResolved = true;
            const data = snapshot?.data?.() || {};
            const exists =
              typeof snapshot?.exists === 'function'
                ? snapshot.exists()
                : snapshot?.exists === true;
            const enabled = exists && data.enabled === true;
            emit(uid, topicId, enabled);
            mirrorLocal(uid, topicId, enabled);
          },
          (error) => {
            console.warn('[topicNotifications] subscribe failed', error?.message || String(error));
          }
        );
      } catch (error) {
        console.warn('[topicNotifications] auth unavailable', error?.message || String(error));
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
    const topicListeners = listeners.get(key);
    topicListeners?.delete(callback);
    if (topicListeners?.size === 0) listeners.delete(key);
  };
}

/**
 * Persist a topic preference. Throws when the Firestore write cannot be queued,
 * allowing the UI to roll back instead of claiming a backend opt-in that failed.
 */
export async function setTopicNotificationsEnabled(uid, topicIdValue, enabledValue) {
  const topicId = normalizeTopicNotificationId(topicIdValue);
  if (!uid || uid === 'anon') throw new Error('Sign in to change topic notifications.');
  if (!topicId) throw new Error('Invalid notification topic.');
  if (!firebaseEnabled) throw new Error('Notification preferences are unavailable right now.');

  const enabled = enabledValue === true;
  const previous = await readLocal(uid, topicId);
  emit(uid, topicId, enabled);
  await mirrorLocal(uid, topicId, enabled);

  try {
    await ensurePreferenceAuth(uid);
    await topicPreferenceDoc(uid, topicId).set(
      {
        userId: uid,
        topicId,
        enabled,
        updatedAt: Date.now(),
      },
      { merge: true }
    );
    return { enabled, synced: true };
  } catch (error) {
    emit(uid, topicId, previous);
    await mirrorLocal(uid, topicId, previous);
    throw error;
  }
}

export default {
  normalizeTopicNotificationId,
  subscribeTopicNotifications,
  setTopicNotificationsEnabled,
};
