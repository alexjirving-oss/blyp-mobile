// verificationService.js
//
// Profile verification for Dating eligibility + running a team.
// Public flag: users/{uid}.verified (server-owned via blypVerificationSubmit).
// Status: unverified | pending | verified | rejected.

import { db, auth, firebaseEnabled } from '../config/firebase';

const FUNCTIONS_BASE = (
  process.env.EXPO_PUBLIC_FUNCTIONS_BASE_URL ||
  'https://us-central1-blyp-master.cloudfunctions.net'
).replace(/\/+$/, '');

const SUBMIT_ENDPOINT = FUNCTIONS_BASE + '/blypVerificationSubmit';

export const VERIFICATION_STATUS = {
  UNVERIFIED: 'unverified',
  PENDING: 'pending',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
};

export const ID_DOCUMENT_TYPES = [
  { id: 'passport', label: 'Passport' },
  { id: 'national_id', label: 'National ID' },
  { id: 'drivers_license', label: "Driver's license" },
];

export const EXTERNAL_AUTH_PROVIDERS = [
  { id: 'Google', label: 'Google' },
  { id: 'Apple', label: 'Apple' },
  { id: 'Facebook', label: 'Facebook' },
];

export function normalizeVerificationStatus(raw, verifiedFlag) {
  if (verifiedFlag === true || raw === VERIFICATION_STATUS.VERIFIED) {
    return VERIFICATION_STATUS.VERIFIED;
  }
  const s = String(raw || '').toLowerCase().trim();
  if (s === VERIFICATION_STATUS.PENDING) return VERIFICATION_STATUS.PENDING;
  if (s === VERIFICATION_STATUS.REJECTED) return VERIFICATION_STATUS.REJECTED;
  if (s === VERIFICATION_STATUS.VERIFIED) return VERIFICATION_STATUS.VERIFIED;
  return VERIFICATION_STATUS.UNVERIFIED;
}

export function isProfileVerified(profileOrUser) {
  if (!profileOrUser || typeof profileOrUser !== 'object') return false;
  if (profileOrUser.verified === true || profileOrUser.isVerified === true) return true;
  return normalizeVerificationStatus(profileOrUser.verificationStatus, false) === VERIFICATION_STATUS.VERIFIED;
}

export function verificationStatusLabel(status) {
  switch (normalizeVerificationStatus(status, status === VERIFICATION_STATUS.VERIFIED)) {
    case VERIFICATION_STATUS.VERIFIED:
      return 'Verified';
    case VERIFICATION_STATUS.PENDING:
      return 'Pending review';
    case VERIFICATION_STATUS.REJECTED:
      return 'Needs attention';
    default:
      return 'Not verified';
  }
}

function snapData(snap) {
  if (!snap) return null;
  if (typeof snap.data === 'function') return snap.data() || null;
  return snap.data || null;
}

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
    console.warn('[verification] id token failed', e?.message || String(e));
  }
  return null;
}

/** Cognito Hosted UI / federated identities from the current session JWT. */
export function readCognitoLinkedProviders(cognitoUser) {
  const out = [];
  try {
    const session =
      cognitoUser?.signInUserSession ||
      (typeof cognitoUser?.getSignInUserSession === 'function'
        ? cognitoUser.getSignInUserSession()
        : null) ||
      null;
    const payload = session?.getIdToken?.()?.payload || null;
    const identities = payload?.identities;
    if (Array.isArray(identities)) {
      for (const item of identities) {
        const provider = String(item?.providerName || item?.providerType || '').trim();
        if (provider) out.push(provider);
      }
    }
    // Amplify / Cognito sometimes surface identities under identities claim as JSON string.
    if (!out.length && typeof payload?.identities === 'string') {
      try {
        const parsed = JSON.parse(payload.identities);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            const provider = String(item?.providerName || item?.providerType || '').trim();
            if (provider) out.push(provider);
          }
        }
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    console.warn('[verification] cognito identities read failed', e?.message || String(e));
  }
  return [...new Set(out)];
}

export function listAvailableExternalProviders(cognitoUser) {
  let isSocialAuthEnabled = () => false;
  let isSocialProviderEnabled = () => false;
  try {
    // Lazy import keeps unit tests free of Amplify native polyfills.
    // eslint-disable-next-line global-require
    const social = require('./socialAuthService');
    isSocialAuthEnabled = social.isSocialAuthEnabled || isSocialAuthEnabled;
    isSocialProviderEnabled = social.isSocialProviderEnabled || isSocialProviderEnabled;
  } catch {
    /* optional */
  }
  const linked = readCognitoLinkedProviders(cognitoUser).map((p) => p.toLowerCase());
  return EXTERNAL_AUTH_PROVIDERS.filter((p) => {
    if (!isSocialProviderEnabled(p.id) && !isSocialAuthEnabled()) {
      // Still show if already linked on this session.
      return linked.some((l) => l === p.id.toLowerCase() || l.includes(p.id.toLowerCase()));
    }
    return true;
  }).map((p) => ({
    ...p,
    linked: linked.some((l) => l === p.id.toLowerCase() || l.includes(p.id.toLowerCase())),
    enabled: isSocialProviderEnabled(p.id) || linked.some((l) => l === p.id.toLowerCase()),
  }));
}

/**
 * @param {string} uid
 * @returns {Promise<{ verified: boolean, verificationStatus: string, verificationMethod: string|null, verifiedAt: any, rejectionReason: string|null }>}
 */
export async function fetchVerificationState(uid) {
  const empty = {
    verified: false,
    verificationStatus: VERIFICATION_STATUS.UNVERIFIED,
    verificationMethod: null,
    verifiedAt: null,
    rejectionReason: null,
  };
  if (!uid || !firebaseEnabled || !db?.collection) return empty;
  try {
    const snap = await db.collection('users').doc(uid).get();
    if (!snapExists(snap)) return empty;
    const data = snapData(snap) || {};
    const verificationStatus = normalizeVerificationStatus(data.verificationStatus, data.verified);
    return {
      verified: isProfileVerified(data),
      verificationStatus,
      verificationMethod: data.verificationMethod || null,
      verifiedAt: data.verifiedAt || null,
      rejectionReason: data.verificationRejectionReason || null,
    };
  } catch (e) {
    console.warn('[verification] fetch failed', e?.message || String(e));
    return empty;
  }
}

function trimStr(v, max) {
  return String(v || '').trim().slice(0, max);
}

export function validateIdentityPayload(identity) {
  const legalFullName = trimStr(identity?.legalFullName, 120);
  const dateOfBirth = trimStr(identity?.dateOfBirth, 32);
  const addressLine1 = trimStr(identity?.addressLine1, 160);
  const addressLine2 = trimStr(identity?.addressLine2, 160);
  const city = trimStr(identity?.city, 80);
  const region = trimStr(identity?.region, 80);
  const postalCode = trimStr(identity?.postalCode, 32);
  const country = trimStr(identity?.country, 80);
  const idDocumentType = trimStr(identity?.idDocumentType, 40);
  const idDocumentLast4 = trimStr(identity?.idDocumentLast4, 8).replace(/\s+/g, '');

  const missing = [];
  if (legalFullName.length < 2) missing.push('full legal name');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) missing.push('date of birth (YYYY-MM-DD)');
  if (addressLine1.length < 3) missing.push('street address');
  if (city.length < 2) missing.push('city');
  if (postalCode.length < 2) missing.push('postal / ZIP code');
  if (country.length < 2) missing.push('country');
  if (!ID_DOCUMENT_TYPES.some((t) => t.id === idDocumentType)) missing.push('ID document type');
  if (!/^[A-Za-z0-9]{4}$/.test(idDocumentLast4)) missing.push('last 4 of ID number');

  if (missing.length) {
    return { ok: false, message: `Complete: ${missing.join(', ')}.` };
  }

  // Soft 18+ check from DOB.
  try {
    const [y, m, d] = dateOfBirth.split('-').map((n) => Number(n));
    const dob = new Date(y, (m || 1) - 1, d || 1);
    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    const beforeBirthday =
      now.getMonth() < dob.getMonth() ||
      (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate());
    if (beforeBirthday) age -= 1;
    if (age < 18) {
      return { ok: false, message: 'You must be 18 or older to verify.' };
    }
  } catch {
    return { ok: false, message: 'Enter a valid date of birth (YYYY-MM-DD).' };
  }

  return {
    ok: true,
    identity: {
      legalFullName,
      dateOfBirth,
      addressLine1,
      addressLine2,
      city,
      region,
      postalCode,
      country,
      idDocumentType,
      idDocumentLast4,
    },
  };
}

/**
 * Submit identity KYC or external-auth verification.
 * Server writes users.verified + verificationStatus (clients cannot forge verified).
 *
 * @param {{ method: 'identity'|'external_auth', identity?: object, provider?: string, linkedProviders?: string[] }} payload
 */
export async function submitVerification(payload) {
  const method = payload?.method === 'external_auth' ? 'external_auth' : 'identity';
  const body = { method };

  if (method === 'identity') {
    const validated = validateIdentityPayload(payload?.identity);
    if (!validated.ok) {
      const err = new Error(validated.message);
      err.code = 'INVALID_IDENTITY';
      throw err;
    }
    body.identity = validated.identity;
  } else {
    const provider = trimStr(payload?.provider, 40);
    if (!provider) {
      const err = new Error('Choose an authenticator to link (Google, Apple, or Facebook).');
      err.code = 'INVALID_PROVIDER';
      throw err;
    }
    body.provider = provider;
    body.linkedProviders = Array.isArray(payload?.linkedProviders)
      ? payload.linkedProviders.map((p) => trimStr(p, 40)).filter(Boolean).slice(0, 8)
      : [];
  }

  const token = await firebaseIdToken();
  if (!token) {
    const err = new Error('Sign in again to submit verification.');
    err.code = 'UNAUTHENTICATED';
    throw err;
  }

  const res = await fetch(SUBMIT_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.ok) {
    const reason = json?.reason || `http_${res.status}`;
    const err = new Error(
      json?.message ||
        (reason === 'provider_not_linked'
          ? 'That provider is not linked on this account yet. Sign in with it once, or submit identity info instead.'
          : reason === 'incomplete_identity'
            ? 'Identity details are incomplete.'
            : 'Verification could not be submitted. Please try again.')
    );
    err.code = reason;
    throw err;
  }

  return {
    ok: true,
    verified: !!json.verified,
    verificationStatus: normalizeVerificationStatus(json.verificationStatus, json.verified),
    verificationMethod: json.verificationMethod || method,
  };
}

export default {
  VERIFICATION_STATUS,
  ID_DOCUMENT_TYPES,
  EXTERNAL_AUTH_PROVIDERS,
  normalizeVerificationStatus,
  isProfileVerified,
  verificationStatusLabel,
  fetchVerificationState,
  readCognitoLinkedProviders,
  listAvailableExternalProviders,
  validateIdentityPayload,
  submitVerification,
};
