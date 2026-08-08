import { Router } from 'express';
import { z } from 'zod';
import { AuthedRequest, cognitoJwtMiddleware } from '../auth/cognitoJwtMiddleware';
import {
  acceptBattle,
  cancelBattle,
  declineBattle,
  endBattle,
  reconcileBattleArena,
  registerBattle,
  voteBattle,
} from '../battles/battleCoordinator';
import { toEconomyError } from '../economy/economyErrors';
import { requireNotBanned } from '../admin/banGuard';

const router = Router();

const registerSchema = z
  .object({
    battleId: z.string().min(1).max(120),
    opponentUid: z.string().min(1).max(128),
    creatorName: z.string().max(120).optional(),
    creatorUsername: z.string().max(80).optional(),
    opponentName: z.string().max(120).optional(),
    opponentUsername: z.string().max(80).optional(),
    title: z.string().max(120).optional(),
    scheduledStartAt: z.coerce.number().int().positive(),
    durationSec: z.coerce.number().int().min(60).max(60 * 60),
    depositMode: z.enum(['free', 'staked']),
    stakeCoins: z.coerce.number().int().min(0).max(1_000_000),
  })
  .strict();

const voteSchema = z.object({ side: z.enum(['A', 'B']) }).strict();

router.use(cognitoJwtMiddleware);
router.use(requireNotBanned);

function userId(req: AuthedRequest): string | null {
  return req.user?.sub || null;
}

function fail(res: any, error: any) {
  const err = toEconomyError(error);
  return res.status(err.httpStatus).json({
    error: err.message,
    code: err.code,
    detail: err.detail,
  });
}

router.post('/battles/register', async (req: AuthedRequest, res) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTH' });
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid battle',
        code: 'INVALID_INPUT',
        detail: parsed.error.issues,
      });
    }
    const battle = await registerBattle(uid, parsed.data);
    return res.json({ battle });
  } catch (error) {
    return fail(res, error);
  }
});

router.get('/battles/:battleId', async (req: AuthedRequest, res) => {
  try {
    if (!userId(req)) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTH' });
    const battleId = String(req.params.battleId || '').trim();
    if (!battleId) return res.status(400).json({ error: 'battleId required', code: 'INVALID_INPUT' });
    const battle = await reconcileBattleArena(battleId);
    return res.json({ battle, serverNow: Date.now() });
  } catch (error) {
    return fail(res, error);
  }
});

router.post('/battles/:battleId/accept', async (req: AuthedRequest, res) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTH' });
    const battle = await acceptBattle(String(req.params.battleId || ''), uid);
    return res.json({ battle });
  } catch (error) {
    return fail(res, error);
  }
});

router.post('/battles/:battleId/decline', async (req: AuthedRequest, res) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTH' });
    const battle = await declineBattle(String(req.params.battleId || ''), uid);
    return res.json({ battle });
  } catch (error) {
    return fail(res, error);
  }
});

router.post('/battles/:battleId/cancel', async (req: AuthedRequest, res) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTH' });
    const battle = await cancelBattle(String(req.params.battleId || ''), uid);
    return res.json({ battle });
  } catch (error) {
    return fail(res, error);
  }
});

router.post('/battles/:battleId/end', async (req: AuthedRequest, res) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTH' });
    const battle = await endBattle(String(req.params.battleId || ''), uid);
    return res.json({ battle });
  } catch (error) {
    return fail(res, error);
  }
});

router.post('/battles/:battleId/vote', async (req: AuthedRequest, res) => {
  try {
    const uid = userId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTH' });
    const parsed = voteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Choose side A or B', code: 'INVALID_INPUT' });
    }
    const result = await voteBattle(String(req.params.battleId || ''), uid, parsed.data.side);
    return res.json(result);
  } catch (error) {
    return fail(res, error);
  }
});

export default router;
