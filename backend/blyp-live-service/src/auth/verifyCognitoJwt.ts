import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { sanitizeHeaderValue } from '../utils/headerSanitize';

export type CognitoTokenUse = 'access' | 'id';

export type VerifiedCognitoClaims = {
  sub: string;
  token_use: CognitoTokenUse;
  client_id?: string;
  aud?: string | string[];
  iss: string;
  exp: number;
  iat: number;
  [key: string]: unknown;
};

type CognitoConfig = {
  region: string;
  userPoolId: string;
  jwksUri: string;
  issuer: string;
  allowedClientIds: Set<string>;
};

function getAllowedClientIds(): Set<string> {
  const raw =
    sanitizeHeaderValue(process.env.COGNITO_APP_CLIENT_IDS) ||
    sanitizeHeaderValue(process.env.COGNITO_APP_CLIENT_ID) ||
    sanitizeHeaderValue(process.env.COGNITO_CLIENT_ID);
  const ids = new Set(
    String(raw || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );
  if (ids.size === 0) {
    throw new Error('[config] COGNITO_APP_CLIENT_IDS is required');
  }
  return ids;
}

function getCognitoConfig(): CognitoConfig {
  const region = sanitizeHeaderValue(process.env.COGNITO_REGION);
  const userPoolId = sanitizeHeaderValue(process.env.COGNITO_USER_POOL_ID);
  if (!region || !userPoolId) {
    throw new Error('[config] COGNITO_REGION and COGNITO_USER_POOL_ID are required');
  }
  return {
    region,
    userPoolId,
    jwksUri: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`,
    issuer: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`,
    allowedClientIds: getAllowedClientIds(),
  };
}

let cachedClient: ReturnType<typeof jwksClient> | null = null;
let cachedJwksUri: string | null = null;

function getJwksClient() {
  const { jwksUri } = getCognitoConfig();
  if (!cachedClient || cachedJwksUri !== jwksUri) {
    cachedJwksUri = jwksUri;
    cachedClient = jwksClient({
      jwksUri,
      cache: true,
      cacheMaxEntries: 10,
      cacheMaxAge: 10 * 60 * 1000,
      rateLimit: true,
      jwksRequestsPerMinute: 10,
      timeout: 5000,
    });
  }
  return cachedClient;
}

function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback) {
  if (!header.kid) {
    callback(new Error('JWT key identifier is missing'));
    return;
  }
  const client = getJwksClient();
  client.getSigningKey(header.kid, (err, key) => {
    if (err) {
      callback(err);
      return;
    }
    if (!key) {
      callback(new Error('JWT signing key was not found'));
      return;
    }
    callback(null, key.getPublicKey());
  });
}

function tokenClientIds(claims: VerifiedCognitoClaims): string[] {
  const values = claims.token_use === 'access' ? [claims.client_id] : [claims.aud].flat();
  return values.filter((value): value is string => typeof value === 'string' && value.length > 0);
}

export async function verifyCognitoJwt(
  token: string,
  options: { tokenUse?: CognitoTokenUse } = {}
): Promise<VerifiedCognitoClaims> {
  const config = getCognitoConfig();
  const expectedUse = options.tokenUse ?? 'access';

  const decoded = await new Promise<jwt.JwtPayload>((resolve, reject) => {
    jwt.verify(
      token,
      getKey,
      {
        algorithms: ['RS256'],
        issuer: config.issuer,
      },
      (err, value) => {
        if (err) {
          reject(err);
          return;
        }
        if (!value || typeof value === 'string') {
          reject(new Error('JWT payload is invalid'));
          return;
        }
        resolve(value);
      }
    );
  });

  if (decoded.token_use !== expectedUse) {
    throw new Error(`Expected Cognito ${expectedUse} token`);
  }
  if (typeof decoded.sub !== 'string' || decoded.sub.trim().length === 0) {
    throw new Error('Cognito subject is missing');
  }

  const claims = decoded as VerifiedCognitoClaims;
  const presentedClientIds = tokenClientIds(claims);
  if (!presentedClientIds.some((clientId) => config.allowedClientIds.has(clientId))) {
    throw new Error('Cognito app client is not allowed');
  }

  return claims;
}
