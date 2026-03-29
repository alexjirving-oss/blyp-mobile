import { Router, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { cognitoJwtMiddleware } from '../auth/cognitoJwtMiddleware';
import { AuthedRequest } from '../auth/cognitoJwtMiddleware';
import { logger } from '../config/logger';
import { checkDb, checkRedis, getEconomyInfra } from '../economy/infra';
import {
    adminListUserPostsSchema,
    adminListUsersSchema,
    adminQueueUserMessageSchema,
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

const router = Router();
const COGNITO_SUB_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isCanonicalSub(value: unknown): boolean {
    return COGNITO_SUB_REGEX.test(String(value || '').trim());
}

const ADMIN_LOGIN_EMAIL = 'alex@tapaquatics.com';
const ADMIN_LOGIN_PASSWORD = 'Caleb2022!';
const ADMIN_ACTOR_SUB = String(process.env.ADMIN_ACTOR_SUB || '00000000-0000-4000-8000-000000000000').trim();
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;

type AdminSession = {
    actorUserId: string;
    expiresAt: number;
};

const adminSessions = new Map<string, AdminSession>();

function cleanupExpiredSessions() {
    const now = Date.now();
    for (const [token, session] of adminSessions.entries()) {
        if (session.expiresAt <= now) {
            adminSessions.delete(token);
        }
    }
}

function issueAdminSession(actorUserId: string): string {
    cleanupExpiredSessions();
    const token = crypto.randomBytes(24).toString('hex');
    adminSessions.set(token, {
        actorUserId,
        expiresAt: Date.now() + SESSION_TTL_MS,
    });
    return token;
}

function getSessionToken(req: AuthedRequest): string {
    const fromHeader = String(req.headers['x-admin-session'] || '').trim();
    const authHeader = String(req.headers.authorization || '').trim();

    if (fromHeader) return fromHeader;
    if (authHeader.toLowerCase().startsWith('bearer admin-session:')) {
        return authHeader.slice('bearer admin-session:'.length).trim();
    }
    return '';
}

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
    cleanupExpiredSessions();
    const token = getSessionToken(req);
    if (!token) {
        return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH', detail: 'missing admin session' });
    }

    const session = adminSessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
        return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH', detail: 'expired or invalid admin session' });
    }

    req.user = { sub: session.actorUserId };

    return next();
}

router.post('/admin/auth/login', async (req: AuthedRequest, res: Response) => {
    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        const password = String(req.body?.password || '');

        const isEmailOk = email === ADMIN_LOGIN_EMAIL;
        const isPasswordOk = password === ADMIN_LOGIN_PASSWORD;

        if (!isEmailOk || !isPasswordOk) {
            logger.warn({ email }, '[admin] login rejected');
            return res.status(401).json({ error: 'INVALID_CREDENTIALS', code: 'INVALID_CREDENTIALS' });
        }

        if (!isCanonicalSub(ADMIN_ACTOR_SUB)) {
            logger.error({ adminActorSub: ADMIN_ACTOR_SUB }, '[admin] ADMIN_ACTOR_SUB is not a canonical sub');
            return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
        }

        const actorUserId = ADMIN_ACTOR_SUB;
        const sessionToken = issueAdminSession(actorUserId);
        return res.json({
            ok: true,
            sessionToken,
            actorUserId,
            expiresInMs: SESSION_TTL_MS,
        });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/auth/login failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.post('/admin/auth/logout', requireAdmin, async (req: AuthedRequest, res: Response) => {
    const token = getSessionToken(req);
    if (token) {
        adminSessions.delete(token);
    }
    return res.json({ ok: true });
});

router.get('/admin/auth/me', requireAdmin, async (req: AuthedRequest, res: Response) => {
    const actorUserId = String(req.user?.sub || '').trim();
    return res.json({ ok: true, actorUserId });
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
