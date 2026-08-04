import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { firestore as db, auth } from '../config/firebase';

function decodeJwtSub(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const json =
      typeof globalThis.atob === 'function'
        ? globalThis.atob(padded)
        : Buffer.from(padded, 'base64').toString('utf8');
    const payload = JSON.parse(json);
    const sub = String(payload?.sub || '').trim();
    return sub || null;
  } catch {
    return null;
  }
}

async function tryGetCognitoSub() {
  try {
    const { getCognitoJwtForApi } = require('../api/getCognitoJwtForApi');
    const token = await getCognitoJwtForApi();
    return decodeJwtSub(token);
  } catch {
    return null;
  }
}

/**
 * Queue a privacy lifecycle request (export or deletion).
 * Server/ops process these; client cannot self-delete privileged data.
 */
export async function submitPrivacyRequest(type, notes = '') {
  const requestType = String(type || '').trim().toLowerCase();
  if (requestType !== 'export' && requestType !== 'deletion') {
    throw new Error('INVALID_PRIVACY_REQUEST_TYPE');
  }

  const firebaseUid = auth?.currentUser?.uid || null;
  const cognitoSub = await tryGetCognitoSub();
  const userId = cognitoSub || firebaseUid;
  if (!userId) {
    throw new Error('AUTH_REQUIRED');
  }

  const payload = {
    type: requestType,
    userId,
    firebaseUid,
    cognitoSub,
    notes: String(notes || '').slice(0, 500),
    status: 'queued',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    source: 'mobile-app',
  };

  const ref = await addDoc(collection(db, 'privacyRequests'), payload);
  return { id: ref.id, ...payload, createdAt: new Date().toISOString() };
}
