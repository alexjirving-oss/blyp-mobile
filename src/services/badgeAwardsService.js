// badgeAwardsService.js
//
// Clubs Phase 3 — client helpers for server-minted badges.
// Reads badgeAwards/{uid}/items; syncs via blypSyncBadgeAwards.
// Never writes award docs from the client.

import { db, auth, firebaseEnabled } from '../config/firebase';
import {
  normalizeEarnedBadgeIds,
  isServerEarnedBadge,
} from './profileIdentityCatalog';

const FUNCTIONS_BASE = (
  process.env.EXPO_PUBLIC_FUNCTIONS_BASE_URL ||
  'https://us-central1-blyp-master.cloudfunctions.net'
).replace(/\/+$/, '');

const SYNC_ENDPOINT = FUNCTIONS_BASE + '/blypSyncBadgeAwards';

function snapExists(snap) {
  if (!snap) return false;
  if (typeof snap.exists === 'function') return !!snap.exists();
  return !!snap.exists;
}

async function firebaseIdToken() {
  try {
    const user = auth?.currentUser;
    if (user && typeof user.getIdToken === 'function') return await user.getIdToken();
  } catch (e) {
    console.warn('[badges] id token failed', e?.message || String(e));
  }
  return null;
}

/**
 * Load earned badge ids from award subcollection (+ optional users denorm).
 * @param {string} uid
 * @returns {Promise<string[]>}
 */
export async function fetchEarnedBadgeIds(uid) {
  if (!uid || !firebaseEnabled || !db?.collection) return [];
  const fromAwards = [];
  try {
    const snap = await db.collection('badgeAwards').doc(uid).collection('items').get();
    for (const d of snap?.docs || []) {
      const id = d.id || d.data()?.badgeId;
      if (id && isServerEarnedBadge(id)) fromAwards.push(String(id));
    }
  } catch (e) {
    console.warn('[badges] awards read failed', e?.message || String(e));
  }

  let fromUser = [];
  try {
    const userSnap = await db.collection('users').doc(uid).get();
    if (snapExists(userSnap)) {
      const data = typeof userSnap.data === 'function' ? userSnap.data() : null;
      fromUser = normalizeEarnedBadgeIds(data?.earnedBadgeIds);
    }
  } catch (e) {
    console.warn('[badges] user earnedBadgeIds read failed', e?.message || String(e));
  }

  return normalizeEarnedBadgeIds([...fromAwards, ...fromUser]);
}

/**
 * Ask the server to evaluate + mint eligible awards, then return earned ids.
 * Falls back to a local read if the endpoint is unreachable.
 * @returns {Promise<{ ok: boolean, awarded: string[], earned: string[] }>}
 */
export async function syncBadgeAwards() {
  const token = await firebaseIdToken();
  if (!token) {
    return { ok: false, awarded: [], earned: [] };
  }
  try {
    const res = await fetch(SYNC_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: '{}',
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok) {
      console.warn('[badges] sync failed', res.status, json?.reason || '');
      const uid = auth?.currentUser?.uid;
      const earned = uid ? await fetchEarnedBadgeIds(uid) : [];
      return { ok: false, awarded: [], earned };
    }
    return {
      ok: true,
      awarded: normalizeEarnedBadgeIds(json.awarded),
      earned: normalizeEarnedBadgeIds(json.earned),
    };
  } catch (e) {
    console.warn('[badges] sync network error', e?.message || String(e));
    const uid = auth?.currentUser?.uid;
    const earned = uid ? await fetchEarnedBadgeIds(uid) : [];
    return { ok: false, awarded: [], earned };
  }
}
