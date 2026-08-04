/**
 * IVS Token API Router
 * 
 * Express-style HTTP endpoints for IVS token provisioning.
 * Used by mobile app to get participant tokens for host/guest/viewer roles.
 * 
 * Endpoints:
 * - POST /ivs/host-start - Host starts broadcast, gets PUBLISHER token
 * - POST /ivs/guest-join - Guest joins stage, gets PUBLISHER token
 * - POST /ivs/viewer-join - Viewer watches, gets playback URL
 * 
 * All endpoints require: Authorization: Bearer <cognito-id-token>
 */

import * as functions from 'firebase-functions';
import { getRegionFromStageArn } from './ivsService';
import { ivsRealtime, getIvsViewer } from './ivsService';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

function applyCors(req: functions.https.Request, res: functions.Response<any>, methods: string) {
  const origin = String(req.headers.origin || '').trim();
  const allowlist = String(process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => !!s && s !== '*');

  if (origin && allowlist.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }

  res.set('Access-Control-Allow-Methods', methods);
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function extractBearerToken(authHeader: unknown): string {
  const header = String(authHeader || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new Error('Missing or invalid Authorization header');
  }
  return match[1];
}

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
      client = jwksClient({ jwksUri, cache: true, cacheMaxEntries: 10, cacheMaxAge: 10 * 60 * 1000 });
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

async function verifyCognitoIdToken(idToken: string): Promise<any> {
  if (!idToken || typeof idToken !== 'string') {
    throw new Error('Invalid Cognito token');
  }

  const { issuer } = getCognitoVerifier();
  return await new Promise((resolve, reject) => {
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
}

/**
 * Cognito token middleware.
 * Extracts and verifies ID token from Authorization header.
 */
async function extractCognitoUserId(authHeader: string | undefined): Promise<string> {
  const token = extractBearerToken(authHeader);
  const decoded = await verifyCognitoIdToken(token);
  return String(decoded.sub);
}

/**
 * Response wrapper for all IVS endpoints.
 */
interface IvsApiResponse {
  ok: boolean;
  role: 'host' | 'guest' | 'viewer';
  userId: string;
  streamId: string;
  stageArn?: string;
  region?: string;
  token?: string;
  playbackUrl?: string;
  expiresAt?: string; // ISO 8601
  error?: string;
}

/**
 * POST /api/ivs/host-start
 * 
 * Start a new live stream session as host.
 * Creates an IVS Real-Time Stage and generates a PUBLISHER token.
 * 
 * PRODUCTION GUARANTEE:
 * - Stage ARN must be provided (via env IVS_REALTIME_STAGE_ARN or request body)
 * - Stage ARN is validated (must match arn:aws:ivs:<region>:<account>:stage/<id> format)
 * - Region is extracted from stage ARN and used to create AWS SDK client
 * - Token is always generated via real AWS IVS CreateParticipantToken
 * - If stage ARN is invalid or missing, returns HTTP 500 with clear error
 * 
 * Request body (optional):
 * {
 *   "streamId": "custom-stream-id",
 *   "stageArnOverride": "arn:aws:ivs:..."
 * }
 * 
 * Response:
 * {
 *   "ok": true,
 *   "role": "host",
 *   "userId": "user-123",
 *   "streamId": "stream-123",
 *   "stageArn": "arn:aws:ivs:...",
 *   "region": "eu-west-1",
 *   "token": "eyJh...",
 *   "expiresAt": "2025-12-07T14:30:00Z"
 * }
 */
export const hostStart = functions.https.onRequest(async (req, res) => {
  // CORS headers (no wildcard for authenticated endpoints)
  applyCors(req, res, 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed. Use POST.' } as IvsApiResponse);
    return;
  }

  const response: IvsApiResponse = {
    ok: false,
    role: 'host',
    userId: '',
    streamId: '',
    error: 'Unknown error',
  };

  try {
    // 1. Extract and verify Cognito token
    const userId = await extractCognitoUserId(req.headers.authorization);
    response.userId = userId;

    console.log('[IVS_API][HOST_START_REQUEST]', { userId });

    // 2. Extract stage ARN (from request override or env var)
    const body = req.body || {};
    const streamId = body.streamId || `stream-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const stageArn = body.stageArnOverride || process.env.IVS_REALTIME_STAGE_ARN;

    // 3. PRODUCTION GUARD: Validate stage ARN exists and is properly formatted
    if (!stageArn) {
      console.error('[IVS_API][HOST_START_ERROR] Missing stage ARN', {
        userId,
        hasEnvVar: !!process.env.IVS_REALTIME_STAGE_ARN,
      });
      
      response.error =
        'No IVS stage ARN configured. ' +
        'Server admin must set IVS_REALTIME_STAGE_ARN environment variable. ' +
        'Stage ARN format: arn:aws:ivs:<region>:<account>:stage/<stage-id>';
      res.status(500).json(response);
      return;
    }

    // 4. PRODUCTION GUARD: Validate stage ARN format and extract region
    let region: string;
    try {
      region = getRegionFromStageArn(stageArn);
    } catch (error) {
      console.error('[IVS_API][HOST_START_INVALID_ARN]', {
        userId,
        stageArn,
        error: error instanceof Error ? error.message : String(error),
      });

      response.error =
        `Invalid stage ARN format: ${error instanceof Error ? error.message : String(error)}. ` +
        'Expected format: arn:aws:ivs:<region>:<account>:stage/<stage-id>';
      res.status(500).json(response);
      return;
    }

    response.streamId = streamId;
    response.stageArn = stageArn;
    response.region = region;

    // 5. Generate PUBLISHER token for host (will use region from ARN)
    const tokenResponse = await ivsRealtime.createParticipantToken({
      userId,
      stageArn,
      role: 'PUBLISHER',
      durationSeconds: 3600, // 1 hour
    });

    response.token = tokenResponse.token;
    response.expiresAt = new Date(tokenResponse.expiresAt).toISOString();
    response.ok = true;

    console.log('[IVS_API][HOST_START_SUCCESS]', {
      userId,
      streamId,
      stageArn,
      region,
      tokenLength: tokenResponse.token.length,
    });

    res.status(200).json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[IVS_API][HOST_START_ERROR]', { error: message });

    response.ok = false;
    response.error = message;
    res.status(500).json(response);
  }
});

/**
 * POST /api/ivs/guest-join
 * 
 * Join an existing live stream as a guest/co-host.
 * Generates a PUBLISHER token to share the stage with the host.
 * 
 * PRODUCTION GUARANTEE:
 * - Stage ARN must be provided in request body
 * - Stage ARN is validated (must match arn:aws:ivs:<region>:<account>:stage/<id> format)
 * - Region is extracted from stage ARN and used to create AWS SDK client
 * - Token is always generated via real AWS IVS CreateParticipantToken
 * 
 * Request body:
 * {
 *   "streamId": "stream-123",
 *   "stageArn": "arn:aws:ivs:..."
 * }
 * 
 * Response:
 * {
 *   "ok": true,
 *   "role": "guest",
 *   "userId": "user-123",
 *   "streamId": "stream-123",
 *   "stageArn": "arn:aws:ivs:...",
 *   "region": "eu-west-1",
 *   "token": "eyJh...",
 *   "expiresAt": "2025-12-07T14:30:00Z"
 * }
 */
export const guestJoin = functions.https.onRequest(async (req, res) => {
  // CORS headers (no wildcard for authenticated endpoints)
  applyCors(req, res, 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed. Use POST.' } as IvsApiResponse);
    return;
  }

  const response: IvsApiResponse = {
    ok: false,
    role: 'guest',
    userId: '',
    streamId: '',
    error: 'Unknown error',
  };

  try {
    // 1. Extract and verify Cognito token
    const userId = await extractCognitoUserId(req.headers.authorization);
    response.userId = userId;

    // 2. Extract streamId and stageArn from request
    const body = req.body || {};
    const streamId = body.streamId;
    const stageArn = body.stageArn;

    if (!streamId || !stageArn) {
      throw new Error('Request body must include streamId and stageArn');
    }

    // 3. PRODUCTION GUARD: Validate stage ARN format and extract region
    let region: string;
    try {
      region = getRegionFromStageArn(stageArn);
    } catch (error) {
      console.error('[IVS_API][GUEST_JOIN_INVALID_ARN]', {
        userId,
        streamId,
        stageArn,
        error: error instanceof Error ? error.message : String(error),
      });

      response.error =
        `Invalid stage ARN format: ${error instanceof Error ? error.message : String(error)}. ` +
        'Expected format: arn:aws:ivs:<region>:<account>:stage/<stage-id>';
      res.status(500).json(response);
      return;
    }

    response.streamId = streamId;
    response.stageArn = stageArn;
    response.region = region;

    console.log('[IVS_API][GUEST_JOIN_REQUEST]', { userId, streamId, stageArn, region });

    // 4. Generate PUBLISHER token for guest (will use region from ARN)
    const tokenResponse = await ivsRealtime.createParticipantToken({
      userId,
      stageArn,
      role: 'PUBLISHER',
      durationSeconds: 3600, // 1 hour
    });

    response.token = tokenResponse.token;
    response.expiresAt = new Date(tokenResponse.expiresAt).toISOString();
    response.ok = true;

    console.log('[IVS_API][GUEST_JOIN_SUCCESS]', { userId, streamId, region });

    res.status(200).json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[IVS_API][GUEST_JOIN_ERROR]', { error: message });

    response.ok = false;
    response.error = message;
    res.status(500).json(response);
  }
});

/**
 * POST /api/ivs/viewer-join
 * 
 * Join an existing live stream as a viewer/subscriber.
 * Returns the HLS playback URL (no token needed for standard HLS playback).
 * 
 * Request body (optional):
 * {
 *   "streamId": "stream-123"
 * }
 * 
 * Response:
 * {
 *   "ok": true,
 *   "role": "viewer",
 *   "userId": "user-123",
 *   "streamId": "stream-123",
 *   "playbackUrl": "https://d123.ivs.aws.com/index.m3u8"
 * }
 */
export const viewerJoin = functions.https.onRequest(async (req, res) => {
  // CORS headers (no wildcard for authenticated endpoints)
  applyCors(req, res, 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed. Use POST.' } as IvsApiResponse);
    return;
  }

  const response: IvsApiResponse = {
    ok: false,
    role: 'viewer',
    userId: '',
    streamId: '',
    error: 'Unknown error',
  };

  try {
    // 1. Extract and verify Cognito token
    const userId = await extractCognitoUserId(req.headers.authorization);
    response.userId = userId;

    // 2. Extract streamId from request (informational)
    const body = req.body || {};
    const streamId = body.streamId || 'unknown';
    response.streamId = streamId;

    console.log('[IVS_API][VIEWER_JOIN_REQUEST]', { userId, streamId });

    // 3. Get viewer playback info (lazy-initialize viewer service)
    const viewerService = getIvsViewer();
    const viewerInfo = viewerService.getViewerInfo({ userId });
    response.playbackUrl = viewerInfo.playbackUrl;
    response.ok = true;

    console.log('[IVS_API][VIEWER_JOIN_SUCCESS]', {
      userId,
      streamId,
      playbackUrl: viewerInfo.playbackUrl,
    });

    res.status(200).json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[IVS_API][VIEWER_JOIN_ERROR]', { error: message });

    response.ok = false;
    response.error = message;
    res.status(500).json(response);
  }
});
