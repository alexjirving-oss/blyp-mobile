// SafetyGate — mandatory Terms + Community Guidelines + age before upload / go-live.
// Versioned doc ids: bump SAFETY_POLICY_BUNDLE_VERSION when either policy changes.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { db, firebaseEnabled } from '../../config/firebase';
import { snapData } from '../../utils/firestoreSnap';
import { appendSafetyAudit } from './SafetyAuditLog';

/** Bump when ToS and/or Community Guidelines materially change → forces re-accept. */
export const SAFETY_POLICY_BUNDLE_VERSION = 1;

export const TERMS_DOC_ID = 'tos_v1';
export const COMMUNITY_GUIDELINES_DOC_ID = 'community_guidelines_v1';

/** UK Online Safety–sensible floor for broadcasting / uploading mature UGC. */
export const MIN_BROADCAST_AGE = 18;

const localKey = (uid) => `@blyp/safetyGateAccepted/${uid}`;
const localAgeKey = (uid) => `@blyp/ageAssured/${uid}`;

export const SAFETY_POLICY_SUMMARY = {
  termsTitle: 'Terms of Service',
  termsUrl: 'https://blyp.world/terms',
  guidelinesTitle: 'Community Guidelines',
  guidelinesUrl: 'https://blyp.world/terms',
  bullets: [
    'Illegal content and child exploitation are zero-tolerance — accounts are closed.',
    'Harassment, hate, and threats can get you banned.',
    'You must be 18+ to go live or upload content.',
    'Reports are reviewed; we keep an audit trail of safety actions.',
  ],
};

function ageFromBirthYear(birthYear) {
  const y = Number(birthYear);
  if (!Number.isFinite(y) || y < 1920) return null;
  const now = new Date();
  // Conservative: use calendar year only (no exact DOB day).
  return now.getFullYear() - y;
}

function ageFromIsoDob(isoDob) {
  const s = String(isoDob || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dob = new Date(y, mo, d);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const beforeBirthday =
    now.getMonth() < dob.getMonth() ||
    (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate());
  if (beforeBirthday) age -= 1;
  return age;
}

async function getLocalBundle(uid) {
  if (!uid) return 0;
  try {
    return Number((await AsyncStorage.getItem(localKey(uid))) || 0) || 0;
  } catch {
    return 0;
  }
}

async function setLocalBundle(uid, version) {
  if (!uid) return;
  try {
    await AsyncStorage.setItem(localKey(uid), String(version));
  } catch {
    /* non-fatal */
  }
}

async function getLocalAge(uid) {
  if (!uid) return null;
  try {
    const raw = await AsyncStorage.getItem(localAgeKey(uid));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function setLocalAge(uid, payload) {
  if (!uid) return;
  try {
    await AsyncStorage.setItem(localAgeKey(uid), JSON.stringify(payload));
  } catch {
    /* non-fatal */
  }
}

/**
 * @returns {Promise<{
 *   ok: boolean,
 *   needsTerms: boolean,
 *   needsAge: boolean,
 *   underage: boolean,
 *   birthYear: number|null,
 *   age: number|null,
 *   acceptedBundleVersion: number,
 * }>}
 */
export async function evaluateSafetyGate(uid) {
  const empty = {
    ok: false,
    needsTerms: true,
    needsAge: true,
    underage: false,
    birthYear: null,
    age: null,
    acceptedBundleVersion: 0,
  };
  if (!uid) return empty;

  let remote = {};
  if (firebaseEnabled && db?.collection) {
    try {
      const snap = await db.collection('users').doc(uid).get();
      remote = snapData(snap) || {};
    } catch (e) {
      console.warn('[SafetyGate] user read failed; using local', e?.message || String(e));
    }
  }

  const localBundle = await getLocalBundle(uid);
  const remoteBundle = Number(remote.safetyPolicyBundleVersion || 0) || 0;
  const acceptedBundleVersion = Math.max(localBundle, remoteBundle);
  const needsTerms = acceptedBundleVersion < SAFETY_POLICY_BUNDLE_VERSION;

  const localAge = await getLocalAge(uid);
  const birthYear =
    Number(remote.birthYear) ||
    Number(localAge?.birthYear) ||
    null;
  const ageAssuredAt = remote.ageAssuredAt || localAge?.ageAssuredAt || null;
  const isoDob = remote.dateOfBirth || localAge?.dateOfBirth || null;

  let age = ageFromIsoDob(isoDob);
  if (age == null) age = ageFromBirthYear(birthYear);

  const needsAge = !ageAssuredAt || age == null;
  const underage = age != null && age < MIN_BROADCAST_AGE;

  const ok = !needsTerms && !needsAge && !underage;

  return {
    ok,
    needsTerms,
    needsAge,
    underage,
    birthYear: birthYear || null,
    age,
    acceptedBundleVersion,
  };
}

/**
 * Record versioned ToS + Community Guidelines acceptance.
 */
export async function acceptSafetyPolicies(uid, { acceptedTerms, acceptedGuidelines } = {}) {
  if (!uid) return false;
  if (!acceptedTerms || !acceptedGuidelines) {
    throw new Error('You must accept Terms of Service and Community Guidelines');
  }

  const now = Date.now();
  await setLocalBundle(uid, SAFETY_POLICY_BUNDLE_VERSION);

  if (firebaseEnabled && db?.collection) {
    try {
      await db.collection('users').doc(uid).set(
        {
          safetyPolicyBundleVersion: SAFETY_POLICY_BUNDLE_VERSION,
          acceptedTermsDocId: TERMS_DOC_ID,
          acceptedCommunityGuidelinesDocId: COMMUNITY_GUIDELINES_DOC_ID,
          acceptedTermsAt: now,
          acceptedCommunityGuidelinesAt: now,
          // Keep legacy Layer-1 field in sync for How Blyp Works prompts.
          acceptedTermsVersion: Math.max(1, Number(SAFETY_POLICY_BUNDLE_VERSION) || 1),
        },
        { merge: true },
      );
    } catch (e) {
      console.warn('[SafetyGate] accept write failed (kept locally)', e?.message || String(e));
    }
  }

  await appendSafetyAudit({
    action: 'terms_accept',
    targetType: 'user',
    targetId: uid,
    metadata: {
      bundleVersion: SAFETY_POLICY_BUNDLE_VERSION,
      termsDocId: TERMS_DOC_ID,
      guidelinesDocId: COMMUNITY_GUIDELINES_DOC_ID,
    },
  });

  return true;
}

/**
 * Declare age via birth year and/or ISO date of birth (YYYY-MM-DD).
 */
export async function declareAge(uid, { birthYear, dateOfBirth } = {}) {
  if (!uid) return { ok: false, underage: false, age: null };

  let year = birthYear != null ? Number(birthYear) : null;
  const iso = dateOfBirth ? String(dateOfBirth).trim() : null;
  if (iso) {
    const m = /^(\d{4})-/.exec(iso);
    if (m) year = Number(m[1]);
  }
  if (!Number.isFinite(year) || year < 1920 || year > new Date().getFullYear()) {
    throw new Error('Enter a valid birth year');
  }

  const age = iso ? ageFromIsoDob(iso) : ageFromBirthYear(year);
  if (age == null) throw new Error('Could not determine age');

  const now = Date.now();
  const payload = {
    birthYear: year,
    dateOfBirth: iso || null,
    ageAssuredAt: now,
    ageBand: age >= MIN_BROADCAST_AGE ? '18_plus' : 'under_18',
  };
  await setLocalAge(uid, payload);

  if (firebaseEnabled && db?.collection) {
    try {
      await db.collection('users').doc(uid).set(
        {
          birthYear: year,
          ...(iso ? { dateOfBirth: iso } : {}),
          ageAssuredAt: now,
          ageBand: payload.ageBand,
        },
        { merge: true },
      );
    } catch (e) {
      console.warn('[SafetyGate] age write failed (kept locally)', e?.message || String(e));
    }
  }

  await appendSafetyAudit({
    action: 'age_declare',
    targetType: 'user',
    targetId: uid,
    metadata: {
      birthYear: year,
      ageBand: payload.ageBand,
      // Never store exact DOB in audit metadata beyond year.
    },
  });

  return {
    ok: age >= MIN_BROADCAST_AGE,
    underage: age < MIN_BROADCAST_AGE,
    age,
  };
}

/**
 * Convenience: true if user may create/upload/go-live right now.
 */
export async function canCreateOrGoLive(uid) {
  const ev = await evaluateSafetyGate(uid);
  return ev.ok;
}

export default {
  SAFETY_POLICY_BUNDLE_VERSION,
  TERMS_DOC_ID,
  COMMUNITY_GUIDELINES_DOC_ID,
  MIN_BROADCAST_AGE,
  SAFETY_POLICY_SUMMARY,
  evaluateSafetyGate,
  acceptSafetyPolicies,
  declareAge,
  canCreateOrGoLive,
};
