// userPreferencesService.js
//
// Single source of truth for per-user personalization:
//   - interests (topics the user picked at onboarding)
//   - pages (the ordered, show/hide-able set of Home surfaces)
//   - onboarding completion flag
//
// Persisted to AsyncStorage (per uid) with an in-memory cache + a tiny
// pub/sub so screens update live when preferences change. Best-effort: never
// throws to callers.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { db, firebaseEnabled } from '../config/firebase';

const KEY = (uid) => `@blyp/prefs/${uid || 'anon'}`;

export const TOPIC_PREFIX = 'topic:';
export const isTopicPageKey = (key) => typeof key === 'string' && key.startsWith(TOPIC_PREFIX);
export const topicIdFromKey = (key) => (isTopicPageKey(key) ? key.slice(TOPIC_PREFIX.length) : null);

// Topics offered at onboarding. Wide on purpose — "the app for everything".
export const INTEREST_CATALOG = [
  { id: 'football', label: 'Football', icon: 'football' },
  { id: 'f1', label: 'Formula 1', icon: 'flag' },
  { id: 'sport', label: 'Other Sport', icon: 'basketball' },
  { id: 'gaming', label: 'Gaming', icon: 'game-controller' },
  { id: 'music', label: 'Music', icon: 'musical-notes' },
  { id: 'comedy', label: 'Comedy', icon: 'happy' },
  { id: 'cooking', label: 'Food & Cooking', icon: 'restaurant' },
  { id: 'fitness', label: 'Fitness', icon: 'barbell' },
  { id: 'tech', label: 'Tech', icon: 'hardware-chip' },
  { id: 'news', label: 'News', icon: 'newspaper' },
  { id: 'travel', label: 'Travel', icon: 'airplane' },
  { id: 'fashion', label: 'Fashion', icon: 'shirt' },
  { id: 'beauty', label: 'Beauty', icon: 'color-palette' },
  { id: 'cars', label: 'Cars', icon: 'car-sport' },
  { id: 'art', label: 'Art & Design', icon: 'brush' },
  { id: 'science', label: 'Science', icon: 'flask' },
  { id: 'finance', label: 'Money & Crypto', icon: 'cash' },
  { id: 'pets', label: 'Animals & Pets', icon: 'paw' },
  { id: 'dance', label: 'Dance', icon: 'body' },
  { id: 'diy', label: 'DIY & Home', icon: 'hammer' },
  { id: 'movies', label: 'Film & TV', icon: 'film' },
  { id: 'photography', label: 'Photography', icon: 'camera' },
];

// The core Home surfaces. `key` 'A'..'D' map to the existing HomeScreen feed
// tabs so the feed engine keeps working untouched. `home` is the new base.
// `fixed` pages can be reordered but not hidden.
export const DEFAULT_PAGES = [
  { key: 'A', label: 'For You', fixed: true, enabled: true },
  { key: 'home', label: 'Home', fixed: true, enabled: true },
  { key: 'following', label: 'Following', enabled: true },
  { key: 'B', label: "What's Hot", enabled: true },
  { key: 'C', label: 'Categories', enabled: true },
  { key: 'D', label: 'Hashtags', enabled: true },
];

const MAX_RECENT_SEARCHES = 12;

const DEFAULT_PREFS = {
  interests: [],
  pages: DEFAULT_PAGES,
  onboarded: false,
  recentSearches: [],
  lastSeenActivityAt: 0,
  updatedAt: 0,
};

/** Build a topic page descriptor for an interest id. */
export function topicPageForInterest(interest) {
  if (!interest || !interest.id) return null;
  return { key: `${TOPIC_PREFIX}${interest.id}`, label: interest.label, enabled: true, removable: true };
}

const cache = new Map(); // uid -> prefs
const listeners = new Map(); // uid -> Set<fn>

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

// Merge stored pages with the latest DEFAULT_PAGES so newly shipped pages
// appear for existing users, and removed pages drop out.
function reconcilePages(storedPages) {
  if (!Array.isArray(storedPages) || storedPages.length === 0) return clone(DEFAULT_PAGES);
  const byKey = new Map(DEFAULT_PAGES.map((p) => [p.key, p]));
  const seen = new Set();
  const result = [];
  for (const sp of storedPages) {
    if (!sp || !sp.key || seen.has(sp.key)) continue;
    const def = byKey.get(sp.key);
    if (def) {
      seen.add(sp.key);
      result.push({
        key: def.key,
        label: def.label,
        fixed: !!def.fixed,
        enabled: def.fixed ? true : sp.enabled !== false,
      });
    } else if (isTopicPageKey(sp.key) && sp.label) {
      // User-added topic page — preserve it.
      seen.add(sp.key);
      result.push({
        key: sp.key,
        label: sp.label,
        removable: true,
        enabled: sp.enabled !== false,
      });
    }
  }
  // Append any default pages the stored order didn't include yet.
  for (const def of DEFAULT_PAGES) {
    if (!seen.has(def.key)) result.push({ ...def });
  }
  // Keep fixed core tabs in DEFAULT_PAGES order so For You stays first for everyone.
  const defOrder = DEFAULT_PAGES.map((p) => p.key);
  const fixedKeys = new Set(DEFAULT_PAGES.filter((p) => p.fixed).map((p) => p.key));
  const fixed = [];
  const rest = [];
  for (const p of result) {
    if (fixedKeys.has(p.key)) fixed.push(p);
    else rest.push(p);
  }
  fixed.sort((a, b) => defOrder.indexOf(a.key) - defOrder.indexOf(b.key));
  return [...fixed, ...rest];
}

function normalize(raw) {
  const base = clone(DEFAULT_PREFS);
  if (!raw || typeof raw !== 'object') return base;
  return {
    interests: Array.isArray(raw.interests) ? raw.interests : [],
    pages: reconcilePages(raw.pages),
    onboarded: !!raw.onboarded,
    recentSearches: Array.isArray(raw.recentSearches)
      ? raw.recentSearches.filter((s) => typeof s === 'string').slice(0, MAX_RECENT_SEARCHES)
      : [],
    lastSeenActivityAt: Number(raw.lastSeenActivityAt) || 0,
    updatedAt: Number(raw.updatedAt) || 0,
  };
}

function emit(uid, prefs) {
  const set = listeners.get(uid);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(prefs);
    } catch {
      /* ignore listener errors */
    }
  }
}

const canSync = (uid) => firebaseEnabled && !!db?.collection && !!uid && uid !== 'anon';

async function ensureAuthForPrefs(uid) {
  if (!canSync(uid)) return;
  try {
    const { ensureFirebaseAuthReady } = await import('../utils/firebaseAuthHelper');
    await ensureFirebaseAuthReady({ uid, timeoutMs: 15000 });
  } catch (e) {
    console.warn('[PREFS] auth not ready', e?.message || String(e));
  }
}

// Best-effort mirror to Firestore for cross-device sync. Namespaced under a
// `blyp` map so it never collides with the user's profile fields.
async function syncToRemote(uid, prefs) {
  if (!canSync(uid)) return;
  try {
    await ensureAuthForPrefs(uid);
    await db.collection('users').doc(uid).set({ blyp: { prefs } }, { merge: true });
  } catch (e) {
    console.warn('[PREFS] remote sync failed', e?.message || String(e));
  }
}

// Pull remote prefs once and, if newer than local (or remote already completed
// onboarding), adopt + emit to subscribers.
async function hydrateFromRemote(uid) {
  if (!canSync(uid)) return;
  try {
    await ensureAuthForPrefs(uid);
    const snap = await db.collection('users').doc(uid).get();
    const data = snap?.data?.();
    const remote = data?.blyp?.prefs;
    if (!remote) return;
    const local = cache.get(uid) || clone(DEFAULT_PREFS);
    const remoteNorm = normalize(remote);
    // Never demote a completed account: remote onboarded wins even if clocks disagree.
    const shouldAdopt =
      (remoteNorm.updatedAt || 0) > (local.updatedAt || 0) ||
      (remoteNorm.onboarded && !local.onboarded);
    if (shouldAdopt) {
      cache.set(uid, remoteNorm);
      emit(uid, remoteNorm);
      try {
        await AsyncStorage.setItem(KEY(uid), JSON.stringify(remoteNorm));
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    console.warn('[PREFS] hydrate failed', e?.message || String(e));
  }
}

async function persist(uid, prefs) {
  const stamped = { ...prefs, updatedAt: Date.now() };
  cache.set(uid, stamped);
  emit(uid, stamped);
  try {
    await AsyncStorage.setItem(KEY(uid), JSON.stringify(stamped));
  } catch (e) {
    console.warn('[PREFS] save failed', e?.message || String(e));
  }
  syncToRemote(uid, stamped);
  return stamped;
}

export async function getPreferences(uid) {
  if (cache.has(uid)) return cache.get(uid);
  try {
    const raw = await AsyncStorage.getItem(KEY(uid));
    const prefs = normalize(raw ? JSON.parse(raw) : null);
    cache.set(uid, prefs);
    hydrateFromRemote(uid); // fire-and-forget; subscribers get any newer remote
    return prefs;
  } catch (e) {
    console.warn('[PREFS] load failed', e?.message || String(e));
    const prefs = clone(DEFAULT_PREFS);
    cache.set(uid, prefs);
    return prefs;
  }
}

/** Subscribe to live preference changes. Returns an unsubscribe fn. */
export function subscribePreferences(uid, cb) {
  if (!listeners.has(uid)) listeners.set(uid, new Set());
  listeners.get(uid).add(cb);
  // Emit current value immediately (load if needed).
  getPreferences(uid).then((p) => {
    try {
      cb(p);
    } catch {
      /* ignore */
    }
  });
  return () => {
    const set = listeners.get(uid);
    if (set) set.delete(cb);
  };
}

export async function setInterests(uid, interests) {
  const prev = await getPreferences(uid);
  const next = { ...prev, interests: Array.isArray(interests) ? interests : [] };
  return persist(uid, next);
}

export async function setPages(uid, pages) {
  const prev = await getPreferences(uid);
  const next = { ...prev, pages: reconcilePages(pages) };
  return persist(uid, next);
}

/** Append a page (e.g. a topic page) if it isn't already present. */
export async function addPage(uid, page) {
  if (!page || !page.key) return getPreferences(uid);
  const prev = await getPreferences(uid);
  if (prev.pages.some((p) => p.key === page.key)) return prev;
  const next = { ...prev, pages: reconcilePages([...prev.pages, page]) };
  return persist(uid, next);
}

/** Remove a removable (non-default) page by key. */
export async function removePage(uid, key) {
  const prev = await getPreferences(uid);
  const next = { ...prev, pages: reconcilePages(prev.pages.filter((p) => p.key !== key)) };
  return persist(uid, next);
}

export async function completeOnboarding(uid, interests) {
  const prev = await getPreferences(uid);
  const next = {
    ...prev,
    interests: Array.isArray(interests) ? interests : prev.interests,
    onboarded: true,
    updatedAt: Date.now(),
  };
  // Auth must be ready before the Firestore mirror, otherwise reinstall/new
  // device can't see onboarded=true and will restart the whole flow + trial.
  await ensureAuthForPrefs(uid);
  const stamped = await persist(uid, next);
  try {
    await syncToRemote(uid, stamped);
  } catch {
    /* already logged inside syncToRemote */
  }
  return stamped;
}

export async function addRecentSearch(uid, queryText) {
  const q = String(queryText || '').trim();
  if (!q) return null;
  const prev = await getPreferences(uid);
  const existing = (prev.recentSearches || []).filter((s) => s.toLowerCase() !== q.toLowerCase());
  const next = { ...prev, recentSearches: [q, ...existing].slice(0, MAX_RECENT_SEARCHES) };
  return persist(uid, next);
}

export async function clearRecentSearches(uid) {
  const prev = await getPreferences(uid);
  const next = { ...prev, recentSearches: [] };
  return persist(uid, next);
}

/** Mark the activity center as seen up to now (drives the unread badge). */
export async function setActivitySeen(uid) {
  const prev = await getPreferences(uid);
  const next = { ...prev, lastSeenActivityAt: Date.now() };
  return persist(uid, next);
}

export async function isOnboarded(uid) {
  const prefs = await getPreferences(uid);
  if (prefs.onboarded) return true;
  // Local miss (reinstall / cleared storage): wait for Firestore before deciding.
  await hydrateFromRemote(uid);
  const after = cache.get(uid) || prefs;
  if (after.onboarded) return true;

  // Secondary heal: an existing entitlements/{uid} means this account already
  // completed first-run (trial or paid). Skip full onboarding and mirror the flag.
  if (!canSync(uid)) return false;
  try {
    await ensureAuthForPrefs(uid);
    const { snapExists } = await import('../utils/firestoreSnap');
    const snap = await db.collection('entitlements').doc(uid).get();
    if (snapExists(snap)) {
      try {
        await completeOnboarding(uid, after.interests);
      } catch {
        /* still treat as onboarded even if prefs heal fails */
      }
      return true;
    }
  } catch (e) {
    console.warn('[PREFS] entitlement heal check failed', e?.message || String(e));
  }
  return false;
}

export function getEnabledPages(prefs) {
  const pages = (prefs && Array.isArray(prefs.pages) ? prefs.pages : DEFAULT_PAGES).filter(
    (p) => p.enabled !== false
  );
  return pages.length ? pages : DEFAULT_PAGES;
}

export function interestLabels(ids) {
  const byId = new Map(INTEREST_CATALOG.map((i) => [i.id, i.label]));
  return (ids || []).map((id) => byId.get(id)).filter(Boolean);
}

export default {
  INTEREST_CATALOG,
  DEFAULT_PAGES,
  TOPIC_PREFIX,
  isTopicPageKey,
  topicIdFromKey,
  topicPageForInterest,
  getPreferences,
  subscribePreferences,
  setInterests,
  setPages,
  addPage,
  removePage,
  completeOnboarding,
  addRecentSearch,
  clearRecentSearches,
  setActivitySeen,
  isOnboarded,
  getEnabledPages,
  interestLabels,
};
