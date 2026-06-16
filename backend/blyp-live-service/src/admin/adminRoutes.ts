import { Router, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { cognitoJwtMiddleware } from '../auth/cognitoJwtMiddleware';
import { AuthedRequest } from '../auth/cognitoJwtMiddleware';
import { logger } from '../config/logger';
import { endLiveSession } from '../live/liveService';
import { checkDb, checkRedis, getEconomyInfra } from '../economy/infra';
import { getDirectoryUserProof } from './adminCognitoDirectory';
import {
    adminBroadcastSchema,
    adminCreditCoinsSchema,
    adminListAuditSchema,
    adminListLiveSchema,
    adminListMessagesSchema,
    adminListPostsSchema,
    adminListUserPostsSchema,
    adminListUsersSchema,
    adminQueueUserMessageSchema,
    adminSetCapabilitiesSchema,
    adminSetFlagsSchema,
    adminSetGiftSchema,
    banUserSchema,
    moderatePostSchema,
    unbanUserSchema,
} from './adminSchemas';
import {
    broadcastAdminMessage,
    getAdminAnalytics,
    getAdminCatalog,
    getFeatureFlags,
    listRecentAdminMessages,
    setFeatureFlags,
    setGiftEnabled,
} from './adminInsights';
import {
    banUserByAdmin,
    getAdminUserDetail,
    getAdminMetricsOverview,
    getAdminUserSourceStats,
    getAdminLiveStreams,
    getEffectiveUserControls,
    listAdminAudit,
    listAdminUserPosts,
    listAdminUsers,
    listAllAdminPosts,
    queueAdminUserMessage,
    removePostByAdmin,
    restorePostByAdmin,
    setAdminUserCapabilities,
    unbanUserByAdmin,
    writeAdminAudit,
} from './adminService';
import { creditCoinsAdmin } from '../economy/economyService';

const router = Router();

// Admin credentials MUST come from the environment — there is deliberately no
// fallback. If ADMIN_LOGIN_EMAIL / ADMIN_LOGIN_PASSWORD are unset, admin login
// FAILS CLOSED (every attempt is rejected) rather than defaulting to anything
// that could be read out of the repository.
const ADMIN_LOGIN_EMAIL = String(process.env.ADMIN_LOGIN_EMAIL || '').trim().toLowerCase();
const ADMIN_LOGIN_PASSWORD = String(process.env.ADMIN_LOGIN_PASSWORD || '');
if (!ADMIN_LOGIN_EMAIL || !ADMIN_LOGIN_PASSWORD) {
    logger.error('[admin] ADMIN_LOGIN_EMAIL/ADMIN_LOGIN_PASSWORD not set; admin console login is DISABLED until they are configured.');
}

// Allow more than one admin to sign into the console (e.g. Melody) without a full
// per-user auth rebuild. Set ADMIN_LOGIN_ACCOUNTS in Cloud Run as either JSON
// (`[{"email":"melody@x.com","password":"..."}]`) or a compact
// `email:password,email2:password2` string. The primary ADMIN_LOGIN_EMAIL is
// always included.
function buildAdminAccounts(): Map<string, string> {
    const accounts = new Map<string, string>();
    if (ADMIN_LOGIN_EMAIL && ADMIN_LOGIN_PASSWORD) {
        accounts.set(ADMIN_LOGIN_EMAIL, ADMIN_LOGIN_PASSWORD);
    }

    const raw = String(process.env.ADMIN_LOGIN_ACCOUNTS || '').trim();
    if (!raw) return accounts;

    const add = (email: unknown, password: unknown) => {
        const e = String(email || '').trim().toLowerCase();
        const p = String(password || '');
        if (e && p) accounts.set(e, p);
    };

    try {
        if (raw.startsWith('[') || raw.startsWith('{')) {
            const parsed = JSON.parse(raw);
            const list = Array.isArray(parsed) ? parsed : [parsed];
            for (const item of list) add(item?.email, item?.password);
        } else {
            for (const pair of raw.split(',')) {
                const idx = pair.indexOf(':');
                if (idx > 0) add(pair.slice(0, idx), pair.slice(idx + 1));
            }
        }
    } catch (e: any) {
        logger.warn({ err: e?.message || String(e) }, '[admin] could not parse ADMIN_LOGIN_ACCOUNTS; ignoring');
    }
    return accounts;
}

const ADMIN_ACCOUNTS = buildAdminAccounts();
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

// Re-verify the logged-in admin's own password for sensitive actions (e.g.
// crediting coins). The admin session must already be valid (requireAdmin);
// this is a second factor of intent, not the primary auth. The password must
// match the account that owns the current session (actorUserId), falling back to
// the primary admin password for legacy sessions.
function verifyAdminPassword(password: string, actorUserId?: string): boolean {
    const provided = String(password || '');
    if (!provided) return false;
    const actor = String(actorUserId || '').trim().toLowerCase();
    if (actor && ADMIN_ACCOUNTS.has(actor)) {
        return provided === ADMIN_ACCOUNTS.get(actor);
    }
    // Fail closed when no primary password is configured.
    return !!ADMIN_LOGIN_PASSWORD && provided === ADMIN_LOGIN_PASSWORD;
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

        const expectedPassword = ADMIN_ACCOUNTS.get(email);
        const isOk = expectedPassword != null && password === expectedPassword;

        if (!isOk) {
            logger.warn({ email }, '[admin] login rejected');
            return res.status(401).json({ error: 'INVALID_CREDENTIALS', code: 'INVALID_CREDENTIALS' });
        }

        const actorUserId = email;
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
    const actorUserId = String(req.user?.sub || ADMIN_LOGIN_EMAIL);
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
            pageItemCount: 0,
            resultState: 'ZERO_MATCHES',
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
        if (!targetUserId) {
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

router.get('/admin/users/directory-proof', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const q = String(req.query?.q || '').trim();
        const out = await getDirectoryUserProof(q);
        return res.json(out);
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/users/directory-proof failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.get('/admin/users/:userId', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const targetUserId = String(req.params?.userId || '').trim();
        if (!targetUserId) {
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
        if (!targetUserId) {
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
        if (!targetUserId) {
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
        if (!targetUserId) {
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
        if (!targetUserId) {
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

router.post('/admin/users/:userId/credit-coins', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const targetUserId = String(req.params?.userId || '').trim();
        if (!targetUserId) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
        }

        const parsed = adminCreditCoinsSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }

        // Sensitive action: require the admin to re-enter their own password.
        // Use 403 (not 401) so the web client doesn't treat a wrong password as
        // an expired session and force a logout.
        if (!verifyAdminPassword(parsed.data.password, actorUserId)) {
            logger.warn({ actorUserId, targetUserId }, '[admin] credit-coins password re-auth failed');
            return res.status(403).json({ error: 'INVALID_CREDENTIALS', code: 'INVALID_CREDENTIALS', detail: 'Incorrect admin password' });
        }

        const idempotencyKey = parsed.data.idempotencyKey || `admin-credit:${targetUserId}:${crypto.randomUUID()}`;

        const result = await creditCoinsAdmin(actorUserId, {
            targetUserId,
            coins: parsed.data.coins,
            idempotencyKey,
            reason: parsed.data.reason,
        });

        await writeAdminAudit({
            actorUserId,
            action: 'user_coins_credited',
            targetType: 'user',
            targetId: targetUserId,
            metadata: {
                coins: parsed.data.coins,
                reason: parsed.data.reason || null,
                ledgerId: result.ledgerId,
                newBalance: result.newBalance,
                replay: result.replay,
            },
        }).catch(() => { /* audit is best-effort */ });

        return res.json({
            ok: true,
            userId: targetUserId,
            coinsCredited: result.coinsCredited,
            newBalance: result.newBalance,
            ledgerId: result.ledgerId,
            replay: result.replay,
        });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/users/:userId/credit-coins failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL', detail: e?.message });
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

router.get('/admin/posts', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const parsed = adminListPostsSchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }

        const out = await listAllAdminPosts(parsed.data);
        return res.json(out);
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/posts failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.get('/admin/live', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const parsed = adminListLiveSchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }

        const out = await getAdminLiveStreams(parsed.data);
        return res.json(out);
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/live failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

// Force-end an abusive live stream from moderation tooling.
router.post('/admin/live/:sessionId/end', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const sessionId = String(req.params?.sessionId || '').trim();
        if (!sessionId) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: 'sessionId required' });
        }
        await endLiveSession(sessionId);
        logger.warn({ sessionId, actor: req.user?.sub }, '[admin] force-ended live session');
        return res.json({ ok: true });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/live/:sessionId/end failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
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

router.get('/admin/analytics', requireAdmin, async (_req: AuthedRequest, res: Response) => {
    try {
        const out = await getAdminAnalytics();
        return res.json(out);
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/analytics failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.post('/admin/comms/broadcast', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const parsed = adminBroadcastSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }
        const out = await broadcastAdminMessage({
            actorUserId,
            segment: parsed.data.segment,
            subject: parsed.data.subject || null,
            message: parsed.data.message,
        });
        return res.json({ ok: true, ...out });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/comms/broadcast failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.get('/admin/comms/messages', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const parsed = adminListMessagesSchema.safeParse(req.query);
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

router.get('/admin/config/flags', requireAdmin, async (_req: AuthedRequest, res: Response) => {
    try {
        const flags = await getFeatureFlags();
        return res.json({ flags });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/config/flags GET failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
    }
});

router.post('/admin/config/flags', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const parsed = adminSetFlagsSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }
        const flags = await setFeatureFlags({ actorUserId, flags: parsed.data.flags });
        return res.json({ ok: true, flags });
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

router.post('/admin/config/gift/:giftId', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const actorUserId = String(req.user?.sub || '').trim();
        const giftId = String(req.params?.giftId || '').trim();
        if (!giftId) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
        }
        const parsed = adminSetGiftSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
        }
        await setGiftEnabled({ actorUserId, giftId, enabled: parsed.data.enabled });
        return res.json({ ok: true, giftId, enabled: parsed.data.enabled });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/config/gift failed');
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
            isBanned: false,
            bannedUntil: null,
            banReason: null,
            role: 'user',
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
