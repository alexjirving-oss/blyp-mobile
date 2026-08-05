// datingService.js
//
// Blyp Dating client — prefs, discovery, like/pass, matches.
// Gated in UI by useHasAI; likes go through blypDatingLike (server match write).
// Prefs persist AsyncStorage + Firestore datingPrefs/{uid}.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { db, auth, firebaseEnabled } from '../config/firebase';
import { getBlockedSet, loadBlockedUsers } from './BlockService';

const KEY = (uid) => '@blyp/datingPrefs/' + (uid || 'anon');

const FUNCTIONS_BASE = (
  process.env.EXPO_PUBLIC_FUNCTIONS_BASE_URL || 'https://us-central1-blyp-master.cloudfunctions.net'
).replace(/\/+$/, '');

const LIKE_ENDPOINT = FUNCTIONS_BASE + '/blypDatingLike';

const DEFAULT_PREFS = {
  optedIn: false,
  adultConfirmed: false,
  adultConfirmedAt: 0,
  bio: '',
  updatedAt: 0,
};

const DISCOVERY_LIMIT = 40;

const cache = new Map();

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function normalize(raw) {
  const base = clone(DEFAULT_PREFS);
  if (!raw || typeof raw !== 'object') return base;
  return {
    optedIn: !!raw.optedIn,
    adultConfirmed: !!raw.adultConfirmed,
    adultConfirmedAt: Number(raw.adultConfirmedAt || 0) || 0,
    bio: typeof raw.bio === 'string' ? raw.bio.slice(0, 280) : '',
    updatedAt: Number(raw.updatedAt || 0) || 0,
  };
}

function pairId(fromUid, toUid) {
  return fromUid + '_' + toUid;
}

function snapExists(snap) {
  if (!snap) return false;
  if (typeof snap.exists === 'function') return !!snap.exists();
  return !!snap.exists;
}

function snapData(snap) {
  if (!snap) return null;
  if (typeof snap.data === 'function') return snap.data() || null;
  return snap.data || null;
}

async function firebaseIdToken() {
  try {
    const user = auth?.currentUser;
    if (user && typeof user.getIdToken === 'function') return await user.getIdToken();
  } catch (e) {
    console.warn('[dating] id token failed', e?.message || String(e));
  }
  return null;
}

/** Load dating prefs for uid (cache → AsyncStorage → Firestore). */
export async function getDatingPrefs(uid) {
  if (!uid) return clone(DEFAULT_PREFS);
  if (cache.has(uid)) return clone(cache.get(uid));

  let prefs = clone(DEFAULT_PREFS);
  try {
    const raw = await AsyncStorage.getItem(KEY(uid));
    if (raw) prefs = normalize(JSON.parse(raw));
  } catch {
    /* ignore */
  }

  if (firebaseEnabled && db) {
    try {
      const snap = await db.collection('datingPrefs').doc(uid).get();
      if (snapExists(snap)) {
        const remote = normalize(snapData(snap));
        if (remote.updatedAt >= prefs.updatedAt) prefs = remote;
      }
    } catch (e) {
      console.warn('[dating] remote read failed', e?.message || String(e));
    }
  }

  cache.set(uid, prefs);
  return clone(prefs);
}

/** Merge + persist dating prefs. */
export async function setDatingPrefs(uid, patch) {
  if (!uid) return clone(DEFAULT_PREFS);
  const current = await getDatingPrefs(uid);
  const next = normalize({
    ...current,
    ...(patch || {}),
    updatedAt: Date.now(),
  });

  cache.set(uid, next);
  try {
    await AsyncStorage.setItem(KEY(uid), JSON.stringify(next));
  } catch {
    /* ignore */
  }

  if (firebaseEnabled && db) {
    try {
      await db.collection('datingPrefs').doc(uid).set(next, { merge: true });
    } catch (e) {
      console.warn('[dating] remote write failed', e?.message || String(e));
    }
  }

  return clone(next);
}

/** Confirm 18+ attestation (required before opt-in). */
export async function confirmAdult(uid) {
  return setDatingPrefs(uid, {
    adultConfirmed: true,
    adultConfirmedAt: Date.now(),
  });
}

/** Toggle discovery opt-in. Refuses if adult not confirmed. */
export async function setDatingOptIn(uid, optedIn) {
  const current = await getDatingPrefs(uid);
  if (optedIn && !current.adultConfirmed) {
    throw new Error('Confirm you are 18+ before joining Dating.');
  }
  return setDatingPrefs(uid, { optedIn: !!optedIn });
}

async function loadSeenTargetIds(uid) {
  const seen = new Set();
  if (!firebaseEnabled || !db || !uid) return seen;
  try {
    const [likesSnap, passesSnap] = await Promise.all([
      db.collection('datingLikes').where('fromUid', '==', uid).limit(200).get(),
      db.collection('datingPasses').where('fromUid', '==', uid).limit(200).get(),
    ]);
    (likesSnap?.docs || []).forEach((d) => {
      const data = typeof d.data === 'function' ? d.data() : d.data;
      if (data?.toUid) seen.add(String(data.toUid));
    });
    (passesSnap?.docs || []).forEach((d) => {
      const data = typeof d.data === 'function' ? d.data() : d.data;
      if (data?.toUid) seen.add(String(data.toUid));
    });
  } catch (e) {
    console.warn('[dating] seen load failed', e?.message || String(e));
  }
  return seen;
}

async function enrichCard(uid, prefsDoc) {
  let displayName = 'Member';
  let photoURL = null;
  let username = '';
  let unavailable = false;
  try {
    const userSnap = await db.collection('users').doc(uid).get();
    if (snapExists(userSnap)) {
      const u = snapData(userSnap) || {};
      displayName =
        (typeof u.displayName === 'string' && u.displayName.trim()) ||
        (typeof u.username === 'string' && u.username.trim()) ||
        displayName;
      username = typeof u.username === 'string' ? u.username.trim() : '';
      photoURL =
        (typeof u.photoURL === 'string' && u.photoURL) ||
        (typeof u.avatar === 'string' && u.avatar) ||
        null;
    } else {
      unavailable = true;
      displayName = 'Unavailable';
    }
  } catch {
    /* profile enrich is best-effort */
    unavailable = true;
    displayName = 'Unavailable';
  }
  const bio = typeof prefsDoc?.bio === 'string' ? prefsDoc.bio.trim() : '';
  return {
    id: uid,
    displayName,
    username,
    photoURL,
    tagline: unavailable
      ? 'No longer on Blyp'
      : bio || (username ? '@' + username : 'On Blyp Dating'),
    unavailable,
    stub: false,
  };
}

/**
 * Discovery cards: opted-in adults minus self, blocks, already liked/passed.
 */
export async function fetchDiscoveryCards(uid) {
  if (!uid || !firebaseEnabled || !db) return [];
  await loadBlockedUsers().catch(() => {});
  const blocked = getBlockedSet();
  const seen = await loadSeenTargetIds(uid);

  let docs = [];
  try {
    const snap = await db
      .collection('datingPrefs')
      .where('optedIn', '==', true)
      .limit(DISCOVERY_LIMIT)
      .get();
    docs = snap?.docs || [];
  } catch (e) {
    console.warn('[dating] discovery query failed', e?.message || String(e));
    return [];
  }

  const candidates = [];
  for (const d of docs) {
    const id = d.id;
    if (!id || id === uid) continue;
    if (blocked.has(id) || seen.has(id)) continue;
    const data = typeof d.data === 'function' ? d.data() : d.data;
    if (!data?.adultConfirmed) continue;
    candidates.push({ id, data });
  }

  const cards = [];
  for (const c of candidates) {
    try {
      cards.push(await enrichCard(c.id, c.data));
    } catch {
      /* skip bad profile */
    }
  }
  return cards;
}

/** Persist a pass (client-owned doc). */
export async function recordPass(uid, toUid) {
  if (!uid || !toUid || uid === toUid) return;
  if (!firebaseEnabled || !db) return;
  try {
    await db.collection('datingPasses').doc(pairId(uid, toUid)).set({
      fromUid: uid,
      toUid,
      createdAt: Date.now(),
    });
  } catch (e) {
    console.warn('[dating] pass write failed', e?.message || String(e));
    throw e;
  }
}

/**
 * Like via Cloud Function (creates mutual datingMatches when reciprocal).
 * @returns {{ ok:boolean, matched?:boolean, matchId?:string|null, code?:string }}
 */
export async function recordLike(uid, toUid) {
  if (!uid || !toUid || uid === toUid) {
    return { ok: false, code: 'invalid_target' };
  }

  const token = await firebaseIdToken();
  if (!token) return { ok: false, code: 'unauthenticated' };

  try {
    const resp = await fetch(LIKE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify({ toUid }),
    });
    const data = await resp.json().catch(() => ({}));

    if (resp.ok && data?.ok) {
      return {
        ok: true,
        matched: !!data.matched,
        matchId: data.matchId || null,
        alreadyLiked: !!data.alreadyLiked,
      };
    }

    const codeByStatus = {
      400: 'invalid_target',
      401: 'unauthenticated',
      402: 'subscription_required',
      403: data?.reason || 'forbidden',
      404: 'target_unavailable',
    };
    return {
      ok: false,
      code: data?.reason || codeByStatus[resp.status] || 'error',
    };
  } catch (e) {
    return { ok: false, code: 'error', detail: String(e?.message || 'like-failed') };
  }
}

/**
 * Matches for the current user (datingMatches where members contains uid).
 */
export async function fetchMatches(uid) {
  if (!uid || !firebaseEnabled || !db) return [];
  await loadBlockedUsers().catch(() => {});
  const blocked = getBlockedSet();

  let docs = [];
  try {
    const snap = await db
      .collection('datingMatches')
      .where('members', 'array-contains', uid)
      .limit(50)
      .get();
    docs = snap?.docs || [];
  } catch (e) {
    console.warn('[dating] matches query failed', e?.message || String(e));
    return [];
  }

  const out = [];
  for (const d of docs) {
    const data = typeof d.data === 'function' ? d.data() : d.data;
    const members = Array.isArray(data?.members) ? data.members : [];
    const otherId = members.find((m) => m !== uid);
    if (!otherId || blocked.has(otherId)) continue;
    const card = await enrichCard(otherId, null);
    out.push({
      matchId: d.id,
      otherUserId: otherId,
      createdAt: Number(data?.createdAt || 0) || 0,
      ...card,
      id: otherId,
    });
  }

  out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return out;
}

/** @deprecated Phase 1 stub — kept for any leftover imports. */
export function getStubDiscoveryCards() {
  return [];
}

export { DEFAULT_PREFS };
