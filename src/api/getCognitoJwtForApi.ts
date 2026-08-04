import { Auth } from 'aws-amplify';
import { CognitoUserPool } from 'amazon-cognito-identity-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import awsconfig from '../aws-exports';
import { cognitoStorage, hydrateCognitoStorageCache } from '../lib/auth/cognitoStorage';

let cachedUserPool: CognitoUserPool | null = null;
function getUserPool(): CognitoUserPool {
  if (cachedUserPool) return cachedUserPool;
  cachedUserPool = new CognitoUserPool({
    UserPoolId: (awsconfig as any)?.aws_user_pools_id,
    ClientId: (awsconfig as any)?.aws_user_pools_web_client_id,
    Storage: cognitoStorage as any,
  });
  return cachedUserPool;
}

async function waitWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  try {
    if (!promise || typeof (promise as any).then !== 'function') return null;
    const ms = Math.max(0, Math.floor(timeoutMs));
    if (!ms) return await promise;
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
    ]);
  } catch {
    return null;
  }
}

async function hydrateCognitoStorageBestEffort(options: { timeoutMs: number; force?: boolean }): Promise<void> {
  try {
    const { timeoutMs, force } = options;

    // Aim to finish quickly in the common case, but be more patient when callers
    // explicitly ask (e.g. IVS start uses timeoutMs=10000).
    const boundedMs = Math.min(5000, Math.max(250, Math.floor(timeoutMs * 0.6)));
    await waitWithTimeout(hydrateCognitoStorageCache({ force: force === true } as any) as any, boundedMs);
  } catch {
    // Best-effort only.
  }
}

async function tryGetJwtFromUserPool(tokenType: CognitoJwtTokenType): Promise<string | null> {
  return await new Promise((resolve) => {
    try {
      const pool = getUserPool();
      const currentUser = pool.getCurrentUser();
      if (!currentUser) return resolve(null);

      currentUser.getSession((err: any, session: any) => {
        if (err || !session || typeof session.isValid !== 'function' || !session.isValid()) {
          return resolve(null);
        }
        try {
          const tokenObj =
            tokenType === 'access'
              ? session.getAccessToken?.()
              : session.getIdToken?.();
          const raw = tokenObj?.getJwtToken?.();
          if (!raw || typeof raw !== 'string') return resolve(null);
          const parts = raw.split('.');
          if (parts.length !== 3) return resolve(null);
          return resolve(raw);
        } catch {
          return resolve(null);
        }
      });
    } catch {
      return resolve(null);
    }
  });
}

async function tryGetJwtFromUserPoolWithRetry(
  tokenType: CognitoJwtTokenType,
  options: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<string | null> {
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 2500;
  const intervalMs = typeof options.intervalMs === 'number' ? options.intervalMs : 250;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const token = await tryGetJwtFromUserPool(tokenType);
    if (token) return token;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

const COGNITO_STORAGE_PREFIX = 'CognitoIdentityServiceProvider';

function safeBase64UrlDecode(input: string): string | null {
  try {
    let t = input.replace(/-/g, '+').replace(/_/g, '/');
    while (t.length % 4 !== 0) t += '=';
    // Prefer Buffer when available (Hermes setups often polyfill it); otherwise fall back to atob.
    const anyGlobal: any = global as any;
    const BufferImpl = anyGlobal?.Buffer;
    if (BufferImpl && typeof BufferImpl.from === 'function') {
      return BufferImpl.from(t, 'base64').toString('utf8');
    }
    // eslint-disable-next-line no-undef
    return typeof atob === 'function' ? atob(t) : null;
  } catch {
    return null;
  }
}

function getJwtExpSeconds(rawJwt: string): number | null {
  try {
    const parts = rawJwt.split('.');
    if (parts.length !== 3) return null;
    const decoded = safeBase64UrlDecode(parts[1]);
    if (!decoded) return null;
    const payload = JSON.parse(decoded);
    const exp = payload?.exp;
    return typeof exp === 'number' ? exp : null;
  } catch {
    return null;
  }
}

async function tryGetJwtFromAsyncStorage(tokenType: CognitoJwtTokenType): Promise<string | null> {
  try {
    const clientId = String((awsconfig as any)?.aws_user_pools_web_client_id || '').trim();
    if (!clientId) return null;

    const AMPLIFY_PREFIX = '@MemoryStorage:';
    const lastAuthUserKey = `${COGNITO_STORAGE_PREFIX}.${clientId}.LastAuthUser`;
    let username = await AsyncStorage.getItem(lastAuthUserKey);
    // Also try @MemoryStorage:-prefixed key (Amplify v6 + @aws-amplify/react-native writes tokens with this prefix)
    if (!username) {
      username = await AsyncStorage.getItem(`${AMPLIFY_PREFIX}${lastAuthUserKey}`);
    }
    if (!username) {
      // Fallback: scan for a matching LastAuthUser key.
      const keys = await AsyncStorage.getAllKeys();
      const candidate = keys.find(
        (k) =>
          typeof k === 'string' &&
          k.includes(COGNITO_STORAGE_PREFIX) &&
          k.includes(`.${clientId}.`) &&
          k.toLowerCase().endsWith('.lastauthuser')
      );
      if (candidate) {
        username = await AsyncStorage.getItem(candidate);
      }
    }
    username = String(username || '').trim();
    if (!username) return null;

    const tokenKey =
      tokenType === 'access'
        ? `${COGNITO_STORAGE_PREFIX}.${clientId}.${username}.accessToken`
        : `${COGNITO_STORAGE_PREFIX}.${clientId}.${username}.idToken`;

    let raw = await AsyncStorage.getItem(tokenKey);
    // Also try @MemoryStorage:-prefixed version
    if (!raw) {
      raw = await AsyncStorage.getItem(`${AMPLIFY_PREFIX}${tokenKey}`);
    }
    if (!raw || typeof raw !== 'string') return null;
    const token = raw.trim();
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    // Ensure token is not obviously expired (30s leeway).
    const exp = getJwtExpSeconds(token);
    if (typeof exp === 'number') {
      const now = Math.floor(Date.now() / 1000);
      if (now >= exp - 30) return null;
    }

    return token;
  } catch {
    return null;
  }
}

// Lazy fallback to avoid module-load-time errors
let cachedAuth: any = null;
function getAmplifyAuth() {
  if (cachedAuth !== null) return cachedAuth;

  // Try named import first
  if (Auth && typeof (Auth as any).currentSession === 'function') {
    cachedAuth = Auth;
    return cachedAuth;
  }

  // Try modular auth to synthesize a currentSession-like shape
  try {
    const authModule = require('aws-amplify/auth');
    const fetchAuthSession = authModule?.fetchAuthSession;
    if (typeof fetchAuthSession === 'function') {
      cachedAuth = {
        currentSession: async () => {
          const session = await fetchAuthSession();
          const tokens = session?.tokens || {};
          return {
            getIdToken: () => ({
              getJwtToken: () => tokens.idToken?.toString?.(),
            }),
            getAccessToken: () => ({
              getJwtToken: () => tokens.accessToken?.toString?.(),
            }),
          };
        },
      };
      return cachedAuth;
    }
  } catch { }

  // Try legacy Auth export
  try {
    const legacyAuth = (require('aws-amplify') as any).Auth;
    if (legacyAuth) {
      cachedAuth = legacyAuth;
      return cachedAuth;
    }
  } catch { }

  cachedAuth = undefined;
  return cachedAuth;
}

export type CognitoJwtTokenType = 'id' | 'access';

export interface GetCognitoJwtForApiOptions {
  tokenType?: CognitoJwtTokenType;
  /**
   * Maximum time to wait for Cognito session/token hydration.
   * Useful for cold starts / release builds where AsyncStorage rehydration is slower.
   */
  timeoutMs?: number;
}

/**
 * Returns a Cognito JWT suitable for calling Blyp backend APIs.
 * Requires the user to already be authenticated with Cognito.
 */
export async function getCognitoJwtForApi(
  options: GetCognitoJwtForApiOptions = {}
): Promise<string> {
  const tokenType: CognitoJwtTokenType = options.tokenType ?? 'id';
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 2500;

  try {
    // Ensure the sync Cognito storage adapter has hydrated from AsyncStorage.
    // Without this, pool.getCurrentUser() can transiently return null on cold start,
    // causing false "missing/expired session" errors (especially in release builds).
    await hydrateCognitoStorageBestEffort({ timeoutMs, force: false });

    // In some cold-start scenarios, the initial background hydration races the first token read.
    // If we fail to find a token, we'll do a forced hydrate + one more userPool pass below.

    // PRIMARY: use the same Cognito session mechanism as AuthScreen (amazon-cognito-identity-js).
    // This avoids the "empty token" mismatch when the app signs in via userPool.authenticateUser.
    const userPoolToken = await tryGetJwtFromUserPoolWithRetry(tokenType, { timeoutMs });
    if (userPoolToken) return userPoolToken;

    // SECOND CHANCE: force hydration and retry userPool once.
    // This targets the case where userPool.getCurrentUser() is null until the in-memory cache is fully hydrated.
    await hydrateCognitoStorageBestEffort({ timeoutMs, force: true });
    const userPoolTokenAfterForce = await tryGetJwtFromUserPoolWithRetry(tokenType, { timeoutMs: Math.min(timeoutMs, 2500) });
    if (userPoolTokenAfterForce) return userPoolTokenAfterForce;

    // FALLBACK: direct read from AsyncStorage (handles transient userPool.getCurrentUser() === null).
    // This is intentionally conservative: returns only if it looks like a JWT and isn't expired.
    const storageToken = await tryGetJwtFromAsyncStorage(tokenType);
    if (storageToken) return storageToken;

    const AmplifyAuth = getAmplifyAuth();
    if (!AmplifyAuth || typeof AmplifyAuth.currentSession !== 'function') {
      throw new Error('Amplify Auth.currentSession is unavailable');
    }

    console.log('[COGNITO] Calling currentSession()...');
    const sessionPromise = AmplifyAuth.currentSession();

    // Add timeout to prevent hanging
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Cognito session timeout (30s)')), 30000)
    );

    const session = await Promise.race([sessionPromise, timeoutPromise]);

    const rawToken =
      tokenType === 'access'
        ? session?.getAccessToken?.()?.getJwtToken?.()
        : session?.getIdToken?.()?.getJwtToken?.();

    console.log('[COGNITO] Token retrieved:', {
      tokenType,
      rawTokenLength: typeof rawToken === 'string' ? rawToken.length : 'N/A',
      hasToken: !!rawToken,
    });

    if (!rawToken || typeof rawToken !== 'string') {
      throw new Error(`Cognito ${tokenType} token is empty or not a string`);
    }

    const parts = rawToken.split('.');
    if (parts.length !== 3) {
      throw new Error(`Cognito ${tokenType} token is malformed (expected 3 JWT parts, got ${parts.length})`);
    }

    console.log('[COGNITO] Token validated successfully');
    return rawToken;
  } catch (err: any) {
    const message =
      err?.message ||
      err?.toString?.() ||
      'Unknown error while retrieving Cognito session';

    const lower = String(message).toLowerCase();
    const isLoggedOutLike =
      lower.includes('token is empty') ||
      lower.includes('not a string') ||
      lower.includes('no current user') ||
      lower.includes('no user') ||
      lower.includes('not authenticated') ||
      lower.includes('session timeout') ||
      lower.includes('session is invalid') ||
      lower.includes('not authorized');

    // NOTE: This error frequently occurs in dev when the user is simply logged out
    // (or when sessions are being reset). Using console.error triggers LogBox, which
    // is too noisy for a recoverable state.
    console.warn('[COGNITO_JWT] Failed to obtain Cognito JWT', {
      error: message,
      hasAmplify: !!getAmplifyAuth(),
    });

    // Prefer a precise, actionable error message.
    if (isLoggedOutLike) {
      throw new Error(
        `[COGNITO_JWT] Not logged in to Cognito (missing/expired session). ` +
        `Details: ${message}`
      );
    }

    throw new Error(
      `[COGNITO_JWT] Unable to obtain Cognito JWT. ` +
      `Details: ${message}`
    );
  }
}
