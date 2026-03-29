import { Router } from 'express';
import { cognitoJwtMiddleware, AuthedRequest } from '../auth/cognitoJwtMiddleware';
import {
  startLiveSession,
  createViewerToken,
  createGuestToken,
  endLiveSession,
  joinLiveRealtime,
  requestGuestSlot,
  listGuestRequests,
  inviteGuest,
  rejectGuest,
  getGuest,
  leaveGuest,
  heartbeatGuest,
} from '../live/liveService';
import { bestEffortRedisPing } from '../economy/redisBestEffort';
import { logger } from '../config/logger';
import { headerValueDiagnostics } from '../utils/headerSanitize';

const router = Router();

router.use(cognitoJwtMiddleware);

function logRedisSoftFail(tag: '[LIVE_START_REDIS_SOFT_FAIL]' | '[GUEST_JOIN_REDIS_SOFT_FAIL]', payload: Record<string, unknown>) {
  // Use structured logging so Cloud Run log filters can reliably match `jsonPayload.msg`.
  logger.warn(payload, tag);
}

router.post('/live/start', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    const attemptId = (req.headers['x-golive-attempt-id'] as string) || (req.headers['x-goLive-attempt-id'] as string) || undefined;
    if (!userId) {
      return res.status(401).json({ error: 'User not found in token' });
    }
    const { title } = req.body || {};
    console.log('[API][/api/live/start]', { attemptId, user: userId });

    const route = '/api/live/start';

    // Redis is not required for IVS stage/token creation. Probe best-effort and degrade.
    try {
      const redis = await bestEffortRedisPing({
        op: 'live_start',
        timeoutMs: 3000,
        meta: { route, attemptId, userId, op: 'ping' },
      });
      if (!redis.ok) {
        logRedisSoftFail('[LIVE_START_REDIS_SOFT_FAIL]', {
          route,
          op: 'ping',
          attemptId,
          userId,
          code: redis.error?.code,
          message: redis.error?.message,
        });
      }
    } catch (e: any) {
      logRedisSoftFail('[LIVE_START_REDIS_SOFT_FAIL]', {
        route,
        op: 'ping',
        attemptId,
        userId,
        code: e?.code,
        message: e?.message || String(e),
      });
    }

    const result = await startLiveSession(userId, title || '');
    console.log('[LIVE_API][HOST_START]', {
      attemptId,
      hostUid: userId,
      sessionId: result?.session?.sessionId,
      status: result?.session?.status,
      stageArn: result?.session?.stageArn,
    });
    // Echo attemptId for client correlation
    res.json({ attemptId, ...result });
  } catch (err: any) {
    const status = err?.code === 'IVS_CREATE_STAGE_FAILED' ? 500 : 500;
    const incomingAuth = req.headers?.authorization;
    const hasIncomingAuthHeader = typeof incomingAuth === 'string' && incomingAuth.length > 0;
    console.error('[LIVE_BACKEND][START_FAIL]', {
      code: err?.code,
      stageName: err?.stageName,
      message: err?.message,
      detail: err?.originalMessage ?? err?.message,
      statusCode: err?.statusCode,
      hasIncomingAuthHeader,
      ...(hasIncomingAuthHeader
        ? { incomingAuthDiag: headerValueDiagnostics('incoming_authorization', incomingAuth) }
        : {}),
    });
    res.status(status).json({
      error: 'Failed to start live session',
      code: err?.code ?? 'UNKNOWN_ERROR',
      detail: err?.originalMessage ?? err?.message,
    });
  }
});

router.post('/live/join-realtime', async (req: AuthedRequest, res) => {
  try {
    const { streamId, displayName } = req.body || {};
    const viewerUserId = req.user?.sub;

    if (!streamId) {
      console.warn('[LIVE_BACKEND][JOIN_REALTIME_FAIL]', {
        streamId,
        viewerUserId,
        reason: 'missing_streamId',
      });
      return res.status(400).json({ error: 'streamId is required' });
    }

    if (!viewerUserId) {
      console.warn('[LIVE_BACKEND][JOIN_REALTIME_FAIL]', {
        streamId,
        viewerUserId,
        reason: 'missing_viewer_user',
      });
      return res.status(401).json({ error: 'User not found in token' });
    }

    console.log('[LIVE_API][JOIN_REALTIME]', {
      sessionId: streamId,
      viewerUserId,
      displayName,
    });

    const result = await joinLiveRealtime(streamId, viewerUserId, displayName);

    console.log('[LIVE_BACKEND][JOIN_REALTIME_SUCCESS]', {
      streamId,
      viewerUserId,
      stageArn: result.stageArn,
      role: 'viewer',
      status: 'live',
    });

    res.json(result);
  } catch (err: any) {
    const reason = err.message.includes('not found') ? 'session_not_found' : 'ivs_error';
    console.warn('[LIVE_BACKEND][JOIN_REALTIME_FAIL]', {
      streamId: req.body?.streamId,
      viewerUserId: req.user?.sub,
      reason,
      error: err.message,
    });
    res.status(err.message.includes('not found') ? 404 : 500).json({
      error: err.message,
    });
  }
});

router.post('/live/viewer-token', async (req: AuthedRequest, res) => {
  try {
    const viewerUserId = req.user?.sub;
    if (!viewerUserId) {
      return res.status(401).json({ error: 'User not found in token' });
    }
    const { sessionId } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required' });
    }
    const token = await createViewerToken(sessionId, viewerUserId);
    res.json(token);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to create viewer token', detail: err.message });
  }
});

router.post('/live/guest-token', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: 'User not found in token' });
    }
    const { sessionId, guestSessionId } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required' });
    }

    const route = '/api/live/guest-token';

    // Guest token flow must not be blocked by Redis instability.
    try {
      const redis = await bestEffortRedisPing({
        op: 'guest_token',
        timeoutMs: 3000,
        meta: { route, sessionId, userId, op: 'ping' },
      });
      if (!redis.ok) {
        logRedisSoftFail('[GUEST_JOIN_REDIS_SOFT_FAIL]', {
          route,
          op: 'ping',
          sessionId,
          userId,
          code: redis.error?.code,
          message: redis.error?.message,
        });
      }
    } catch (e: any) {
      logRedisSoftFail('[GUEST_JOIN_REDIS_SOFT_FAIL]', {
        route,
        op: 'ping',
        sessionId,
        userId,
        code: e?.code,
        message: e?.message || String(e),
      });
    }

    const token = await createGuestToken(sessionId, userId, guestSessionId);
    res.json(token);
  } catch (err: any) {
    const code = err?.code;
    const isAuthz = code === 'GUEST_NOT_INVITED' || code === 'GUEST_REQUEST_REJECTED' || code === 'GUEST_REQUEST_NOT_FOUND';
    res.status(isAuthz ? 403 : 500).json({
      error: 'Failed to create guest token',
      code: code || 'UNKNOWN_ERROR',
      detail: err?.message,
    });
  }
});

// Compatibility alias: canonical-style nested route.
// Treats POST /api/live/guest/token the same as POST /api/live/guest-token.
router.post('/live/guest/token', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: 'User not found in token' });
    }
    const { sessionId, guestSessionId } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required' });
    }

    const route = '/api/live/guest/token';

    try {
      const redis = await bestEffortRedisPing({
        op: 'guest_token',
        timeoutMs: 3000,
        meta: { route, sessionId, userId, op: 'ping' },
      });
      if (!redis.ok) {
        logRedisSoftFail('[GUEST_JOIN_REDIS_SOFT_FAIL]', {
          route,
          op: 'ping',
          sessionId,
          userId,
          code: redis.error?.code,
          message: redis.error?.message,
        });
      }
    } catch (e: any) {
      logRedisSoftFail('[GUEST_JOIN_REDIS_SOFT_FAIL]', {
        route,
        op: 'ping',
        sessionId,
        userId,
        code: e?.code,
        message: e?.message || String(e),
      });
    }

    const token = await createGuestToken(sessionId, userId, guestSessionId);
    res.json(token);
  } catch (err: any) {
    const code = err?.code;
    const isAuthz = code === 'GUEST_NOT_INVITED' || code === 'GUEST_REQUEST_REJECTED' || code === 'GUEST_REQUEST_NOT_FOUND';
    res.status(isAuthz ? 403 : 500).json({
      error: 'Failed to create guest token',
      code: code || 'UNKNOWN_ERROR',
      detail: err?.message,
    });
  }
});

router.post('/live/guest/request', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: 'User not found in token' });
    }
    const { sessionId } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required' });
    }

    const slotIndexRequested = req.body?.slotIndexRequested;
    await requestGuestSlot(
      sessionId,
      userId,
      typeof slotIndexRequested === 'number' ? slotIndexRequested : undefined
    );
    res.json({ ok: true });
  } catch (err: any) {
    const code = err?.code;
    const status = code === 'GUEST_SESSION_ACTIVE' ? 409 : 500;
    res.status(status).json({ error: 'Failed to request guest slot', code: code || 'UNKNOWN_ERROR', detail: err?.message });
  }
});

router.post('/live/guest/leave', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: 'User not found in token' });
    }

    const { sessionId, guestSessionId, force } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required' });
    }

    await leaveGuest(sessionId, userId, { guestSessionId, force: force === true });
    res.json({ ok: true });
  } catch (err: any) {
    // Cleanup should be best-effort; return ok even if the record was already cleared.
    res.status(200).json({ ok: true, detail: err?.message });
  }
});

router.post('/live/guest/heartbeat', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: 'User not found in token' });
    }

    const { sessionId, guestSessionId } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required' });
    }
    if (!guestSessionId) {
      return res.status(400).json({ error: 'guestSessionId required' });
    }

    await heartbeatGuest(sessionId, userId, guestSessionId);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(409).json({ ok: false, error: 'Heartbeat failed', detail: err?.message });
  }
});

router.get('/live/guest/requests', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: 'User not found in token' });
    }

    const sessionId = (req.query?.sessionId as string) || '';
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required' });
    }

    const requests = await listGuestRequests(sessionId);
    res.json({
      requests: requests.map((r) => ({
        userId: r.userId,
        status: r.state,
        requestedAt: r.requestedAt,
        updatedAt: r.updatedAt,
        sessionId: r.sessionId,
        slotIndex: r.slotIndex,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to list guest requests', detail: err.message });
  }
});

router.get('/live/guest/me', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: 'User not found in token' });
    }

    const sessionId = (req.query?.sessionId as string) || '';
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required' });
    }

    const record = await getGuest(sessionId, userId);
    if (!record) {
      return res.json({ request: null });
    }
    res.json({
      request: {
        userId: record.userId,
        status: record.state,
        requestedAt: record.requestedAt,
        updatedAt: record.updatedAt,
        sessionId: record.sessionId,
        slotIndex: record.slotIndex,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch guest request', detail: err.message });
  }
});

router.post('/live/guest/invite', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: 'User not found in token' });
    }

    const { sessionId, guestUserId } = req.body || {};
    if (!sessionId || !guestUserId) {
      return res.status(400).json({ error: 'sessionId and guestUserId required' });
    }

    const { slotIndex, stageArn } = await inviteGuest(sessionId, guestUserId);
    // For backward compatibility with client types, return a token placeholder.
    // The guest will mint their own token via /live/guest-token after they observe INVITED.
    res.json({
      token: 'INVITED',
      stageArn,
      sessionId,
      guestUserId,
      slotIndex,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to invite guest', detail: err.message });
  }
});

// Compatibility alias: accept == invite (host approval).
// Treats POST /api/live/guest/accept the same as POST /api/live/guest/invite.
router.post('/live/guest/accept', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: 'User not found in token' });
    }

    const { sessionId, guestUserId } = req.body || {};
    if (!sessionId || !guestUserId) {
      return res.status(400).json({ error: 'sessionId and guestUserId required' });
    }

    const { slotIndex, stageArn } = await inviteGuest(sessionId, guestUserId);
    res.json({
      token: 'INVITED',
      stageArn,
      sessionId,
      guestUserId,
      slotIndex,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to invite guest', detail: err.message });
  }
});

router.post('/live/guest/reject', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: 'User not found in token' });
    }
    const { sessionId, guestUserId } = req.body || {};
    if (!sessionId || !guestUserId) {
      return res.status(400).json({ error: 'sessionId and guestUserId required' });
    }
    await rejectGuest(sessionId, guestUserId);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to reject guest', detail: err.message });
  }
});

router.post('/live/end', async (req: AuthedRequest, res) => {
  try {
    const { sessionId } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required' });
    }
    await endLiveSession(sessionId);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to end live session', detail: err.message });
  }
});

export default router;
