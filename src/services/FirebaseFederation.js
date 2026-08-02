import { signInWithCustomToken } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, firestore as db, firebaseEnabled } from '../config/firebase';
import { getCognitoSessionTokens, isCanonicalCognitoSub } from './CognitoSession';
import { getLiveApiBaseUrl, isLiveApiConfigured } from './liveApiBase';

let inFlight = null;
let lastFederatedSub = null;

/**
 * Exchange Cognito Bearer for a Firebase custom token with uid = Cognito sub,
 * then sign in so Firestore auth.uid matches economy/live identity.
 */
export async function ensureFirebaseFederatedSession(cognitoUser) {
  if (!firebaseEnabled) {
    return { ok: false, reason: 'FIREBASE_DISABLED' };
  }
  if (!isLiveApiConfigured()) {
    return { ok: false, reason: 'LIVE_API_NOT_CONFIGURED' };
  }

  if (inFlight) {
    return inFlight;
  }

  inFlight = (async () => {
    try {
      if (
        lastFederatedSub &&
        auth?.currentUser?.uid === lastFederatedSub &&
        isCanonicalCognitoSub(lastFederatedSub)
      ) {
        return { ok: true, sub: lastFederatedSub, reused: true };
      }

      const { bearerToken, sub } = await getCognitoSessionTokens(cognitoUser);
      if (auth?.currentUser?.uid === sub) {
        lastFederatedSub = sub;
        return { ok: true, sub, reused: true };
      }

      const response = await fetch(`${getLiveApiBaseUrl()}/auth/firebase-token`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          Accept: 'application/json',
        },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload?.detail || payload?.error || 'FIREBASE_TOKEN_FAILED');
        error.code = payload?.code || 'FIREBASE_TOKEN_FAILED';
        error.status = response.status;
        throw error;
      }

      const customToken = String(payload?.customToken || '').trim();
      if (!customToken) {
        throw new Error('FIREBASE_TOKEN_MISSING');
      }

      // Prefer modular web API; native RN Firebase exposes auth().signInWithCustomToken.
      if (typeof signInWithCustomToken === 'function' && auth?.app) {
        await signInWithCustomToken(auth, customToken);
      } else if (typeof auth?.signInWithCustomToken === 'function') {
        await auth.signInWithCustomToken(customToken);
      } else {
        throw new Error('FIREBASE_CUSTOM_TOKEN_UNSUPPORTED');
      }

      if (auth?.currentUser?.uid !== sub) {
        throw new Error('FIREBASE_UID_MISMATCH');
      }

      // Best-effort profile marker so feed/gift UIs can resolve Cognito receivers.
      try {
        await setDoc(
          doc(db, 'users', sub),
          {
            cognitoSub: sub,
            authProvider: 'cognito',
            federatedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      } catch (profileError) {
        console.warn(
          '[FEDERATION] profile marker write failed',
          profileError?.message || profileError,
        );
      }

      lastFederatedSub = sub;
      return { ok: true, sub, reused: false };
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export function getLastFederatedSub() {
  return lastFederatedSub;
}

export function isFederatedFirebaseUser(user = auth?.currentUser) {
  return isCanonicalCognitoSub(user?.uid);
}
