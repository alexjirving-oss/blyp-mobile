import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { firestore as db, auth } from '../config/firebase';
import { getCognitoSub } from './CognitoSession';

/**
 * Queue a privacy lifecycle request (export or deletion).
 * Server/ops process these; client cannot self-delete privileged data under Wave 0 rules.
 */
export async function submitPrivacyRequest(type, notes = '') {
  const requestType = String(type || '').trim().toLowerCase();
  if (requestType !== 'export' && requestType !== 'deletion') {
    throw new Error('INVALID_PRIVACY_REQUEST_TYPE');
  }

  const firebaseUid = auth?.currentUser?.uid || null;
  let cognitoSub = null;
  try {
    cognitoSub = await getCognitoSub();
  } catch {
    cognitoSub = null;
  }

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
