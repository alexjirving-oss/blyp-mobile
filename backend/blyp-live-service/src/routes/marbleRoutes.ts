/**
 * Blyp Marble Race — live overlay routes.
 * Gated by LIVE_MARBLE_RACE_ENABLED (404 when dark).
 */
import { Router } from 'express';
import { z } from 'zod';
import { cognitoJwtMiddleware, AuthedRequest } from '../auth/cognitoJwtMiddleware';
import { requireNotBanned } from '../admin/banGuard';
import { getSessionById } from '../live/liveSessionStore';
import { logger } from '../config/logger';
import {
  startRace,
  nextHeat,
  endRace,
  pickMarble,
  getRoom,
  publicEvent,
  resumeTicksIfNeeded,
  type MarbleRoom,
} from '../games/marble/marbleRoomService';

const router = Router();

function marbleEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test(String(process.env.LIVE_MARBLE_RACE_ENABLED || '').trim());
}

function isMarblePath(req: { path?: string }): boolean {
  return String(req.path || '').startsWith('/live-game/marble');
}

// Scope kill-switch + Cognito to marble paths only — do not block sibling `/api` routers.
router.use((req, res, next) => {
  if (!isMarblePath(req)) return next();
  if (!marbleEnabled()) {
    return res.status(404).json({ error: 'DISABLED', code: 'DISABLED' });
  }
  return cognitoJwtMiddleware(req as AuthedRequest, res, next);
});

const startSchema = z.object({
  sessionId: z.string().min(1),
  hostName: z.string().min(1).max(40).optional(),
  racers: z
    .array(z.object({ userId: z.string().min(1), displayName: z.string().min(1).max(40) }))
    .min(2)
    .max(4)
    .optional(),
});

const sessionSchema = z.object({ sessionId: z.string().min(1) });
const pickSchema = z.object({ sessionId: z.string().min(1), racerUserId: z.string().min(1) });

function mapError(res: any, e: any) {
  const code = e?.code as string | undefined;
  const map: Record<string, number> = {
    NEED_GUESTS: 400,
    RACE_NOT_FOUND: 404,
    RACE_ENDED: 409,
    NOT_HOST: 403,
    PICKS_LOCKED: 409,
    GAME_BUSY: 409,
    SESSION_NOT_FOUND: 404,
  };
  if (code && map[code]) return res.status(map[code]).json({ error: code, code });
  logger.error({ err: e?.message, code }, '[marble] route error');
  return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
}

function respond(room: MarbleRoom) {
  return publicEvent(room, room.state.phase === 'ended' ? 'ENDED' : 'PHASE');
}

router.post('/live-game/marble/start', requireNotBanned, async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
    }
    const session = await getSessionById(parsed.data.sessionId);
    if (!session) return res.status(404).json({ error: 'SESSION_NOT_FOUND', code: 'SESSION_NOT_FOUND' });
    if (session.hostUserId !== userId) return res.status(403).json({ error: 'NOT_HOST', code: 'NOT_HOST' });
    const room = await startRace({
      sessionId: parsed.data.sessionId,
      hostUserId: userId,
      hostName: parsed.data.hostName,
      racers: parsed.data.racers,
    });
    res.json(respond(room));
  } catch (e: any) {
    mapError(res, e);
  }
});

router.post('/live-game/marble/next-heat', requireNotBanned, async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    const parsed = sessionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
    const room = await nextHeat({ sessionId: parsed.data.sessionId, hostUserId: userId });
    res.json(respond(room));
  } catch (e: any) {
    mapError(res, e);
  }
});

router.post('/live-game/marble/end', requireNotBanned, async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    const parsed = sessionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
    const room = await endRace({ sessionId: parsed.data.sessionId, hostUserId: userId });
    if (!room) return res.status(404).json({ error: 'RACE_NOT_FOUND', code: 'RACE_NOT_FOUND' });
    res.json(respond(room));
  } catch (e: any) {
    mapError(res, e);
  }
});

router.post('/live-game/marble/pick', requireNotBanned, async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    const parsed = pickSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
    const room = await pickMarble({
      sessionId: parsed.data.sessionId,
      pickerUserId: userId,
      racerUserId: parsed.data.racerUserId,
    });
    res.json(publicEvent(room, 'SNAPSHOT'));
  } catch (e: any) {
    mapError(res, e);
  }
});

router.get('/live-game/marble/state', async (req: AuthedRequest, res) => {
  try {
    const sessionId = String(req.query.sessionId || '');
    if (!sessionId) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
    const room = await getRoom(sessionId);
    if (!room) return res.status(404).json({ error: 'RACE_NOT_FOUND', code: 'RACE_NOT_FOUND' });
    await resumeTicksIfNeeded(sessionId);
    res.json(publicEvent(room, 'SNAPSHOT'));
  } catch (e: any) {
    mapError(res, e);
  }
});

export default router;
