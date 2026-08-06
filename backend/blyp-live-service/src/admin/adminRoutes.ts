import { Router, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { AuthedRequest, cognitoJwtMiddleware } from '../auth/cognitoJwtMiddleware';
import { verifyCognitoJwt } from '../auth/verifyCognitoJwt';
import { isCanonicalCognitoSub as isCanonicalSub } from '../auth/cognitoSub';
import { getAdminEnv } from '../config/adminEnv';
import { logger } from '../config/logger';
import { checkDb, checkRedis, getEconomyInfra } from '../economy/infra';
import { creditCoinsAdmin, creditGemsAdminLaunchTest } from '../economy/economyService';
import {
    approveWithdrawal,
    listWithdrawals,
    rejectWithdrawal,
} from '../economy/withdrawalService';
import { LAUNCH_TEST_GEM_CREDIT_CAP } from '../economy/withdrawLaunchTest';
import { materializeRankingsSnapshots } from '../economy/rankingsService';
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
    adminCreditGemsBodySchema,
    adminListReportsSchema,
    adminResolveReportSchema,
    adminListWithdrawalsSchema,
    adminRejectWithdrawalSchema,
    banUserSchema,
    adminSetFeatureFlagsSchema,
    adminSetGiftEnabledSchema,
    adminListCommsMessagesSchema,
    adminBroadcastMessageSchema,
    adminListLiveSchema,
    adminListGlobalPostsSchema,
    adminSetStreamingConfigSchema,
    adminForceEndLiveSchema,
    adminApproveTeamApplicationSchema,
    adminRejectTeamApplicationSchema,
    adminListLedgerSchema,
    adminListIapPurchasesSchema,
    adminBanCacheProbeSchema,
    adminAuditExportSchema,
    adminFraudSignalsSchema,
    adminListPromotionsSchema,
    adminAddStrikeSchema,
    adminCreateAppealSchema,
    adminResolveAppealSchema,
    adminListAppealsSchema,
    adminAutoModPolicySchema,
    adminMassBanSchema,
    adminFraudFlagsSchema,
    adminDsarPurgeSchema,
    adminGameDisputeCreateSchema,
    adminGameDisputeStatusSchema,

    moderatePostSchema,
    adminFeedPrioritySchema,
    adminAccountFeedPrioritySchema,
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
    setAccountFeedPriorityByAdmin,
    unbanUserByAdmin,
    writeAdminAudit,
} from './adminService';
import {
    getAdminAnalytics,
    getAdminCatalog,
    getFeatureFlags,
    setFeatureFlags,
    setGiftEnabled,
    broadcastAdminMessage,
    listRecentAdminMessages,
    listAdminGlobalPosts,
    getOpsControlPlane,
} from './adminInsights';
import {
    adminGetWallet,
    adminListLedger,
    adminListIapPurchases,
    DUAL_CONTROL_UI,
} from './adminEconomyReads';
import {
    getFraudGiftSignals,
    listPromotions,
    listDatingDesk,
    getUserStrikeSummary,
    addUserStrike,
    listAppeals,
    createAppeal,
    resolveAppeal,
} from './adminIntegrity';
import { getBanCacheStats, probeBanCache } from './banGuard';
import {
    listFirestoreReports,
    resolveFirestoreReport,
    listFirestoreStreams,
    getFirestoreStream,
    listFirestoreTeams,
    listFirestoreTeamApplications,
    approveTeamApplication,
    rejectTeamApplication,
    setStreamingConfig,
} from './firestoreAdmin';
import { endLiveSession } from '../live/liveService';
import { getSessionById } from '../live/liveSessionStore';
import { getAppVersionPolicy, publicAppVersionPolicy, setAppVersionPolicy } from '../appVersion/appVersionPolicy';
import { ensureAdminSchema } from './adminSchema';
import {
    buildDsarExportPackage,
    createGameDispute,
    DISPUTE_STATUSES,
    DSAR_PURGE_CONFIRM,
    executeDsarPurge,
    executeMassBan,
    getAutoModPolicy,
    listGameDisputes,
    listOpenChargebackUsers,
    MASS_BAN_CONFIRM,
    MASS_BAN_MAX,
    setAutoModPolicy,
    setUserFraudFlags,
    updateGameDisputeStatus,
} from './adminDeferredOps';
import {
    ADMIN_CREDIT_SOFT_CAP,
    ADMIN_ROLES,
    attachStaffToRequest,
    deleteStaffRole,
    isAdminRole,
    listStaffRecords,
    mePayload,
    requirePermission,
    resolveStaffRole,
    roleHasPermission,
    seedBootstrapStaff,
    upsertStaffRole,
    type AdminRole,
} from './adminRbac';

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
    const staff = await resolveStaffRole(auth.actorUserId);
    if (!staff) {
        logger.warn({ actorUserId: auth.actorUserId }, '[admin] allowlisted but no console role');
        return res.status(403).json({
            error: 'FORBIDDEN',
            code: 'ADMIN_ROLE_REQUIRED',
            detail: 'Allowlisted but no console role assigned — Owner must grant a role on Access',
        });
    }
    attachStaffToRequest(req, staff);
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

    const staff = await resolveStaffRole(auth.actorUserId);
    if (!staff) {
        return res.status(403).json({
            error: 'FORBIDDEN',
            code: 'ADMIN_ROLE_REQUIRED',
            detail: 'Allowlisted but no console role assigned — Owner must grant a role on Access',
        });
    }

    return res.json(mePayload(staff));
});

router.post('/admin/auth/logout', async (_req: AuthedRequest, res: Response) => {
    // Stateless Cognito auth: nothing to revoke server-side here.
    return res.json({ ok: true });
});

router.get('/admin/auth/me', requireAdmin, async (req: AuthedRequest, res: Response) => {
    const staff = req.user?.adminStaff;
    if (!staff) {
        return res.status(403).json({ error: 'FORBIDDEN', code: 'ADMIN_ROLE_REQUIRED' });
    }
    return res.json(mePayload(staff));
});

router.get('/admin/staff', requireAdmin, requirePermission('staff.manage'), async (_req: AuthedRequest, res: Response) => {
    try {
        await seedBootstrapStaff();
        const items = await listStaffRecords();
        return res.json({
            items,
            roles: ADMIN_ROLES,
            note: 'Outer gate remains ADMIN_ALLOWLIST_SUBS env; this table is the RBAC role store.',
        });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/staff GET failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.post('/admin/staff', requireAdmin, requirePermission('staff.manage'), async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const sub = String(req.body?.sub || '').trim();
        const role = String(req.body?.role || '').trim();
        const displayName = req.body?.displayName != null ? String(req.body.displayName).trim() : null;
        const notes = req.body?.notes != null ? String(req.body.notes).trim() : null;
        if (!isCanonicalSub(sub)) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_SUB' });
        }
        if (!isAdminRole(role)) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_ROLE', detail: `role must be one of ${ADMIN_ROLES.join(',')}` });
        }
        const record = await upsertStaffRole({
            sub,
            role: role as AdminRole,
            displayName,
            notes,
            actorUserId,
        });
        await writeAdminAudit({
            actorUserId,
            action: 'staff_role_upsert',
            targetType: 'admin_staff',
            targetId: sub,
            metadata: { role, displayName, notes },
        });
        return res.json({ ok: true, item: record });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/staff POST failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL', detail: e?.message });
    }
});

router.post('/admin/staff/:sub/delete', requireAdmin, requirePermission('staff.manage'), async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const sub = String(req.params.sub || '').trim();
        await deleteStaffRole(sub);
        await writeAdminAudit({
            actorUserId,
            action: 'staff_role_delete',
            targetType: 'admin_staff',
            targetId: sub,
            metadata: {},
        });
        return res.json({ ok: true });
    } catch (e: any) {
        const msg = e?.message || String(e);
        if (msg === 'CANNOT_REMOVE_OWNER') {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'CANNOT_REMOVE_OWNER', detail: 'Owner bootstrap seat cannot be removed' });
        }
        logger.error({ err: msg }, '[admin] /admin/staff delete failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL', detail: msg });
    }
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

router.post('/admin/config/app-version-policy', requireAdmin, requirePermission('config.version.write'), async (req: AuthedRequest, res: Response) => {
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

router.post('/admin/users/:userId/capabilities', requireAdmin, requirePermission('users.capabilities'), async (req: AuthedRequest, res: Response) => {
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
router.post('/admin/users/:userId/credit-coins', requireAdmin, requirePermission('economy.credit'), async (req: AuthedRequest, res: Response) => {
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

        const actorRole = String(req.user?.adminRole || '') as AdminRole;
        if (actorRole !== 'owner' && coins > ADMIN_CREDIT_SOFT_CAP) {
            return res.status(403).json({
                error: 'FORBIDDEN',
                code: 'CREDIT_SOFT_CAP',
                detail: `Non-owner credit capped at ${ADMIN_CREDIT_SOFT_CAP} BONUS_COIN per request — escalate to Owner`,
                softCap: ADMIN_CREDIT_SOFT_CAP,
            });
        }

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

/**
 * Owner-only launch-test gem credit → gem_available (audited).
 * Target must be WITHDRAW_TEST_SUBS / ADMIN_ALLOWLIST / Owner bootstrap.
 */
router.post('/admin/users/:userId/credit-gems', requireAdmin, requirePermission('economy.credit'), async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const actorRole = String(req.user?.adminRole || '') as AdminRole;
        if (actorRole !== 'owner') {
            return res.status(403).json({
                error: 'FORBIDDEN',
                code: 'OWNER_ONLY',
                detail: 'Launch-test gem credit is Owner-only',
            });
        }

        const targetUserId = String(req.params?.userId || '').trim();
        if (!isCanonicalSub(targetUserId)) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
        }

        const parsed = adminCreditGemsBodySchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }

        const gems = parsed.data.gems;
        if (gems > LAUNCH_TEST_GEM_CREDIT_CAP) {
            return res.status(400).json({
                error: 'INVALID_INPUT',
                code: 'GEM_CREDIT_CAP',
                detail: `Max ${LAUNCH_TEST_GEM_CREDIT_CAP} gems per launch-test credit`,
            });
        }

        const idempotencyKey =
            parsed.data.idempotencyKey || `admin-gem:${actorUserId}:${targetUserId}:${randomUUID()}`;
        const reason = parsed.data.reason || 'owner_launch_test_withdraw';

        const out = await creditGemsAdminLaunchTest(actorUserId, {
            targetUserId,
            gems,
            idempotencyKey,
            reason,
        });

        await writeAdminAudit({
            actorUserId,
            action: 'user_credit_gems_launch_test',
            targetType: 'user',
            targetId: targetUserId,
            metadata: {
                gems,
                gemsCredited: out.gemsCredited,
                gemAvailable: out.gemAvailable,
                ledgerId: out.ledgerId,
                idempotencyKey,
                reason,
                replay: out.replay === true,
            },
        }).catch((err) => {
            logger.warn({ err: err?.message || String(err) }, '[admin] credit-gems audit write failed');
        });

        return res.json(out);
    } catch (e: any) {
        const err = toEconomyError(e);
        if (err.code === 'INTERNAL') {
            logger.error({ detail: err.detail }, '[admin] /admin/users/:userId/credit-gems failed');
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

/** CSV export of audit log (safety/access actions). Capped; no secrets. */
router.get('/admin/audit.csv', requireAdmin, requirePermission('audit.export'), async (req: AuthedRequest, res: Response) => {
    try {
        const parsed = adminAuditExportSchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }

        const max = parsed.data.limit;
        const pageSize = 100;
        const rows: Array<{
            id: number;
            actorUserId: string;
            action: string;
            targetType: string;
            targetId: string;
            metadata: Record<string, unknown>;
            createdAt: string | null;
        }> = [];
        let offset = 0;
        while (rows.length < max) {
            const batch = await listAdminAudit({
                q: parsed.data.q,
                action: parsed.data.action,
                limit: Math.min(pageSize, max - rows.length),
                offset,
            });
            rows.push(...batch.items);
            if (batch.items.length < pageSize || rows.length >= batch.total) break;
            offset += batch.items.length;
        }

        const esc = (v: unknown) => {
            const s = v == null ? '' : String(v);
            if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
            return s;
        };
        const header = ['id', 'createdAt', 'action', 'actorUserId', 'targetType', 'targetId', 'metadata'];
        const lines = [header.join(',')];
        for (const r of rows) {
            lines.push(
                [
                    esc(r.id),
                    esc(r.createdAt),
                    esc(r.action),
                    esc(r.actorUserId),
                    esc(r.targetType),
                    esc(r.targetId),
                    esc(JSON.stringify(r.metadata || {})),
                ].join(','),
            );
        }

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="blyp-admin-audit.csv"');
        return res.status(200).send(lines.join('\n') + '\n');
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/audit.csv failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.get('/admin/users/:userId/wallet', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const userId = String(req.params?.userId || '').trim();
        if (!isCanonicalSub(userId)) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
        }
        const out = await adminGetWallet(userId);
        return res.json(out);
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/users/:userId/wallet failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.get('/admin/users/:userId/ledger', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const userId = String(req.params?.userId || '').trim();
        if (!isCanonicalSub(userId)) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
        }
        const parsed = adminListLedgerSchema.safeParse({ ...req.query, userId });
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }
        const out = await adminListLedger(parsed.data);
        return res.json(out);
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/users/:userId/ledger failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.get('/admin/users/:userId/reports', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const userId = String(req.params?.userId || '').trim();
        if (!isCanonicalSub(userId)) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
        }
        const out = await listFirestoreReports({ status: 'all', limit: 100 });
        const reports = (out.reports || []).filter(
            (r) => r.targetId === userId || r.reporterId === userId,
        );
        return res.json({
            available: out.available,
            userId,
            reports,
            total: reports.length,
            detail: out.detail,
            note: 'Filtered from recent Firestore reports window (not a full historical index).',
        });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/users/:userId/reports failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.get('/admin/users/:userId/devices', requireAdmin, async (req: AuthedRequest, res: Response) => {
    const userId = String(req.params?.userId || '').trim();
    if (!isCanonicalSub(userId)) {
        return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
    }
    // Honest empty: live-service has no end-user device/session inventory.
    return res.json({
        available: false,
        userId,
        items: [],
        detail: 'not_in_live_service',
        note: 'Device tokens / push sessions are not stored in blyp-live-service. No fake inventory.',
    });
});

router.get('/admin/ledger', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const parsed = adminListLedgerSchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }
        const out = await adminListLedger(parsed.data);
        return res.json({ ...out, dualControlUi: DUAL_CONTROL_UI });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/ledger failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.get('/admin/iap/purchases', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const parsed = adminListIapPurchasesSchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }
        const out = await adminListIapPurchases({
            ...parsed.data,
            platform: parsed.data.platform ? String(parsed.data.platform).toUpperCase() : undefined,
        });
        return res.json(out);
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/iap/purchases failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.get('/admin/ops/ban-cache', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const parsed = adminBanCacheProbeSchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }
        const stats = getBanCacheStats();
        const probe = parsed.data.userId ? await probeBanCache(parsed.data.userId) : null;
        return res.json({
            generatedAt: new Date().toISOString(),
            stats,
            probe,
        });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/ops/ban-cache failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.get('/admin/fraud/signals', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const parsed = adminFraudSignalsSchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }
        const out = await getFraudGiftSignals(parsed.data);
        return res.json(out);
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/fraud/signals failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.get('/admin/promote', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const parsed = adminListPromotionsSchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }
        const out = await listPromotions(parsed.data);
        return res.json(out);
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/promote failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.get('/admin/dating', requireAdmin, async (_req: AuthedRequest, res: Response) => {
    try {
        const out = await listDatingDesk({ limit: 40 });
        return res.json(out);
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/dating failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.get('/admin/users/:userId/strikes', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const userId = String(req.params?.userId || '').trim();
        if (!isCanonicalSub(userId)) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
        }
        const out = await getUserStrikeSummary(userId);
        return res.json(out);
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/users/:userId/strikes failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.post('/admin/users/:userId/strikes', requireAdmin, requirePermission('strikes.write'), async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const userId = String(req.params?.userId || '').trim();
        if (!isCanonicalSub(userId)) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
        }
        const parsed = adminAddStrikeSchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }
        const out = await addUserStrike({
            actorUserId,
            userId,
            reason: parsed.data.reason,
            surface: parsed.data.surface,
            relatedReportId: parsed.data.relatedReportId,
        });
        return res.json(out);
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] POST /admin/users/:userId/strikes failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.get('/admin/appeals', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const parsed = adminListAppealsSchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }
        const out = await listAppeals(parsed.data);
        return res.json(out);
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/appeals failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.post('/admin/appeals', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const parsed = adminCreateAppealSchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }
        const out = await createAppeal({
            actorUserId,
            userId: parsed.data.userId,
            statement: parsed.data.statement,
            strikeId: parsed.data.strikeId,
        });
        return res.json(out);
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] POST /admin/appeals failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.post('/admin/appeals/:appealId/resolve', requireAdmin, requirePermission('appeals.resolve'), async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const appealId = String(req.params?.appealId || '').trim();
        if (!appealId) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
        }
        const parsed = adminResolveAppealSchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }
        const out = await resolveAppeal({
            actorUserId,
            appealId,
            status: parsed.data.status,
            note: parsed.data.note,
        });
        if (!out.ok) {
            return res.status(404).json({ error: 'NOT_FOUND', code: 'NOT_FOUND', detail: out.detail });
        }
        return res.json({ ok: true, appealId, status: parsed.data.status });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] POST /admin/appeals/:appealId/resolve failed');
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
            reasonCode: parsed.data.reasonCode,
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

router.post('/admin/reports/:reportId/resolve', requireAdmin, requirePermission('reports.resolve'), async (req: AuthedRequest, res: Response) => {
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

        // Child-safety force/close requires elevated permission (mods may triage only via escalate note).
        const reasonHint = String(
            (req.body as any)?.reasonCode ||
                (req.body as any)?.lane ||
                parsed.data.note ||
                '',
        ).toLowerCase();
        const childSafety =
            reasonHint.includes('child_safety') ||
            reasonHint.includes('child-safety') ||
            reasonHint.includes('csam') ||
            Boolean((req.body as any)?.childSafety);
        if (childSafety && !roleHasPermission(String(req.user?.adminRole || '') as AdminRole, 'reports.resolve.child_safety')) {
            return res.status(403).json({
                error: 'FORBIDDEN',
                code: 'FORBIDDEN_PERMISSION',
                detail: 'Missing permission: reports.resolve.child_safety — escalate to T&S Lead / Admin / Owner',
            });
        }
        if (childSafety && !roleHasPermission(String(req.user?.adminRole || '') as AdminRole, 'child_safety.force') && parsed.data.status === 'resolved') {
            return res.status(403).json({
                error: 'FORBIDDEN',
                code: 'FORBIDDEN_PERMISSION',
                detail: 'Missing permission: child_safety.force — cannot solo-close child_safety',
            });
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

router.post('/admin/users/:userId/message', requireAdmin, requirePermission('users.message'), async (req: AuthedRequest, res: Response) => {
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

router.post('/admin/users/mass-ban', requireAdmin, requirePermission('users.ban.mass'), async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const parsed = adminMassBanSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: 'INVALID_INPUT',
                code: 'INVALID_INPUT',
                detail: parsed.error.issues,
                maxBatch: MASS_BAN_MAX,
                confirmHint: MASS_BAN_CONFIRM,
            });
        }
        const out = await executeMassBan({
            actorUserId,
            userIds: parsed.data.userIds,
            reason: parsed.data.reason,
            dryRun: parsed.data.dryRun !== false,
            confirmPhrase: parsed.data.confirmPhrase,
        });
        return res.json({
            ok: true,
            ...out,
            maxBatch: MASS_BAN_MAX,
            confirmHint: MASS_BAN_CONFIRM,
        });
    } catch (e: any) {
        const code = e?.code || 'INTERNAL';
        const status = code === 'CONFIRM_REQUIRED' || code === 'BATCH_TOO_LARGE' || code === 'EMPTY_BATCH' ? 400 : 500;
        return res.status(status).json({
            error: code,
            code,
            detail: e?.detail || e?.message || String(e),
            maxBatch: MASS_BAN_MAX,
            confirmHint: MASS_BAN_CONFIRM,
        });
    }
});

router.post('/admin/users/:userId/ban', requireAdmin, requirePermission('users.ban'), async (req: AuthedRequest, res: Response) => {
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

router.post('/admin/users/:userId/unban', requireAdmin, requirePermission('users.unban'), async (req: AuthedRequest, res: Response) => {
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

router.post('/admin/posts/:postId/remove', requireAdmin, requirePermission('content.moderate'), async (req: AuthedRequest, res: Response) => {
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

router.post('/admin/posts/:postId/restore', requireAdmin, requirePermission('content.moderate'), async (req: AuthedRequest, res: Response) => {
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

router.post('/admin/posts/:postId/feed-priority', requireAdmin, requirePermission('growth.feed_priority'), async (req: AuthedRequest, res: Response) => {
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

        return res.json({
            ok: true,
            postId: targetPostId,
            feedPriority:
                parsed.data.priority === 'less' ? 'low' : parsed.data.priority,
        });
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

router.post('/admin/users/:userId/feed-priority', requireAdmin, requirePermission('growth.feed_priority'), async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const targetUserId = String(req.params?.userId || '').trim();
        if (!targetUserId) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
        }
        if (!isCanonicalSub(targetUserId)) {
            return res.status(400).json({ error: 'INVALID_SUB', code: 'INVALID_SUB' });
        }

        const parsed = adminAccountFeedPrioritySchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }

        const result = await setAccountFeedPriorityByAdmin({
            actorUserId,
            targetUserId,
            priority: parsed.data.priority,
            reason: parsed.data.reason || null,
        });

        return res.json({
            ok: true,
            userId: targetUserId,
            feedPriorityAccount: result.feedPriorityAccount,
        });
    } catch (e: any) {
        const code = String(e?.code || '');
        if (code === 'INVALID_SUB') {
            return res.status(400).json({ error: 'INVALID_SUB', code: 'INVALID_SUB' });
        }
        if (code === 'FEED_PRIORITY_FIRESTORE_FAILED') {
            return res.status(502).json({
                error: 'FIRESTORE_WRITE_FAILED',
                code: 'FEED_PRIORITY_FIRESTORE_FAILED',
                detail: e?.message || String(e),
            });
        }
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/users/:userId/feed-priority failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

/**
 * Creator withdrawal queue (pending_review settle path).
 * Approve executes Stripe transfer; reject restores reserved gems.
 */
router.get('/admin/withdrawals', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const parsed = adminListWithdrawalsSchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }
        const out = await listWithdrawals(parsed.data);
        return res.json(out);
    } catch (e: any) {
        const err = toEconomyError(e);
        logger.error({ detail: err.detail, code: err.code }, '[admin] /admin/withdrawals failed');
        return res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
    }
});

router.post('/admin/withdrawals/:withdrawalId/approve', requireAdmin, requirePermission('economy.withdraw.approve'), async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const withdrawalId = String(req.params?.withdrawalId || '').trim();
        if (!withdrawalId) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
        }
        const out = await approveWithdrawal(withdrawalId, actorUserId);
        await writeAdminAudit({
            actorUserId,
            action: 'withdrawal_approve',
            targetType: 'withdrawal',
            targetId: withdrawalId,
            metadata: {
                status: out.status,
                userId: out.userId,
                amountGems: out.amountGems,
                stripeTransferId: out.stripeTransferId || null,
            },
        }).catch((err) => {
            logger.warn({ err: err?.message || String(err) }, '[admin] withdrawal approve audit failed');
        });
        return res.json(out);
    } catch (e: any) {
        const err = toEconomyError(e);
        if (err.code === 'INTERNAL' || err.code === 'PROVIDER_ERROR') {
            logger.error({ detail: err.detail, code: err.code }, '[admin] withdrawal approve failed');
        }
        return res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
    }
});

router.post('/admin/withdrawals/:withdrawalId/reject', requireAdmin, requirePermission('economy.withdraw.reject'), async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const withdrawalId = String(req.params?.withdrawalId || '').trim();
        if (!withdrawalId) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
        }
        const parsed = adminRejectWithdrawalSchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }
        const out = await rejectWithdrawal(withdrawalId, actorUserId, parsed.data.reason);
        await writeAdminAudit({
            actorUserId,
            action: 'withdrawal_reject',
            targetType: 'withdrawal',
            targetId: withdrawalId,
            metadata: {
                status: out.status,
                userId: out.userId,
                amountGems: out.amountGems,
                reason: parsed.data.reason || null,
            },
        }).catch((err) => {
            logger.warn({ err: err?.message || String(err) }, '[admin] withdrawal reject audit failed');
        });
        return res.json(out);
    } catch (e: any) {
        const err = toEconomyError(e);
        logger.error({ detail: err.detail, code: err.code }, '[admin] withdrawal reject failed');
        return res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
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

router.get('/admin/analytics', requireAdmin, async (_req: AuthedRequest, res: Response) => {
    try {
        const out = await getAdminAnalytics();
        return res.json(out);
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/analytics failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.get('/admin/config/flags', requireAdmin, async (_req: AuthedRequest, res: Response) => {
    try {
        const flags = await getFeatureFlags();
        return res.json({ flags });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/config/flags GET failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.post('/admin/config/flags', requireAdmin, requirePermission('config.flags.write'), async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const parsed = adminSetFeatureFlagsSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }

        const flags = await setFeatureFlags({ actorUserId, flags: parsed.data.flags });
        return res.json({ flags });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/config/flags POST failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.get('/admin/config/catalog', requireAdmin, async (_req: AuthedRequest, res: Response) => {
    try {
        const out = await getAdminCatalog();
        return res.json(out);
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/config/catalog failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.post('/admin/config/gift/:giftId', requireAdmin, requirePermission('config.flags.write'), async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const giftId = String(req.params?.giftId || '').trim();
        if (!giftId) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
        }

        const parsed = adminSetGiftEnabledSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }

        await setGiftEnabled({ actorUserId, giftId, enabled: parsed.data.enabled });
        return res.json({ ok: true, giftId, enabled: parsed.data.enabled });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/config/gift/:giftId failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.get('/admin/comms/messages', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const parsed = adminListCommsMessagesSchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }

        const out = await listRecentAdminMessages(parsed.data);
        return res.json(out);
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/comms/messages failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.post('/admin/comms/broadcast', requireAdmin, requirePermission('comms.broadcast'), async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const parsed = adminBroadcastMessageSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }

        if (
            parsed.data.segment === 'all' &&
            !roleHasPermission(String(req.user?.adminRole || '') as AdminRole, 'comms.broadcast.all')
        ) {
            return res.status(403).json({
                error: 'FORBIDDEN',
                code: 'FORBIDDEN_PERMISSION',
                detail: 'Missing permission: comms.broadcast.all — all-user blast is Owner/Exec only',
            });
        }

        const out = await broadcastAdminMessage({
            actorUserId,
            segment: parsed.data.segment,
            subject: parsed.data.subject ?? null,
            message: parsed.data.message,
            deepLink: parsed.data.deepLink ?? null,
        });
        return res.json(out);
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/comms/broadcast failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.get('/admin/live', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const parsed = adminListLiveSchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }

        const streams = await listFirestoreStreams(parsed.data.status);
        if (streams === null) {
            return res.json({
                items: [],
                live: 0,
                total: 0,
                totalViewers: 0,
                degraded: true,
                detail: 'firestore_unavailable',
            });
        }

        const liveCount = streams.filter((s) => s.status === 'live').length;
        const totalViewers = streams
            .filter((s) => s.status === 'live')
            .reduce((sum, s) => sum + (s.viewerCount || 0), 0);

        return res.json({
            items: streams,
            live: liveCount,
            total: streams.length,
            totalViewers,
        });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/live failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.get('/admin/teams', requireAdmin, async (_req: AuthedRequest, res: Response) => {
    try {
        const teams = await listFirestoreTeams();
        if (teams === null) {
            return res.json({ items: [], total: 0, degraded: true, detail: 'firestore_unavailable' });
        }
        return res.json({ items: teams, total: teams.length });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/teams failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.get('/admin/team-applications', requireAdmin, async (_req: AuthedRequest, res: Response) => {
    try {
        const items = await listFirestoreTeamApplications();
        if (items === null) {
            return res.json({
                items: [],
                total: 0,
                pendingCount: 0,
                degraded: true,
                detail: 'firestore_unavailable',
            });
        }
        const pendingCount = items.filter((a) => a.status === 'pending').length;
        return res.json({ items, total: items.length, pendingCount });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/team-applications failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.post('/admin/team-applications/:uid/approve', requireAdmin, requirePermission('teams.approve'), async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const uid = String(req.params?.uid || '').trim();
        if (!isCanonicalSub(uid)) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
        }

        const parsed = adminApproveTeamApplicationSchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }

        const out = await approveTeamApplication(uid, {
            teamName: parsed.data.teamName,
            teamDesc: parsed.data.teamDesc,
        });
        if (!out) {
            return res.status(404).json({ error: 'NOT_FOUND', code: 'NOT_FOUND' });
        }

        await writeAdminAudit({
            actorUserId,
            action: 'team_application_approve',
            targetType: 'user',
            targetId: uid,
            metadata: { teamId: out.teamId, teamName: parsed.data.teamName || null },
        }).catch(() => undefined);

        return res.json({ ok: true, uid, teamId: out.teamId });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/team-applications/:uid/approve failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.post('/admin/team-applications/:uid/reject', requireAdmin, requirePermission('teams.approve'), async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const uid = String(req.params?.uid || '').trim();
        if (!isCanonicalSub(uid)) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
        }

        const parsed = adminRejectTeamApplicationSchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }

        const ok = await rejectTeamApplication(uid, parsed.data.reason || '');
        if (!ok) {
            return res.status(503).json({ error: 'FAILED', code: 'FIRESTORE_WRITE_FAILED' });
        }

        await writeAdminAudit({
            actorUserId,
            action: 'team_application_reject',
            targetType: 'user',
            targetId: uid,
            metadata: { reason: parsed.data.reason || null },
        }).catch(() => undefined);

        return res.json({ ok: true, uid });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/team-applications/:uid/reject failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.get('/admin/posts', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const parsed = adminListGlobalPostsSchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }

        const out = await listAdminGlobalPosts(parsed.data);
        return res.json(out);
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/posts failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.get('/admin/ops/control-plane', requireAdmin, async (_req: AuthedRequest, res: Response) => {
    try {
        const out = await getOpsControlPlane();
        return res.json(out);
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/ops/control-plane failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.post('/admin/config/streaming', requireAdmin, requirePermission('kill.global.write'), async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const parsed = adminSetStreamingConfigSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }

        const out = await setStreamingConfig({
            enabled: parsed.data.enabled,
            reason: parsed.data.reason ?? null,
            actorUserId,
        });
        if (!out.ok) {
            return res.status(503).json({ error: 'FIRESTORE_WRITE_FAILED', code: 'FIRESTORE_WRITE_FAILED', detail: out.detail });
        }

        await writeAdminAudit({
            actorUserId,
            action: 'streaming_config_set',
            targetType: 'config',
            targetId: 'appConfig/streaming',
            metadata: { enabled: parsed.data.enabled, reason: parsed.data.reason || null },
        }).catch(() => undefined);

        return res.json({ ok: true, enabled: out.enabled });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/config/streaming failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.get('/admin/live/:sessionId', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const sessionId = String(req.params?.sessionId || '').trim();
        if (!sessionId) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
        }

        const [fsStream, dynamoSession] = await Promise.all([
            getFirestoreStream(sessionId).catch(() => null),
            getSessionById(sessionId).catch(() => null),
        ]);

        if (!fsStream && !dynamoSession) {
            return res.status(404).json({ error: 'NOT_FOUND', code: 'NOT_FOUND', detail: 'No Firestore directory or Dynamo session for this id' });
        }

        const moderators = dynamoSession?.moderatorIds
            ? Array.from(dynamoSession.moderatorIds as unknown as Set<string> | string[])
            : [];

        return res.json({
            sessionId,
            firestore: fsStream,
            dynamo: dynamoSession
                ? {
                    sessionId: dynamoSession.sessionId,
                    hostUserId: dynamoSession.hostUserId,
                    title: dynamoSession.title,
                    status: dynamoSession.status,
                    createdAt: dynamoSession.createdAt,
                    endedAt: dynamoSession.endedAt || null,
                    region: dynamoSession.region || null,
                    moderators,
                }
                : null,
            // Convenience fields for UI
            hostUserId: fsStream?.userId || dynamoSession?.hostUserId || null,
            title: fsStream?.title || dynamoSession?.title || null,
            status: fsStream?.status || (dynamoSession?.status ? String(dynamoSession.status).toLowerCase() : null),
            viewerCount: fsStream?.viewerCount ?? null,
            peakViewerCount: fsStream?.peakViewerCount ?? null,
            startedAt: fsStream?.createdAt || dynamoSession?.createdAt || null,
            lastHeartbeatAt: fsStream?.lastHeartbeatAt || null,
        });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e), sessionId: req.params?.sessionId }, '[admin] /admin/live/:sessionId failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.post('/admin/live/:sessionId/force-end', requireAdmin, requirePermission('live.force_end'), async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const sessionId = String(req.params?.sessionId || '').trim();
        if (!sessionId) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
        }

        const parsed = adminForceEndLiveSchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }

        await endLiveSession(sessionId);

        // Mirror into Firestore directory so Live admin UI doesn't keep showing LIVE.
        const { endFirestoreStream } = await import('./firestoreAdmin');
        const fsEnd = await endFirestoreStream(sessionId).catch(() => ({ ok: false as const, detail: 'fs_error' }));

        await writeAdminAudit({
            actorUserId,
            action: 'live_force_end',
            targetType: 'live_session',
            targetId: sessionId,
            metadata: { reason: parsed.data.reason || null, firestoreEnded: fsEnd.ok },
        }).catch(() => undefined);

        return res.json({ ok: true, sessionId, firestoreEnded: fsEnd.ok });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e), sessionId: req.params?.sessionId }, '[admin] /admin/live/:sessionId/force-end failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL', detail: e?.message || String(e) });
    }
});

/**
 * Manually materialize rankings_snapshots (economy + gift boards × windows).
 * Same work as Cloud Scheduler → POST /internal/cron/rankings-materialize.
 */
router.post('/admin/rankings/materialize', requireAdmin, requirePermission('growth.rankings'), async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const limitRaw = (req.body as any)?.limit;
        const limit =
            limitRaw === undefined || limitRaw === null || limitRaw === ''
                ? undefined
                : Number(limitRaw);
        if (limit !== undefined && (!Number.isFinite(limit) || limit < 1 || limit > 50)) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
        }

        const out = await materializeRankingsSnapshots({ limit });
        await writeAdminAudit({
            actorUserId,
            action: 'rankings_materialize',
            targetType: 'system',
            targetId: 'rankings_snapshots',
            metadata: {
                ok: out.ok,
                limit: out.limit,
                durationMs: out.durationMs,
                results: out.results,
            },
        }).catch((err) => {
            logger.warn({ err: err?.message || String(err) }, '[admin] rankings materialize audit write failed');
        });

        return res.status(out.ok ? 200 : 207).json(out);
    } catch (e: any) {
        const err = toEconomyError(e);
        logger.error({ err: err.message, detail: err.detail }, '[admin] /admin/rankings/materialize failed');
        return res.status(err.httpStatus).json({ error: err.message, code: err.code, detail: err.detail });
    }
});

/** Bulk account feed-priority (What's Hot / discovery weight). */
router.post('/admin/feed-priority/bulk', requireAdmin, requirePermission('growth.feed_priority'), async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const userIds = Array.isArray(req.body?.userIds) ? req.body.userIds.map((x: any) => String(x).trim()).filter(Boolean) : [];
        const priority = String(req.body?.priority || '').trim();
        const reason = req.body?.reason != null ? String(req.body.reason).trim() : undefined;
        if (!userIds.length || userIds.length > 50) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: 'userIds required (1–50)' });
        }
        if (!['suppress', 'low', 'standard', 'high', 'boost'].includes(priority)) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: 'invalid priority' });
        }
        const results: Array<{ userId: string; ok: boolean; detail?: string }> = [];
        for (const userId of userIds) {
            if (!isCanonicalSub(userId)) {
                results.push({ userId, ok: false, detail: 'invalid_sub' });
                continue;
            }
            try {
                await setAccountFeedPriorityByAdmin({
                    actorUserId,
                    targetUserId: userId,
                    priority: priority as any,
                    reason: reason || null,
                });
                results.push({ userId, ok: true });
            } catch (e: any) {
                results.push({ userId, ok: false, detail: e?.message || String(e) });
            }
        }
        await writeAdminAudit({
            actorUserId,
            action: 'feed_priority_bulk',
            targetType: 'users',
            targetId: `bulk:${userIds.length}`,
            metadata: { priority, reason: reason || null, results },
        }).catch(() => undefined);
        return res.json({ ok: true, results });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] feed-priority bulk failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

/** DSAR / data-export request queue (v1 intake). */
router.get('/admin/dsar', requireAdmin, requirePermission('dsar.manage'), async (req: AuthedRequest, res: Response) => {
    try {
        const { db } = getEconomyInfra();
        await ensureAdminSchema(db);
        const status = String(req.query?.status || '').trim();
        let q = db('admin_dsar_requests').orderBy('created_at', 'desc').limit(100);
        if (status) q = q.where({ status });
        const rows = await q;
        return res.json({
            items: rows.map((r: any) => ({
                requestId: r.request_id,
                userId: r.user_id,
                requestType: r.request_type,
                status: r.status,
                notes: r.notes,
                createdBy: r.created_by,
                assignedTo: r.assigned_to,
                resolvedBy: r.resolved_by,
                resolvedAt: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
                createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
                updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
                hasExportPackage: !!(typeof r.metadata === 'object' ? r.metadata?.exportPackage : (() => {
                    try {
                        return JSON.parse(r.metadata || '{}')?.exportPackage;
                    } catch {
                        return false;
                    }
                })()),
            })),
            total: rows.length,
            note: 'Export-first: generate package before Owner purge. Hard-delete is Owner-only (dsar.execute) with multi-confirm.',
        });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/dsar GET failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.post('/admin/dsar', requireAdmin, requirePermission('dsar.manage'), async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const userId = String(req.body?.userId || '').trim();
        const requestType = String(req.body?.requestType || 'export').trim();
        const notes = req.body?.notes != null ? String(req.body.notes).trim() : null;
        if (!isCanonicalSub(userId)) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_SUB' });
        }
        if (!['export', 'delete', 'rectify'].includes(requestType)) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_TYPE' });
        }
        const { db } = getEconomyInfra();
        await ensureAdminSchema(db);
        const requestId = randomUUID();
        const now = new Date().toISOString();
        await db('admin_dsar_requests').insert({
            request_id: requestId,
            user_id: userId,
            request_type: requestType,
            status: 'open',
            notes,
            created_by: actorUserId,
            created_at: now,
            updated_at: now,
        });
        await writeAdminAudit({
            actorUserId,
            action: 'dsar_create',
            targetType: 'dsar',
            targetId: requestId,
            metadata: { userId, requestType, notes },
        }).catch(() => undefined);
        return res.json({ ok: true, requestId });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/dsar POST failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.post('/admin/dsar/:requestId/status', requireAdmin, requirePermission('dsar.manage'), async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const requestId = String(req.params.requestId || '').trim();
        const status = String(req.body?.status || '').trim();
        const notes = req.body?.notes != null ? String(req.body.notes).trim() : undefined;
        if (!['open', 'in_progress', 'package_ready', 'awaiting_legal', 'completed', 'rejected'].includes(status)) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_STATUS' });
        }
        if (status === 'completed' && !roleHasPermission(String(req.user?.adminRole || '') as AdminRole, 'dsar.execute')) {
            return res.status(403).json({
                error: 'FORBIDDEN',
                code: 'FORBIDDEN_PERMISSION',
                detail: 'Completing DSAR execute requires dsar.execute (Owner)',
            });
        }
        const { db } = getEconomyInfra();
        await ensureAdminSchema(db);
        const patch: any = { status, updated_at: new Date().toISOString() };
        if (notes !== undefined) patch.notes = notes;
        if (status === 'completed' || status === 'rejected') {
            patch.resolved_by = actorUserId;
            patch.resolved_at = new Date().toISOString();
        }
        const n = await db('admin_dsar_requests').where({ request_id: requestId }).update(patch);
        if (!n) return res.status(404).json({ error: 'NOT_FOUND', code: 'NOT_FOUND' });
        await writeAdminAudit({
            actorUserId,
            action: 'dsar_status',
            targetType: 'dsar',
            targetId: requestId,
            metadata: { status, notes: notes ?? null },
        }).catch(() => undefined);
        return res.json({ ok: true });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/dsar status failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.post('/admin/dsar/:requestId/export-package', requireAdmin, requirePermission('dsar.manage'), async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const requestId = String(req.params.requestId || '').trim();
        const out = await buildDsarExportPackage({ actorUserId, requestId });
        if (!out.ok) {
            return res.status(out.code === 'NOT_FOUND' ? 404 : 400).json({ error: out.code, code: out.code, detail: out.detail });
        }
        return res.json({ ok: true, package: out.package });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] dsar export-package failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.post('/admin/dsar/:requestId/purge', requireAdmin, requirePermission('dsar.execute'), async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const requestId = String(req.params.requestId || '').trim();
        const parsed = adminDsarPurgeSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }
        const out = await executeDsarPurge({
            actorUserId,
            requestId,
            confirmPhrase: parsed.data.confirmPhrase,
            confirmUserId: parsed.data.confirmUserId,
        });
        if (!out.ok) {
            const status = out.code === 'NOT_FOUND' ? 404 : out.code === 'CONFIRM_REQUIRED' || out.code === 'USER_MISMATCH' ? 400 : 409;
            return res.status(status).json({
                error: out.code,
                code: out.code,
                detail: out.detail,
                confirmHint: DSAR_PURGE_CONFIRM,
            });
        }
        return res.json({ ok: true, deleted: out.deleted });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] dsar purge failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

/** Ambassadors / clubs desk (read from teams + honest gaps). */
router.get('/admin/growth/ambassadors', requireAdmin, async (_req: AuthedRequest, res: Response) => {
    try {
        const teams = await listFirestoreTeams();
        return res.json({
            teams: teams
                ? {
                      items: teams,
                      total: teams.length,
                  }
                : { items: [], total: 0, degraded: true, detail: 'firestore_unavailable' },
            roomAmbassadors: {
                available: false,
                detail: 'Room ambassador claims live in Dynamo room docs; console CRM not wired yet.',
            },
            clubs: {
                available: false,
                detail: 'Club membership CRM not exposed; team applications remain the live admin surface.',
            },
            note: 'Use Teams page for application approve/reject. This endpoint is a growth CRM stub.',
        });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] ambassadors desk failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

/** Battle / marble dispute desk — status workflow only (no pot freeze/void). */
router.get('/admin/games/disputes', requireAdmin, async (_req: AuthedRequest, res: Response) => {
    try {
        const plane = await getOpsControlPlane();
        const items = await listGameDisputes(50);
        return res.json({
            items,
            total: items.length,
            statuses: DISPUTE_STATUSES,
            marbleRaceEnabled: (plane as any)?.envReadOnly?.liveMarbleRaceEnabled ?? null,
            available: true,
            settlementWired: false,
            detail:
                'Status workflow only. noted_freeze records ops intent — freeze/void/refund of battle/marble pots is not implemented. Do not settle pots from admin.',
            note: 'Create disputes below; escalate settlement to engineering if pots must move.',
        });
    } catch (e: any) {
        return res.json({
            items: [],
            total: 0,
            available: false,
            settlementWired: false,
            detail: e?.message || String(e),
        });
    }
});

router.post('/admin/games/disputes', requireAdmin, requirePermission('reports.resolve'), async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const parsed = adminGameDisputeCreateSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }
        const disputeId = await createGameDispute({
            actorUserId,
            surface: parsed.data.surface,
            referenceId: parsed.data.referenceId,
            summary: parsed.data.summary,
            notes: parsed.data.notes ?? null,
        });
        return res.json({ ok: true, disputeId });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] game dispute create failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.post('/admin/games/disputes/:disputeId/status', requireAdmin, requirePermission('reports.resolve'), async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const disputeId = String(req.params.disputeId || '').trim();
        const parsed = adminGameDisputeStatusSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }
        await updateGameDisputeStatus({
            actorUserId,
            disputeId,
            status: parsed.data.status,
            notes: parsed.data.notes,
        });
        return res.json({ ok: true, settlementWired: false });
    } catch (e: any) {
        if (e?.code === 'NOT_FOUND') return res.status(404).json({ error: 'NOT_FOUND', code: 'NOT_FOUND' });
        if (e?.code === 'INVALID_STATUS') return res.status(400).json({ error: 'INVALID_STATUS', code: 'INVALID_STATUS' });
        logger.error({ err: e?.message || String(e) }, '[admin] game dispute status failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

/** Chargeback desk: Stripe dispute webhooks + manual flags wire WithdrawalGuard; Play ingest still manual. */
router.get('/admin/fraud/chargebacks', requireAdmin, async (_req: AuthedRequest, res: Response) => {
    try {
        const iap = await adminListIapPurchases({ limit: 40 });
        const anomalies = (iap.items || []).filter((x: any) => Array.isArray(x.anomalyHints) && x.anomalyHints.length > 0);
        const flagged = await listOpenChargebackUsers(50);
        let stripeWebhookConfigured = false;
        try {
            const { getStripeReadiness } = await import('../economy/withdrawalService');
            stripeWebhookConfigured = getStripeReadiness().webhookConfigured;
        } catch {
            // economy env may be unavailable in degraded admin-only boots
        }
        return res.json({
            openChargebackCount: flagged.length,
            flaggedUsers: flagged,
            chargebackIngest: {
                wired: true,
                stripeDisputes: true,
                playBilling: false,
                webhookConfigured: stripeWebhookConfigured,
                detail:
                    'Stripe charge.dispute.* + radar.early_fraud_warning.created on POST /webhooks/stripe set openChargebackCount when the Connect account maps to a Blyp user. Play Billing chargebacks remain manual (admin fraud flags).',
            },
            withdrawBlockWired: true,
            iapAnomalies: anomalies.slice(0, 25),
            iapSource: iap.source,
            iapNote: iap.note,
            degraded: iap.degraded,
            note: 'Open chargeback flags block withdraw when BLOCK_IF_OPEN_CHARGEBACK is on. ENABLE_WITHDRAWALS is independent (Cloud Run env).',
        });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] chargebacks desk failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.post('/admin/users/:userId/fraud-flags', requireAdmin, requirePermission('users.ban'), async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const userId = String(req.params.userId || '').trim();
        const parsed = adminFraudFlagsSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }
        const flags = await setUserFraudFlags({
            actorUserId,
            userId,
            openChargebackCount: parsed.data.openChargebackCount,
            accountFrozen: parsed.data.accountFrozen,
            underFraudReview: parsed.data.underFraudReview,
            note: parsed.data.note,
        });
        return res.json({ ok: true, flags, withdrawBlockWired: true });
    } catch (e: any) {
        if (e?.code === 'INVALID_SUB') return res.status(400).json({ error: 'INVALID_SUB', code: 'INVALID_SUB' });
        logger.error({ err: e?.message || String(e) }, '[admin] fraud-flags failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.get('/admin/config/auto-mod', requireAdmin, async (_req: AuthedRequest, res: Response) => {
    try {
        const policy = await getAutoModPolicy();
        return res.json({ ok: true, policy });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] auto-mod GET failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.post('/admin/config/auto-mod', requireAdmin, requirePermission('config.flags.write'), async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const parsed = adminAutoModPolicySchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }
        const policy = await setAutoModPolicy({ actorUserId, ...parsed.data });
        return res.json({ ok: true, policy });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] auto-mod POST failed');
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
