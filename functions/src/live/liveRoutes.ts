/**
 * HTTP routes for IVS live streaming API.
 * 
 * Exposes Firebase Cloud Functions HTTP endpoints matching mobile API contract:
 * - POST /ivs/host/start - Start new stream as host
 * - POST /ivs/guest/join - Join stream as guest
 * - POST /ivs/viewer/join - Join stream as viewer
 */

import * as functions from 'firebase-functions';
import {
  hostStartSession,
  hostEndSession,
  acceptGuestInvite,
  joinAsViewer,
} from './liveService';
import { HostStartRequest, GuestJoinRequest, ViewerJoinRequest } from './liveTypes';

/**
 * Verify Cognito JWT token and extract user ID.
 * 
 * @param token - Bearer token from Authorization header
 * @returns User ID if valid
 */
async function verifyCognitoToken(token: string): Promise<string> {
  if (!token) {
    throw new Error('No authorization token provided');
  }

  // Remove 'Bearer ' prefix if present
  const bearerToken = token.startsWith('Bearer ') ? token.slice(7) : token;

  try {
    // Verify with Cognito (simplified for now; production should use AWS Cognito verification)
    // For MVP, we decode the token and extract the sub claim (user ID)
    const decoded = JSON.parse(Buffer.from(bearerToken.split('.')[1], 'base64').toString());
    const userId = decoded.sub || decoded.user_id || decoded.oid;

    if (!userId) {
      throw new Error('Token missing user ID claim');
    }

    return userId;
  } catch (error) {
    throw new Error(`Token verification failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * POST /ivs/host/start
 * 
 * Start a new live stream as host.
 * Request body: { title?: string, streamId?: string }
 * Response: { streamId, stageArn, region, role, participantToken, expiresAt, userId }
 */
export const hostStart = functions.https.onRequest(async (req, res) => {
  console.log('[LIVE_ROUTES][HOST_START_REQUEST]', {
    method: req.method,
    ip: req.ip,
  });

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    // 1. Verify auth
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      res.status(401).json({ error: 'Authorization required' });
      return;
    }

    const userId = await verifyCognitoToken(authHeader);

    // 2. Parse request
    const reqBody = req.body as HostStartRequest;
    if (typeof reqBody !== 'object' || reqBody === null) {
      res.status(400).json({ error: 'Request body must be JSON object' });
      return;
    }

    // 3. Call service
    const response = await hostStartSession(userId, reqBody);

    // 4. Return response
    res.status(200).json(response);

    console.log('[LIVE_ROUTES][HOST_START_SUCCESS]', {
      userId,
      streamId: response.streamId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[LIVE_ROUTES][HOST_START_ERROR]', { error: message });
    res.status(500).json({ error: message });
  }
});

/**
 * POST /ivs/host/end
 * 
 * End a live stream as host.
 * Request body: { streamId: string }
 * Response: { success: true }
 */
export const hostEnd = functions.https.onRequest(async (req, res) => {
    console.log('[LIVE_ROUTES][HOST_END_REQUEST]', {
      method: req.method,
      ip: req.ip,
    });

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    try {
      // 1. Verify auth
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        res.status(401).json({ error: 'Authorization required' });
        return;
      }

      const userId = await verifyCognitoToken(authHeader);

      // 2. Parse request
      const { streamId } = req.body as { streamId?: string };
      if (!streamId || typeof streamId !== 'string') {
        res.status(400).json({ error: 'streamId required' });
        return;
      }

      // 3. Call service
      await hostEndSession(userId, streamId);

      // 4. Return response
      res.status(200).json({ success: true });

      console.log('[LIVE_ROUTES][HOST_END_SUCCESS]', {
        userId,
        streamId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[LIVE_ROUTES][HOST_END_ERROR]', { error: message });
      res.status(500).json({ error: message });
    }
  }
);

/**
 * POST /ivs/guest/join
 * 
 * Join a stream as guest.
 * Request body: { streamId: string }
 * Response: { streamId, stageArn, region, role, participantToken, expiresAt, userId }
 */
export const guestJoin = functions.https.onRequest(async (req, res) => {
    console.log('[LIVE_ROUTES][GUEST_JOIN_REQUEST]', {
      method: req.method,
      ip: req.ip,
    });

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    try {
      // 1. Verify auth
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        res.status(401).json({ error: 'Authorization required' });
        return;
      }

      const userId = await verifyCognitoToken(authHeader);

      // 2. Parse request
      const { streamId } = req.body as GuestJoinRequest;
      if (!streamId || typeof streamId !== 'string') {
        res.status(400).json({ error: 'streamId required' });
        return;
      }

      // 3. Call service
      const response = await acceptGuestInvite(userId, streamId);

      // 4. Return response
      res.status(200).json(response);

      console.log('[LIVE_ROUTES][GUEST_JOIN_SUCCESS]', {
        userId,
        streamId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[LIVE_ROUTES][GUEST_JOIN_ERROR]', { error: message });
      res.status(500).json({ error: message });
    }
  }
);

/**
 * POST /ivs/viewer/join
 * 
 * Join a stream as viewer.
 * Request body: { streamId: string }
 * Response: { streamId, stageArn, region, role, participantToken, expiresAt, userId }
 */
export const viewerJoin = functions.https.onRequest(async (req, res) => {
    console.log('[LIVE_ROUTES][VIEWER_JOIN_REQUEST]', {
      method: req.method,
      ip: req.ip,
    });

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    try {
      // 1. Verify auth
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        res.status(401).json({ error: 'Authorization required' });
        return;
      }

      const userId = await verifyCognitoToken(authHeader);

      // 2. Parse request
      const { streamId } = req.body as ViewerJoinRequest;
      if (!streamId || typeof streamId !== 'string') {
        res.status(400).json({ error: 'streamId required' });
        return;
      }

      // 3. Call service
      const response = await joinAsViewer(userId, streamId);

      // 4. Return response
      res.status(200).json(response);

      console.log('[LIVE_ROUTES][VIEWER_JOIN_SUCCESS]', {
        userId,
        streamId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[LIVE_ROUTES][VIEWER_JOIN_ERROR]', { error: message });
      res.status(500).json({ error: message });
    }
  }
);
