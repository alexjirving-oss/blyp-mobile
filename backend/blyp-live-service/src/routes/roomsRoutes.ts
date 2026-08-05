// roomsRoutes — HTTP surface for hostless, topic-based group video rooms.
//
// Mounted under /api alongside liveRoutes. All routes require a verified Cognito
// JWT (same middleware as live/battle routes); the publisher userId is taken
// from the token, never the body, so a client can't claim a seat for someone
// else. Capacity is enforced server-side in roomsService (Firestore transaction).

import { Router } from 'express';
import { cognitoJwtMiddleware, AuthedRequest } from '../auth/cognitoJwtMiddleware';
import { requireNotBanned } from '../admin/banGuard';
import {
  listRooms,
  joinRoomAsPublisher,
  joinRoomAsViewer,
  leaveRoom,
  heartbeatRoom,
  sweepRoom,
  claimRoomAmbassador,
  pinAmbassadorIntro,
} from '../live/roomsService';

const router = Router();

router.use(cognitoJwtMiddleware);

// List active rooms (browse screen). Topic grouping is done client-side.
router.get('/rooms', async (_req: AuthedRequest, res) => {
  try {
    const rooms = await listRooms();
    res.json({ rooms });
  } catch (err: any) {
    res.status(err?.code === 'FIRESTORE_UNAVAILABLE' ? 503 : 500).json({
      error: 'Failed to list rooms',
      code: err?.code || 'UNKNOWN_ERROR',
      detail: err?.message,
    });
  }
});

// Join a room as a publisher (claim an open seat). 409 when the room is full so
// the client can offer a "watch instead" path.
router.post('/rooms/join', requireNotBanned, async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub || req.user?.username;
    if (!userId) return res.status(401).json({ error: 'User not found in token' });
    const { roomId, displayName } = req.body || {};
    if (!roomId) return res.status(400).json({ error: 'roomId required' });

    const result = await joinRoomAsPublisher(String(roomId), userId, displayName);
    res.json(result);
  } catch (err: any) {
    const code = err?.code || 'UNKNOWN_ERROR';
    const status = code === 'ROOM_FULL' ? 409 : code === 'ROOM_NOT_FOUND' ? 404 : 500;
    res.status(status).json({ error: 'Failed to join room', code, detail: err?.message });
  }
});

// Join a room as a SUBSCRIBE-only viewer.
router.post('/rooms/watch', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub || req.user?.username;
    if (!userId) return res.status(401).json({ error: 'User not found in token' });
    const { roomId, displayName } = req.body || {};
    if (!roomId) return res.status(400).json({ error: 'roomId required' });

    const result = await joinRoomAsViewer(String(roomId), userId, displayName);
    res.json(result);
  } catch (err: any) {
    const code = err?.code || 'UNKNOWN_ERROR';
    const status = code === 'ROOM_NOT_FOUND' ? 404 : 500;
    res.status(status).json({ error: 'Failed to watch room', code, detail: err?.message });
  }
});

// Free the caller's seat + remove presence (graceful leave).
router.post('/rooms/leave', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub || req.user?.username;
    if (!userId) return res.status(401).json({ error: 'User not found in token' });
    const { roomId } = req.body || {};
    if (!roomId) return res.status(400).json({ error: 'roomId required' });

    await leaveRoom(String(roomId), userId);
    res.json({ ok: true });
  } catch (err: any) {
    // Leave is best-effort cleanup; never hard-fail the client.
    res.status(200).json({ ok: true, detail: err?.message });
  }
});

// Presence heartbeat — keeps the caller's seat from being swept as stale.
router.post('/rooms/heartbeat', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub || req.user?.username;
    if (!userId) return res.status(401).json({ error: 'User not found in token' });
    const { roomId } = req.body || {};
    if (!roomId) return res.status(400).json({ error: 'roomId required' });

    await heartbeatRoom(String(roomId), userId);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(200).json({ ok: false, detail: err?.message });
  }
});

// On-demand stale sweep (also runnable from a scheduler). Reclaims dead seats.
router.post('/rooms/sweep', async (req: AuthedRequest, res) => {
  try {
    const { roomId } = req.body || {};
    if (!roomId) return res.status(400).json({ error: 'roomId required' });
    const removed = await sweepRoom(String(roomId));
    res.json({ ok: true, removed });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to sweep room', detail: err?.message });
  }
});

// Opt-in page ambassador for empty/low rooms (share, welcome, pin intro).
router.post('/rooms/ambassador/claim', requireNotBanned, async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub || req.user?.username;
    if (!userId) return res.status(401).json({ error: 'User not found in token' });
    const { roomId, displayName } = req.body || {};
    if (!roomId) return res.status(400).json({ error: 'roomId required' });

    const result = await claimRoomAmbassador(String(roomId), userId, displayName);
    res.json(result);
  } catch (err: any) {
    const code = err?.code || 'UNKNOWN_ERROR';
    const status =
      code === 'ROOM_NOT_FOUND' ? 404 : code === 'AMBASSADOR_FULL' ? 409 : 500;
    res.status(status).json({ error: 'Failed to claim ambassador', code, detail: err?.message });
  }
});

// Pin a short intro message (ambassadors only).
router.post('/rooms/ambassador/intro', requireNotBanned, async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub || req.user?.username;
    if (!userId) return res.status(401).json({ error: 'User not found in token' });
    const { roomId, text, displayName } = req.body || {};
    if (!roomId) return res.status(400).json({ error: 'roomId required' });
    if (!text) return res.status(400).json({ error: 'text required' });

    const result = await pinAmbassadorIntro(String(roomId), userId, String(text), displayName);
    res.json(result);
  } catch (err: any) {
    const code = err?.code || 'UNKNOWN_ERROR';
    const status =
      code === 'ROOM_NOT_FOUND' ? 404
        : code === 'NOT_AMBASSADOR' ? 403
          : code === 'INVALID_INTRO' ? 400
            : 500;
    res.status(status).json({ error: 'Failed to pin intro', code, detail: err?.message });
  }
});

export default router;
