// BlockService.js
//
// User blocking. Required for UGC apps so people can protect themselves from
// abuse without waiting for moderation.
//
// Storage: users/{me}/blocks/{targetUid} = { createdAt }
// A blocked user's content is filtered client-side (feed, DMs, live chat) and the
// block record is the source of truth a future server-side filter can enforce.

import { db, auth } from '../config/firebase';
import { appendSafetyAudit } from './safety/SafetyAuditLog';

const cache = {
  uid: null,
  set: new Set(),
  loaded: false,
};

function meUid() {
  return auth?.currentUser?.uid || null;
}

function blocksCol(uid) {
  return db.collection('users').doc(uid).collection('blocks');
}

/** Block a user. Idempotent. */
export async function blockUser(targetUid) {
  const uid = meUid();
  if (!uid) throw new Error('Sign in to block someone');
  if (!targetUid || targetUid === uid) return;
  await blocksCol(uid).doc(targetUid).set({ createdAt: Date.now() }, { merge: true });
  cache.set.add(targetUid);
  try {
    await appendSafetyAudit({
      action: 'block_user',
      targetType: 'user',
      targetId: targetUid,
      metadata: {},
    });
  } catch { /* non-fatal */ }
}

/** Unblock a user. Idempotent. */
export async function unblockUser(targetUid) {
  const uid = meUid();
  if (!uid || !targetUid) return;
  try {
    await blocksCol(uid).doc(targetUid).delete();
  } catch { /* already gone */ }
  cache.set.delete(targetUid);
}

/** Load the current user's block list into the in-memory cache. */
export async function loadBlockedUsers() {
  const uid = meUid();
  if (!uid) {
    cache.uid = null;
    cache.set = new Set();
    cache.loaded = false;
    return cache.set;
  }
  if (cache.loaded && cache.uid === uid) return cache.set;
  try {
    const snap = await blocksCol(uid).get();
    cache.set = new Set(snap.docs.map((d) => d.id));
    cache.uid = uid;
    cache.loaded = true;
  } catch (e) {
    console.warn('[BlockService] load failed', e?.message);
  }
  return cache.set;
}

/** Synchronous check against the cached block list (call loadBlockedUsers first). */
export function isBlockedCached(targetUid) {
  return !!targetUid && cache.uid === meUid() && cache.set.has(targetUid);
}

/** Get the cached set of blocked uids (may be empty until loaded). */
export function getBlockedSet() {
  return cache.uid === meUid() ? cache.set : new Set();
}

/** Live subscription to the block list. Returns an unsubscribe fn. */
export function subscribeBlockedUsers(callback) {
  const uid = meUid();
  if (!uid) { callback(new Set()); return () => {}; }
  return blocksCol(uid).onSnapshot(
    (snap) => {
      cache.set = new Set(snap.docs.map((d) => d.id));
      cache.uid = uid;
      cache.loaded = true;
      callback(new Set(cache.set));
    },
    (err) => { console.warn('[BlockService] subscribe error', err?.message); callback(new Set()); }
  );
}

/** Filter an array of items, removing any authored by a blocked user. */
// True when a feed item has been hidden by moderation (report auto-action or an
// admin takedown). Cloud Functions set `moderation.hidden = true` on the post;
// the client must not render hidden content in any feed/discovery surface.
function isModerationHidden(it) {
  try {
    return it?.moderation?.hidden === true;
  } catch {
    return false;
  }
}

export function filterBlocked(items, getUid) {
  if (!items?.length) return items || [];
  const blocked = getBlockedSet();
  return items.filter((it) => {
    try {
      if (isModerationHidden(it)) return false;
      if (blocked.size && blocked.has(getUid(it))) return false;
      return true;
    } catch {
      return true;
    }
  });
}

export function clearBlockCache() {
  cache.uid = null;
  cache.set = new Set();
  cache.loaded = false;
}

export default {
  blockUser,
  unblockUser,
  loadBlockedUsers,
  isBlockedCached,
  getBlockedSet,
  subscribeBlockedUsers,
  filterBlocked,
  clearBlockCache,
};
