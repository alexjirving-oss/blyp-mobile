/**
 * Reaction Duel live skill-game routes.
 * Gated by LIVE_REACTION_DUEL_ENABLED (default ON for demo).
 */
import { Router } from 'express';
import { z } from 'zod';
import {
  cognitoJwtMiddleware,
  type AuthedRequest,
} from '../auth/cognitoJwtMiddleware';
import { requireNotBanned } from '../admin/banGuard';
import { getSessionById } from '../live/liveSessionStore';
import { logger } from '../config/logger';
import { isFrenemiesAdmin } from '../games/frenemies/frenemiesRoomService';
import {
  REACTION_DUEL_DEFAULT_STAKE_COINS,
  REACTION_DUEL_MAX_STAKE_COINS,
  REACTION_DUEL_MIN_STAKE_COINS,
} from '../games/reactionDuel/reactionDuelEngine';
import {
  endDuel,
  getRoom,
  heartbeatPlayer,
  lockPlayer,
  publicEvent,
  resumeTicksIfNeeded,
  startDuel,
  submitTap,
  type ReactionDuelEventType,
  type ReactionDuelRoom,
} from '../games/reactionDuel/reactionDuelRoomService';

const router = Router();
router.use(cognitoJwtMiddleware);

function reactionDuelEnabled(): boolean {
  const raw = String(
    process.env.LIVE_REACTION_DUEL_ENABLED ?? '1',
  ).trim();
  return !/^(0|false|no|off)$/i.test(raw);
}

router.use((req, res, next) => {
  if (!req.path.startsWith('/live-game/reaction-duel')) return next();
  if (!reactionDuelEnabled()) {
    return res.status(404).json({ error: 'DISABLED', code: 'DISABLED' });
  }
  next();
});

const startSchema = z.object({
  sessionId: z.string().min(1),
  opponentUserId: z.string().min(1),
  stakeCoins: z
    .number()
    .int()
    .min(REACTION_DUEL_MIN_STAKE_COINS)
    .max(REACTION_DUEL_MAX_STAKE_COINS)
    .default(REACTION_DUEL_DEFAULT_STAKE_COINS),
  hostDisplayName: z.string().min(1).max(80).optional(),
  opponentDisplayName: z.string().min(1).max(80).optional(),
});
const sessionSchema = z.object({ sessionId: z.string().min(1) });
const tapSchema = z.object({
  sessionId: z.string().min(1),
  promptId: z.string().min(1).max(160),
  targetId: z.string().min(1).max(200),
});

function eventTypeFor(room: ReactionDuelRoom): ReactionDuelEventType {
  if (room.state.phase === 'ended') return 'ENDED';
  if (room.state.phase === 'refunded') return 'REFUNDED';
  if (room.state.phase === 'round_result') return 'ROUND';
  return 'SNAPSHOT';
}

function mapError(res: any, error: any) {
  const code = String(error?.code || '');
  if (code === 'INSUFFICIENT_FUNDS') {
    return res.status(409).json({
      error: String(error?.message || 'Not enough coins to lock this Reaction Duel stake.'),
      code,
    });
  }
  const statusByCode: Record<string, number> = {
    NOT_ADMIN: 403,
    NOT_AUTHORIZED: 403,
    NOT_PLAYER: 403,
    BAD_OPPONENT: 400,
    BAD_TARGET: 400,
    INVALID_STAKE: 400,
    OPPONENT_NOT_ON_STAGE: 409,
    GAME_NOT_FOUND: 404,
    GAME_BUSY: 409,
    ENTRIES_CLOSED: 409,
    NO_ACTIVE_PROMPT: 409,
    STALE_PROMPT: 409,
    ALREADY_TAPPED: 409,
    IMPOSSIBLE_TAP: 422,
    TOO_LATE: 409,
    SESSION_NOT_FOUND: 404,
    NOT_LIVE: 409,
    CONFLICT: 409,
  };
  if (code && statusByCode[code]) {
    return res.status(statusByCode[code]).json({ error: code, code });
  }
  logger.error(
    { err: error?.message, code },
    '[reaction-duel] route error',
  );
  return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
}

router.post(
  '/live-game/reaction-duel/start',
  requireNotBanned,
  async (req: AuthedRequest, res) => {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
      }
      const parsed = startSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
      }
      const session = await getSessionById(parsed.data.sessionId);
      if (!session) {
        return res.status(404).json({
          error: 'SESSION_NOT_FOUND',
          code: 'SESSION_NOT_FOUND',
        });
      }
      // The live host owns game start. Staff admins retain the ability to run demos.
      if (session.hostUserId !== userId && !isFrenemiesAdmin(userId)) {
        return res
          .status(403)
          .json({ error: 'HOST_ONLY', code: 'HOST_ONLY' });
      }
      if (session.status !== 'LIVE') {
        return res.status(409).json({ error: 'NOT_LIVE', code: 'NOT_LIVE' });
      }
      const room = await startDuel({
        sessionId: parsed.data.sessionId,
        hostUserId: session.hostUserId,
        starterUserId: userId,
        opponentUserId: parsed.data.opponentUserId,
        stakeCoins: parsed.data.stakeCoins,
        hostDisplayName: parsed.data.hostDisplayName,
        opponentDisplayName: parsed.data.opponentDisplayName,
      });
      res.json(publicEvent(room, 'PHASE'));
    } catch (error: any) {
      mapError(res, error);
    }
  },
);

router.post(
  '/live-game/reaction-duel/lock',
  requireNotBanned,
  async (req: AuthedRequest, res) => {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
      }
      const parsed = sessionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
      }
      const room = await lockPlayer({
        sessionId: parsed.data.sessionId,
        userId,
      });
      res.json(publicEvent(room, eventTypeFor(room)));
    } catch (error: any) {
      mapError(res, error);
    }
  },
);

router.post(
  '/live-game/reaction-duel/tap',
  requireNotBanned,
  async (req: AuthedRequest, res) => {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
      }
      const parsed = tapSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
      }
      const room = await submitTap({ ...parsed.data, userId });
      res.json(publicEvent(room, eventTypeFor(room)));
    } catch (error: any) {
      mapError(res, error);
    }
  },
);

router.post(
  '/live-game/reaction-duel/heartbeat',
  requireNotBanned,
  async (req: AuthedRequest, res) => {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
      }
      const parsed = sessionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
      }
      await heartbeatPlayer({ sessionId: parsed.data.sessionId, userId });
      res.json({ ok: true });
    } catch (error: any) {
      mapError(res, error);
    }
  },
);

router.post(
  '/live-game/reaction-duel/end',
  requireNotBanned,
  async (req: AuthedRequest, res) => {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
      }
      const parsed = sessionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
      }
      const room = await endDuel({
        sessionId: parsed.data.sessionId,
        userId,
        isAdmin: isFrenemiesAdmin(userId),
      });
      if (!room) {
        return res
          .status(404)
          .json({ error: 'GAME_NOT_FOUND', code: 'GAME_NOT_FOUND' });
      }
      res.json(publicEvent(room, eventTypeFor(room)));
    } catch (error: any) {
      mapError(res, error);
    }
  },
);

router.get(
  '/live-game/reaction-duel/state',
  async (req: AuthedRequest, res) => {
    try {
      const sessionId = String(req.query.sessionId || '');
      if (!sessionId) {
        return res
          .status(400)
          .json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
      }
      const room = await getRoom(sessionId);
      if (!room) {
        return res
          .status(404)
          .json({ error: 'GAME_NOT_FOUND', code: 'GAME_NOT_FOUND' });
      }
      await resumeTicksIfNeeded(sessionId);
      res.json(publicEvent(room, eventTypeFor(room)));
    } catch (error: any) {
      mapError(res, error);
    }
  },
);

export default router;
