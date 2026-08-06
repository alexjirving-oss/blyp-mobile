import { Router } from 'express';
import { cognitoJwtMiddleware, AuthedRequest } from '../auth/cognitoJwtMiddleware';
import {
  adminCreditCoinsSchema,
  giftSendSchema,
  iapVerifySchema,
  liveGameFinalizeSchema,
  liveGameJoinSchema,
  liveGameStartSchema,
  matchdayPredictionPlaceSchema,
  matchdayPredictionSettleSchema,
  matchdayPurchaseSchema,
  matchdayReactSchema,
  paginationSchema,
  promoteBattleSchema,
  promoteSpotlightBookSchema,
  promoteMethodBookSchema,
  promoteTimeSlotBookSchema,
  battleDepositSchema,
  battleCancelRefundSchema,
  battleSettleSchema,
  battleGiftPledgeCreateSchema,
  battleGiftPledgeCancelSchema,
  battleGiftPledgesApplySchema,
  battleGiftPledgesRefundSchema,
  withdrawRequestSchema,
  withdrawConnectOnboardSchema,
  socialFollowSchema,
} from './economySchemas';
import { depositBattle, cancelRefundBattle, settleBattle } from './battleEscrowService';
import {
  createBattleGiftPledge,
  cancelBattleGiftPledge,
  applyBattleGiftPledges,
  refundBattleGiftPledges,
  listBattleGiftPledges,
} from './battleGiftPledgeService';
import {
  bookPromoteSpotlight,
  bookPromoteTimeSlot,
  purchasePromoteMethod,
  getMyPromotions,
  claimDailyReward,
  creditCoinsAdmin,
  finalizeLiveGame,
  getCatalog,
  getLedger,
  getActivePromotions,
  getPromotePricing,
  getSpotlightAvailability,
  getStreamSummary,
  getWallet,
  joinLiveGame,
  peekDailyReward,
  purchasePromoteBattle,
  sendGift,
  startLiveGame,
  verifyIapPurchaseAndGrant,
} from './economyService';
import {
  createConnectOnboardLink,
  getConnectStatus,
  getWithdrawEligibility,
  requestWithdrawal,
} from './withdrawalService';
import { followUser, unfollowUser } from './socialFollowService';
import {
  checkMatchdayEntitlement,
  getMatchdayLeaderboard,
  getMatchdayPredictions,
  getMatchdayPricing,
  placeMatchdayPrediction,
  purchaseMatchdayEntitlement,
  reactMatchday,
  settleMatchdayPredictions,
} from './matchdayService';
import { getRankingBoard, listRankingBoardsMeta } from './rankingsService';
import { EconomyError, toEconomyError } from './economyErrors';
import { getEconomyInfra } from './infra';
import { logger } from '../config/logger';
import { requireNotBanned } from '../admin/banGuard';

const router = Router();

// All economy endpoints require auth, and banned accounts are rejected outright.
router.use(cognitoJwtMiddleware);
router.use(requireNotBanned);

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


/** Active promote windows for feed ranking (battle / time slot / spotlight). */
router.get('/promote/active', async (_req: AuthedRequest, res) => {
  try {
    const result = await getActivePromotions();
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


router.post('/promote/method/book', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });

    const parsed = promoteMethodBookSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });

    const out = await purchasePromoteMethod(userId, parsed.data);
    if (out.kind === 'replay') {
      return res.status(409).json({ ...out.response, code: 'IDEMPOTENT_REPLAY' });
    }

    res.json(out.response);
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

router.get('/promote/mine', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });

    const result = await getMyPromotions(userId);
    res.json(result);
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

// Daily reward streak. Credits the same wallet the app reads (keyed by the
// Cognito sub), so claimed coins are immediately reflected in /wallet.
//   GET  -> { ok, streak, claimedToday, claimableReward }          (peek)
//   POST -> { ok, alreadyClaimed, streak, reward, balanceCoins }   (claim)
router.get('/economy/daily-reward', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ ok: false, reason: 'unauthenticated' });
    const out = await peekDailyReward(userId);
    res.json(out);
  } catch (e: any) {
    const err = toEconomyError(e);
    if (err.code === 'INTERNAL') {
      logger.error({ detail: err.detail }, '[economy] INTERNAL error in /economy/daily-reward');
    }
    res.status(err.httpStatus).json({ ok: false, reason: 'error', detail: err.detail });
  }
});

router.post('/economy/daily-reward/claim', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ ok: false, reason: 'unauthenticated' });
    const out = await claimDailyReward(userId);
    res.json(out);
  } catch (e: any) {
    const err = toEconomyError(e);
    if (err.code === 'INTERNAL') {
      logger.error({ detail: err.detail }, '[economy] INTERNAL error in /economy/daily-reward/claim');
    }
    res.status(err.httpStatus).json({ ok: false, reason: 'error', detail: err.detail });
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

// ----------------------------------------------------------------------------
// Battles — coin deposit / refund / attendance settlement (all in COINS).
// ----------------------------------------------------------------------------

router.post('/economy/battle/deposit', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    const parsed = battleDepositSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
    const out = await depositBattle(userId, parsed.data);
    if (out.kind === 'replay') return res.status(409).json({ ...out.response, code: 'IDEMPOTENT_REPLAY' });
    res.json(out.response);
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

router.post('/economy/battle/cancel-refund', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    const parsed = battleCancelRefundSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
    const out = await cancelRefundBattle(userId, parsed.data);
    if (out.kind === 'replay') return res.status(409).json({ ...out.response, code: 'IDEMPOTENT_REPLAY' });
    res.json(out.response);
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

router.post('/economy/battle/settle', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    const parsed = battleSettleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
    const out = await settleBattle(userId, parsed.data);
    if (out.kind === 'replay') return res.status(409).json({ ...out.response, code: 'IDEMPOTENT_REPLAY' });
    res.json(out.response);
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

// ----------------------------------------------------------------------------
// Pre-arranged battle gifts (schedule now → deliver when match starts).
// ----------------------------------------------------------------------------

router.post('/economy/battle/gift-pledge', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    const parsed = battleGiftPledgeCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
    const out = await createBattleGiftPledge(userId, parsed.data);
    if (out.kind === 'replay') return res.status(409).json({ ...out.response, code: 'IDEMPOTENT_REPLAY' });
    res.json(out.response);
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

router.post('/economy/battle/gift-pledge/cancel', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    const parsed = battleGiftPledgeCancelSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
    const out = await cancelBattleGiftPledge(userId, parsed.data);
    if (out.kind === 'replay') return res.status(409).json({ ...out.response, code: 'IDEMPOTENT_REPLAY' });
    res.json(out.response);
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

router.get('/economy/battle/:battleId/gift-pledges', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    const battleId = String(req.params.battleId || '').trim();
    if (!battleId) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
    const mine = String(req.query.mine || '') === '1';
    const out = await listBattleGiftPledges(battleId, mine ? { mineUid: userId } : {});
    res.json(out);
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

router.post('/economy/battle/gift-pledges/apply', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    const parsed = battleGiftPledgesApplySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
    const out = await applyBattleGiftPledges(parsed.data);
    res.json(out.response);
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

router.post('/economy/battle/gift-pledges/refund', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    const parsed = battleGiftPledgesRefundSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
    const out = await refundBattleGiftPledges(parsed.data);
    res.json(out.response);
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

const handleIapVerify = async (req: AuthedRequest, res: any) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });

    const parsed = iapVerifySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });

    const out = await verifyIapPurchaseAndGrant(userId, parsed.data);
    if (out.kind === 'replay') {
      return res.status(409).json({ ...out.response, code: 'IDEMPOTENT_REPLAY' });
    }

    return res.json(out.response);
  } catch (e: any) {
    const err = toEconomyError(e);
    return res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
};

router.post('/iap/verify', handleIapVerify);
// Backward-compatible alias while clients move to canonical /iap/verify.
router.post('/commerce/purchase/verify', handleIapVerify);

const matchdayWritesEnabled = () => String(process.env.ECONOMY_MATCHDAY_ENABLED || '').trim() === '1';

router.get('/economy/matchday/pricing', async (_req: AuthedRequest, res) => {
  try {
    res.json({ ...getMatchdayPricing(), enabled: matchdayWritesEnabled() });
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

router.get('/economy/matchday/:eventId/entitlement', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    const eventId = typeof req.params?.eventId === 'string' ? req.params.eventId.trim() : '';
    if (!eventId) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
    const out = await checkMatchdayEntitlement(userId, eventId);
    res.json(out);
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

router.post('/economy/matchday/purchase', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    if (!matchdayWritesEnabled()) return res.status(403).json({ error: 'RESTRICTED', code: 'RESTRICTED' });

    const parsed = matchdayPurchaseSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });

    const out = await purchaseMatchdayEntitlement(userId, parsed.data);
    if (out.kind === 'replay') return res.status(409).json({ ...out.response, code: 'IDEMPOTENT_REPLAY' });
    res.json(out.response);
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

router.get('/economy/matchday/:eventId/predictions', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    const eventId = typeof req.params?.eventId === 'string' ? req.params.eventId.trim() : '';
    if (!eventId) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
    const out = await getMatchdayPredictions(userId, eventId);
    res.json(out);
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

router.post('/economy/matchday/predictions/place', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    if (!matchdayWritesEnabled()) return res.status(403).json({ error: 'RESTRICTED', code: 'RESTRICTED' });

    const parsed = matchdayPredictionPlaceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });

    const out = await placeMatchdayPrediction(userId, parsed.data);
    if (out.kind === 'replay') return res.status(409).json({ ...out.response, code: 'IDEMPOTENT_REPLAY' });
    res.json(out.response);
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

router.post('/economy/matchday/predictions/settle', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    if (!matchdayWritesEnabled()) return res.status(403).json({ error: 'RESTRICTED', code: 'RESTRICTED' });

    // Settlement moves real wallet balances based on a *reported* final result.
    // The backend has no sports feed to corroborate it, so settlement is
    // restricted to an explicit ops allowlist (defaults closed) to prevent an
    // untrusted client from fabricating a favorable result.
    const allowlist = String(process.env.ECONOMY_MATCHDAY_SETTLE_ALLOWLIST_SUBS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (allowlist.length === 0 || !allowlist.includes(userId)) {
      logger.warn({ userId }, '[economy] RESTRICTED /economy/matchday/predictions/settle (not allowlisted)');
      return res.status(403).json({ error: 'RESTRICTED', code: 'RESTRICTED' });
    }

    const parsed = matchdayPredictionSettleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });

    const out = await settleMatchdayPredictions(userId, parsed.data);
    if (out.kind === 'replay') return res.status(409).json({ ...out.response, code: 'IDEMPOTENT_REPLAY' });
    res.json(out.response);
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

router.get('/economy/matchday/leaderboard', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    const eventId = typeof req.query?.eventId === 'string' ? req.query.eventId.trim() : '';
    const out = await getMatchdayLeaderboard(eventId || undefined);
    res.json(out);
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

// Global rankings hub (Phase 0–5): economy + social/live + competitive/game + club + Plus gates.
router.get('/economy/rankings/boards', async (req: AuthedRequest, res) => {
  try {
    if (!req.user?.sub) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    res.json({
      boards: listRankingBoardsMeta(),
      entitlement: {
        freeLimit: 3,
        plusLimit: 50,
        freeWindows: ['alltime'],
        plusWindows: ['day', 'week', 'month', 'year', 'alltime'],
        datingRequires: ['plus', 'dating_opt_in'],
        optOutFields: ['leaderboardOptOut', 'privacyHideFromRankings'],
      },
    });
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

router.get('/economy/rankings', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    const board = typeof req.query?.board === 'string' ? req.query.board.trim() : '';
    const window = typeof req.query?.window === 'string' ? req.query.window.trim() : 'alltime';
    const clubId = typeof req.query?.clubId === 'string' ? req.query.clubId.trim() : '';
    const limit = req.query?.limit;
    const out = await getRankingBoard(board, limit, window, clubId || undefined, userId);
    res.json(out);
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

router.post('/economy/matchday/react', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
    if (!matchdayWritesEnabled()) return res.status(403).json({ error: 'RESTRICTED', code: 'RESTRICTED' });

    const parsed = matchdayReactSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });

    // Lightweight per-user rate limit so emoji storms can't be abused (fail-open).
    try {
      const { redis } = getEconomyInfra();
      const key = `economy:matchday_react:${userId}:s2`;
      const n = await redis.incr(key);
      if (n === 1) await redis.expire(key, 2);
      if (n > 10) return res.status(429).json({ error: 'RATE_LIMIT', code: 'RATE_LIMIT' });
    } catch {
      // Redis unavailable: allow the reaction rather than blocking the room.
    }

    const out = await reactMatchday(userId, parsed.data.eventId, parsed.data.emoji);
    res.json(out);
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

// ---------------------------------------------------------------------------
// Withdrawals (creator GEM earnings → Stripe Connect)
// ---------------------------------------------------------------------------

function emailVerifiedFromReq(req: AuthedRequest): boolean {
  const u: any = req.user || {};
  return u.email_verified === true || u.email_verified === 'true';
}

router.get('/withdraw/eligibility', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) throw new EconomyError('UNAUTH', 401, 'Unauthorized');
    const out = await getWithdrawEligibility(userId, { emailVerified: emailVerifiedFromReq(req) });
    res.json(out);
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

router.post('/withdraw/connect/onboard', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) throw new EconomyError('UNAUTH', 401, 'Unauthorized');
    const parsed = withdrawConnectOnboardSchema.safeParse(req.body || {});
    if (!parsed.success) {
      throw new EconomyError('INVALID_INPUT', 400, 'Invalid input', parsed.error.flatten());
    }
    const email = typeof (req.user as any)?.email === 'string' ? (req.user as any).email : undefined;
    const out = await createConnectOnboardLink(userId, {
      email,
      returnUrl: parsed.data.returnUrl,
      refreshUrl: parsed.data.refreshUrl,
    });
    res.json(out);
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

router.get('/withdraw/connect/status', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) throw new EconomyError('UNAUTH', 401, 'Unauthorized');
    const out = await getConnectStatus(userId);
    res.json(out);
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

router.post('/withdraw/request', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) throw new EconomyError('UNAUTH', 401, 'Unauthorized');
    const parsed = withdrawRequestSchema.safeParse(req.body || {});
    if (!parsed.success) {
      throw new EconomyError('INVALID_INPUT', 400, 'Invalid input', parsed.error.flatten());
    }
    const out = await requestWithdrawal(userId, parsed.data, {
      emailVerified: emailVerifiedFromReq(req),
    });
    if (out.kind === 'replay') {
      res.status(409).json({ code: 'IDEMPOTENT_REPLAY', ...out.response });
      return;
    }
    res.json(out.response);
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

router.post('/social/follow', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) throw new EconomyError('UNAUTH', 401, 'Unauthorized');
    const parsed = socialFollowSchema.safeParse(req.body || {});
    if (!parsed.success) {
      throw new EconomyError('INVALID_INPUT', 400, 'Invalid input', parsed.error.flatten());
    }
    const out = await followUser(userId, parsed.data.targetUserId);
    res.json(out);
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

router.post('/social/unfollow', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) throw new EconomyError('UNAUTH', 401, 'Unauthorized');
    const parsed = socialFollowSchema.safeParse(req.body || {});
    if (!parsed.success) {
      throw new EconomyError('INVALID_INPUT', 400, 'Invalid input', parsed.error.flatten());
    }
    const out = await unfollowUser(userId, parsed.data.targetUserId);
    res.json(out);
  } catch (e: any) {
    const err = toEconomyError(e);
    res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

export default router;
