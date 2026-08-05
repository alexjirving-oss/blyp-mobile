/**
 * Local welcome / “Take the tour” inbox seed.
 *
 * Complements the server outbox (Cloud Function). Survives until the user taps
 * or the tour completes, and merges into Messenger → Notifications.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = (uid) => `@blyp/welcomeTourInbox/${uid || 'anon'}`;

export const LOCAL_WELCOME_TOUR_ID = 'local_welcome_tour';

function emptyItem() {
  return null;
}

export async function getLocalWelcomeTourItem(uid) {
  if (!uid || uid === 'anon') return emptyItem();
  try {
    const raw = await AsyncStorage.getItem(KEY(uid));
    if (!raw) return emptyItem();
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.consumed) return emptyItem();
    return {
      id: LOCAL_WELCOME_TOUR_ID,
      userId: uid,
      type: 'system',
      title: parsed.title || 'Welcome to Blyp',
      body: parsed.body || 'Take a quick tour of Home, Create, Live, Messages, and more.',
      data: { type: 'tour', action: 'start' },
      status: 'sent',
      createdAt: Number(parsed.createdAt) || Date.now(),
      _local: true,
    };
  } catch {
    return emptyItem();
  }
}

/** Idempotent seed after onboarding (or first AppStack mount). */
export async function ensureLocalWelcomeTourItem(uid, { force = false } = {}) {
  if (!uid || uid === 'anon') return emptyItem();
  try {
    const existing = await AsyncStorage.getItem(KEY(uid));
    if (existing && !force) {
      const parsed = JSON.parse(existing);
      if (parsed && !parsed.consumed) {
        return getLocalWelcomeTourItem(uid);
      }
      if (parsed?.consumed && !force) return emptyItem();
    }
    const item = {
      title: 'Welcome to Blyp',
      body: 'Take a quick tour of Home, Create, Live, Messages, and more.',
      createdAt: Date.now(),
      consumed: false,
    };
    await AsyncStorage.setItem(KEY(uid), JSON.stringify(item));
    return getLocalWelcomeTourItem(uid);
  } catch (e) {
    console.warn('[tour] local welcome seed failed', e?.message || e);
    return emptyItem();
  }
}

export async function consumeLocalWelcomeTourItem(uid) {
  if (!uid || uid === 'anon') return;
  try {
    const raw = await AsyncStorage.getItem(KEY(uid));
    const prev = raw ? JSON.parse(raw) : {};
    await AsyncStorage.setItem(
      KEY(uid),
      JSON.stringify({
        ...prev,
        title: prev?.title || 'Welcome to Blyp',
        body: prev?.body || 'Take a quick tour of Home, Create, Live, Messages, and more.',
        createdAt: Number(prev?.createdAt) || Date.now(),
        consumed: true,
        consumedAt: Date.now(),
      })
    );
  } catch {
    /* ignore */
  }
}
