import { Router } from 'express';
import { cognitoJwtMiddleware, AuthedRequest } from '../auth/cognitoJwtMiddleware';
import {
  adminCreditCoinsSchema,
  giftSendSchema,
  iapVerifySchema,
  liveGameFinalizeSchema,
  liveGameJoinSchema,
  liveGameStartSchema,
  paginationSchema,
  promoteBattleSchema,
  promoteSpotlightBookSchema,
  promoteTimeSlotBookSchema,
} from './economySchemas';
import {
  bookPromoteSpotlight,
  bookPromoteTimeSlot,
  creditCoinsAdmin,
  finalizeLiveGame,
  getCatalog,
  getLedger,
  getPromotePricing,
  getSpotlightAvailability,
  getStreamSummary,
  getWallet,
  joinLiveGame,
  purchasePromoteBattle,
  sendGift,
  startLiveGame,
} from './economyService';
import { EconomyError, toEconomyError } from './economyErrors';
import { getEconomyInfra } from './infra';
import { logger } from '../config/logger';

const router = Router();

// All economy endpoints require auth.
router.use(cognitoJwtMiddleware);

router.get('/economy/catalog', async (_req: AuthedRequest, res) => {
  try {
    const result = await getCatalog();
    res.json(result);
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

router.get('/promote/pricing', async (_req: AuthedRequest, res) => {
  try {
    const result = await getPromotePricing();
    res.json(result);
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

router.get('/promote/spotlight/availability', async (req: AuthedRequest, res) => {
  try {
    const raw = typeof req.query?.durationKey === 'string' ? req.query.durationKey.trim() : '';
    const durationKey = raw === '1h' || raw === '24h' || raw === '7d' ? (raw as '1h' | '24h' | '7d') : null;
    if (!durationKey) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });

    const result = await getSpotlightAvailability(durationKey);
    res.json(result);
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

router.post('/promote/battle', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });

    const parsed = promoteBattleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });

    const out = await purchasePromoteBattle(userId, parsed.data);
    if (out.kind === 'replay') {
      return res.status(409).json({ ...out.response, code: 'IDEMPOTENT_REPLAY' });
    }

    res.json(out.response);
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

router.post('/promote/slot/book', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });

    const parsed = promoteTimeSlotBookSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });

    const out = await bookPromoteTimeSlot(userId, parsed.data);
    if (out.kind === 'replay') {
      return res.status(409).json({ ...out.response, code: 'IDEMPOTENT_REPLAY' });
    }

    res.json(out.response);
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

router.post('/promote/spotlight/book', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });

    const parsed = promoteSpotlightBookSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });

    const out = await bookPromoteSpotlight(userId, parsed.data);
    if (out.kind === 'replay') {
      return res.status(409).json({ ...out.response, code: 'IDEMPOTENT_REPLAY' });
    }

    res.json(out.response);
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

router.get('/wallet', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    const wallet = await getWallet(userId);
    res.json({ userId, ...wallet });
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

router.get('/ledger', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });

    const parsed = paginationSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });

    const { cursor, limit } = parsed.data;
    const result = await getLedger(userId, cursor, limit);
    res.json(result);
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

router.get('/economy/stream/:streamId/summary', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });

    const streamId = typeof req.params?.streamId === 'string' ? req.params.streamId.trim() : '';
    if (!streamId) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });

    const summary = await getStreamSummary(userId, streamId);
    res.json(summary);
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

router.post('/gift/send', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });

    const parsed = giftSendSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });

    const out = await sendGift(userId, parsed.data);

    // If replay, spec wants 409 IDEMPOTENT_REPLAY but same success payload.
    if (out.kind === 'replay') {
      return res.status(409).json({ ...out.response, code: 'IDEMPOTENT_REPLAY' });
    }

    res.json(out.response);
  } catch (e: any) {
    const err = toEconomyError(e);

    if (err.code === 'INTERNAL') {
      logger.error({ detail: err.detail }, '[economy] INTERNAL error in /gift/send');
    }

    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

router.post('/economy/live-games/start', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    if (String(process.env.ECONOMY_LIVE_GAMES_ENABLED || '').trim() !== '1') {
      return res.status(403).json({ error: 'RESTRICTED', code: 'RESTRICTED' });
    }

    const parsed = liveGameStartSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });

    const out = await startLiveGame(userId, parsed.data);
    if (out.kind === 'replay') {
      return res.status(409).json({ ...out.response, code: 'IDEMPOTENT_REPLAY' });
    }
    res.json(out.response);
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

router.post('/economy/live-games/join', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    if (String(process.env.ECONOMY_LIVE_GAMES_ENABLED || '').trim() !== '1') {
      return res.status(403).json({ error: 'RESTRICTED', code: 'RESTRICTED' });
    }

    const parsed = liveGameJoinSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });

    const out = await joinLiveGame(userId, parsed.data);
    if (out.kind === 'replay') {
      return res.status(409).json({ ...out.response, code: 'IDEMPOTENT_REPLAY' });
    }
    res.json(out.response);
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

router.post('/economy/live-games/finalize', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    if (String(process.env.ECONOMY_LIVE_GAMES_ENABLED || '').trim() !== '1') {
      return res.status(403).json({ error: 'RESTRICTED', code: 'RESTRICTED' });
    }

    const parsed = liveGameFinalizeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });

    const out = await finalizeLiveGame(userId, parsed.data);
    if (out.kind === 'replay') {
      return res.status(409).json({ ...out.response, code: 'IDEMPOTENT_REPLAY' });
    }
    res.json(out.response);
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

router.post('/iap/verify', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });

    const parsed = iapVerifySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });

    // Phase 4: provider verification not implemented yet.
    return res.status(500).json({
      error: 'Provider verification not configured',
      code: 'PROVIDER_ERROR',
      detail: 'Apple/Google verification requires provider credentials and integration work (Phase 4).',
    });
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

router.post('/economy/admin/credit-coins', async (req: AuthedRequest, res) => {
  try {
    const actorUserId = req.user?.sub;
    if (!actorUserId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });

    // Disabled by default; must be explicitly enabled.
    const enabled = String(process.env.ECONOMY_ADMIN_CREDIT_ENABLED || '').trim() === '1';
    const allowlistRaw = String(process.env.ECONOMY_ADMIN_ALLOWLIST_SUBS || '').trim();
    const allowlist = allowlistRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (!enabled) {
      logger.warn(
        { actorUserId, enabled, allowlistCount: allowlist.length },
        '[economy] RESTRICTED /economy/admin/credit-coins (disabled)'
      );
      return res.status(403).json({ error: 'RESTRICTED', code: 'RESTRICTED' });
    }

    if (allowlist.length === 0 || !allowlist.includes(actorUserId)) {
      logger.warn(
        { actorUserId, enabled, allowlistCount: allowlist.length },
        '[economy] RESTRICTED /economy/admin/credit-coins (not allowlisted)'
      );
      return res.status(403).json({ error: 'RESTRICTED', code: 'RESTRICTED' });
    }
    const parsed = adminCreditCoinsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
    }

    // Redis rate limit (fail closed).
    const { redis } = getEconomyInfra();
    const coins = parsed.data.coins;
    const day = new Date().toISOString().slice(0, 10);
    const perMinuteKey = `economy:admin_credit:${actorUserId}:m1`;
    const perDayKey = `economy:admin_credit:${actorUserId}:d:${day}`;

    try {
      const perMin = await redis.incr(perMinuteKey);
      if (perMin === 1) await redis.expire(perMinuteKey, 60);
      if (perMin > 3) {
        throw new EconomyError('RATE_LIMIT', 429, 'Rate limited');
      }

      const perDay = await redis.incrby(perDayKey, coins);
      if (perDay === coins) await redis.expire(perDayKey, 60 * 60 * 48);
      if (perDay > 1_000_000) {
        try { await redis.decrby(perDayKey, coins); } catch {}
        throw new EconomyError('RATE_LIMIT', 429, 'Daily cap exceeded');
      }
    } catch (e: any) {
      if (e instanceof EconomyError) throw e;
      throw new EconomyError('RATE_LIMIT', 503, 'Rate limiter unavailable', e?.message ?? e);
    }

    const out = await creditCoinsAdmin(actorUserId, parsed.data);
    res.json(out);
  } catch (e: any) {
    const err = toEconomyError(e);

    if (err.code === 'INTERNAL') {
      logger.error({ detail: err.detail }, '[economy] INTERNAL error in /economy/admin/credit-coins');
    }

    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

export default router;
