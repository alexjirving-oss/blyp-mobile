import { Router } from 'express';
import { z } from 'zod';
import { cognitoJwtMiddleware, AuthedRequest } from '../auth/cognitoJwtMiddleware';
import { assertSessionHost } from '../live/liveService';
import {
  getTikTokRoomStatus,
  isTikTokRoomConfigured,
  listTikTokRoomEvents,
  startTikTokRoom,
  stopTikTokRoom,
} from '../live/tiktokRoomRead';

const router = Router();
router.use(cognitoJwtMiddleware);

const startSchema = z
  .object({
    uniqueId: z.string().min(2).max(80),
  })
  .strict();

function mapError(e: any, res: any) {
  const code = String(e?.code || 'INTERNAL');
  const status =
    code === 'FORBIDDEN' ? 403
      : code === 'INVALID_UNIQUE_ID' ? 400
          : /not found/i.test(String(e?.message || '')) ? 404
            : 500;
  return res.status(status).json({
    error: e?.message || 'TikTok room error',
    code,
  });
}

router.post('/live/:sessionId/tiktok-room/start', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub || req.user?.username;
    if (!userId) return res.status(401).json({ error: 'User not found in token' });
    const sessionId = String(req.params.sessionId || '').trim();
    await assertSessionHost(sessionId, userId);
    const parsed = startSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
    }
    const status = await startTikTokRoom({
      sessionId,
      uniqueId: parsed.data.uniqueId,
    });
    return res.json({ ok: true, status });
  } catch (e: any) {
    return mapError(e, res);
  }
});

router.post('/live/:sessionId/tiktok-room/stop', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub || req.user?.username;
    if (!userId) return res.status(401).json({ error: 'User not found in token' });
    const sessionId = String(req.params.sessionId || '').trim();
    await assertSessionHost(sessionId, userId);
    const status = await stopTikTokRoom(sessionId);
    return res.json({ ok: true, status });
  } catch (e: any) {
    return mapError(e, res);
  }
});

router.get('/live/:sessionId/tiktok-room/status', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub || req.user?.username;
    if (!userId) return res.status(401).json({ error: 'User not found in token' });
    const sessionId = String(req.params.sessionId || '').trim();
    await assertSessionHost(sessionId, userId);
    const status = await getTikTokRoomStatus(sessionId);
    return res.json({ ok: true, status, configured: isTikTokRoomConfigured() });
  } catch (e: any) {
    return mapError(e, res);
  }
});

router.get('/live/:sessionId/tiktok-room/events', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub || req.user?.username;
    if (!userId) return res.status(401).json({ error: 'User not found in token' });
    const sessionId = String(req.params.sessionId || '').trim();
    await assertSessionHost(sessionId, userId);
    const [status, events] = await Promise.all([
      getTikTokRoomStatus(sessionId),
      listTikTokRoomEvents(sessionId),
    ]);
    return res.json({ ok: true, status, events });
  } catch (e: any) {
    return mapError(e, res);
  }
});

export default router;
