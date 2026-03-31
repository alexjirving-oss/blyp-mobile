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
import { probeDirectoryState } from './adminCognitoDirectory';

const router = Router();

const ADMIN_LOGIN_EMAIL = 'alex@tapaquatics.com';
const ADMIN_LOGIN_PASSWORD = 'Caleb2022!';
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

        const actorUserId = ADMIN_LOGIN_EMAIL;
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

router.get('/admin/iap/readiness', requireAdmin, async (_req: AuthedRequest, res: Response) => {
    try {
        const { db } = getEconomyInfra();

        const tableRows = await db.raw(
            `
            SELECT
              to_regclass('public.iap_products') IS NOT NULL AS iap_products_exists,
              to_regclass('public.iap_receipts') IS NOT NULL AS iap_receipts_exists
            `
        );
        const tableFlags = (tableRows as any)?.rows?.[0] || {};

                const userIdemRows = await db.raw(
                        `
                        SELECT EXISTS (
                            SELECT tc.constraint_name
                            FROM information_schema.table_constraints tc
                            JOIN information_schema.key_column_usage kcu
                                ON tc.constraint_name = kcu.constraint_name
                             AND tc.table_schema = kcu.table_schema
                             AND tc.table_name = kcu.table_name
                            WHERE tc.table_schema = 'public'
                                AND tc.table_name = 'iap_receipts'
                                AND tc.constraint_type = 'UNIQUE'
                            GROUP BY tc.constraint_name
                            HAVING COUNT(*) = 2
                                 AND SUM(CASE WHEN kcu.column_name IN ('user_id', 'idempotency_key') THEN 1 ELSE 0 END) = 2
                        ) AS ok
                        `
                );
        const uniqueUserIdempotency = Boolean((userIdemRows as any)?.rows?.[0]?.ok);

                const storeTxRows = await db.raw(
                        `
                        SELECT EXISTS (
                            SELECT tc.constraint_name
                            FROM information_schema.table_constraints tc
                            JOIN information_schema.key_column_usage kcu
                                ON tc.constraint_name = kcu.constraint_name
                             AND tc.table_schema = kcu.table_schema
                             AND tc.table_name = kcu.table_name
                            WHERE tc.table_schema = 'public'
                                AND tc.table_name = 'iap_receipts'
                                AND tc.constraint_type = 'UNIQUE'
                            GROUP BY tc.constraint_name
                            HAVING COUNT(*) = 2
                                 AND SUM(CASE WHEN kcu.column_name IN ('platform', 'store_transaction_id') THEN 1 ELSE 0 END) = 2
                        ) AS ok
                        `
                );
        const uniquePlatformStoreTransaction = Boolean((storeTxRows as any)?.rows?.[0]?.ok);

                const purchaseTokenRows = await db.raw(
                        `
                        SELECT EXISTS (
                            SELECT 1
                            FROM pg_indexes
                            WHERE schemaname = 'public'
                                AND tablename = 'iap_receipts'
                                AND indexname = 'uq_iap_receipts_platform_purchase_token'
                        ) AS ok
                        `
                );
        const uniquePlatformPurchaseTokenNotNull = Boolean((purchaseTokenRows as any)?.rows?.[0]?.ok);

        const packageNameConfigured = Boolean(String(process.env.GOOGLE_PLAY_PACKAGE_NAME || '').trim());
        const serviceAccountRaw = String(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON || '').trim();
        let serviceAccountConfigured = false;
        if (serviceAccountRaw) {
            try {
                const parsed = JSON.parse(serviceAccountRaw);
                serviceAccountConfigured = Boolean(String(parsed?.client_email || '').trim() && String(parsed?.private_key || '').trim());
            } catch {
                serviceAccountConfigured = false;
            }
        }

        const providerEnvReady = packageNameConfigured && serviceAccountConfigured;
        const schemaReady = Boolean(tableFlags.iap_products_exists)
            && Boolean(tableFlags.iap_receipts_exists)
            && uniqueUserIdempotency
            && uniquePlatformStoreTransaction
            && uniquePlatformPurchaseTokenNotNull;

        return res.json({
            schemaReady,
            schema: {
                iap_products: Boolean(tableFlags.iap_products_exists),
                iap_receipts: Boolean(tableFlags.iap_receipts_exists),
                unique_user_idempotency_key: uniqueUserIdempotency,
                unique_platform_store_transaction_id: uniquePlatformStoreTransaction,
                unique_platform_purchase_token_not_null: uniquePlatformPurchaseTokenNotNull,
            },
            providerEnv: {
                packageNameConfigured,
                serviceAccountConfigured,
                ready: providerEnvReady,
            },
        });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/iap/readiness failed');
        return res.status(500).json({
            error: 'INTERNAL',
            code: 'INTERNAL',
            detail: e?.message || String(e),
        });
    }
});

router.get('/admin/iap/receipt-probe', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
        const storeTransactionId = String(req.query?.storeTransactionId || '').trim();
        const purchaseToken = String(req.query?.purchaseToken || '').trim();
        if (!storeTransactionId && !purchaseToken) {
            return res.status(400).json({
                error: 'INVALID_INPUT',
                code: 'INVALID_INPUT',
                detail: 'storeTransactionId or purchaseToken is required',
            });
        }

        const { db } = getEconomyInfra();
        const base = db('iap_receipts').select('verification_status');

        if (storeTransactionId && purchaseToken) {
            base.where(function () {
                this.where('store_transaction_id', storeTransactionId).orWhere('purchase_token', purchaseToken);
            });
        } else if (storeTransactionId) {
            base.where({ store_transaction_id: storeTransactionId });
        } else {
            base.where({ purchase_token: purchaseToken });
        }

        const rows = await base;
        const totalRows = rows.length;
        const verifiedRows = rows.filter((r: any) => String(r?.verification_status || '').toUpperCase() === 'VERIFIED').length;

        return res.json({
            storeTransactionId: storeTransactionId || null,
            purchaseToken: purchaseToken || null,
            totalRows,
            verifiedRows,
            hasAnyRow: totalRows > 0,
            hasVerifiedRow: verifiedRows > 0,
        });
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] /admin/iap/receipt-probe failed');
        return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL', detail: e?.message || String(e) });
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
        const out = await probeDirectoryState(q);
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
