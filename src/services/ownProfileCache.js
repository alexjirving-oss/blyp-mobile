// ownProfileCache.js
//
// Early hydrate + cache for the signed-in user's profile header (avatar,
// displayName/username, stats) so Profile paints immediately instead of
// flashing "User" / zeros for 1–2s. Keyed by uid: in-memory + AsyncStorage.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { db, firebaseEnabled } from '../config/firebase';
import { getFollowersCount, getFollowingCount } from '../utils/followUtils';

const KEY = (uid) => `@blyp/ownProfile/${uid || 'anon'}`;

const memory = new Map(); // uid -> cached payload
const listeners = new Map(); // uid -> Set<fn>
const inflight = new Map(); // uid -> Promise

function clone(v) {
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return v;
  }
}

function notify(uid) {
  const set = listeners.get(uid);
  if (!set) return;
  const payload = memory.get(uid) || null;
  for (const fn of Array.from(set)) {
    try {
      fn(payload ? clone(payload) : null);
    } catch {
      /* ignore */
    }
  }
}

async function persist(uid, payload) {
  try {
    await AsyncStorage.setItem(KEY(uid), JSON.stringify(payload));
  } catch {
    /* best-effort */
  }
}

function normalizeBasics(data) {
  if (!data || typeof data !== 'object') return null;
  return {
    displayName: data.displayName ?? null,
    username: data.username ?? null,
    handle: data.handle ?? null,
    photoURL: data.photoURL || data.avatarUrl || data.avatar || null,
    bio: data.bio ?? '',
    email: data.email ?? null,
    pronouns: data.pronouns ?? null,
    location: data.location ?? data.city ?? null,
    city: data.city ?? null,
    country: data.country ?? null,
    website: data.website ?? null,
    verified: data.verified === true,
    stage: data.stage ?? undefined,
    profileCategories: data.profileCategories ?? undefined,
    profileClubs: data.profileClubs ?? undefined,
    profileBadges: data.profileBadges ?? undefined,
  };
}

function normalizeStats(stats) {
  if (!stats || typeof stats !== 'object') {
    return { followers: 0, following: 0, likes: 0, posts: 0, lives: 0 };
  }
  const n = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  };
  return {
    followers: n(stats.followers),
    following: n(stats.following),
    likes: n(stats.likes),
    posts: n(stats.posts),
    lives: n(stats.lives),
  };
}

/** Sync read of in-memory cache (cold start: null until AsyncStorage hydrate). */
export function getCachedOwnProfile(uid) {
  if (!uid) return null;
  const hit = memory.get(uid);
  return hit ? clone(hit) : null;
}

/** Load AsyncStorage into memory if needed. Does not hit network. */
export async function loadOwnProfileFromStorage(uid) {
  if (!uid) return null;
  if (memory.has(uid)) return clone(memory.get(uid));
  try {
    const raw = await AsyncStorage.getItem(KEY(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const payload = {
      basics: normalizeBasics(parsed.basics || parsed),
      stats: normalizeStats(parsed.stats),
      updatedAt: Number(parsed.updatedAt) || Date.now(),
    };
    if (!payload.basics) return null;
    memory.set(uid, payload);
    notify(uid);
    return clone(payload);
  } catch {
    return null;
  }
}

/** Write / merge cache (memory + AsyncStorage) and notify subscribers. */
export async function setOwnProfileCache(uid, { basics, stats } = {}) {
  if (!uid) return null;
  const prev = memory.get(uid) || {};
  const next = {
    basics: normalizeBasics(basics !== undefined ? basics : prev.basics) || prev.basics || null,
    stats: stats !== undefined ? normalizeStats(stats) : normalizeStats(prev.stats),
    updatedAt: Date.now(),
  };
  if (!next.basics) return null;
  memory.set(uid, next);
  notify(uid);
  await persist(uid, next);
  return clone(next);
}

export function subscribeOwnProfile(uid, fn) {
  if (!uid || typeof fn !== 'function') return () => {};
  let set = listeners.get(uid);
  if (!set) {
    set = new Set();
    listeners.set(uid, set);
  }
  set.add(fn);
  const current = memory.get(uid);
  if (current) {
    try {
      fn(clone(current));
    } catch {
      /* ignore */
    }
  }
  return () => {
    set.delete(fn);
    if (set.size === 0) listeners.delete(uid);
  };
}

export function clearOwnProfileCache(uid) {
  if (uid) {
    memory.delete(uid);
    inflight.delete(uid);
    notify(uid);
    AsyncStorage.removeItem(KEY(uid)).catch(() => {});
    return;
  }
  memory.clear();
  inflight.clear();
  for (const id of Array.from(listeners.keys())) notify(id);
}

async function fetchBasics(uid) {
  if (!firebaseEnabled || !db?.collection || !uid) return null;
  try {
    const snap = await db.collection('users').doc(uid).get();
    const data = typeof snap?.data === 'function' ? snap.data() : snap?.data;
    return normalizeBasics(data || null);
  } catch (e) {
    console.warn('[OWN_PROFILE] basics fetch failed', e?.message || String(e));
    return null;
  }
}

async function countWhere(collectionName, field, value) {
  if (!firebaseEnabled || !db?.collection) return 0;
  try {
    const query = db.collection(collectionName).where(field, '==', value);
    if (typeof query?.count === 'function') {
      try {
        const snap = await query.count().get();
        const data = typeof snap?.data === 'function' ? snap.data() : snap?.data;
        const c = data?.count;
        if (Number.isFinite(Number(c))) return Number(c);
      } catch {
        /* fall through */
      }
    }
    const snap = await query.limit(2000).get();
    return snap?.docs?.length ?? 0;
  } catch {
    return 0;
  }
}

async function fetchStats(uid) {
  const empty = { followers: 0, following: 0, likes: 0, posts: 0, lives: 0 };
  if (!firebaseEnabled || !db?.collection || !uid) return empty;
  try {
    // Prefer the same top-level followers queries ProfileScreen uses, with
    // subcollection counts as a fallback so early paint matches the header.
    const [followersTop, followingTop, postsSnap, livesSnap] = await Promise.all([
      countWhere('followers', 'userId', uid),
      countWhere('followers', 'followerId', uid),
      db.collection('posts').where('userId', '==', uid).limit(500).get().catch(() => null),
      db.collection('liveStreams').where('userId', '==', uid).get().catch(() => null),
    ]);
    let followers = followersTop;
    let following = followingTop;
    if (!followers && !following) {
      followers = await getFollowersCount(uid).catch(() => 0);
      following = await getFollowingCount(uid).catch(() => 0);
    }
    const docs = postsSnap?.docs || [];
    let likes = 0;
    docs.forEach((d) => {
      try {
        const data = typeof d.data === 'function' ? d.data() : d.data;
        likes += Array.isArray(data?.likedBy)
          ? data.likedBy.length
          : Number(data?.likeCount ?? data?.likes ?? 0) || 0;
      } catch {
        /* ignore */
      }
    });
    return {
      followers: Number(followers) || 0,
      following: Number(following) || 0,
      likes,
      posts: docs.length,
      lives: livesSnap?.docs?.length ?? 0,
    };
  } catch (e) {
    console.warn('[OWN_PROFILE] stats fetch failed', e?.message || String(e));
    return empty;
  }
}

/**
 * Prefetch own profile at auth ready. Dedupes concurrent calls per uid.
 * Seeds AsyncStorage first so UI can paint, then refreshes from network.
 */
export async function hydrateOwnProfile(uid) {
  if (!uid) return null;
  if (inflight.has(uid)) return inflight.get(uid);

  const run = (async () => {
    await loadOwnProfileFromStorage(uid);

    const [basics, stats] = await Promise.all([fetchBasics(uid), fetchStats(uid)]);
    if (!basics && !memory.has(uid)) return getCachedOwnProfile(uid);

    return setOwnProfileCache(uid, {
      basics: basics || memory.get(uid)?.basics,
      stats,
    });
  })();

  inflight.set(uid, run);
  try {
    return await run;
  } finally {
    inflight.delete(uid);
  }
}

export default {
  getCachedOwnProfile,
  loadOwnProfileFromStorage,
  setOwnProfileCache,
  subscribeOwnProfile,
  clearOwnProfileCache,
  hydrateOwnProfile,
};
