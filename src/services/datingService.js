// datingService.js
//
// Thin client prefs for Blyp Dating (subscription-package surface).
// Opt-in + 18+ attestation only in Phase 0/1 — discovery matching is P2+.
// Persists AsyncStorage with best-effort Firestore mirror under datingPrefs/{uid}.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { db, firebaseEnabled } from '../config/firebase';

const KEY = (uid) => `@blyp/datingPrefs/${uid || 'anon'}`;

const DEFAULT_PREFS = {
  optedIn: false,
  adultConfirmed: false,
  adultConfirmedAt: 0,
  bio: '',
  updatedAt: 0,
};

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
      if (snap.exists) {
        const remote = normalize(snap.data());
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

/**
 * Phase 1 stub candidates — illustrative cards only.
 * Real discovery (opted-in profiles minus blocks) lands in Phase 2.
 */
export function getStubDiscoveryCards() {
  return [
    {
      id: 'stub-alex',
      displayName: 'Alex',
      tagline: 'Into live sports and late-night streams',
      stub: true,
    },
    {
      id: 'stub-jordan',
      displayName: 'Jordan',
      tagline: 'Looking for someone who actually shows up to watch F1',
      stub: true,
    },
    {
      id: 'stub-sam',
      displayName: 'Sam',
      tagline: 'Creator · coffee · no small talk about the algorithm',
      stub: true,
    },
  ];
}

export { DEFAULT_PREFS };
