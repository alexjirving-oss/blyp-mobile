// datingService.js
//
// Blyp Dating client — prefs, discovery, like/pass, matches.
// Gated in UI by useHasAI; likes/passes go through Cloud Functions (rate-limited).
// Prefs persist AsyncStorage + Firestore datingPrefs/{uid}.
// Phase 4: bio / prompts / photo refs + Discover filters (age / gender / distance).
// Phase 5: soft birthYear gate for Discover; server rejects unentitled / incomplete prefs.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { db, auth, firebaseEnabled } from '../config/firebase';
import { getBlockedSet, loadBlockedUsers } from './BlockService';
import { isProfileVerified } from './verificationService';

const KEY = (uid) => '@blyp/datingPrefs/' + (uid || 'anon');

const FUNCTIONS_BASE = (
  process.env.EXPO_PUBLIC_FUNCTIONS_BASE_URL || 'https://us-central1-blyp-master.cloudfunctions.net'
).replace(/\/+$/, '');

const LIKE_ENDPOINT = FUNCTIONS_BASE + '/blypDatingLike';
const PASS_ENDPOINT = FUNCTIONS_BASE + '/blypDatingPass';

/** Fixed prompt stems — users fill answers (1–3). */
export const DATING_PROMPT_OPTIONS = [
  { id: 'weekend', question: 'A perfect weekend looks like…' },
  { id: 'looking', question: "I'm looking for someone who…" },
  { id: 'laugh', question: 'You should know I laugh at…' },
  { id: 'green_flag', question: 'My green flag is…' },
  { id: 'sunday', question: 'Sunday mornings are for…' },
  { id: 'blyp', question: 'On Blyp you will find me…' },
];

/** Soft gender labels for dating only — not legal/medical categories. */
export const DATING_GENDER_OPTIONS = [
  { id: 'woman', label: 'Woman' },
  { id: 'man', label: 'Man' },
  { id: 'nonbinary', label: 'Non-binary' },
  { id: 'prefer_not', label: 'Prefer not to say' },
];

export const DISTANCE_OPTIONS_KM = [null, 25, 50, 100, 250];

const BIO_MAX = 280;
const PROMPT_ANSWER_MAX = 120;
const PROMPT_MAX = 3;
const PHOTO_REF_MAX = 3;
const AGE_MIN_FLOOR = 18;
const AGE_MAX_CEIL = 99;

const DEFAULT_PREFS = {
  optedIn: false,
  adultConfirmed: false,
  adultConfirmedAt: 0,
  bio: '',
  prompts: [],
  photoRefs: [],
  useProfilePhoto: true,
  birthYear: null,
  gender: '',
  lookingFor: [],
  ageMin: 18,
  ageMax: 99,
  maxDistanceKm: null,
  geoLat: null,
  geoLon: null,
  geoUpdatedAt: 0,
  updatedAt: 0,
};

const DISCOVERY_LIMIT = 80;

const cache = new Map();

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function clampInt(n, lo, hi, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

function normalizePrompts(raw) {
  if (!Array.isArray(raw)) return [];
  const known = new Set(DATING_PROMPT_OPTIONS.map((p) => p.id));
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const id = typeof item.id === 'string' ? item.id : '';
    const answer = typeof item.answer === 'string' ? item.answer.trim().slice(0, PROMPT_ANSWER_MAX) : '';
    if (!id || !known.has(id) || !answer || seen.has(id)) continue;
    const q =
      DATING_PROMPT_OPTIONS.find((p) => p.id === id)?.question ||
      (typeof item.question === 'string' ? item.question : '');
    seen.add(id);
    out.push({ id, question: q, answer });
    if (out.length >= PROMPT_MAX) break;
  }
  return out;
}

function normalizePhotoRefs(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const u of raw) {
    if (typeof u !== 'string') continue;
    const url = u.trim();
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) continue;
    if (out.includes(url)) continue;
    out.push(url);
    if (out.length >= PHOTO_REF_MAX) break;
  }
  return out;
}

function normalizeLookingFor(raw) {
  if (!Array.isArray(raw)) return [];
  const known = new Set(DATING_GENDER_OPTIONS.map((g) => g.id));
  const out = [];
  for (const id of raw) {
    if (typeof id !== 'string' || !known.has(id) || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

function normalizeGender(raw) {
  const id = typeof raw === 'string' ? raw : '';
  return DATING_GENDER_OPTIONS.some((g) => g.id === id) ? id : '';
}

function normalize(raw) {
  const base = clone(DEFAULT_PREFS);
  if (!raw || typeof raw !== 'object') return base;
  let ageMin = clampInt(raw.ageMin, AGE_MIN_FLOOR, AGE_MAX_CEIL, 18);
  let ageMax = clampInt(raw.ageMax, AGE_MIN_FLOOR, AGE_MAX_CEIL, 99);
  if (ageMin > ageMax) {
    const t = ageMin;
    ageMin = ageMax;
    ageMax = t;
  }
  const birthYearRaw = raw.birthYear;
  let birthYear = null;
  if (birthYearRaw !== null && birthYearRaw !== undefined && birthYearRaw !== '') {
    const y = clampInt(birthYearRaw, 1920, new Date().getFullYear() - AGE_MIN_FLOOR, null);
    birthYear = y;
  }
  let maxDistanceKm = null;
  if (raw.maxDistanceKm !== null && raw.maxDistanceKm !== undefined && raw.maxDistanceKm !== '') {
    const d = Number(raw.maxDistanceKm);
    if (Number.isFinite(d) && d > 0) maxDistanceKm = Math.min(500, Math.round(d));
  }
  const geoLat = Number(raw.geoLat);
  const geoLon = Number(raw.geoLon);
  const hasGeo = Number.isFinite(geoLat) && Number.isFinite(geoLon);

  return {
    optedIn: !!raw.optedIn,
    adultConfirmed: !!raw.adultConfirmed,
    adultConfirmedAt: Number(raw.adultConfirmedAt || 0) || 0,
    bio: typeof raw.bio === 'string' ? raw.bio.slice(0, BIO_MAX) : '',
    prompts: normalizePrompts(raw.prompts),
    photoRefs: normalizePhotoRefs(raw.photoRefs),
    useProfilePhoto: raw.useProfilePhoto !== false,
    birthYear,
    gender: normalizeGender(raw.gender),
    lookingFor: normalizeLookingFor(raw.lookingFor),
    ageMin,
    ageMax,
    maxDistanceKm,
    geoLat: hasGeo ? geoLat : null,
    geoLon: hasGeo ? geoLon : null,
    geoUpdatedAt: Number(raw.geoUpdatedAt || 0) || 0,
    updatedAt: Number(raw.updatedAt || 0) || 0,
  };
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

function ageFromBirthYear(birthYear) {
  if (!birthYear || !Number.isFinite(Number(birthYear))) return null;
  const y = Number(birthYear);
  const now = new Date().getFullYear();
  const age = now - y;
  if (age < AGE_MIN_FLOOR || age > 120) return null;
  return age;
}

/** Soft Discover eligibility: adult + opted-in + self-reported birth year (age ≥ 18). */
export function canParticipateInDiscover(prefs) {
  if (!prefs) return false;
  return !!prefs.adultConfirmed && !!prefs.optedIn && ageFromBirthYear(prefs.birthYear) != null;
}

/** Haversine distance in km. */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function passesFilters(viewerPrefs, candidatePrefs) {
  if (!viewerPrefs) return true;
  const cAge = ageFromBirthYear(candidatePrefs?.birthYear);
  if (cAge != null) {
    if (cAge < (viewerPrefs.ageMin || AGE_MIN_FLOOR)) return false;
    if (cAge > (viewerPrefs.ageMax || AGE_MAX_CEIL)) return false;
  }

  const want = Array.isArray(viewerPrefs.lookingFor) ? viewerPrefs.lookingFor : [];
  if (want.length > 0) {
    const g = candidatePrefs?.gender || '';
    if (g && !want.includes(g)) return false;
  }

  const maxKm = viewerPrefs.maxDistanceKm;
  if (maxKm != null && maxKm > 0) {
    const vLat = viewerPrefs.geoLat;
    const vLon = viewerPrefs.geoLon;
    const cLat = candidatePrefs?.geoLat;
    const cLon = candidatePrefs?.geoLon;
    if (
      Number.isFinite(vLat) &&
      Number.isFinite(vLon) &&
      Number.isFinite(cLat) &&
      Number.isFinite(cLon)
    ) {
      if (haversineKm(vLat, vLon, cLat, cLon) > maxKm) return false;
    }
  }

  return true;
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

/** Toggle discovery opt-in. Refuses if adult not confirmed, birth year missing, or unverified. */
export async function setDatingOptIn(uid, optedIn) {
  const current = await getDatingPrefs(uid);
  if (optedIn && !current.adultConfirmed) {
    throw new Error('Confirm you are 18+ before joining Dating.');
  }
  if (optedIn && ageFromBirthYear(current.birthYear) == null) {
    throw new Error('Add your birth year in Prefs before joining Discover.');
  }
  if (optedIn && firebaseEnabled && db && uid) {
    try {
      const userSnap = await db.collection('users').doc(uid).get();
      const userData =
        (userSnap && (typeof userSnap.data === 'function' ? userSnap.data() : userSnap.data)) || {};
      if (!isProfileVerified(userData)) {
        const err = new Error('Verify your profile before joining Dating.');
        err.code = 'VERIFICATION_REQUIRED';
        throw err;
      }
    } catch (e) {
      if (e?.code === 'VERIFICATION_REQUIRED' || String(e?.message || '').includes('Verify your profile')) {
        throw e;
      }
      console.warn('[dating] verification check failed', e?.message || String(e));
      const err = new Error('Verify your profile before joining Dating.');
      err.code = 'VERIFICATION_REQUIRED';
      throw err;
    }
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
    unavailable = true;
    displayName = 'Unavailable';
  }

  const bio = typeof prefsDoc?.bio === 'string' ? prefsDoc.bio.trim() : '';
  const prompts = normalizePrompts(prefsDoc?.prompts);
  const refs = normalizePhotoRefs(prefsDoc?.photoRefs);
  const useProfile = prefsDoc?.useProfilePhoto !== false;
  const photos = [];
  if (useProfile && photoURL) photos.push(photoURL);
  for (const r of refs) {
    if (!photos.includes(r)) photos.push(r);
    if (photos.length >= PHOTO_REF_MAX) break;
  }
  if (!photos.length && photoURL) photos.push(photoURL);

  const age = ageFromBirthYear(prefsDoc?.birthYear);
  const gender = normalizeGender(prefsDoc?.gender);

  return {
    id: uid,
    displayName,
    username,
    photoURL: photos[0] || photoURL,
    photos,
    bio,
    prompts,
    age,
    gender,
    tagline: unavailable
      ? 'No longer on Blyp'
      : bio || (prompts[0]?.answer ? prompts[0].answer : username ? '@' + username : 'On Blyp Dating'),
    unavailable,
    stub: false,
  };
}

/**
 * Discovery cards: opted-in adults with birthYear, minus self, blocks, already
 * liked/passed, then client filters (age / lookingFor / distance when data exists).
 * Viewer must also clear the soft age gate.
 */
export async function fetchDiscoveryCards(uid) {
  if (!uid || !firebaseEnabled || !db) return [];
  await loadBlockedUsers().catch(() => {});
  const blocked = getBlockedSet();
  const seen = await loadSeenTargetIds(uid);
  const viewerPrefs = await getDatingPrefs(uid);
  if (!canParticipateInDiscover(viewerPrefs)) return [];

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
    const cand = normalize(data);
    if (ageFromBirthYear(cand.birthYear) == null) continue;
    if (!passesFilters(viewerPrefs, cand)) continue;
    candidates.push({ id, data: cand });
  }

  const cards = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        const card = await enrichCard(candidate.id, candidate.data);
        const hasViewerGeo =
          Number.isFinite(viewerPrefs.geoLat) && Number.isFinite(viewerPrefs.geoLon);
        const hasCandidateGeo =
          Number.isFinite(candidate.data.geoLat) && Number.isFinite(candidate.data.geoLon);
        const distanceKm =
          hasViewerGeo && hasCandidateGeo
            ? Math.round(
                haversineKm(
                  viewerPrefs.geoLat,
                  viewerPrefs.geoLon,
                  candidate.data.geoLat,
                  candidate.data.geoLon,
                ),
              )
            : null;
        return { ...card, distanceKm };
      } catch {
        return null;
      }
    }),
  );
  return cards.filter(Boolean);
}

/**
 * Pass via Cloud Function (rate-limited; entitlement + Discover gate enforced server-side).
 * @returns {{ ok:boolean, alreadyPassed?:boolean, code?:string }}
 */
export async function recordPass(uid, toUid) {
  if (!uid || !toUid || uid === toUid) {
    return { ok: false, code: 'invalid_target' };
  }

  const token = await firebaseIdToken();
  if (!token) return { ok: false, code: 'unauthenticated' };

  try {
    const resp = await fetch(PASS_ENDPOINT, {
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
        alreadyPassed: !!data.alreadyPassed,
      };
    }

    const codeByStatus = {
      400: 'invalid_target',
      401: 'unauthenticated',
      402: 'subscription_required',
      403: data?.reason || 'forbidden',
      429: 'rate_limited',
    };
    return {
      ok: false,
      code: data?.reason || codeByStatus[resp.status] || 'error',
      retryAfterSec: Number(data?.retryAfterSec) || undefined,
    };
  } catch (e) {
    return { ok: false, code: 'error', detail: String(e?.message || 'pass-failed') };
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
      429: 'rate_limited',
    };
    return {
      ok: false,
      code: data?.reason || codeByStatus[resp.status] || 'error',
      retryAfterSec: Number(data?.retryAfterSec) || undefined,
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
    let prefsDoc = null;
    try {
      const pSnap = await db.collection('datingPrefs').doc(otherId).get();
      if (snapExists(pSnap)) prefsDoc = normalize(snapData(pSnap));
    } catch {
      /* ignore */
    }
    const card = await enrichCard(otherId, prefsDoc);
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

/**
 * People who liked the current user. Firestore rules only expose likes where
 * the signed-in user is sender or recipient, so this can safely power the
 * existing Plus "Likes you" experience without adding a second write path.
 */
export async function fetchIncomingLikes(uid) {
  if (!uid || !firebaseEnabled || !db) return [];
  await loadBlockedUsers().catch(() => {});
  const blocked = getBlockedSet();
  // A reverse like or pass means this incoming like has already been handled.
  // Keep Likes focused on pending decisions; mutual likes live in Matches.
  const handled = await loadSeenTargetIds(uid);
  const viewerPrefs = await getDatingPrefs(uid);

  let docs = [];
  try {
    const snap = await db
      .collection('datingLikes')
      .where('toUid', '==', uid)
      .limit(50)
      .get();
    docs = snap?.docs || [];
  } catch (e) {
    console.warn('[dating] incoming likes query failed', e?.message || String(e));
    return [];
  }

  const likes = await Promise.all(
    docs.map(async (doc) => {
      const data = typeof doc.data === 'function' ? doc.data() : doc.data;
      const fromUid = typeof data?.fromUid === 'string' ? data.fromUid : '';
      if (!fromUid || fromUid === uid || blocked.has(fromUid) || handled.has(fromUid)) {
        return null;
      }

      try {
        const prefsSnap = await db.collection('datingPrefs').doc(fromUid).get();
        if (!snapExists(prefsSnap)) return null;
        const candidatePrefs = normalize(snapData(prefsSnap));
        if (!canParticipateInDiscover(candidatePrefs)) return null;

        const card = await enrichCard(fromUid, candidatePrefs);
        if (card.unavailable) return null;

        const hasViewerGeo =
          Number.isFinite(viewerPrefs.geoLat) && Number.isFinite(viewerPrefs.geoLon);
        const hasCandidateGeo =
          Number.isFinite(candidatePrefs.geoLat) && Number.isFinite(candidatePrefs.geoLon);
        const distanceKm =
          hasViewerGeo && hasCandidateGeo
            ? Math.round(
                haversineKm(
                  viewerPrefs.geoLat,
                  viewerPrefs.geoLon,
                  candidatePrefs.geoLat,
                  candidatePrefs.geoLon,
                ),
              )
            : null;

        return {
          ...card,
          id: fromUid,
          otherUserId: fromUid,
          likeId: doc.id,
          likedAt: Number(data?.createdAt || 0) || 0,
          distanceKm,
        };
      } catch {
        return null;
      }
    }),
  );

  return likes
    .filter(Boolean)
    .sort((a, b) => (b.likedAt || 0) - (a.likedAt || 0));
}

/** @deprecated Phase 1 stub — kept for any leftover imports. */
export function getStubDiscoveryCards() {
  return [];
}

export { DEFAULT_PREFS, BIO_MAX, PROMPT_MAX, AGE_MIN_FLOOR, AGE_MAX_CEIL };
