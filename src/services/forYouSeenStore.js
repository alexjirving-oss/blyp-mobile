// forYouSeenStore.js
//
// Persist For You impression / head history across sessions so refresh and
// cold reopen do not restart on the same ranked head. Pure client storage —
// no server. Caps keep AsyncStorage payloads small.

import AsyncStorage from '@react-native-async-storage/async-storage';

const MAX_IDS = 200;
const KEY = (uid) => `@blyp/foryou_seen_v1/${uid}`;

/** @type {Map<string, { ids: string[], dirty: boolean, writeTimer: any }>} */
const memory = new Map();

function normalizeIds(raw) {
  const out = [];
  const seen = new Set();
  for (const id of raw || []) {
    const s = id != null ? String(id) : '';
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out.slice(-MAX_IDS);
}

function slot(uid) {
  const key = String(uid || '').trim();
  if (!key) return null;
  let entry = memory.get(key);
  if (!entry) {
    entry = { ids: [], dirty: false, writeTimer: null };
    memory.set(key, entry);
  }
  return entry;
}

async function flush(uid) {
  const entry = slot(uid);
  if (!entry || !entry.dirty) return;
  entry.dirty = false;
  try {
    await AsyncStorage.setItem(KEY(uid), JSON.stringify({ ids: entry.ids }));
  } catch (e) {
    console.warn('[FORYOU_SEEN] persist failed', e?.message || String(e));
  }
}

/**
 * Load persisted seen order into memory (and return it). Safe no-op without uid.
 * @param {string} uid
 * @returns {Promise<string[]>}
 */
export async function loadForYouSeen(uid) {
  const entry = slot(uid);
  if (!entry) return [];
  try {
    const raw = await AsyncStorage.getItem(KEY(uid));
    if (raw) {
      const parsed = JSON.parse(raw);
      entry.ids = normalizeIds(Array.isArray(parsed?.ids) ? parsed.ids : []);
    }
  } catch (e) {
    console.warn('[FORYOU_SEEN] load failed', e?.message || String(e));
  }
  return entry.ids.slice();
}

/** Current in-memory seen order (oldest → newest). */
export function getForYouSeenOrder(uid) {
  const entry = slot(uid);
  return entry ? entry.ids.slice() : [];
}

export function getForYouSeenSet(uid) {
  return new Set(getForYouSeenOrder(uid));
}

/**
 * Append an impression id (deduped; moves prior occurrence to the end).
 * Debounced persist so swipe storms do not thrash AsyncStorage.
 * @param {string} uid
 * @param {string} postId
 */
export function recordForYouSeen(uid, postId) {
  const entry = slot(uid);
  const id = postId != null ? String(postId) : '';
  if (!entry || !id) return;
  const prev = entry.ids.filter((x) => x !== id);
  prev.push(id);
  entry.ids = prev.slice(-MAX_IDS);
  entry.dirty = true;
  if (entry.writeTimer) return;
  entry.writeTimer = setTimeout(() => {
    entry.writeTimer = null;
    flush(uid);
  }, 800);
}

/** Replace order (e.g. after hydrate sync from refs). */
export function replaceForYouSeen(uid, ids) {
  const entry = slot(uid);
  if (!entry) return;
  entry.ids = normalizeIds(ids);
  entry.dirty = true;
  if (entry.writeTimer) clearTimeout(entry.writeTimer);
  entry.writeTimer = setTimeout(() => {
    entry.writeTimer = null;
    flush(uid);
  }, 400);
}

/** Test helper. */
export function resetForYouSeenMemory() {
  for (const entry of memory.values()) {
    if (entry.writeTimer) clearTimeout(entry.writeTimer);
  }
  memory.clear();
}

export default {
  loadForYouSeen,
  getForYouSeenOrder,
  getForYouSeenSet,
  recordForYouSeen,
  replaceForYouSeen,
  resetForYouSeenMemory,
};
