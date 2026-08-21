/**
 * Blyp Artillery — server-authoritative battle-stage game routes.
 *
 * Actions go over REST (validated here + in gameRoomService); the resulting
 * authoritative state is fanned out to the live room over the `game_event`
 * Socket.IO channel. Gated by LIVE_ARTILLERY_ENABLED so it ships dark.
 */
import { Router } from 'express';
import { z } from 'zod';
import { cognitoJwtMiddleware, AuthedRequest } from '../auth/cognitoJwtMiddleware';
import { requireNotBanned } from '../admin/banGuard';
import { getSessionById } from '../live/liveSessionStore';
import { emitGameEvent } from '../realtime/realtimeBus';
import { logger } from '../config/logger';
import { startMatch, joinMatch, fire, getRoom, type GameRoom } from '../games/artillery/gameRoomService';
import type { Outcome } from '../games/artillery/engine';

const router = Router();

function artilleryEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test(String(process.env.LIVE_ARTILLERY_ENABLED || '').trim());
}

function isArtilleryPath(req: { path?: string }): boolean {
  return String(req.path || '').startsWith('/live-game/artillery');
}

// Scope kill-switch + Cognito to artillery paths only. This router is mounted at
// `/api` alongside marble/frenemies; blanket auth or DISABLED would block siblings.
router.use((req, res, next) => {
  if (!isArtilleryPath(req)) return next();
  if (!artilleryEnabled()) {
    return res.status(404).json({ error: 'DISABLED', code: 'DISABLED' });
  }
  return cognitoJwtMiddleware(req as AuthedRequest, res, next);
});

const startSchema = z.object({
  sessionId: z.string().min(1),
  battleId: z.string().min(1).optional(),
  creatorName: z.string().min(1).max(40).optional(),
  opponentName: z.string().min(1).max(40).optional(),
});

const joinSchema = z.object({ sessionId: z.string().min(1) });

const fireSchema = z.object({
  sessionId: z.string().min(1),
  unitId: z.coerce.number().int(),
  weaponId: z.string().min(1).max(32),
  angleDeg: z.coerce.number().min(0).max(90),
  power: z.coerce.number().min(0).max(1),
});

/** Build the snapshot payload broadcast to the room (no server-only fields). */
function stateEvent(room: GameRoom) {
  return {
    sessionId: room.sessionId,
    type: 'STATE' as const,
    version: room.version,
    battleId: room.battleId,
    players: room.players,
    state: room.state,
  };
}

function shotEvent(room: GameRoom, outcome: Outcome) {
  return {
    sessionId: room.sessionId,
    type: 'SHOT' as const,
    version: room.version,
    battleId: room.battleId,
    players: room.players,
    outcome,
    state: room.state,
  };
}

function mapError(res: any, e: any) {
  const code = e?.code as string | undefined;
  const map: Record<string, number> = {
    MATCH_NOT_FOUND: 404,
    MATCH_ENDED: 409,
    NOT_YOUR_TURN: 403,
    BAD_WEAPON: 400,
    BAD_UNIT: 400,
    BAD_SHOT: 400,
    GAME_BUSY: 409,
  };
  if (code && map[code]) return res.status(map[code]).json({ error: code, code });
  logger.error({ err: e?.message, code }, '[artillery] route error');
  return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
}

// Creator opens the match on their battle session.
router.post('/live-game/artillery/start', requireNotBanned, async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });

    const session = await getSessionById(parsed.data.sessionId);
    if (!session) return res.status(404).json({ error: 'SESSION_NOT_FOUND', code: 'SESSION_NOT_FOUND' });
    if (session.hostUserId !== userId) {
      return res.status(403).json({ error: 'NOT_HOST', code: 'NOT_HOST' });
    }

    const room = await startMatch({
      sessionId: parsed.data.sessionId,
      battleId: parsed.data.battleId ?? null,
      hostUserId: userId,
      creatorName: parsed.data.creatorName,
      opponentName: parsed.data.opponentName,
    });
    emitGameEvent(room.sessionId, stateEvent(room));
    res.json(stateEvent(room));
  } catch (e: any) {
    mapError(res, e);
  }
});

// Opponent registers as team 1.
router.post('/live-game/artillery/join', requireNotBanned, async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    const parsed = joinSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });

    const room = await joinMatch({ sessionId: parsed.data.sessionId, userId });
    emitGameEvent(room.sessionId, stateEvent(room));
    res.json(stateEvent(room));
  } catch (e: any) {
    mapError(res, e);
  }
});

// Current-turn player fires.
router.post('/live-game/artillery/fire', requireNotBanned, async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    const parsed = fireSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });

    const { sessionId, unitId, weaponId, angleDeg, power } = parsed.data;
    const { room, outcome } = await fire({ sessionId, userId, input: { unitId, weaponId, angleDeg, power } });
    emitGameEvent(room.sessionId, shotEvent(room, outcome));
    res.json(shotEvent(room, outcome));
  } catch (e: any) {
    mapError(res, e);
  }
});

// Spectators / late joiners fetch current state.
router.get('/live-game/artillery/state', async (req: AuthedRequest, res) => {
  try {
    const sessionId = String(req.query.sessionId || '');
    if (!sessionId) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
    const room = await getRoom(sessionId);
    if (!room) return res.status(404).json({ error: 'MATCH_NOT_FOUND', code: 'MATCH_NOT_FOUND' });
    res.json(stateEvent(room));
  } catch (e: any) {
    mapError(res, e);
  }
});

export default router;
