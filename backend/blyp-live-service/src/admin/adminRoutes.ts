import { Router, Response, NextFunction } from 'express';
import { AuthedRequest, cognitoJwtMiddleware } from '../auth/cognitoJwtMiddleware';
import { verifyCognitoJwt } from '../auth/verifyCognitoJwt';
import { getAdminEnv } from '../config/adminEnv';
import { logger } from '../config/logger';
import { checkDb, checkRedis, getEconomyInfra } from '../economy/infra';
import { sanitizeBearerAuthorization } from '../utils/headerSanitize';
import {
    adminListUserPostsSchema,
    adminListUsersSchema,
        adminQueueUserMessageSchema,
    adminSetAppVersionPolicySchema,
    adminSetCapabilitiesSchema,
    banUserSchema,

    moderatePostSchema,
    unbanUserSchema,
} from './adminSchemas';
import {
    banUserByAdmin,
    getAdminUserDetail,
    getAdminMetricsOverview,
    getAdminUserSourceStats,
    getEffectiveUserControls,
    listAdminUserPosts,
    listAdminUsers,
    queueAdminUserMessage,
    removePostByAdmin,
    restorePostByAdmin,
    setAdminUserCapabilities,
    unbanUserByAdmin,
} from './adminService';
import { getAppVersionPolicy, publicAppVersionPolicy, setAppVersionPolicy } from '../appVersion/appVersionPolicy';

const router = Router();
const COGNITO_SUB_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isCanonicalSub(value: unknown): boolean {
    return COGNITO_SUB_REGEX.test(String(value || '').trim());
}

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
        });

        return res.json({ ok: true, userId: targetUserId, detail: out });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/users/:userId/capabilities failed');
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
