/**
 * Frenemies live party game routes.
 * Gated by LIVE_FRENEMIES_ENABLED (default ON; set 0 to kill-switch).
 */
import { Router } from 'express';
import { z } from 'zod';
import { cognitoJwtMiddleware, AuthedRequest } from '../auth/cognitoJwtMiddleware';
import { requireNotBanned } from '../admin/banGuard';
import { getSessionById } from '../live/liveSessionStore';
import { logger } from '../config/logger';
import {
  startGame,
  endGame,
  spinRound,
  updateSettings,
  throwGuest,
  submitQuizAnswer,
  submitChatPhrase,
  reportLikes,
  getRoom,
  publicEvent,
  resumeTicksIfNeeded,
  bumpEngagement,
  getSessionEngagement,
  getHostPrizePreview,
  isFrenemiesAdmin,
  requestJoinQueue,
  leaveJoinQueue,
  jumpKickTakeSeat,
  buyExtraLife,
} from '../games/frenemies/frenemiesRoomService';

const router = Router();
router.use(cognitoJwtMiddleware);

function frenemiesEnabled(): boolean {
  const raw = String(process.env.LIVE_FRENEMIES_ENABLED ?? '1').trim();
  return !/^(0|false|no|off)$/i.test(raw);
}

router.use((req, res, next) => {
  const ours =
    req.path.startsWith('/live-game/frenemies') || req.path.startsWith('/live/engagement');
  if (!ours) {
    return next();
  }
  if (!frenemiesEnabled()) {
    return res.status(404).json({ error: 'DISABLED', code: 'DISABLED' });
  }
  next();
});

const sessionSchema = z.object({ sessionId: z.string().min(1) });
const throwSchema = z.object({
  sessionId: z.string().min(1),
  targetUserId: z.string().min(1),
});
const quizSchema = z.object({
  sessionId: z.string().min(1),
  choiceIndex: z.coerce.number().int().min(0).max(3),
  displayName: z.string().min(1).max(40).optional(),
});
const chatSchema = z.object({
  sessionId: z.string().min(1),
  text: z.string().min(1).max(280),
  displayName: z.string().min(1).max(40).optional(),
});
const likesSchema = z.object({
  sessionId: z.string().min(1),
  count: z.coerce.number().int().min(1).max(20).optional(),
  displayName: z.string().min(1).max(40).optional(),
});
const engageSchema = z.object({
  sessionId: z.string().min(1),
  likes: z.coerce.number().int().min(0).max(20).optional(),
  shares: z.coerce.number().int().min(0).max(5).optional(),
  comments: z.coerce.number().int().min(0).max(5).optional(),
  coinsSpent: z.coerce.number().int().min(0).max(1_000_000).optional(),
  coinsReceived: z.coerce.number().int().min(0).max(1_000_000).optional(),
});
const settingsSchema = z.object({
  sessionId: z.string().min(1),
  spinMs: z.coerce.number().int().optional(),
  chooseMs: z.coerce.number().int().optional(),
  challengeMs: z.coerce.number().int().optional(),
  resultMs: z.coerce.number().int().optional(),
  autoContinue: z.boolean().optional(),
  autoContinueDelayMs: z.coerce.number().int().optional(),
  throwCoins: z.coerce.number().int().min(0).max(500).optional(),
  soloCoins: z.coerce.number().int().min(0).max(500).optional(),
  likesTarget: z.coerce.number().int().min(10).max(500).optional(),
  challengeQuiz: z.boolean().optional(),
  challengeChat: z.boolean().optional(),
  challengeLikes: z.boolean().optional(),
  housePays: z.boolean().optional(),
  showPayerBadge: z.boolean().optional(),
});

function mapError(res: any, e: any) {
  const code = e?.code as string | undefined;
  const map: Record<string, number> = {
    NOT_ADMIN: 403,
    NOT_HOST: 403,
    NOT_CHOOSER: 403,
    NOT_CHOOSING: 409,
    NOT_READY: 409,
    SETTINGS_LOCKED: 409,
    BAD_TARGET: 400,
    TARGET_NOT_ON_STAGE: 409,
    TARGET_PROTECTED: 409,
    TARGET_HAS_LIFE: 409,
    DROP_COOLDOWN: 409,
    JUMP_COOLDOWN: 409,
    ALREADY_SEATED: 409,
    ALREADY_QUEUED: 409,
    HOST_CANNOT_QUEUE: 400,
    HOST_CANNOT_JUMP: 400,
    HOST_CANNOT_BUY_LIFE: 400,
    NOT_SEATED: 409,
    LIFE_AT_CAP: 409,
    SEAT_FAILED: 500,
    GAME_NOT_FOUND: 404,
    GAME_BUSY: 409,
    NO_QUIZ: 409,
    FROZEN: 409,
    SESSION_NOT_FOUND: 404,
    INSUFFICIENT_FUNDS: 409,
  };
  if (code && map[code]) {
    const body: any = { error: code, code };
    if (code === 'INSUFFICIENT_FUNDS') {
      body.needed = e?.needed;
      body.balance = e?.balance;
    }
    return res.status(map[code]).json(body);
  }
  logger.error({ err: e?.message, code }, '[frenemies] route error');
  return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
}

router.post('/live-game/frenemies/start', requireNotBanned, async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    const parsed = sessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
    }
    const session = await getSessionById(parsed.data.sessionId);
    if (!session) return res.status(404).json({ error: 'SESSION_NOT_FOUND', code: 'SESSION_NOT_FOUND' });
    if (session.hostUserId !== userId && !isFrenemiesAdmin(userId)) {
      return res.status(403).json({ error: 'HOST_ONLY', code: 'HOST_ONLY' });
    }
    if (session.status !== 'LIVE') {
      return res.status(409).json({ error: 'NOT_LIVE', code: 'NOT_LIVE' });
    }
    const room = await startGame({
      sessionId: parsed.data.sessionId,
      hostUserId: session.hostUserId,
      starterUserId: userId,
    });
    res.json(publicEvent(room, 'PHASE'));
  } catch (e: any) {
    mapError(res, e);
  }
});

router.post('/live-game/frenemies/spin', requireNotBanned, async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    const parsed = sessionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
    const room = await spinRound({ sessionId: parsed.data.sessionId, userId });
    res.json(publicEvent(room, 'PHASE'));
  } catch (e: any) {
    mapError(res, e);
  }
});

router.post('/live-game/frenemies/settings', requireNotBanned, async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
    const { sessionId, ...patch } = parsed.data;
    const room = await updateSettings({ sessionId, userId, patch });
    res.json(publicEvent(room, 'SNAPSHOT'));
  } catch (e: any) {
    mapError(res, e);
  }
});

router.post('/live-game/frenemies/end', requireNotBanned, async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    const parsed = sessionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
    const room = await endGame({ sessionId: parsed.data.sessionId, userId });
    if (!room) return res.status(404).json({ error: 'GAME_NOT_FOUND', code: 'GAME_NOT_FOUND' });
    res.json(publicEvent(room, 'ENDED'));
  } catch (e: any) {
    mapError(res, e);
  }
});

router.post('/live-game/frenemies/throw', requireNotBanned, async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    const parsed = throwSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
    const room = await throwGuest({
      sessionId: parsed.data.sessionId,
      chooserUserId: userId,
      targetUserId: parsed.data.targetUserId,
    });
    res.json(publicEvent(room, 'RESULT'));
  } catch (e: any) {
    mapError(res, e);
  }
});

router.post('/live-game/frenemies/quiz-answer', requireNotBanned, async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    const parsed = quizSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
    const room = await submitQuizAnswer({
      sessionId: parsed.data.sessionId,
      userId,
      displayName: parsed.data.displayName,
      choiceIndex: parsed.data.choiceIndex,
    });
    res.json(publicEvent(room, 'SNAPSHOT'));
  } catch (e: any) {
    mapError(res, e);
  }
});

router.post('/live-game/frenemies/chat', requireNotBanned, async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
    const room = await submitChatPhrase({
      sessionId: parsed.data.sessionId,
      userId,
      displayName: parsed.data.displayName,
      text: parsed.data.text,
    });
    if (!room) return res.status(404).json({ error: 'GAME_NOT_FOUND', code: 'GAME_NOT_FOUND' });
    res.json(publicEvent(room, 'SNAPSHOT'));
  } catch (e: any) {
    mapError(res, e);
  }
});

router.post('/live-game/frenemies/like', requireNotBanned, async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    const parsed = likesSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
    const room = await reportLikes({
      sessionId: parsed.data.sessionId,
      userId,
      displayName: parsed.data.displayName,
      count: parsed.data.count,
    });
    res.json(room ? publicEvent(room, 'SNAPSHOT') : { ok: true });
  } catch (e: any) {
    mapError(res, e);
  }
});

router.get('/live-game/frenemies/state', async (req: AuthedRequest, res) => {
  try {
    const sessionId = String(req.query.sessionId || '');
    if (!sessionId) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
    const room = await getRoom(sessionId);
    if (!room) return res.status(404).json({ error: 'GAME_NOT_FOUND', code: 'GAME_NOT_FOUND' });
    await resumeTicksIfNeeded(sessionId);
    res.json(publicEvent(room, 'SNAPSHOT'));
  } catch (e: any) {
    mapError(res, e);
  }
});

router.get('/live-game/frenemies/preview', async (req: AuthedRequest, res) => {
  try {
    const sessionId = String(req.query.sessionId || '');
    if (!sessionId) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
    const preview = await getHostPrizePreview(sessionId);
    res.json(preview);
  } catch (e: any) {
    mapError(res, e);
  }
});

const joinQueueSchema = z.object({
  sessionId: z.string().min(1),
  displayName: z.string().min(1).max(40).optional(),
  photoUrl: z.string().max(500).optional().nullable(),
  source: z.enum(['comment', 'guest_request', 'cta']).optional(),
});

router.post('/live-game/frenemies/queue/join', requireNotBanned, async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    const parsed = joinQueueSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
    const room = await requestJoinQueue({
      sessionId: parsed.data.sessionId,
      userId,
      displayName: parsed.data.displayName,
      photoUrl: parsed.data.photoUrl,
      source: parsed.data.source || 'cta',
    });
    res.json(publicEvent(room, 'SNAPSHOT'));
  } catch (e: any) {
    mapError(res, e);
  }
});

router.post('/live-game/frenemies/queue/leave', requireNotBanned, async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    const parsed = sessionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
    const room = await leaveJoinQueue({ sessionId: parsed.data.sessionId, userId });
    if (!room) return res.status(404).json({ error: 'GAME_NOT_FOUND', code: 'GAME_NOT_FOUND' });
    res.json(publicEvent(room, 'SNAPSHOT'));
  } catch (e: any) {
    mapError(res, e);
  }
});

const jumpSchema = z.object({
  sessionId: z.string().min(1),
  targetUserId: z.string().min(1),
  displayName: z.string().min(1).max(40).optional(),
  photoUrl: z.string().max(500).optional().nullable(),
  idempotencyKey: z.string().min(8).max(80),
});

router.post('/live-game/frenemies/queue/jump', requireNotBanned, async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    const parsed = jumpSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
    const out = await jumpKickTakeSeat({
      sessionId: parsed.data.sessionId,
      jumperUserId: userId,
      targetUserId: parsed.data.targetUserId,
      displayName: parsed.data.displayName,
      photoUrl: parsed.data.photoUrl,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    res.json({
      ...publicEvent(out.room, 'RESULT'),
      charged: out.charged,
      slotIndex: out.slotIndex,
      victimUserId: out.victimUserId,
    });
  } catch (e: any) {
    mapError(res, e);
  }
});

const buyLifeSchema = z.object({
  sessionId: z.string().min(1),
  idempotencyKey: z.string().min(8).max(80),
});

router.post('/live-game/frenemies/life/buy', requireNotBanned, async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    const parsed = buyLifeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
    const out = await buyExtraLife({
      sessionId: parsed.data.sessionId,
      userId,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    res.json({
      ...publicEvent(out.room, 'SNAPSHOT'),
      charged: out.charged,
      extraLives: out.extraLives,
    });
  } catch (e: any) {
    mapError(res, e);
  }
});

router.post('/live/engagement/bump', requireNotBanned, async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    const parsed = engageSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
    const { sessionId, ...delta } = parsed.data;
    if (delta.likes && delta.likes > 0) {
      await reportLikes({ sessionId, userId, count: delta.likes });
    } else {
      await bumpEngagement(sessionId, userId, delta);
    }
    if (delta.shares || delta.comments || delta.coinsSpent || delta.coinsReceived) {
      await bumpEngagement(sessionId, userId, {
        shares: delta.shares,
        comments: delta.comments,
        coinsSpent: delta.coinsSpent,
        coinsReceived: delta.coinsReceived,
      });
    }
    res.json({ ok: true });
  } catch (e: any) {
    mapError(res, e);
  }
});

router.get('/live/engagement/session', async (req: AuthedRequest, res) => {
  try {
    const sessionId = String(req.query.sessionId || '');
    if (!sessionId) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
    const byUser = await getSessionEngagement(sessionId);
    res.json({ sessionId, byUser });
  } catch (e: any) {
    mapError(res, e);
  }
});

export default router;
