import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import {
  creditSubscriptionCoins,
  creditWebStripeCoins,
  purgeUserData,
  creditGemsAdminLaunchTest,
} from '../economy/economyService';
import { toEconomyError } from '../economy/economyErrors';
import { materializeRankingsSnapshots } from '../economy/rankingsService';
import { applyBattleGiftPledges, refundBattleGiftPledges } from '../economy/battleGiftPledgeService';
import { battleGiftPledgesApplySchema, battleGiftPledgesRefundSchema } from '../economy/economySchemas';
import { deleteCognitoUserBySub } from '../admin/adminCognitoDirectory';
import { logger } from '../config/logger';
import { createConnectOnboardLink } from '../economy/withdrawalService';
import { LAUNCH_TEST_GEM_CREDIT_CAP } from '../economy/withdrawLaunchTest';
import { runAgentProposalSweep } from '../admin/agentProposalWorker';
import { runAgentExecuteSweep } from '../admin/agentExecuteWorker';
import { runMarketingCronSweep } from '../admin/marketingService';

/**
 * Internal service-to-service routes.
 *
 * These are NOT user endpoints — they are called by trusted backend services
 * (currently the Firebase Functions subscription handlers) using a shared
 * secret, so they bypass the Cognito user middleware. They MUST be mounted
 * before the economy router (whose router-level Cognito middleware would
 * otherwise reject these calls as unauthenticated).
 *
 * Auth model: a single shared secret carried in `x-internal-secret`, compared
 * in constant time. Fails CLOSED — if `INTERNAL_SHARED_SECRET` is not set the
 * route returns 503 and never processes the request.
 *
 * Rankings P1.5 cron (Cloud Scheduler HTTP):
 *   POST /internal/cron/rankings-materialize
 *   Header: x-internal-secret: $INTERNAL_SHARED_SECRET
 *
 * Agent proposal worker cron:
 *   POST /internal/cron/agent-proposals
 *   Header: x-internal-secret: $INTERNAL_SHARED_SECRET
 *   Body (optional): { "dryRun": false, "maxUsers": 80, "maxProposals": 25 }
 *
 * Agent execute worker cron (retries approved comments):
 *   POST /internal/cron/agent-execute
 *   Header: x-internal-secret: $INTERNAL_SHARED_SECRET
 *   Body (optional): { "dryRun": false, "maxExecutes": 25 }
 *
 * Marketing Hub publish cron (schedule slots + due queue):
 *   POST /internal/cron/marketing-publish
 *   Header: x-internal-secret: $INTERNAL_SHARED_SECRET
 *   Body (optional): { "dryRun": false, "maxItems": 10 }
 *
 * Example gcloud (replace SECRET; prefer Secret Manager / headers-file):
 *   gcloud scheduler jobs create http rankings-materialize \
 *     --project=blyp-master --location=us-central1 \
 *     --schedule="every 10 minutes" --time-zone=UTC \
 *     --uri="https://blyp-live-service-innn3d7yqq-uc.a.run.app/internal/cron/rankings-materialize" \
 *     --http-method=POST \
 *     --headers="Content-Type=application/json,x-internal-secret=SECRET" \
 *     --message-body="{}" \
 *     --attempt-deadline=180s
 */

const router = Router();

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function requireInternalSecret(req: any, res: any, next: any) {
  const expected = String(process.env.INTERNAL_SHARED_SECRET || '').trim();
  if (!expected) {
    logger.error('[internal] INTERNAL_SHARED_SECRET not configured; refusing internal request');
    return res.status(503).json({ error: 'NOT_CONFIGURED', code: 'NOT_CONFIGURED' });
  }
  const provided = String(req.headers['x-internal-secret'] || '').trim();
  if (!provided || !timingSafeEqual(provided, expected)) {
    logger.warn('[internal] rejected internal request (bad secret)');
    return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
  }
  return next();
}

const creditCoinsSchema = z
  .object({
    userId: z.string().min(1),
    coins: z.coerce.number().int().positive(),
    idempotencyKey: z.string().min(1),
    sku: z.string().min(1).optional(),
    source: z.string().min(1).optional(),
  })
  .strict();

// Credit subscription coins into the live-service Postgres wallet the app
// reads/spends from. Idempotent per (userId, idempotencyKey).
router.post('/internal/subscription/credit-coins', requireInternalSecret, async (req, res) => {
  try {
    const parsed = creditCoinsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
    }
    const { userId, coins, idempotencyKey, sku, source } = parsed.data;
    const out = await creditSubscriptionCoins(userId, { coins, idempotencyKey, sku, source });
    return res.json({ ok: true, kind: out.kind, granted: out.granted, wallet: out.wallet });
  } catch (e: any) {
    const err = toEconomyError(e);
    if (err.code === 'INTERNAL') {
      logger.error({ detail: err.detail }, '[internal] INTERNAL error in /internal/subscription/credit-coins');
    }
    return res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

const creditWebCoinsSchema = z
  .object({
    userId: z.string().min(1),
    packId: z.string().min(1),
    stripeSessionId: z.string().min(1),
  })
  .strict();

/** Credit blyp.world Stripe Checkout packs (base + web +15% bonus). Idempotent per session. */
router.post('/internal/economy/credit-web-coins', requireInternalSecret, async (req, res) => {
  try {
    const parsed = creditWebCoinsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
    }
    const out = await creditWebStripeCoins(parsed.data);
    return res.json({
      ok: true,
      kind: out.kind,
      granted: out.granted,
      baseCoins: out.baseCoins,
      bonusCoins: out.bonusCoins,
      packId: out.packId,
      wallet: out.wallet,
    });
  } catch (e: any) {
    const err = toEconomyError(e);
    if (err.code === 'INTERNAL') {
      logger.error({ detail: err.detail }, '[internal] INTERNAL error in /internal/economy/credit-web-coins');
    }
    return res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

const launchTestGemCreditSchema = z
  .object({
    userId: z.string().min(1),
    gems: z.coerce.number().int().min(1).max(LAUNCH_TEST_GEM_CREDIT_CAP),
    idempotencyKey: z.string().min(8).max(128),
    reason: z.string().min(1).max(200).optional(),
    /** When true, also mint a Stripe Connect Account Link for the user. */
    includeConnectLink: z.coerce.boolean().optional(),
    email: z.string().email().optional(),
  })
  .strict();

/**
 * Owner launch-test: credit gem_available (audited) for WITHDRAW_TEST_SUBS /
 * ADMIN_ALLOWLIST / Owner bootstrap targets. Optional Connect onboard URL.
 * Does NOT execute a Stripe transfer.
 */
router.post('/internal/economy/credit-launch-test-gems', requireInternalSecret, async (req, res) => {
  try {
    const parsed = launchTestGemCreditSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
    }
    const { userId, gems, idempotencyKey, reason, includeConnectLink, email } = parsed.data;
    const out = await creditGemsAdminLaunchTest('internal:launch-test', {
      targetUserId: userId,
      gems,
      idempotencyKey,
      reason: reason || 'owner_launch_test_withdraw',
    });
    let connect: {
      url?: string;
      stripeAccountId?: string;
      expiresAt?: number;
      alreadyComplete?: boolean;
      error?: string;
      code?: string;
    } | null = null;
    if (includeConnectLink) {
      try {
        const link = await createConnectOnboardLink(userId, {
          email: email || undefined,
          returnUrl: 'https://blyp.world/withdraw/connect-return',
          refreshUrl: 'https://blyp.world/withdraw/connect-refresh',
        });
        connect = {
          url: link?.url,
          stripeAccountId: link?.stripeAccountId,
          expiresAt: link?.expiresAt,
          alreadyComplete: link?.alreadyComplete,
        };
      } catch (e: any) {
        const mapped = toEconomyError(e);
        logger.warn(
          { err: mapped.message, code: mapped.code, userId },
          '[internal] connect link after gem credit failed',
        );
        connect = {
          url: undefined,
          error: String(mapped.message || e?.message || 'connect_failed').slice(0, 300),
          code: mapped.code,
        };
      }
    }
    logger.info(
      {
        userId,
        gemsCredited: out.gemsCredited,
        gemAvailable: out.gemAvailable,
        replay: out.replay,
        connectLinked: Boolean(connect?.stripeAccountId),
      },
      '[internal] launch-test gem credit',
    );
    return res.json({ ok: true, ...out, connect });
  } catch (e: any) {
    const err = toEconomyError(e);
    if (err.code === 'INTERNAL') {
      logger.error({ detail: err.detail }, '[internal] INTERNAL error in /internal/economy/credit-launch-test-gems');
    }
    return res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

const purgeSchema = z.object({ userId: z.string().min(1) }).strict();

const rankingsMaterializeSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strict()
  .optional();

/**
 * Precompute rankings_snapshots for snapshot boards × day/week/month/year
 * (coin_spend, gem_earn, gifts_sent, gifts_recv, stream_earnings).
 * Invoked by Cloud Scheduler (or manually) with x-internal-secret.
 */
router.post('/internal/cron/rankings-materialize', requireInternalSecret, async (req, res) => {
  try {
    const parsed = rankingsMaterializeSchema.safeParse(req.body && Object.keys(req.body).length ? req.body : undefined);
    if (!parsed.success) {
      return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
    }
    const out = await materializeRankingsSnapshots({ limit: parsed.data?.limit });
    logger.info(
      { ok: out.ok, durationMs: out.durationMs, boards: out.results.length },
      '[internal] rankings materialize complete',
    );
    return res.status(out.ok ? 200 : 207).json(out);
  } catch (e: any) {
    const err = toEconomyError(e);
    if (err.code === 'INTERNAL') {
      logger.error({ detail: err.detail }, '[internal] INTERNAL error in /internal/cron/rankings-materialize');
    }
    return res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

const agentProposalsSchema = z
  .object({
    dryRun: z.coerce.boolean().optional(),
    maxUsers: z.coerce.number().int().min(1).max(200).optional(),
    maxProposals: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict()
  .optional();

/**
 * Generate comment proposals for enabled agents when followed creators have
 * recent live posts. Queues pending rows for /agents approve; may auto-send
 * comments when mode=auto_with_limits and forceSuggestOnly is off.
 */
router.post('/internal/cron/agent-proposals', requireInternalSecret, async (req, res) => {
  try {
    const parsed = agentProposalsSchema.safeParse(
      req.body && Object.keys(req.body).length ? req.body : undefined,
    );
    if (!parsed.success) {
      return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
    }
    const out = await runAgentProposalSweep({
      dryRun: parsed.data?.dryRun,
      maxUsers: parsed.data?.maxUsers,
      maxProposals: parsed.data?.maxProposals,
    });
    logger.info(
      {
        proposed: out.proposed,
        autoExecuted: out.autoExecuted,
        usersScanned: out.usersScanned,
        paused: out.paused,
        durationMs: out.durationMs,
      },
      '[internal] agent proposal sweep complete',
    );
    return res.status(out.ok || out.paused ? 200 : 207).json(out);
  } catch (e: any) {
    const err = toEconomyError(e);
    if (err.code === 'INTERNAL') {
      logger.error({ detail: err.detail }, '[internal] INTERNAL error in /internal/cron/agent-proposals');
    }
    return res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

const agentExecuteSchema = z
  .object({
    dryRun: z.coerce.boolean().optional(),
    maxExecutes: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict()
  .optional();

/** Retry execute for approved-but-not-executed comment proposals. */
router.post('/internal/cron/agent-execute', requireInternalSecret, async (req, res) => {
  try {
    const parsed = agentExecuteSchema.safeParse(
      req.body && Object.keys(req.body).length ? req.body : undefined,
    );
    if (!parsed.success) {
      return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
    }
    const out = await runAgentExecuteSweep({
      dryRun: parsed.data?.dryRun,
      maxExecutes: parsed.data?.maxExecutes,
    });
    logger.info(
      {
        executed: out.executed,
        scanned: out.scanned,
        paused: out.paused,
        durationMs: out.durationMs,
      },
      '[internal] agent execute sweep complete',
    );
    return res.status(out.ok || out.paused ? 200 : 207).json(out);
  } catch (e: any) {
    const err = toEconomyError(e);
    if (err.code === 'INTERNAL') {
      logger.error({ detail: err.detail }, '[internal] INTERNAL error in /internal/cron/agent-execute');
    }
    return res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

const marketingPublishSchema = z
  .object({
    dryRun: z.coerce.boolean().optional(),
    maxItems: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strict()
  .optional();

/**
 * Marketing Hub: enqueue from schedule slots, then publish due queue items.
 * Cloud Scheduler: every 5 minutes recommended.
 */
router.post('/internal/cron/marketing-publish', requireInternalSecret, async (req, res) => {
  try {
    const parsed = marketingPublishSchema.safeParse(
      req.body && Object.keys(req.body).length ? req.body : undefined,
    );
    if (!parsed.success) {
      return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
    }
    const out = await runMarketingCronSweep({
      dryRun: parsed.data?.dryRun,
      maxItems: parsed.data?.maxItems,
    });
    logger.info(
      {
        enqueued: out.enqueue.enqueued,
        slot: out.enqueue.slot,
        skipped: out.enqueue.skipped,
        published: out.publish.published,
        failed: out.publish.failed,
        scanned: out.publish.scanned,
        durationMs: out.publish.durationMs,
      },
      '[internal] marketing publish sweep complete',
    );
    return res.status(out.ok ? 200 : 207).json(out);
  } catch (e: any) {
    const err = toEconomyError(e);
    if (err.code === 'INTERNAL') {
      logger.error({ detail: err.detail }, '[internal] INTERNAL error in /internal/cron/marketing-publish');
    }
    return res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

/** Apply pre-arranged battle gifts when match clock starts (Cloud Function). */
router.post('/internal/battle/gift-pledges/apply', requireInternalSecret, async (req, res) => {
  try {
    const parsed = battleGiftPledgesApplySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
    }
    const out = await applyBattleGiftPledges(parsed.data);
    return res.json({ ok: true, ...out.response });
  } catch (e: any) {
    const err = toEconomyError(e);
    if (err.code === 'INTERNAL') {
      logger.error({ detail: err.detail }, '[internal] INTERNAL error in /internal/battle/gift-pledges/apply');
    }
    return res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

/** Refund held battle gift pledges when a battle is cancelled/rejected. */
router.post('/internal/battle/gift-pledges/refund', requireInternalSecret, async (req, res) => {
  try {
    const parsed = battleGiftPledgesRefundSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
    }
    const out = await refundBattleGiftPledges(parsed.data);
    return res.json({ ok: true, ...out.response });
  } catch (e: any) {
    const err = toEconomyError(e);
    if (err.code === 'INTERNAL') {
      logger.error({ detail: err.detail }, '[internal] INTERNAL error in /internal/battle/gift-pledges/refund');
    }
    return res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

// Account-deletion purge of the user's personal economy data (wallet,
// subscriptions, entitlements, per-user activity). Called by the Firebase
// account-deletion worker. Idempotent.
router.post('/internal/account/purge', requireInternalSecret, async (req, res) => {
  try {
    const parsed = purgeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
    }
    const out = await purgeUserData(parsed.data.userId);
    // Also delete the Cognito identity so the account can't sign back in
    // (the live-service holds AWS creds; GCP Functions don't).
    const cognitoDeleted = await deleteCognitoUserBySub(parsed.data.userId);
    logger.info({ userId: parsed.data.userId, deleted: out.deleted, cognitoDeleted }, '[internal] account purge complete');
    return res.json({ ok: true, deleted: out.deleted, cognitoDeleted });
  } catch (e: any) {
    const err = toEconomyError(e);
    if (err.code === 'INTERNAL') {
      logger.error({ detail: err.detail }, '[internal] INTERNAL error in /internal/account/purge');
    }
    return res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
  }
});

router.post('/internal/ivs/participant-published', requireInternalSecret, async (req, res) => {
  try {
    const { handleParticipantPublished } = await import('./ivsProgramEvents');
    const out = await handleParticipantPublished(req.body || {});
    return res.status(200).json(out);
  } catch (e: any) {
    logger.error({ err: e?.message || String(e) }, '[internal] participant-published failed');
    return res.status(200).json({ ok: true, unmatched: true });
  }
});

router.post('/internal/ivs/composition-state', requireInternalSecret, async (req, res) => {
  try {
    const { handleCompositionState } = await import('./ivsProgramEvents');
    const out = await handleCompositionState(req.body || {});
    return res.status(200).json(out);
  } catch (e: any) {
    logger.error({ err: e?.message || String(e) }, '[internal] composition-state failed');
    return res.status(200).json({ ok: true, unmatched: true });
  }
});

router.post('/internal/cron/live-orphan-sweep', requireInternalSecret, async (req, res) => {
  try {
    const { handleLiveOrphanSweep } = await import('./ivsProgramEvents');
    const out = await handleLiveOrphanSweep();
    return res.status(200).json(out);
  } catch (e: any) {
    logger.error({ err: e?.message || String(e) }, '[internal] live-orphan-sweep failed');
    return res.status(200).json({ ok: false, swept: 0, ids: [] });
  }
});

const broadcastWorkerHeartbeatSchema = z
  .object({
    workerId: z.string().min(4).max(128),
    region: z.string().min(2).max(32),
    baseUrl: z.string().url(),
    status: z.enum(['idle', 'busy']),
    sessionId: z.string().optional().nullable(),
  })
  .strict();

/** Fan-out worker pool registration + queued job claim. */
router.post('/internal/broadcast/worker/heartbeat', requireInternalSecret, async (req, res) => {
  try {
    const parsed = broadcastWorkerHeartbeatSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
    }
    const { registerWorkerHeartbeat } = await import('../live/broadcastWorkerPool');
    const { broadcastClaimQueuedJob } = await import('../live/broadcastPrepare');
    await registerWorkerHeartbeat(parsed.data);
    let claimed: { claimed: boolean; sessionId?: string } = { claimed: false };
    if (parsed.data.status === 'idle') {
      claimed = await broadcastClaimQueuedJob(parsed.data);
    }
    return res.json({ ok: true, claimed: claimed.claimed, sessionId: claimed.sessionId ?? null });
  } catch (e: any) {
    logger.error({ err: e?.message || String(e) }, '[internal] broadcast worker heartbeat failed');
    return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
  }
});

export default router;
