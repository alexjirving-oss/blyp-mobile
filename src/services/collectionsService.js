// collectionsService.js
//
// Named collections (folders/playlists) for organizing saved posts. Each
// collection references bookmark ids. AsyncStorage-backed with pub/sub and a
// best-effort Firestore mirror for cross-device continuity.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { db, firebaseEnabled } from '../config/firebase';

const KEY = (uid) => `@blyp/collections/${uid || 'anon'}`;

const cache = new Map();
const listeners = new Map();

const canSync = (uid) => firebaseEnabled && !!db?.collection && !!uid && uid !== 'anon';

function emit(uid, list) {
  const set = listeners.get(uid);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(list);
    } catch {
      /* ignore */
    }
  }
}

function genId() {
  return `col_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function normalize(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((c) => c && c.id && typeof c.name === 'string')
    .map((c) => ({
      id: c.id,
      name: c.name,
      createdAt: Number(c.createdAt) || Date.now(),
      postIds: Array.isArray(c.postIds) ? c.postIds.filter(Boolean) : [],
    }));
}

async function persist(uid, list) {
  cache.set(uid, list);
  emit(uid, list);
  try {
    await AsyncStorage.setItem(KEY(uid), JSON.stringify(list));
  } catch (e) {
    console.warn('[COLLECTIONS] save failed', e?.message || String(e));
  }
  if (canSync(uid)) {
    db.collection('users').doc(uid).set({ blyp: { collections: list } }, { merge: true }).catch(() => {});
  }
}

async function hydrateFromRemote(uid) {
  if (!canSync(uid)) return;
  try {
    const snap = await db.collection('users').doc(uid).get();
    const remote = normalize(snap?.data?.()?.blyp?.collections);
    if (remote.length === 0) return;
    const local = cache.get(uid) || [];
    if (local.length === 0) {
      cache.set(uid, remote);
      emit(uid, remote);
      try {
        await AsyncStorage.setItem(KEY(uid), JSON.stringify(remote));
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

export async function getCollections(uid) {
  if (cache.has(uid)) return cache.get(uid);
  try {
    const raw = await AsyncStorage.getItem(KEY(uid));
    const list = normalize(raw ? JSON.parse(raw) : []);
    cache.set(uid, list);
    hydrateFromRemote(uid);
    return list;
  } catch {
    cache.set(uid, []);
    return [];
  }
}

export function subscribeCollections(uid, cb) {
  if (!listeners.has(uid)) listeners.set(uid, new Set());
  listeners.get(uid).add(cb);
  getCollections(uid).then((l) => {
    try {
      cb(l);
    } catch {
      /* ignore */
    }
  });
  return () => {
    const set = listeners.get(uid);
    if (set) set.delete(cb);
  };
}

export async function createCollection(uid, name) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const list = await getCollections(uid);
  const col = { id: genId(), name: clean, createdAt: Date.now(), postIds: [] };
  await persist(uid, [col, ...list]);
  return col;
}

export async function renameCollection(uid, id, name) {
  const clean = String(name || '').trim();
  if (!clean) return;
  const list = await getCollections(uid);
  await persist(uid, list.map((c) => (c.id === id ? { ...c, name: clean } : c)));
}

export async function deleteCollection(uid, id) {
  const list = await getCollections(uid);
  await persist(uid, list.filter((c) => c.id !== id));
}

/** Toggle a post's membership in a collection. Returns the new membership bool. */
export async function toggleInCollection(uid, collectionId, postId) {
  if (!collectionId || !postId) return false;
  const list = await getCollections(uid);
  let nowIn = false;
  const next = list.map((c) => {
    if (c.id !== collectionId) return c;
    const has = c.postIds.includes(postId);
    nowIn = !has;
    return { ...c, postIds: has ? c.postIds.filter((p) => p !== postId) : [postId, ...c.postIds] };
  });
  await persist(uid, next);
  return nowIn;
}

/** Remove a post id from every collection (used when unsaving). */
export async function purgePostId(uid, postId) {
  const list = await getCollections(uid);
  if (!list.some((c) => c.postIds.includes(postId))) return;
  await persist(uid, list.map((c) => ({ ...c, postIds: c.postIds.filter((p) => p !== postId) })));
}

export default {
  getCollections,
  subscribeCollections,
  createCollection,
  renameCollection,
  deleteCollection,
  toggleInCollection,
  purgePostId,
};
