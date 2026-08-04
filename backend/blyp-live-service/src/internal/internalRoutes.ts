import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { creditSubscriptionCoins, purgeUserData } from '../economy/economyService';
import { toEconomyError } from '../economy/economyErrors';
import { deleteCognitoUserBySub } from '../admin/adminCognitoDirectory';
import { logger } from '../config/logger';

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

const purgeSchema = z.object({ userId: z.string().min(1) }).strict();

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

export default router;
