import { userPool } from '../config/cognitoPool';

// Cognito subs are UUID-shaped but not always RFC 4122 version/variant.
const COGNITO_SUB_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    // Prefer atob in RN Hermes; fall back to Buffer when available.
    const json =
      typeof globalThis.atob === 'function'
        ? globalThis.atob(padded)
        : Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function getSessionFromUser(cognitoUser) {
  return new Promise((resolve, reject) => {
    if (!cognitoUser?.getSession) {
      reject(new Error('COGNITO_AUTH_REQUIRED'));
      return;
    }
    cognitoUser.getSession((err, session) => {
      if (err || !session?.isValid?.()) {
        reject(err || new Error('COGNITO_AUTH_REQUIRED'));
        return;
      }
      resolve(session);
    });
  });
}

export function isCanonicalCognitoSub(value) {
  return COGNITO_SUB_REGEX.test(String(value || '').trim());
}

/**
 * Read tokens from the same CognitoUserPool session AuthScreen uses.
 * Prefer access token for API calls; fall back to id token.
 */
export async function getCognitoSessionTokens(cognitoUser) {
  const user = cognitoUser || userPool.getCurrentUser();
  if (!user) {
    throw new Error('COGNITO_AUTH_REQUIRED');
  }
  const session = await getSessionFromUser(user);
  const accessToken = session.getAccessToken?.()?.getJwtToken?.() || null;
  const idToken = session.getIdToken?.()?.getJwtToken?.() || null;
  const token = accessToken || idToken;
  if (!token || typeof token !== 'string') {
    throw new Error('COGNITO_AUTH_REQUIRED');
  }
  const payload = decodeJwtPayload(idToken || accessToken) || {};
  const sub = String(payload.sub || '').trim();
  if (!isCanonicalCognitoSub(sub)) {
    throw new Error('COGNITO_SUB_INVALID');
  }
  return {
    accessToken,
    idToken,
    bearerToken: token,
    sub,
    payload,
    cognitoUser: user,
  };
}

export async function getCognitoBearerToken(cognitoUser) {
  const tokens = await getCognitoSessionTokens(cognitoUser);
  return tokens.bearerToken;
}

export async function getCognitoSub(cognitoUser) {
  const tokens = await getCognitoSessionTokens(cognitoUser);
  return tokens.sub;
}
