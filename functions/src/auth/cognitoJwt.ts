import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

export type CognitoJwtPayload = {
  sub: string;
  [key: string]: any;
};

const getCognitoVerifier = (() => {
  let client: any | null = null;
  let issuer: string | null = null;

  return () => {
    const cognitoRegion = process.env.COGNITO_REGION;
    const cognitoUserPoolId = process.env.COGNITO_USER_POOL_ID;

    if (!cognitoRegion || !cognitoUserPoolId) {
      throw new Error('[config] COGNITO_REGION and COGNITO_USER_POOL_ID are required');
    }

    if (!client) {
      const jwksUri = `https://cognito-idp.${cognitoRegion}.amazonaws.com/${cognitoUserPoolId}/.well-known/jwks.json`;
      client = jwksClient({
        jwksUri,
        cache: true,
        cacheMaxEntries: 10,
        cacheMaxAge: 10 * 60 * 1000,
      });
      issuer = `https://cognito-idp.${cognitoRegion}.amazonaws.com/${cognitoUserPoolId}`;
    }

    return { client, issuer };
  };
})();

function getKey(header: any, callback: any) {
  try {
    const { client } = getCognitoVerifier();
    client.getSigningKey(header.kid, function (err: any, key: any) {
      if (err) {
        callback(err);
        return;
      }
      const signingKey = key?.getPublicKey?.();
      callback(null, signingKey);
    });
  } catch (e: any) {
    callback(e);
  }
}

export function extractBearerToken(authHeader: unknown): string {
  const header = String(authHeader || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new Error('Missing or invalid Authorization header');
  }
  return match[1];
}

export async function verifyCognitoIdToken(idToken: string): Promise<CognitoJwtPayload> {
  if (!idToken || typeof idToken !== 'string') {
    throw new Error('Invalid Cognito token');
  }

  const { issuer } = getCognitoVerifier();

  const decoded: any = await new Promise((resolve, reject) => {
    jwt.verify(
      idToken,
      getKey,
      {
        algorithms: ['RS256'],
        issuer: issuer || undefined,
      },
      (err: any, payload: any) => {
        if (err) reject(err);
        else resolve(payload);
      },
    );
  });

  const sub = String(decoded?.sub || '').trim();
  if (!sub) {
    throw new Error('Invalid token: missing sub');
  }

  return decoded as CognitoJwtPayload;
}
