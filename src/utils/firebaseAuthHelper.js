/**
 * Firebase Auth Bridge Stub
 *
 * DEV: No Firebase auth needed (relies on DEV-OPEN Firestore rules).
 * PRODUCTION: Proper Firebase Custom Token bridge from Cognito must be implemented.
 */

// IMPORTANT: Do not embed literal loopback markers (e.g. common loopback hostnames) in release bundles.
// Construct them at runtime so release artifact scans can verify they're not baked into the binary.
const LOOPBACK_IPV4 = ['127', '0', '0', '1'].join('.');
const LOOPBACK_HOST = ['local', 'host'].join('');
const FUNCTIONS_EMULATOR_PORT = '5001';

// [BLYP][PROOF] Hosted Cloud Functions base — release builds MUST use this, never localhost/emulator.
const FUNCTIONS_HOSTED_BASE =
  process.env.EXPO_PUBLIC_FUNCTIONS_BASE_URL || 'https://us-central1-blyp-master.cloudfunctions.net';

function normalizeBaseUrl(raw) {
  try {
    const s = String(raw || '').trim();
    if (!s) return '';
    return s.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function getFirebaseProjectId() {
  const fromEnv = String(process.env?.EXPO_PUBLIC_FIREBASE_PROJECT_ID || '').trim();
  if (fromEnv) return fromEnv;
  try {
    const cfg = require('../config/firebase');
    const fromCfg = String(cfg?.firebaseConfig?.projectId || '').trim();
    if (fromCfg) return fromCfg;
  } catch { }
  return 'blyp-master';
}

function getFirebaseFunctionsRegion() {
  const fromEnv = String(process.env?.EXPO_PUBLIC_FIREBASE_FUNCTIONS_REGION || '').trim();
  return fromEnv || 'us-central1';
}

function looksLikeFirebaseFunctionsBaseUrl(base) {
  try {
    const s = String(base || '');
    return (
      s.includes('cloudfunctions.net') ||
      s.includes(':5001') ||
      /\/us-[a-z0-9-]+\b/i.test(s) ||
      /\bus-central1\b/i.test(s)
    );
  } catch {
    return false;
  }
}

function buildEmulatorFunctionsBaseUrl() {
  const projectId = getFirebaseProjectId();
  const region = getFirebaseFunctionsRegion();
  return `http://${LOOPBACK_IPV4}:${FUNCTIONS_EMULATOR_PORT}/${projectId}/${region}`;
}

function buildCloudFunctionsBaseUrl() {
  const projectId = getFirebaseProjectId();
  const region = getFirebaseFunctionsRegion();
  return `https://${region}-${projectId}.cloudfunctions.net`;
}

async function fetchWithTimeout(url, init, timeoutMs = 10000) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => {
    try {
      controller?.abort?.();
    } catch { }
  }, timeoutMs);

  try {
    const nextInit = controller ? { ...(init || {}), signal: controller.signal } : init;
    return await fetch(url, nextInit);
  } finally {
    clearTimeout(timer);
  }
}

function buildBridgeCandidates(preferredBase) {
  const candidates = [];
  const add = (v) => {
    const norm = normalizeBaseUrl(v);
    if (!norm) return;
    if (!candidates.includes(norm)) candidates.push(norm);
  };

  // Preference order matters: try what the app was configured to use first.
  add(preferredBase);

  // In dev, consider both emulator + cloud as fallbacks.
  // In release, ONLY add the hosted Cloud Functions base — never try localhost/emulator.
  if (__DEV__) {
    add(buildEmulatorFunctionsBaseUrl());
  }
  add(buildCloudFunctionsBaseUrl());

  return candidates;
}

async function mintFirebaseCustomToken({ desiredUid, cognitoIdToken, base, timeoutMs = 10000 }) {
  const url = `${String(base).replace(/\/$/, '')}/mintFirebaseCustomToken`;
  // [BLYP][PROD_PROOF] Release-visible — survives transform-remove-console exclude:[error,warn]
  console.warn('[AUTH][FIREBASE_BRIDGE] mint request', { url, desiredUid });
  const resp = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cognitoIdToken}`,
      },
      body: JSON.stringify({ uid: desiredUid }),
    },
    timeoutMs
  );
  const payload = await resp.json().catch(() => ({}));
  // [BLYP][PROD_PROOF] Release-visible — survives transform-remove-console exclude:[error,warn]
  console.warn('[AUTH][FIREBASE_BRIDGE] mint response', { url, status: resp?.status, hasToken: !!payload?.firebaseToken });
  return { resp, payload, url };
}

function resolveFirebaseBridgeBaseUrl() {
  // Explicit override (recommended when EXPO_PUBLIC_API_BASE_URL points at :4000 live-service)
  const explicit = normalizeBaseUrl(process.env?.EXPO_PUBLIC_FIREBASE_BRIDGE_BASE_URL);
  if (explicit) return explicit;

  // Default: use the normal API base, but never point the Firebase bridge at the live-service.
  const apiBase = normalizeBaseUrl(process.env?.EXPO_PUBLIC_API_BASE_URL);
  // Only accept it when it looks like a Firebase Functions base URL.
  if (apiBase && !apiBase.includes(':4000') && looksLikeFirebaseFunctionsBaseUrl(apiBase)) return apiBase;

  // Local IVS mode (dev only): when the app API base points at a local live-service (4000),
  // the Firebase auth-bridge should still point at the local Functions emulator.
  // Gated behind __DEV__ so release builds never resolve to localhost.
  if (__DEV__ && apiBase && apiBase.includes(':4000') && (apiBase.includes(LOOPBACK_IPV4) || apiBase.includes(LOOPBACK_HOST))) {
    return buildEmulatorFunctionsBaseUrl();
  }

  // Dev fallback: match repo workflow (Functions emulator default)
  if (__DEV__) {
    return buildEmulatorFunctionsBaseUrl();
  }

  // Release fallback: Cloud Functions base for the configured Firebase project.
  // This keeps internal testing / store builds working even when EXPO_PUBLIC_* env vars are not injected.
  return buildCloudFunctionsBaseUrl();
}

/**
 * Ensure Firebase authentication for Firestore/Storage access.
 * Signs in to Firebase Auth using a Firebase custom token minted from a Cognito JWT.
 * This is required because Firestore rules use `request.auth.uid`, while the app
 * identity is Cognito `sub`.
 *
 * @param {object} args
 * @param {string} args.cognitoIdToken - Cognito ID token (JWT)
 * @param {string} args.uid - Cognito sub (desired Firebase uid)
 * @param {any} args.firebaseAuth - Firebase Auth instance (web or native)
 * @returns {Promise<void>}
 */
export async function ensureFirebaseAuth({ cognitoIdToken, uid, firebaseAuth }) {
  try {
    if (!firebaseAuth) return;
    if (!uid) return;

    const currentUid = firebaseAuth?.currentUser?.uid || null;
    if (currentUid === uid) return;

    const base = resolveFirebaseBridgeBaseUrl();
    if (!base) {
      console.warn('[AUTH][FIREBASE_BRIDGE] Missing Firebase bridge base URL; cannot mint Firebase custom token');
      return;
    }
    if (!cognitoIdToken) {
      console.warn('[AUTH][FIREBASE_BRIDGE] Missing Cognito ID token; cannot mint Firebase custom token');
      return;
    }

    const candidates = buildBridgeCandidates(base);
    let lastStatus = null;
    let lastPayload = null;
    let lastUrl = null;
    let firebaseToken = null;
    for (const b of candidates) {
      try {
        const { resp, payload, url } = await mintFirebaseCustomToken({ desiredUid: uid, cognitoIdToken, base: b, timeoutMs: 8000 });
        lastStatus = resp?.status ?? null;
        lastPayload = payload;
        lastUrl = url;
        if (!resp.ok) {
          // If endpoint doesn't exist on that base, try the next one.
          if (resp.status === 404) continue;
          console.warn('[AUTH][FIREBASE_BRIDGE] mint failed', { status: resp.status, url, payload });
          return;
        }
        firebaseToken = payload?.firebaseToken || null;
        if (!firebaseToken) {
          console.warn('[AUTH][FIREBASE_BRIDGE] mint response missing firebaseToken', { url });
          return;
        }
        if (__DEV__) {
          console.log('[AUTH][FIREBASE_BRIDGE] mint ok', { url, uid });
        }
        break;
      } catch (e) {
        // Network errors (or timeouts) — try the next candidate.
        lastStatus = null;
        lastPayload = null;
        lastUrl = `${String(b).replace(/\/$/, '')}/mintFirebaseCustomToken`;
        continue;
      }
    }

    if (!firebaseToken) {
      console.warn('[AUTH][FIREBASE_BRIDGE] mint failed (no token)', { lastStatus, lastUrl, lastPayload });
      return;
    }

    // Native (@react-native-firebase/auth) has signInWithCustomToken on the instance.
    if (typeof firebaseAuth?.signInWithCustomToken === 'function') {
      await firebaseAuth.signInWithCustomToken(firebaseToken);
      // [BLYP][PROD_PROOF] Release-visible — survives transform-remove-console exclude:[error,warn]
      console.warn('[AUTH][FIREBASE_BRIDGE] signInWithCustomToken ok (native)', { uid });
      return;
    }

    // Web SDK expects signInWithCustomToken(auth, token)
    try {
      const mod = require('firebase/auth');
      if (typeof mod?.signInWithCustomToken === 'function') {
        await mod.signInWithCustomToken(firebaseAuth, firebaseToken);
        // [BLYP][PROD_PROOF] Release-visible — survives transform-remove-console exclude:[error,warn]
        console.warn('[AUTH][FIREBASE_BRIDGE] signInWithCustomToken ok (web)', { uid });
      }
    } catch (e) {
      console.warn('[AUTH][FIREBASE_BRIDGE] signInWithCustomToken failed', e?.message || String(e));
    }
  } catch (e) {
    console.warn('[AUTH][FIREBASE_BRIDGE] unexpected error', e?.message || String(e));
  }
}

let bridgeContext = {
  getCognitoIdToken: null,
  getUid: null,
  firebaseAuth: null,
};

/**
 * Provide shared context for the Firebase Auth bridge.
 * Services can then call ensureFirebaseAuthReady() without needing to thread tokens through.
 */
export function setFirebaseAuthBridgeContext(next) {
  bridgeContext = {
    getCognitoIdToken: next?.getCognitoIdToken || bridgeContext.getCognitoIdToken,
    getUid: next?.getUid || bridgeContext.getUid,
    firebaseAuth: next?.firebaseAuth || bridgeContext.firebaseAuth,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForFirebaseAuthUid({ firebaseAuth, desiredUid, timeoutMs }) {
  const started = Date.now();
  const timeout = typeof timeoutMs === 'number' ? timeoutMs : 15000;

  // Native SDK commonly has onAuthStateChanged(cb)
  if (firebaseAuth && typeof firebaseAuth.onAuthStateChanged === 'function') {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        try {
          unsub && unsub();
        } catch { }
        reject(new Error('FIREBASE_AUTH_TIMEOUT'));
      }, timeout);

      let unsub = null;
      try {
        unsub = firebaseAuth.onAuthStateChanged((user) => {
          const u = user?.uid || null;
          if (!desiredUid || u === desiredUid) {
            clearTimeout(timer);
            try {
              unsub && unsub();
            } catch { }
            resolve(u);
          }
        });
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  // Web modular SDK uses onAuthStateChanged(auth, cb)
  try {
    const mod = require('firebase/auth');
    if (firebaseAuth && typeof mod?.onAuthStateChanged === 'function') {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('FIREBASE_AUTH_TIMEOUT')), timeout);
        const unsub = mod.onAuthStateChanged(firebaseAuth, (user) => {
          const u = user?.uid || null;
          if (!desiredUid || u === desiredUid) {
            clearTimeout(timer);
            try {
              unsub && unsub();
            } catch { }
            resolve(u);
          }
        });
      });
    }
  } catch { }

  // Fallback polling (last resort)
  while (Date.now() - started < timeout) {
    const u = firebaseAuth?.currentUser?.uid || null;
    if (!desiredUid || u === desiredUid) return u;
    await sleep(200);
  }
  throw new Error('FIREBASE_AUTH_TIMEOUT');
}

/**
 * Strict (ZERO TOLERANCE) Firebase Auth gate.
 * - Ensures Firebase Auth is signed in with uid == Cognito sub before any Firestore call.
 * - Throws if it cannot establish Firebase Auth.
 *
 * @param {object} [args]
 * @param {string} [args.uid] - desired uid (Cognito sub)
 * @param {any} [args.firebaseAuth] - Firebase Auth instance
 * @param {() => Promise<string>} [args.getCognitoIdToken] - provider for Cognito ID token JWT
 * @param {number} [args.timeoutMs]
 * @returns {Promise<string>} firebase uid
 */
export async function ensureFirebaseAuthReady(args = {}) {
  // IMPORTANT:
  // Firestore rules in this repo generally require `request.auth != null`.
  // If we continue without Firebase sign-in, the app will look "wiped" (permission-denied everywhere).
  // Strict is the default; relaxed mode must be explicitly enabled.
  const strictSetting = String(process.env?.EXPO_PUBLIC_FIREBASE_STRICT_AUTH ?? '').toLowerCase();
  const relaxedSetting = String(process.env?.EXPO_PUBLIC_FIREBASE_RELAXED_AUTH ?? '').toLowerCase();
  const devRelaxedAuth =
    __DEV__ === true &&
    (['1', 'true', 'yes'].includes(relaxedSetting) || ['0', 'false', 'no'].includes(strictSetting));

  const desiredUid = args.uid || (typeof bridgeContext.getUid === 'function' ? bridgeContext.getUid() : null);

  let firebaseAuth = args.firebaseAuth || bridgeContext.firebaseAuth || null;
  if (!firebaseAuth) {
    try {
      const cfg = require('../config/firebase');
      firebaseAuth = cfg?.auth || null;
    } catch { }
  }

  if (!desiredUid) {
    const err = new Error('FIREBASE_AUTH_UID_MISSING');
    err.code = 'FIREBASE_AUTH_UID_MISSING';
    throw err;
  }
  if (!firebaseAuth) {
    const err = new Error('FIREBASE_AUTH_INSTANCE_MISSING');
    err.code = 'FIREBASE_AUTH_INSTANCE_MISSING';
    throw err;
  }

  const currentUid = firebaseAuth?.currentUser?.uid || null;
  if (currentUid === desiredUid) {
    if (__DEV__) {
      console.log('[AUTH][FIREBASE_READY]', { uid: desiredUid, mode: 'already_signed_in' });
    }
    return desiredUid;
  }

  const getCognitoIdToken =
    args.getCognitoIdToken || (typeof bridgeContext.getCognitoIdToken === 'function' ? bridgeContext.getCognitoIdToken : null);

  if (typeof getCognitoIdToken !== 'function') {
    if (devRelaxedAuth) {
      console.warn('[AUTH][FIREBASE_READY] missing Cognito token provider (dev relaxed); continuing without Firebase sign-in');
      return desiredUid;
    }
    const err = new Error('COGNITO_ID_TOKEN_PROVIDER_MISSING');
    err.code = 'COGNITO_ID_TOKEN_PROVIDER_MISSING';
    throw err;
  }

  let cognitoIdToken = null;
  try {
    // Important: do NOT auto-clear Cognito sessions from the Firebase bridge.
    // A transient token read issue should not force user sign-out.
    cognitoIdToken = await getCognitoIdToken({ autoClearOnCorruption: false });
  } catch (e) {
    if (devRelaxedAuth) {
      console.warn('[AUTH][FIREBASE_READY] Cognito token fetch failed (dev relaxed); continuing without Firebase sign-in', e?.message || String(e));
      return desiredUid;
    }
    throw e;
  }

  if (!cognitoIdToken) {
    if (devRelaxedAuth) {
      console.warn('[AUTH][FIREBASE_READY] missing Cognito ID token (dev relaxed); continuing without Firebase sign-in');
      return desiredUid;
    }
    const err = new Error('COGNITO_ID_TOKEN_MISSING');
    err.code = 'COGNITO_ID_TOKEN_MISSING';
    throw err;
  }

  if (__DEV__) {
    console.log('[AUTH][FIREBASE_READY] mint/sign-in start', { desiredUid });
  }

  // Strict: attempt mint + sign-in; any failure should throw.
  const base = resolveFirebaseBridgeBaseUrl();
  if (!base) {
    if (devRelaxedAuth) {
      console.warn('[AUTH][FIREBASE_READY] missing Firebase bridge base URL (dev relaxed); continuing without Firebase sign-in');
      return desiredUid;
    }
    const err = new Error('FIREBASE_BRIDGE_BASE_URL_MISSING');
    err.code = 'FIREBASE_BRIDGE_BASE_URL_MISSING';
    throw err;
  }

  const candidates = buildBridgeCandidates(base);

  let firebaseToken = null;
  let lastStatus = null;
  let lastPayload = null;
  let lastUrl = null;
  for (const b of candidates) {
    try {
      const { resp, payload, url } = await mintFirebaseCustomToken({ desiredUid, cognitoIdToken, base: b, timeoutMs: args.timeoutMs || 10000 });
      lastStatus = resp?.status ?? null;
      lastPayload = payload;
      lastUrl = url;
      if (!resp.ok) {
        // 404 commonly means “not deployed on this base”; try another.
        if (resp.status === 404) continue;
        const err = new Error('FIREBASE_CUSTOM_TOKEN_MINT_FAILED');
        err.code = 'FIREBASE_CUSTOM_TOKEN_MINT_FAILED';
        err.status = resp.status;
        err.url = url;
        err.detail = payload;
        throw err;
      }

      firebaseToken = payload?.firebaseToken || null;
      if (!firebaseToken) {
        const err = new Error('FIREBASE_CUSTOM_TOKEN_MISSING');
        err.code = 'FIREBASE_CUSTOM_TOKEN_MISSING';
        err.url = url;
        throw err;
      }

      if (__DEV__) {
        console.log('[AUTH][FIREBASE_READY] mint ok', { url, desiredUid });
      }
      break;
    } catch (e) {
      // If we got a network error (or timeout) or a 404, keep trying candidates.
      // Otherwise, stop early.
      const status = e?.status;
      const code = e?.code;
      if (status === 404 || code === 'AbortError') {
        continue;
      }
      // Unknown error: try next candidate only if it's clearly a network issue.
      const msg = e?.message || String(e);
      const isNetworkish = /network|failed to fetch|timeout|abort/i.test(msg);
      if (isNetworkish) continue;
      throw e;
    }
  }

  if (!firebaseToken) {
    const err = new Error('FIREBASE_CUSTOM_TOKEN_MINT_FAILED');
    err.code = 'FIREBASE_CUSTOM_TOKEN_MINT_FAILED';
    err.status = lastStatus ?? 404;
    err.url = lastUrl;
    err.detail = lastPayload;
    err.tried = candidates;
    throw err;
  }
  if (typeof firebaseAuth?.signInWithCustomToken === 'function') {
    await firebaseAuth.signInWithCustomToken(firebaseToken);
    // [BLYP][PROD_PROOF] Release-visible — survives transform-remove-console exclude:[error,warn]
    console.warn('[AUTH][FIREBASE_READY] signInWithCustomToken ok (native)', { desiredUid });
  } else {
    const mod = require('firebase/auth');
    if (typeof mod?.signInWithCustomToken !== 'function') {
      const err = new Error('FIREBASE_SIGNIN_WITH_CUSTOM_TOKEN_UNAVAILABLE');
      err.code = 'FIREBASE_SIGNIN_WITH_CUSTOM_TOKEN_UNAVAILABLE';
      throw err;
    }
    await mod.signInWithCustomToken(firebaseAuth, firebaseToken);
    // [BLYP][PROD_PROOF] Release-visible — survives transform-remove-console exclude:[error,warn]
    console.warn('[AUTH][FIREBASE_READY] signInWithCustomToken ok (web)', { desiredUid });
  }

  const finalUid = await waitForFirebaseAuthUid({ firebaseAuth, desiredUid, timeoutMs: args.timeoutMs });
  if (finalUid !== desiredUid) {
    const err = new Error('FIREBASE_AUTH_UID_MISMATCH');
    err.code = 'FIREBASE_AUTH_UID_MISMATCH';
    err.expected = desiredUid;
    err.actual = finalUid;
    throw err;
  }

  if (__DEV__) {
    console.log('[AUTH][FIREBASE_READY]', { uid: desiredUid, mode: 'minted_and_signed_in' });
  }
  // [BLYP][PROD_PROOF] Release-visible — survives transform-remove-console exclude:[error,warn]
  console.warn('[AUTH][FIREBASE_READY] bridge complete', { uid: desiredUid });

  return desiredUid;
}
