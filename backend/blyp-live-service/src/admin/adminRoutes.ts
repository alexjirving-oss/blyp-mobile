import { Router, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { AuthedRequest, cognitoJwtMiddleware } from '../auth/cognitoJwtMiddleware';
import { verifyCognitoJwt } from '../auth/verifyCognitoJwt';
import { isCanonicalCognitoSub as isCanonicalSub } from '../auth/cognitoSub';
import { getAdminEnv } from '../config/adminEnv';
import { logger } from '../config/logger';
import { checkDb, checkRedis, getEconomyInfra } from '../economy/infra';
import { creditCoinsAdmin } from '../economy/economyService';
import { EconomyError, toEconomyError } from '../economy/economyErrors';
import { sanitizeBearerAuthorization } from '../utils/headerSanitize';
import {
    adminListUserPostsSchema,
    adminListUsersSchema,
    adminListAuditSchema,
        adminQueueUserMessageSchema,
    adminSetAppVersionPolicySchema,
    adminSetCapabilitiesSchema,
    adminCreditCoinsBodySchema,
    adminListReportsSchema,
    adminResolveReportSchema,
    banUserSchema,

    moderatePostSchema,
    adminFeedPrioritySchema,
    unbanUserSchema,
} from './adminSchemas';
import {
    banUserByAdmin,
    getAdminUserDetail,
    getAdminMetricsOverview,
    getAdminUserSourceStats,
    getEffectiveUserControls,
    listAdminAudit,
    listAdminUserPosts,
    listAdminUsers,
    queueAdminUserMessage,
    removePostByAdmin,
    restorePostByAdmin,
    setAdminUserCapabilities,
    setFeedPriorityByAdmin,
    unbanUserByAdmin,
    writeAdminAudit,
} from './adminService';
import { listFirestoreReports, resolveFirestoreReport } from './firestoreAdmin';
import { getAppVersionPolicy, publicAppVersionPolicy, setAppVersionPolicy } from '../appVersion/appVersionPolicy';

const router = Router();

function extractBearerToken(req: AuthedRequest): string {
    // Fail closed: never accept tokens from query strings.
    if (typeof req.query?.access_token === 'string' || typeof req.query?.id_token === 'string' || typeof req.query?.token === 'string') {
        return '';
    }
    const authHeader = sanitizeBearerAuthorization(req.headers.authorization || '');
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) return '';
    const token = match[1].trim();
    // Reject the retired in-memory admin-session scheme.
    if (token.toLowerCase().startsWith('admin-session:')) return '';
    return token;
}

async function authenticateAllowlistedAdmin(req: AuthedRequest): Promise<
    | { ok: true; actorUserId: string }
    | { ok: false; status: number; error: string; code: string; detail?: string }
> {
    if (String(req.headers['x-admin-session'] || '').trim()) {
        return {
            ok: false,
            status: 401,
            error: 'UNAUTH',
            code: 'ADMIN_SESSION_RETIRED',
            detail: 'x-admin-session is retired; send a Cognito Bearer token',
        };
    }

    const token = extractBearerToken(req);
    if (!token) {
        return {
            ok: false,
            status: 401,
            error: 'UNAUTH',
            code: 'UNAUTH',
            detail: 'missing Cognito Bearer token',
        };
    }

    let decoded: any;
    try {
        decoded = await verifyCognitoJwt(token);
    } catch (err: any) {
        const isMisconfig = typeof err?.message === 'string' && err.message.includes('COGNITO_REGION');
        return {
            ok: false,
            status: isMisconfig ? 500 : 401,
            error: isMisconfig ? 'Auth misconfigured' : 'Invalid token',
            code: isMisconfig ? 'AUTH_MISCONFIGURED' : 'INVALID_TOKEN',
            detail: err?.message,
        };
    }

    const tokenUse = String(decoded?.token_use || '').trim().toLowerCase();
    if (tokenUse && tokenUse !== 'access' && tokenUse !== 'id') {
        return {
            ok: false,
            status: 401,
            error: 'UNAUTH',
            code: 'INVALID_TOKEN_USE',
            detail: 'admin routes require a Cognito access or id token',
        };
    }

    const actorUserId = String(decoded?.sub || '').trim();
    if (!isCanonicalSub(actorUserId)) {
        return {
            ok: false,
            status: 401,
            error: 'UNAUTH',
            code: 'INVALID_SUB',
            detail: 'token subject is not a canonical Cognito sub',
        };
    }

    let allowlistSubs: string[] = [];
    try {
        allowlistSubs = getAdminEnv().allowlistSubs;
    } catch (err: any) {
        return {
            ok: false,
            status: 500,
            error: 'INTERNAL',
            code: 'ADMIN_ENV_INVALID',
            detail: err?.message || String(err),
        };
    }

    if (allowlistSubs.length === 0) {
        logger.error('[admin] ADMIN_ALLOWLIST_SUBS is empty; refusing all admin access');
        return {
            ok: false,
            status: 503,
            error: 'ADMIN_ALLOWLIST_REQUIRED',
            code: 'ADMIN_ALLOWLIST_REQUIRED',
            detail: 'Set ADMIN_ALLOWLIST_SUBS to one or more Cognito subs',
        };
    }

    if (!allowlistSubs.includes(actorUserId)) {
        logger.warn({ actorUserId }, '[admin] cognito principal not allowlisted');
        return {
            ok: false,
            status: 403,
            error: 'FORBIDDEN',
            code: 'ADMIN_NOT_ALLOWLISTED',
        };
    }

    return { ok: true, actorUserId };
}

async function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
    const auth = await authenticateAllowlistedAdmin(req);
    if (!auth.ok) {
        return res.status(auth.status).json({
            error: auth.error,
            code: auth.code,
            detail: auth.detail,
        });
    }
    req.user = { sub: auth.actorUserId };
    return next();
}

// Password login is retired. This endpoint only validates an allowlisted Cognito Bearer token.
router.post('/admin/auth/login', async (req: AuthedRequest, res: Response) => {
    if (req.body?.email || req.body?.password) {
        logger.warn('[admin] rejected password login attempt');
        return res.status(503).json({
            error: 'ADMIN_LOGIN_DISABLED',
            code: 'ADMIN_LOGIN_DISABLED',
            detail: 'Shared-password admin login is disabled. Send Authorization: Bearer <cognito-jwt>.',
        });
    }

    const auth = await authenticateAllowlistedAdmin(req);
    if (!auth.ok) {
        return res.status(auth.status).json({
            error: auth.error,
            code: auth.code,
            detail: auth.detail,
        });
    }

    return res.json({
        ok: true,
        actorUserId: auth.actorUserId,
        authMode: 'cognito-allowlist',
    });
});

router.post('/admin/auth/logout', async (_req: AuthedRequest, res: Response) => {
    // Stateless Cognito auth: nothing to revoke server-side here.
    return res.json({ ok: true });
});

router.get('/admin/auth/me', requireAdmin, async (req: AuthedRequest, res: Response) => {
    const actorUserId = String(req.user?.sub || '').trim();
    return res.json({ ok: true, actorUserId, authMode: 'cognito-allowlist' });
});

router.get('/admin/config/app-version-policy', requireAdmin, async (_req: AuthedRequest, res: Response) => {
    try {
        const policy = await getAppVersionPolicy();
        return res.json({ policy: publicAppVersionPolicy(policy) });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] app-version-policy GET failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.post('/admin/config/app-version-policy', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const parsed = adminSetAppVersionPolicySchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }

        const policy = await setAppVersionPolicy({
            actorUserId,
            policy: {
                enabled: parsed.data.enabled,
                minimumAndroidVersionCode: parsed.data.minimumAndroidVersionCode ?? null,
                message: parsed.data.message,
                storeUrl: parsed.data.storeUrl,
            },
        });
        return res.json({ ok: true, policy: publicAppVersionPolicy(policy) });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] app-version-policy POST failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.get('/admin/users', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const parsed = adminListUsersSchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }

        const out = await listAdminUsers(parsed.data);
        return res.json(out);
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/users failed');
        const infra = getEconomyInfra();
        const [dbStatus, redisStatus] = await Promise.all([
            checkDb(infra.db),
            checkRedis(infra.redis),
        ]);

        return res.json({
            items: [],
            total: 0,
            limit: Number(req.query?.limit || 25),
            offset: Number(req.query?.offset || 0),
            degraded: true,
            detail: 'Users unavailable: database/redis not ready',
            dependencyStatus: {
                db: dbStatus,
                redis: redisStatus,
            },
            error: e?.message || String(e),
        });
    }
});

router.get('/admin/users/:userId/posts', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const targetUserId = String(req.params?.userId || '').trim();
        if (!isCanonicalSub(targetUserId)) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
        }

        const parsed = adminListUserPostsSchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }

        const out = await listAdminUserPosts({
            userId: targetUserId,
            q: parsed.data.q,
            limit: parsed.data.limit,
            offset: parsed.data.offset,
        });
        return res.json(out);
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/users/:userId/posts failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.get('/admin/users/sources', requireAdmin, async (_req: AuthedRequest, res: Response) => {
    try {
        const out = await getAdminUserSourceStats();
        return res.json(out);
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/users/sources failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.get('/admin/users/:userId', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const targetUserId = String(req.params?.userId || '').trim();
        if (!isCanonicalSub(targetUserId)) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
        }

        const out = await getAdminUserDetail(targetUserId);
        return res.json(out);
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/users/:userId failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.post('/admin/users/:userId/capabilities', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const targetUserId = String(req.params?.userId || '').trim();
        if (!isCanonicalSub(targetUserId)) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
        }

        const parsed = adminSetCapabilitiesSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }

        const out = await setAdminUserCapabilities({
            actorUserId,
            targetUserId,
            verified: parsed.data.verified,
            role: parsed.data.role,
            verificationNote: parsed.data.verificationNote || null,
            messagingRestricted: parsed.data.messagingRestricted,
            liveRestricted: parsed.data.liveRestricted,
            loginRestricted: parsed.data.loginRestricted,
            accountRestricted: parsed.data.accountRestricted,
            reason: parsed.data.reason || null,
            expiresAt: parsed.data.expiresAt || null,
            avatarFrame: parsed.data.avatarFrame === undefined ? undefined : (parsed.data.avatarFrame || null),
        });

        return res.json({ ok: true, userId: targetUserId, detail: out });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/users/:userId/capabilities failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

/**
 * Credit coins from the admin dashboard.
 * Auth: ADMIN_ALLOWLIST_SUBS only (same as other /admin/* routes).
 * Reuses economy creditCoinsAdmin ledger path. The separate
 * /economy/admin/credit-coins endpoint still requires ECONOMY_ADMIN_CREDIT_ENABLED
 * + ECONOMY_ADMIN_ALLOWLIST_SUBS for non-dashboard callers.
 */
router.post('/admin/users/:userId/credit-coins', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const targetUserId = String(req.params?.userId || '').trim();
        if (!isCanonicalSub(targetUserId)) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
        }

        const parsed = adminCreditCoinsBodySchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }

        const coins = parsed.data.coins;
        const idempotencyKey = parsed.data.idempotencyKey || `admin-dash:${actorUserId}:${targetUserId}:${randomUUID()}`;
        const reason = parsed.data.reason;

        // Same Redis rate limits as /economy/admin/credit-coins (fail closed).
        const { redis } = getEconomyInfra();
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
                try { await redis.decrby(perDayKey, coins); } catch { /* ignore */ }
                throw new EconomyError('RATE_LIMIT', 429, 'Daily cap exceeded');
            }
        } catch (e: any) {
            if (e instanceof EconomyError) throw e;
            throw new EconomyError('RATE_LIMIT', 503, 'Rate limiter unavailable', e?.message ?? e);
        }

        const out = await creditCoinsAdmin(actorUserId, {
            targetUserId,
            coins,
            idempotencyKey,
            reason,
        });

        await writeAdminAudit({
            actorUserId,
            action: 'user_credit_coins',
            targetType: 'user',
            targetId: targetUserId,
            metadata: {
                coins,
                coinsCredited: out.coinsCredited,
                newBalance: out.newBalance,
                ledgerId: out.ledgerId,
                idempotencyKey,
                reason: reason || null,
                replay: out.replay === true,
            },
        }).catch((err) => {
            logger.warn({ err: err?.message || String(err) }, '[admin] credit-coins audit write failed');
        });

        return res.json(out);
    } catch (e: any) {
        const err = toEconomyError(e);
        if (err.code === 'INTERNAL') {
            logger.error({ detail: err.detail }, '[admin] /admin/users/:userId/credit-coins failed');
        }
        return res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
    }
});

router.get('/admin/audit', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const parsed = adminListAuditSchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }

        const out = await listAdminAudit(parsed.data);
        return res.json(out);
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/audit failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.get('/admin/reports', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const parsed = adminListReportsSchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }

        const out = await listFirestoreReports({
            status: parsed.data.status,
            limit: parsed.data.limit,
        });

        return res.json({
            ok: true,
            available: out.available,
            reports: out.reports,
            detail: out.detail || null,
        });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/reports failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.post('/admin/reports/:reportId/resolve', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const reportId = String(req.params?.reportId || '').trim();
        if (!reportId) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
        }

        const parsed = adminResolveReportSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }

        const out = await resolveFirestoreReport({
            reportId,
            actorUserId,
            status: parsed.data.status,
            note: parsed.data.note || null,
        });

        if (!out.ok) {
            const status = out.detail === 'not_found' ? 404 : out.detail === 'firestore_unavailable' ? 503 : 500;
            return res.status(status).json({ error: out.detail || 'FAILED', code: out.detail || 'FAILED' });
        }

        await writeAdminAudit({
            actorUserId,
            action: 'report_resolve',
            targetType: 'report',
            targetId: reportId,
            metadata: {
                status: parsed.data.status,
                note: parsed.data.note || null,
                report: out.report || null,
            },
        }).catch(() => undefined);

        return res.json({ ok: true, report: out.report });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/reports/:reportId/resolve failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.post('/admin/users/:userId/message', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const targetUserId = String(req.params?.userId || '').trim();
        if (!isCanonicalSub(targetUserId)) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
        }

        const parsed = adminQueueUserMessageSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }

        const out = await queueAdminUserMessage({
            actorUserId,
            targetUserId,
            channel: parsed.data.channel,
            subject: parsed.data.subject || null,
            message: parsed.data.message,
        });

        return res.json({ ok: true, userId: targetUserId, ...out });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/users/:userId/message failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.post('/admin/users/:userId/ban', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const targetUserId = String(req.params?.userId || '').trim();
        if (!isCanonicalSub(targetUserId)) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
        }

        const parsed = banUserSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }

        await banUserByAdmin({
            actorUserId,
            targetUserId,
            reason: parsed.data.reason || null,
            bannedUntil: parsed.data.bannedUntil || null,
        });

        return res.json({ ok: true, userId: targetUserId, isBanned: true });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/users/:userId/ban failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.post('/admin/users/:userId/unban', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const targetUserId = String(req.params?.userId || '').trim();
        if (!isCanonicalSub(targetUserId)) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
        }

        const parsed = unbanUserSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }

        await unbanUserByAdmin({
            actorUserId,
            targetUserId,
            reason: parsed.data.reason || null,
        });

        return res.json({ ok: true, userId: targetUserId, isBanned: false });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/users/:userId/unban failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.post('/admin/posts/:postId/remove', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const targetPostId = String(req.params?.postId || '').trim();
        if (!targetPostId) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
        }

        const parsed = moderatePostSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }

        await removePostByAdmin({
            actorUserId,
            targetPostId,
            userId: parsed.data.userId,
            reason: parsed.data.reason || null,
        });

        return res.json({ ok: true, postId: targetPostId, isRemoved: true });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/posts/:postId/remove failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.post('/admin/posts/:postId/restore', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const targetPostId = String(req.params?.postId || '').trim();
        if (!targetPostId) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
        }

        const parsed = moderatePostSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }

        await restorePostByAdmin({
            actorUserId,
            targetPostId,
            userId: parsed.data.userId,
            reason: parsed.data.reason || null,
        });

        return res.json({ ok: true, postId: targetPostId, isRemoved: false });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/posts/:postId/restore failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.post('/admin/posts/:postId/feed-priority', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const targetPostId = String(req.params?.postId || '').trim();
        if (!targetPostId) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
        }

        const parsed = adminFeedPrioritySchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }

        await setFeedPriorityByAdmin({
            actorUserId,
            targetPostId,
            priority: parsed.data.priority,
            reason: parsed.data.reason || null,
        });

        return res.json({ ok: true, postId: targetPostId, feedPriority: parsed.data.priority });
    } catch (e: any) {
        const code = String(e?.code || '');
        if (code === 'FEED_PRIORITY_FIRESTORE_FAILED') {
            return res.status(502).json({
                error: 'FIRESTORE_WRITE_FAILED',
                code: 'FEED_PRIORITY_FIRESTORE_FAILED',
                detail: e?.message || String(e),
            });
        }
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/posts/:postId/feed-priority failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.get('/admin/metrics/overview', requireAdmin, async (_req: AuthedRequest, res: Response) => {
    try {
        const out = await getAdminMetricsOverview();
        return res.json(out);
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/metrics/overview failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

// Read-only app-consumption route: authenticated users can fetch only their own controls/messages.
router.get('/api/live/me/admin-controls', cognitoJwtMiddleware, async (req: AuthedRequest, res: Response) => {
    try {
        const userId = String(req.user?.sub || '').trim();
        if (!userId) {
            return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH', detail: 'missing user identity' });
        }

        const out = await getEffectiveUserControls(userId);
        return res.json({ ok: true, ...out });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /api/live/me/admin-controls failed');
        return res.status(200).json({
            ok: false,
            userId: String(req.user?.sub || ''),
            verification: { isVerified: false, note: '', updatedAt: null, updatedBy: null },
            restrictions: {
                messagingRestricted: false,
                liveRestricted: false,
                accountRestricted: false,
                reason: '',
                expiresAt: null,
                updatedAt: null,
                updatedBy: null,
            },
            recentMessages: [],
            source: 'unavailable',
            degraded: true,
            detail: e?.message || String(e),
        });
    }
});

export default router;
