import { Router } from 'express';
import { cognitoJwtMiddleware, AuthedRequest } from '../auth/cognitoJwtMiddleware';
import {
  startLiveSession,
  createViewerToken,
  createGuestToken,
  endLiveSession,
  joinLiveRealtime,
  joinLiveMass,
  requestGuestSlot,
  listGuestRequests,
  inviteGuest,
  rejectGuest,
  kickGuest,
  muteGuest,
  setGuestCamera,
  hostInviteGuest,
  addModerator,
  removeModerator,
  getGuest,
  leaveGuest,
  heartbeatGuest,
  startBattleStage,
  joinBattleStage,
  assertSessionHost,
} from '../live/liveService';
import { bestEffortRedisPing } from '../economy/redisBestEffort';
import { logger } from '../config/logger';
import { headerValueDiagnostics } from '../utils/headerSanitize';
import { requireNotBanned } from '../admin/banGuard';
import { requireCanGoLive } from '../admin/liveRestrictionGuard';
import {
  endFirestoreStream,
  sweepStaleLiveDirectory,
  touchLiveDirectoryHeartbeat,
} from '../admin/firestoreAdmin';
import { getSessionById } from '../live/liveSessionStore';
import { battlesEnabled, battlesDisabledPayload } from '../battles/battlesFlags';

const router = Router();

router.use(cognitoJwtMiddleware);

function resolveLiveSessionId(body: any): string {
  return String(body?.streamId || body?.sessionId || '').trim();
}

/** Clear Firestore discovery when Dynamo says the session is gone/ended. */
async function clearDirectoryGhost(sessionId: string, reason: string): Promise<void> {
  if (!sessionId) return;
  try {
    const result = await endFirestoreStream(sessionId);
    logger.warn({ sessionId, reason, ok: result.ok, detail: result.detail }, '[LIVE][DIRECTORY_GHOST_CLEAR]');
  } catch (e: any) {
    logger.warn({ sessionId, reason, err: e?.message || String(e) }, '[LIVE][DIRECTORY_GHOST_CLEAR_FAIL]');
  }
}

function logRedisSoftFail(tag: '[LIVE_START_REDIS_SOFT_FAIL]' | '[GUEST_JOIN_REDIS_SOFT_FAIL]', payload: Record<string, unknown>) {
  // Use structured logging so Cloud Run log filters can reliably match `jsonPayload.msg`.
  logger.warn(payload, tag);
}

router.post('/live/start', requireNotBanned, requireCanGoLive, async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub || req.user?.username;
    const attemptId = (req.headers['x-golive-attempt-id'] as string) || (req.headers['x-goLive-attempt-id'] as string) || undefined;
    if (!userId) {
      return res.status(401).json({ error: 'User not found in token' });
    }
    const { title, region } = req.body || {};
    console.log('[API][/api/live/start]', { attemptId, user: userId, region: region || '(none)' });

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

    const result = await startLiveSession(userId, title || '', typeof region === 'string' ? region : undefined);
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

/**
 * Lightweight joinability probe for client Live-tab taps.
 * Returns whether Dynamo still has a LIVE session for this id.
 * Also opportunistically sweeps stale Firestore ghosts so badges/cards clear.
 */
router.get('/live/session/:sessionId/status', async (req: AuthedRequest, res) => {
  try {
    const sessionId = String(req.params?.sessionId || '').trim();
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required', code: 'MISSING_SESSION_ID' });
    }
    const session = await getSessionById(sessionId);
    const live = !!(session && session.status === 'LIVE');
    if (!live) {
      void clearDirectoryGhost(sessionId, 'status_probe_miss');
    }
    // Best-effort background sweep of other stale cards (non-blocking).
    void sweepStaleLiveDirectory({ staleMs: 3 * 60_000, limit: 25 });
    return res.json({
      sessionId,
      live,
      status: session?.status || 'MISSING',
      hostUserId: session?.hostUserId || null,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: 'Failed to resolve session status',
      detail: err?.message || String(err),
    });
  }
});

router.post('/live/join-realtime', async (req: AuthedRequest, res) => {
  try {
    const streamId = resolveLiveSessionId(req.body || {});
    const { displayName } = req.body || {};
    const viewerUserId = req.user?.sub;

    if (!streamId) {
      console.warn('[LIVE_BACKEND][JOIN_REALTIME_FAIL]', JSON.stringify({
        streamId,
        viewerUserId,
        reason: 'missing_streamId',
      }));
      return res.status(400).json({ error: 'streamId is required', code: 'MISSING_STREAM_ID' });
    }

    if (!viewerUserId) {
      console.warn('[LIVE_BACKEND][JOIN_REALTIME_FAIL]', JSON.stringify({
        streamId,
        viewerUserId,
        reason: 'missing_viewer_user',
      }));
      return res.status(401).json({ error: 'User not found in token' });
    }

    console.log('[LIVE_API][JOIN_REALTIME]', JSON.stringify({
      sessionId: streamId,
      viewerUserId,
      displayName,
    }));

    const result = await joinLiveRealtime(streamId, viewerUserId, displayName);

    console.log('[LIVE_BACKEND][JOIN_REALTIME_SUCCESS]', JSON.stringify({
      streamId,
      viewerUserId,
      stageArn: result.stageArn,
      role: 'viewer',
      status: 'live',
    }));

    res.json(result);
  } catch (err: any) {
    const message = String(err?.message || 'Failed to join');
    const notFound = /not found|not live/i.test(message);
    const reason = notFound ? 'session_not_found' : 'ivs_error';
    const streamId = resolveLiveSessionId(req.body || {});
    console.warn('[LIVE_BACKEND][JOIN_REALTIME_FAIL]', JSON.stringify({
      streamId,
      viewerUserId: req.user?.sub,
      reason,
      error: message,
    }));
    // Split-brain: Firestore still lists a card whose Dynamo session is gone/ENDED.
    // Clear the directory entry so account B stops trying to join a dead id.
    if (notFound && streamId) {
      void clearDirectoryGhost(streamId, 'join_realtime_miss');
    }
    res.status(notFound ? 404 : 500).json({
      error: message,
      code: reason === 'session_not_found' ? 'SESSION_NOT_FOUND' : 'JOIN_FAILED',
    });
  }
});

router.post('/live/join', async (req: AuthedRequest, res) => {
  try {
    const id = resolveLiveSessionId(req.body || {});
    const { displayName } = req.body || {};
    const viewerUserId = req.user?.sub;
    if (!id) {
      return res.status(400).json({ error: 'sessionId is required' });
    }
    if (!viewerUserId) {
      return res.status(401).json({ error: 'User not found in token' });
    }
    const result = await joinLiveMass(id, viewerUserId, displayName);
    return res.json(result);
  } catch (err: any) {
    const message = String(err?.message || 'Failed to join live session');
    const notFound = /not found|not live/i.test(message);
    const id = resolveLiveSessionId(req.body || {});
    if (notFound && id) {
      void clearDirectoryGhost(id, 'join_mass_miss');
    }
    return res.status(notFound ? 404 : 500).json({
      error: message,
      code: notFound ? 'SESSION_NOT_FOUND' : 'JOIN_FAILED',
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

    const requests = await listGuestRequests(sessionId, userId);
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
    const status = err?.code === 'FORBIDDEN' ? 403 : 500;
    res.status(status).json({
      error: 'Failed to list guest requests',
      code: err?.code || 'UNKNOWN_ERROR',
      detail: err.message,
    });
  }
});

/**
 * Host presence ping. Web studio must call this while on-air so Firestore
 * discovery heartbeats stay fresh; otherwise /live/session/:id/status sweeps
 * end the directory card after ~3 minutes even though Dynamo is still LIVE.
 */
router.post('/live/heartbeat', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: 'User not found in token' });
    }
    const sessionId = resolveLiveSessionId(req.body || {});
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required' });
    }
    await assertSessionHost(sessionId, userId);
    const touched = await touchLiveDirectoryHeartbeat(sessionId);
    res.json({ ok: touched.ok, sessionId, detail: touched.detail });
  } catch (err: any) {
    const status = err?.code === 'FORBIDDEN' ? 403 : 500;
    res.status(status).json({
      error: 'Failed to heartbeat live session',
      code: err?.code || 'UNKNOWN_ERROR',
      detail: err?.message,
    });
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

    const { slotIndex, stageArn } = await inviteGuest(sessionId, guestUserId, userId);
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
    const status = err?.code === 'FORBIDDEN' ? 403 : err?.code === 'PANEL_FULL' ? 409 : 500;
    res.status(status).json({ error: 'Failed to invite guest', code: err?.code, detail: err.message });
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

    const { slotIndex, stageArn } = await inviteGuest(sessionId, guestUserId, userId);
    res.json({
      token: 'INVITED',
      stageArn,
      sessionId,
      guestUserId,
      slotIndex,
    });
  } catch (err: any) {
    const status = err?.code === 'FORBIDDEN' ? 403 : err?.code === 'PANEL_FULL' ? 409 : 500;
    res.status(status).json({ error: 'Failed to invite guest', code: err?.code, detail: err.message });
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
    await rejectGuest(sessionId, guestUserId, userId);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(err?.code === 'FORBIDDEN' ? 403 : 500).json({ error: 'Failed to reject guest', code: err?.code, detail: err.message });
  }
});

// Host-only: mute/unmute a guest's mic. Body: { sessionId, guestUserId, muted }.
router.post('/live/guest/mute', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: 'User not found in token' });
    }
    const { sessionId, guestUserId, muted } = req.body || {};
    if (!sessionId || !guestUserId || typeof muted !== 'boolean') {
      return res.status(400).json({ error: 'sessionId, guestUserId and muted (boolean) required' });
    }
    await muteGuest(sessionId, userId, guestUserId, muted);
    res.json({ ok: true, muted });
  } catch (err: any) {
    res.status(err?.code === 'FORBIDDEN' ? 403 : 500).json({ error: 'Failed to mute guest', code: err?.code, detail: err.message });
  }
});

// Host-only: turn a guest's camera off/on. Body: { sessionId, guestUserId, cameraOff }.
router.post('/live/guest/camera', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: 'User not found in token' });
    }
    const { sessionId, guestUserId, cameraOff } = req.body || {};
    if (!sessionId || !guestUserId || typeof cameraOff !== 'boolean') {
      return res.status(400).json({ error: 'sessionId, guestUserId and cameraOff (boolean) required' });
    }
    await setGuestCamera(sessionId, userId, guestUserId, cameraOff);
    res.json({ ok: true, cameraOff });
  } catch (err: any) {
    res.status(err?.code === 'FORBIDDEN' ? 403 : 500).json({ error: 'Failed to set guest camera', code: err?.code, detail: err.message });
  }
});

// Host-only: invite a VIEWER (who hasn't requested) up onto the stage as a guest.
// Body: { sessionId, guestUserId }.
router.post('/live/guest/host-invite', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: 'User not found in token' });
    }
    const { sessionId, guestUserId } = req.body || {};
    if (!sessionId || !guestUserId) {
      return res.status(400).json({ error: 'sessionId and guestUserId required' });
    }
    const result = await hostInviteGuest(sessionId, userId, guestUserId);
    res.json({ ok: true, slotIndex: result.slotIndex });
  } catch (err: any) {
    const code = err?.code;
    const status = code === 'FORBIDDEN' ? 403 : code === 'PANEL_FULL' ? 409 : 500;
    res.status(status).json({ error: 'Failed to invite guest', code, detail: err.message });
  }
});

// Host-only: appoint / revoke a moderator. Body: { sessionId, moderatorUserId }.
router.post('/live/moderator/add', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: 'User not found in token' });
    }
    const { sessionId, moderatorUserId } = req.body || {};
    if (!sessionId || !moderatorUserId) {
      return res.status(400).json({ error: 'sessionId and moderatorUserId required' });
    }
    await addModerator(sessionId, userId, moderatorUserId);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(err?.code === 'FORBIDDEN' ? 403 : 500).json({ error: 'Failed to add moderator', code: err?.code, detail: err.message });
  }
});

router.post('/live/moderator/remove', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: 'User not found in token' });
    }
    const { sessionId, moderatorUserId } = req.body || {};
    if (!sessionId || !moderatorUserId) {
      return res.status(400).json({ error: 'sessionId and moderatorUserId required' });
    }
    await removeModerator(sessionId, userId, moderatorUserId);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(err?.code === 'FORBIDDEN' ? 403 : 500).json({ error: 'Failed to remove moderator', code: err?.code, detail: err.message });
  }
});

// Host or moderator: forcibly remove a guest from the stage.
router.post('/live/guest/kick', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: 'User not found in token' });
    }
    const { sessionId, guestUserId } = req.body || {};
    if (!sessionId || !guestUserId) {
      return res.status(400).json({ error: 'sessionId and guestUserId required' });
    }
    await kickGuest(sessionId, userId, guestUserId);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(err?.code === 'FORBIDDEN' ? 403 : 500).json({ error: 'Failed to kick guest', code: err?.code, detail: err.message });
  }
});

// Battles — start the shared stage (creator) / join it (opponent). Both are
// equal co-hosts: no request/approve dance.
router.post('/live/battle/start', requireNotBanned, requireCanGoLive, async (req: AuthedRequest, res) => {
  try {
    if (!battlesEnabled()) return res.status(404).json(battlesDisabledPayload());
    const userId = req.user?.sub || req.user?.username;
    if (!userId) return res.status(401).json({ error: 'User not found in token' });
    const { battleId, title, region } = req.body || {};
    if (!battleId) return res.status(400).json({ error: 'battleId required' });
    const result = await startBattleStage(userId, String(battleId), title || '', typeof region === 'string' ? region : undefined);
    res.json(result);
  } catch (err: any) {
    const status = Number(err?.httpStatus) || (err?.code === 'FORBIDDEN' ? 403 : 500);
    res.status(status).json({
      error: 'Failed to start battle stage',
      code: err?.code ?? 'UNKNOWN_ERROR',
      detail: err?.originalMessage ?? err?.message,
    });
  }
});

router.post('/live/battle/join', requireNotBanned, async (req: AuthedRequest, res) => {
  try {
    if (!battlesEnabled()) return res.status(404).json(battlesDisabledPayload());
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'User not found in token' });
    const { sessionId, battleId } = req.body || {};
    if (!sessionId || !battleId) return res.status(400).json({ error: 'sessionId and battleId required' });
    const result = await joinBattleStage(userId, String(sessionId), String(battleId));
    res.json(result);
  } catch (err: any) {
    const notFound = String(err?.message || '').includes('not found');
    const status = Number(err?.httpStatus) || (err?.code === 'FORBIDDEN' ? 403 : notFound ? 404 : 500);
    res.status(status).json({
      error: 'Failed to join battle stage',
      code: err?.code,
      detail: err?.message,
    });
  }
});

router.post('/live/end', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub || req.user?.username;
    if (!userId) {
      return res.status(401).json({ error: 'User not found in token' });
    }
    const { sessionId } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required' });
    }
    // Only the host may end their own session. Admin force-end goes through the
    // separate admin route (which calls endLiveSession directly). If the session
    // no longer exists, treat end as idempotently successful.
    try {
      await assertSessionHost(sessionId, userId);
    } catch (authErr: any) {
      if (authErr?.code === 'FORBIDDEN') {
        return res.status(403).json({ error: 'Only the host can end this session', code: 'FORBIDDEN' });
      }
      // Session not found -> nothing to end; respond ok for idempotency.
      return res.json({ ok: true, detail: 'no active session' });
    }
    await endLiveSession(sessionId);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to end live session', detail: err.message });
  }
});

export default router;
