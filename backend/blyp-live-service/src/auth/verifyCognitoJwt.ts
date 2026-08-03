import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { sanitizeHeaderValue } from '../utils/headerSanitize';
import { validateCognitoClaims } from './cognitoClaims';

type CognitoConfig = {
  region: string;
  userPoolId: string;
  jwksUri: string;
  issuer: string;
  appClientIds: string[];
};

function getCognitoConfig(): CognitoConfig {
  const region = sanitizeHeaderValue(process.env.COGNITO_REGION);
  const userPoolId = sanitizeHeaderValue(process.env.COGNITO_USER_POOL_ID);
  if (!region || !userPoolId) {
    throw new Error('[config] COGNITO_REGION and COGNITO_USER_POOL_ID are required');
  }

  const rawClients = [
    process.env.COGNITO_APP_CLIENT_ID,
    process.env.COGNITO_USER_POOL_WEB_CLIENT_ID,
    process.env.EXPO_PUBLIC_AWS_USER_POOL_WEB_CLIENT_ID,
  ]
    .map((v) => sanitizeHeaderValue(v))
    .filter(Boolean);

  // Production default used by mobile EAS + aws-exports when env is unset.
  if (rawClients.length === 0) {
    rawClients.push('4a7r115hllaedriqsjlsa00snj');
  }

  return {
    region,
    userPoolId,
    jwksUri: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`,
    issuer: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`,
    appClientIds: Array.from(new Set(rawClients)),
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
    });
  }
  return cachedClient;
}

function getKey(header: any, callback: any) {
  const client = getJwksClient();
  client.getSigningKey(header.kid, function (err, key) {
    if (err) {
      callback(err);
      return;
    }
    const signingKey = key?.getPublicKey();
    callback(null, signingKey);
  });
}

export async function verifyCognitoJwt(token: string): Promise<any> {
  const { issuer, appClientIds } = getCognitoConfig();
  const decoded = await new Promise<any>((resolve, reject) => {
    jwt.verify(
      token,
      getKey,
      {
        algorithms: ['RS256'],
        issuer,
      },
      (err, payload) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(payload);
      }
    );
  });

  validateCognitoClaims(decoded, appClientIds);
  return decoded;
}
