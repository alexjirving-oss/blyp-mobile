import crypto from 'crypto';
import type { Knex } from 'knex';
import { checkDb, checkRedis, getEconomyInfra } from '../economy/infra';
import { logger } from '../config/logger';
import { findDirectoryUser, listDirectoryUsers, setCognitoUserEnabledBySub, type DirectoryUser } from './adminCognitoDirectory';
import {
    syncUserRoleToFirestore,
    syncAvatarFrameToFirestore,
    getFirestoreUserPublicFields,
    setPostFeedPriorityFs,
    setUserFeedPriorityFs,
    setPostModerationHiddenFs,
    normalizePostFeedPriority,
    normalizeAccountFeedPriority,
    enqueueAdminInboxNotification,
    type FeedPriority,
    type AccountFeedPriority,
} from './firestoreAdmin';
import { invalidateBanCache } from './banGuard';
import { invalidateLiveRestrictionCache } from './liveRestrictionGuard';

import { isCanonicalCognitoSub as isCanonicalSubUserId } from '../auth/cognitoSub';

export type AdminUserRow = {
    userId: string;
    username?: string;
    email?: string;
    phoneNumber?: string;
    displayName?: string;
    userStatus?: string;
    enabled?: boolean;
    role: string;
    isBanned: boolean;
    banReason: string | null;
    bannedUntil: string | null;
    createdAt: string | null;
    updatedAt: string | null;
};

type AdminVerification = {
    isVerified: boolean;
    note: string;
    updatedAt: string | null;
    updatedBy: string | null;
};

type AdminRestrictions = {
    messagingRestricted: boolean;
    liveRestricted: boolean;
    loginRestricted: boolean;
    accountRestricted: boolean;
    reason: string;
    expiresAt: string | null;
    updatedAt: string | null;
    updatedBy: string | null;
};

type AdminUserDetail = {
    userId: string;
    username?: string;
    email?: string;
    phoneNumber?: string;
    displayName?: string;
    dateOfBirth?: string;
    address?: string;
    city?: string;
    region?: string;
    postcode?: string;
    country?: string;
    userStatus?: string;
    enabled?: boolean;
    role: string;
    isBanned: boolean;
    banReason: string | null;
    bannedUntil: string | null;
    verification: AdminVerification;
    restrictions: AdminRestrictions;
    fraud?: {
        openChargebackCount: number;
        accountFrozen: boolean;
        underFraudReview: boolean;
        chargebackNote: string | null;
        updatedAt: string | null;
        updatedBy: string | null;
    };
    avatarFrame: string | null;
    photoURL: string | null;
    feedPriorityAccount: AccountFeedPriority;
    createdAt: string | null;
    updatedAt: string | null;
    recentActions: Array<{
        action: string;
        targetType: string;
        targetId: string;
        metadata: Record<string, unknown>;
        createdAt: string | null;
    }>;
    recentMessages: Array<{
        messageId: string;
        channel: string;
        status: string;
        subject: string;
        body: string;
        createdAt: string | null;
    }>;
};

type PostListItem = {
    postId: string;
    userId: string;
    content: string;
    createdAt: string | null;
    updatedAt: string | null;
    postType: string;
    mediaUrl: string | null;
    videoUrl: string | null;
    thumbnailUrl: string | null;
    isRemoved: boolean;
    removedReason: string | null;
    removedAt: string | null;
};

function adminDb(): Knex {
    return getEconomyInfra().db;
}

function asObject(value: unknown): Record<string, any> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, any>;
    }
    return {};
}

function parseJson(input: unknown): Record<string, any> {
    if (!input) return {};
    if (typeof input === 'string') {
        try {
            return asObject(JSON.parse(input));
        } catch {
            return {};
        }
    }
    return asObject(input);
}

function toIso(value: unknown): string | null {
    if (!value) return null;
    try {
        const d = new Date(String(value));
        if (Number.isNaN(d.getTime())) return null;
        return d.toISOString();
    } catch {
        return null;
    }
}

function asBool(value: unknown): boolean {
    return value === true;
}

function asString(value: unknown): string {
    if (typeof value !== 'string') return '';
    return value.trim();
}

function buildVerification(metadata: Record<string, any>): AdminVerification {
    const verification = asObject(metadata.verification);
    return {
        isVerified: asBool(verification.isVerified),
        note: asString(verification.note),
        updatedAt: toIso(verification.updatedAt),
        updatedBy: asString(verification.updatedBy) || null,
    };
}

function buildRestrictions(metadata: Record<string, any>): AdminRestrictions {
    const restrictions = asObject(metadata.restrictions);
    return {
        messagingRestricted: asBool(restrictions.messagingRestricted),
        liveRestricted: asBool(restrictions.liveRestricted),
        loginRestricted: asBool(restrictions.loginRestricted),
        accountRestricted: asBool(restrictions.accountRestricted),
        reason: asString(restrictions.reason),
        expiresAt: toIso(restrictions.expiresAt),
        updatedAt: toIso(restrictions.updatedAt),
        updatedBy: asString(restrictions.updatedBy) || null,
    };
}

type SqlUserIdSource = {
    name: string;
    table: string;
    column?: string;
    selectSql: string;
    countSql: string;
};

const CORE_SQL_USER_ID_SOURCES: SqlUserIdSource[] = [
    {
        name: 'wallets.user_id',
        table: 'wallets',
        selectSql: `SELECT DISTINCT user_id AS user_id FROM wallets WHERE user_id IS NOT NULL AND user_id <> ''`,
        countSql: `SELECT COUNT(DISTINCT user_id)::bigint AS n FROM wallets WHERE user_id IS NOT NULL AND user_id <> ''`,
    },
    {
        name: 'user_admin_state.user_id',
        table: 'user_admin_state',
        selectSql: `SELECT DISTINCT user_id AS user_id FROM user_admin_state WHERE user_id IS NOT NULL AND user_id <> ''`,
        countSql: `SELECT COUNT(DISTINCT user_id)::bigint AS n FROM user_admin_state WHERE user_id IS NOT NULL AND user_id <> ''`,
    },
    {
        name: 'ledger_entries.user_id',
        table: 'ledger_entries',
        selectSql: `SELECT DISTINCT user_id AS user_id FROM ledger_entries WHERE user_id IS NOT NULL AND user_id <> ''`,
        countSql: `SELECT COUNT(DISTINCT user_id)::bigint AS n FROM ledger_entries WHERE user_id IS NOT NULL AND user_id <> ''`,
    },
    {
        name: 'gift_events.sender_user_id',
        table: 'gift_events',
        selectSql: `SELECT DISTINCT sender_user_id AS user_id FROM gift_events WHERE sender_user_id IS NOT NULL AND sender_user_id <> ''`,
        countSql: `SELECT COUNT(DISTINCT sender_user_id)::bigint AS n FROM gift_events WHERE sender_user_id IS NOT NULL AND sender_user_id <> ''`,
    },
    {
        name: 'gift_events.receiver_user_id',
        table: 'gift_events',
        selectSql: `SELECT DISTINCT receiver_user_id AS user_id FROM gift_events WHERE receiver_user_id IS NOT NULL AND receiver_user_id <> ''`,
        countSql: `SELECT COUNT(DISTINCT receiver_user_id)::bigint AS n FROM gift_events WHERE receiver_user_id IS NOT NULL AND receiver_user_id <> ''`,
    },
    {
        name: 'stream_earnings.creator_user_id',
        table: 'stream_earnings',
        selectSql: `SELECT DISTINCT creator_user_id AS user_id FROM stream_earnings WHERE creator_user_id IS NOT NULL AND creator_user_id <> ''`,
        countSql: `SELECT COUNT(DISTINCT creator_user_id)::bigint AS n FROM stream_earnings WHERE creator_user_id IS NOT NULL AND creator_user_id <> ''`,
    },
    {
        name: 'promotions.user_id',
        table: 'promotions',
        selectSql: `SELECT DISTINCT user_id AS user_id FROM promotions WHERE user_id IS NOT NULL AND user_id <> ''`,
        countSql: `SELECT COUNT(DISTINCT user_id)::bigint AS n FROM promotions WHERE user_id IS NOT NULL AND user_id <> ''`,
    },
    {
        name: 'live_games.host_user_id',
        table: 'live_games',
        selectSql: `SELECT DISTINCT host_user_id AS user_id FROM live_games WHERE host_user_id IS NOT NULL AND host_user_id <> ''`,
        countSql: `SELECT COUNT(DISTINCT host_user_id)::bigint AS n FROM live_games WHERE host_user_id IS NOT NULL AND host_user_id <> ''`,
    },
    {
        name: 'live_game_entries.user_id',
        table: 'live_game_entries',
        selectSql: `SELECT DISTINCT user_id AS user_id FROM live_game_entries WHERE user_id IS NOT NULL AND user_id <> ''`,
        countSql: `SELECT COUNT(DISTINCT user_id)::bigint AS n FROM live_game_entries WHERE user_id IS NOT NULL AND user_id <> ''`,
    },
    {
        name: 'live_game_settlements.host_user_id',
        table: 'live_game_settlements',
        selectSql: `SELECT DISTINCT host_user_id AS user_id FROM live_game_settlements WHERE host_user_id IS NOT NULL AND host_user_id <> ''`,
        countSql: `SELECT COUNT(DISTINCT host_user_id)::bigint AS n FROM live_game_settlements WHERE host_user_id IS NOT NULL AND host_user_id <> ''`,
    },
    {
        name: 'user_subscriptions.user_id',
        table: 'user_subscriptions',
        selectSql: `SELECT DISTINCT user_id AS user_id FROM user_subscriptions WHERE user_id IS NOT NULL AND user_id <> ''`,
        countSql: `SELECT COUNT(DISTINCT user_id)::bigint AS n FROM user_subscriptions WHERE user_id IS NOT NULL AND user_id <> ''`,
    },
    {
        name: 'admin_audit_log.actor_user_id',
        table: 'admin_audit_log',
        selectSql: `SELECT DISTINCT actor_user_id AS user_id FROM admin_audit_log WHERE actor_user_id IS NOT NULL AND actor_user_id <> ''`,
        countSql: `SELECT COUNT(DISTINCT actor_user_id)::bigint AS n FROM admin_audit_log WHERE actor_user_id IS NOT NULL AND actor_user_id <> ''`,
    },
    {
        name: 'admin_audit_log.target_id(user)',
        table: 'admin_audit_log',
        selectSql: `SELECT DISTINCT target_id AS user_id FROM admin_audit_log WHERE target_type = 'user' AND target_id IS NOT NULL AND target_id <> ''`,
        countSql: `SELECT COUNT(DISTINCT target_id)::bigint AS n FROM admin_audit_log WHERE target_type = 'user' AND target_id IS NOT NULL AND target_id <> ''`,
    },
];

const OPTIONAL_SQL_USER_ID_SOURCES: SqlUserIdSource[] = [
    {
        name: 'users.id',
        table: 'users',
        column: 'id',
        selectSql: `SELECT DISTINCT id AS user_id FROM users WHERE id IS NOT NULL AND id <> ''`,
        countSql: `SELECT COUNT(DISTINCT id)::bigint AS n FROM users WHERE id IS NOT NULL AND id <> ''`,
    },
    {
        name: 'users.user_id',
        table: 'users',
        column: 'user_id',
        selectSql: `SELECT DISTINCT user_id AS user_id FROM users WHERE user_id IS NOT NULL AND user_id <> ''`,
        countSql: `SELECT COUNT(DISTINCT user_id)::bigint AS n FROM users WHERE user_id IS NOT NULL AND user_id <> ''`,
    },
    {
        name: 'user_profiles.user_id',
        table: 'user_profiles',
        column: 'user_id',
        selectSql: `SELECT DISTINCT user_id AS user_id FROM user_profiles WHERE user_id IS NOT NULL AND user_id <> ''`,
        countSql: `SELECT COUNT(DISTINCT user_id)::bigint AS n FROM user_profiles WHERE user_id IS NOT NULL AND user_id <> ''`,
    },
    {
        name: 'profiles.user_id',
        table: 'profiles',
        column: 'user_id',
        selectSql: `SELECT DISTINCT user_id AS user_id FROM profiles WHERE user_id IS NOT NULL AND user_id <> ''`,
        countSql: `SELECT COUNT(DISTINCT user_id)::bigint AS n FROM profiles WHERE user_id IS NOT NULL AND user_id <> ''`,
    },
    {
        name: 'accounts.id',
        table: 'accounts',
        column: 'id',
        selectSql: `SELECT DISTINCT id AS user_id FROM accounts WHERE id IS NOT NULL AND id <> ''`,
        countSql: `SELECT COUNT(DISTINCT id)::bigint AS n FROM accounts WHERE id IS NOT NULL AND id <> ''`,
    },
    {
        name: 'accounts.user_id',
        table: 'accounts',
        column: 'user_id',
        selectSql: `SELECT DISTINCT user_id AS user_id FROM accounts WHERE user_id IS NOT NULL AND user_id <> ''`,
        countSql: `SELECT COUNT(DISTINCT user_id)::bigint AS n FROM accounts WHERE user_id IS NOT NULL AND user_id <> ''`,
    },
];

const ALL_SQL_USER_ID_SOURCES: SqlUserIdSource[] = [...CORE_SQL_USER_ID_SOURCES, ...OPTIONAL_SQL_USER_ID_SOURCES];

async function tableHasColumn(db: Knex, table: string, column: string): Promise<boolean> {
    const rs = await db.raw(
        `
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ?
          AND column_name = ?
        LIMIT 1
        `,
        [table, column]
    );
    return Boolean((rs as any)?.rows?.[0]);
}

async function tableExists(db: Knex, table: string): Promise<boolean> {
    const rs = await db.raw(
        `
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = 'public'
                    AND table_name = ?
                LIMIT 1
                `,
        [table]
    );
    return Boolean((rs as any)?.rows?.[0]);
}

async function sqlUserIdSourceExists(db: Knex, source: SqlUserIdSource): Promise<boolean> {
    if (source.column) {
        return tableHasColumn(db, source.table, source.column);
    }
    return tableExists(db, source.table);
}

async function collectDistinctSqlUserIds(db: Knex): Promise<string[]> {
    const ids = new Set<string>();

    for (const source of ALL_SQL_USER_ID_SOURCES) {
        try {
            const exists = await sqlUserIdSourceExists(db, source);
            if (!exists) {
                continue;
            }

            const rs = await db.raw(source.selectSql);
            const rows = ((rs as any)?.rows || []) as Array<Record<string, unknown>>;
            for (const row of rows) {
                const userId = asString(row.user_id);
                if (userId && isCanonicalSubUserId(userId)) {
                    ids.add(userId);
                }
            }
        } catch {
            // Source-level failures should not block fallback enumeration.
        }
    }

    return Array.from(ids).sort((left, right) => left.localeCompare(right));
}

async function buildUserIdsCte(db: Knex): Promise<string> {
    const selects: string[] = [];

    for (const source of ALL_SQL_USER_ID_SOURCES) {
        try {
            const ok = await sqlUserIdSourceExists(db, source);
            if (ok) {
                selects.push(source.selectSql);
            }
        } catch {
            // Optional source probes should never break admin listing.
        }
    }

    if (selects.length === 0) {
        return `WITH ids AS (SELECT NULL::text AS user_id WHERE FALSE)`;
    }

    return `WITH ids AS (${selects.join(' UNION ')})`;
}

function mergeUserRowWithDirectory(row: AdminUserRow | null, directoryUser: DirectoryUser | null): AdminUserRow {
    const mergedUserId = asString(row?.userId || directoryUser?.userId || '');
    return {
        userId: mergedUserId,
        username: directoryUser?.username || row?.username || '',
        email: directoryUser?.email || row?.email || '',
        phoneNumber: directoryUser?.phoneNumber || row?.phoneNumber || '',
        displayName: directoryUser?.displayName || row?.displayName || '',
        userStatus: directoryUser?.userStatus || row?.userStatus || '',
        enabled: directoryUser?.enabled ?? row?.enabled ?? true,
        role: row?.role || 'user',
        isBanned: row?.isBanned === true,
        banReason: row?.banReason || null,
        bannedUntil: row?.bannedUntil || null,
        createdAt: row?.createdAt || directoryUser?.createdAt || null,
        updatedAt: row?.updatedAt || directoryUser?.updatedAt || null,
    };
}

function matchesAdminUserQuery(user: AdminUserRow, q: string): boolean {
    if (!q) return true;
    const lowered = q.toLowerCase();
    return [user.userId, user.username, user.email, user.displayName, user.phoneNumber]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(lowered));
}

async function listSqlKnownUsers(): Promise<AdminUserRow[]> {
    const db = adminDb();
    const userIds = await collectDistinctSqlUserIds(db);
    const stateByUserId = new Map<string, any>();

    if (userIds.length > 0) {
        try {
            const stateRows = await db('user_admin_state')
                .select('user_id', 'role', 'is_banned', 'ban_reason', 'banned_until', 'created_at', 'updated_at')
                .whereIn('user_id', userIds);

            for (const row of stateRows as Array<any>) {
                stateByUserId.set(String(row.user_id), row);
            }
        } catch {
            // Keep fallback enumeration available even if admin state enrichment is unavailable.
        }
    }

    const rows = userIds.map((userId) => {
        const state = stateByUserId.get(userId);
        return {
            userId,
            role: String(state?.role || 'user'),
            isBanned: Boolean(state?.is_banned),
            banReason: state?.ban_reason ? String(state.ban_reason) : null,
            bannedUntil: state?.banned_until ? new Date(state.banned_until).toISOString() : null,
            createdAt: state?.created_at ? new Date(state.created_at).toISOString() : null,
            updatedAt: state?.updated_at ? new Date(state.updated_at).toISOString() : null,
        };
    });

    if (rows.length === 0) {
        try {
            const sampleUserIds = userIds.slice(0, 5);
            const sampleStateMatches = sampleUserIds.filter((userId) => stateByUserId.has(userId)).length;

            logger.warn(
                {
                    zeroRows: true,
                    idsCount: userIds.length,
                    sampleUserIds,
                    sampleUserIdsHaveAdminStateMatch: sampleStateMatches > 0,
                    sampleUserIdsAdminStateMatchCount: sampleStateMatches,
                },
                '[admin][users] sql known users returned zero rows'
            );
        } catch (e: any) {
            logger.warn(
                {
                    zeroRows: true,
                    diagnosticError: e?.message || String(e),
                },
                '[admin][users] sql known users zero-row diagnostic failed'
            );
        }
    }

    return rows;
}

export async function getAdminUserSourceStats(): Promise<Record<string, unknown>> {
    const db = adminDb();

    const counts: Array<Record<string, unknown>> = [];

    for (const src of ALL_SQL_USER_ID_SOURCES) {
        try {
            const exists = await sqlUserIdSourceExists(db, src);
            if (!exists) {
                counts.push({ source: src.name, table: src.table, exists: false, distinctUsers: 0 });
                continue;
            }

            const rs = await db.raw(src.countSql);
            const n = Number((rs as any)?.rows?.[0]?.n || 0);
            counts.push({ source: src.name, table: src.table, exists: true, distinctUsers: n });
        } catch (e: any) {
            counts.push({ source: src.name, table: src.table, exists: true, error: e?.message || String(e) });
        }
    }

    return {
        generatedAt: new Date().toISOString(),
        counts,
    };
}

export async function listAdminUsers(input: { q?: string; limit: number; offset: number }): Promise<{ items: AdminUserRow[]; total: number; limit: number; offset: number }> {
    const q = asString(input.q || '').toLowerCase();
    const [sqlUsers, directoryUsers] = await Promise.all([
        listSqlKnownUsers(),
        listDirectoryUsers(),
    ]);

    const byId = new Map<string, AdminUserRow>();
    for (const row of sqlUsers) {
        if (isCanonicalSubUserId(row.userId)) {
            byId.set(row.userId, row);
        }
    }
    for (const directoryUser of directoryUsers) {
        if (!isCanonicalSubUserId(directoryUser.userId)) {
            continue;
        }
        byId.set(directoryUser.userId, mergeUserRowWithDirectory(byId.get(directoryUser.userId) || null, directoryUser));
    }

    const merged = Array.from(byId.values())
        .filter((user) => isCanonicalSubUserId(user.userId))
        .filter((user) => matchesAdminUserQuery(user, q))
        .sort((left, right) => {
            const leftCreated = left.createdAt ? Date.parse(left.createdAt) : 0;
            const rightCreated = right.createdAt ? Date.parse(right.createdAt) : 0;
            if (leftCreated !== rightCreated) return rightCreated - leftCreated;
            return String(left.userId).localeCompare(String(right.userId));
        });

    const total = merged.length;
    const items = merged.slice(input.offset, input.offset + input.limit);
    return { items, total, limit: input.limit, offset: input.offset };
}

async function getAdminStateRow(userId: string): Promise<any | null> {
    const db = adminDb();
    const rs = await db.raw(
        `
        SELECT user_id, role, is_banned, ban_reason, banned_until, metadata, created_at, updated_at
        FROM user_admin_state
        WHERE user_id = ?
        LIMIT 1
        `,
        [userId]
    );
    return (rs as any)?.rows?.[0] || null;
}

async function writeUserMetadata(userId: string, metadata: Record<string, unknown>): Promise<void> {
    const db = adminDb();
    await db.raw(
        `
        INSERT INTO user_admin_state (user_id, metadata)
        VALUES (?, ?::jsonb)
        ON CONFLICT (user_id)
        DO UPDATE SET
          metadata = EXCLUDED.metadata,
          updated_at = CURRENT_TIMESTAMP
        `,
        [userId, JSON.stringify(metadata || {})]
    );
}

async function upsertAdminState(input: {
    userId: string;
    role?: string;
    isBanned: boolean;
    banReason: string | null;
    bannedUntil: string | null;
}): Promise<void> {
    const db = adminDb();

    await db.raw(
        `
    INSERT INTO user_admin_state (user_id, role, is_banned, ban_reason, banned_until)
    VALUES (?, COALESCE(?, 'user'), ?, ?, ?)
    ON CONFLICT (user_id)
    DO UPDATE SET
      role = COALESCE(EXCLUDED.role, user_admin_state.role),
      is_banned = EXCLUDED.is_banned,
      ban_reason = EXCLUDED.ban_reason,
      banned_until = EXCLUDED.banned_until,
      updated_at = CURRENT_TIMESTAMP
    `,
        [input.userId, input.role || null, input.isBanned, input.banReason, input.bannedUntil]
    );
}

export async function banUserByAdmin(input: {
    actorUserId: string;
    targetUserId: string;
    reason: string | null;
    bannedUntil: string | null;
}): Promise<void> {
    await upsertAdminState({
        userId: input.targetUserId,
        isBanned: true,
        banReason: input.reason,
        bannedUntil: input.bannedUntil,
    });

    invalidateBanCache(input.targetUserId);

    await writeAdminAudit({
        actorUserId: input.actorUserId,
        action: 'user_ban',
        targetType: 'user',
        targetId: input.targetUserId,
        metadata: {
            reason: input.reason,
            bannedUntil: input.bannedUntil,
        },
    });
}

export async function setUserEnabledByAdmin(input: {
    actorUserId: string;
    targetUserId: string;
    enabled: boolean;
    reason: string | null;
}): Promise<{ enabled: boolean; username?: string }> {
    const out = await setCognitoUserEnabledBySub(input.targetUserId, input.enabled === true);
    if (!out.ok) {
        throw new Error(out.detail || 'COGNITO_ENABLE_FAILED');
    }

    await writeAdminAudit({
        actorUserId: input.actorUserId,
        action: input.enabled ? 'user_enable' : 'user_disable',
        targetType: 'user',
        targetId: input.targetUserId,
        metadata: {
            reason: input.reason,
            cognitoUsername: out.username || null,
        },
    });

    return { enabled: input.enabled === true, username: out.username };
}

export async function unbanUserByAdmin(input: {
    actorUserId: string;
    targetUserId: string;
    reason: string | null;
}): Promise<void> {
    await upsertAdminState({
        userId: input.targetUserId,
        isBanned: false,
        banReason: null,
        bannedUntil: null,
    });

    invalidateBanCache(input.targetUserId);

    await writeAdminAudit({
        actorUserId: input.actorUserId,
        action: 'user_unban',
        targetType: 'user',
        targetId: input.targetUserId,
        metadata: {
            reason: input.reason,
        },
    });
}

export async function writeAdminAudit(input: {
    actorUserId: string;
    action: string;
    targetType: string;
    targetId: string;
    metadata?: Record<string, unknown>;
}): Promise<void> {
    const db = adminDb();
    await db.raw(
        `
    INSERT INTO admin_audit_log (actor_user_id, action, target_type, target_id, metadata)
    VALUES (?, ?, ?, ?, ?::jsonb)
    `,
        [input.actorUserId, input.action, input.targetType, input.targetId, JSON.stringify(input.metadata || {})]
    );
}

export async function listAdminAudit(input: {
    q?: string;
    action?: string;
    limit: number;
    offset: number;
}): Promise<{
    items: Array<{
        id: number;
        actorUserId: string;
        action: string;
        targetType: string;
        targetId: string;
        metadata: Record<string, unknown>;
        createdAt: string | null;
    }>;
    total: number;
    limit: number;
    offset: number;
    degraded?: boolean;
    detail?: string;
}> {
    const limit = Math.max(1, Math.min(100, Number(input.limit) || 50));
    const offset = Math.max(0, Number(input.offset) || 0);
    const q = asString(input.q || '').trim();
    const action = asString(input.action || '').trim();

    try {
        const db = adminDb();
        if (!(await hasTable(db, 'admin_audit_log'))) {
            return {
                items: [],
                total: 0,
                limit,
                offset,
                degraded: true,
                detail: 'admin_audit_log table missing',
            };
        }

        const where: string[] = [];
        const params: unknown[] = [];
        if (action) {
            where.push('action = ?');
            params.push(action);
        }
        if (q) {
            where.push('(actor_user_id ILIKE ? OR target_id ILIKE ? OR action ILIKE ?)');
            const like = `%${q}%`;
            params.push(like, like, like);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const countRs = await db.raw(
            `SELECT COUNT(*)::bigint AS n FROM admin_audit_log ${whereSql}`,
            params
        );
        const total = Number((countRs as any)?.rows?.[0]?.n || 0);

        const listParams = [...params, limit, offset];
        const listRs = await db.raw(
            `
            SELECT id, actor_user_id, action, target_type, target_id, metadata, created_at
            FROM admin_audit_log
            ${whereSql}
            ORDER BY created_at DESC, id DESC
            LIMIT ? OFFSET ?
            `,
            listParams
        );

        const items = (((listRs as any)?.rows || []) as Array<any>).map((r) => ({
            id: Number(r.id),
            actorUserId: asString(r.actor_user_id),
            action: asString(r.action),
            targetType: asString(r.target_type),
            targetId: asString(r.target_id),
            metadata: parseJson(r.metadata),
            createdAt: toIso(r.created_at),
        }));

        return { items, total, limit, offset };
    } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[admin] listAdminAudit failed');
        return {
            items: [],
            total: 0,
            limit,
            offset,
            degraded: true,
            detail: e?.message || String(e),
        };
    }
}

async function hasTable(db: Knex, tableName: string): Promise<boolean> {
    const rs = await db.raw(
        `
        SELECT to_regclass(?)::text AS name
        `,
        [`public.${tableName}`]
    );
    return Boolean((rs as any)?.rows?.[0]?.name);
}

type TableRef = { schema: string; table: string };

function quoteIdent(value: string): string {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
        throw new Error(`Invalid SQL identifier: ${value}`);
    }
    return `"${value}"`;
}

function tableQualifiedName(ref: TableRef): string {
    return `${quoteIdent(ref.schema)}.${quoteIdent(ref.table)}`;
}

async function hasTableRef(db: Knex, ref: TableRef): Promise<boolean> {
    const rs = await db.raw(
        `
        SELECT to_regclass(?)::text AS name
        `,
        [`${ref.schema}.${ref.table}`]
    );
    return Boolean((rs as any)?.rows?.[0]?.name);
}

async function tableHasColumnRef(db: Knex, ref: TableRef, column: string): Promise<boolean> {
    const rs = await db.raw(
        `
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = ?
          AND table_name = ?
          AND column_name = ?
        LIMIT 1
        `,
        [ref.schema, ref.table, column]
    );
    return Boolean((rs as any)?.rows?.[0]);
}

function isLikelyPostTableName(tableName: string): boolean {
    return /(post|feed|timeline|story|content|moment)/i.test(tableName || '');
}

async function listCandidatePostTables(db: Knex): Promise<TableRef[]> {
    const rs = await db.raw(
        `
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_schema ASC, table_name ASC
        `
    );

    const refs = ((rs as any)?.rows || [])
        .map((r: any) => ({
            schema: String(r.table_schema || '').trim(),
            table: String(r.table_name || '').trim(),
        }))
        .filter((r: TableRef) => r.schema && r.table);

    const likely = refs.filter((r: TableRef) => isLikelyPostTableName(r.table));
    const other = refs.filter((r: TableRef) => !isLikelyPostTableName(r.table));
    return [...likely, ...other];
}

async function detectUserIdColumn(db: Knex, ref: TableRef): Promise<string | null> {
    const candidates = [
        'user_id',
        'userid',
        'userId',
        'uid',
        'author_user_id',
        'creator_user_id',
        'owner_user_id',
        'owner_id',
        'author_id',
        'creator_id',
        'profile_id',
        'account_id',
        'member_id',
    ];
    for (const col of candidates) {
        const ok = await tableHasColumnRef(db, ref, col);
        if (ok) return col;
    }
    return null;
}

async function detectPostIdColumn(db: Knex, ref: TableRef): Promise<string | null> {
    const candidates = ['post_id', 'postid', 'postId', 'id', 'uuid', 'post_uuid', 'content_id'];
    for (const col of candidates) {
        const ok = await tableHasColumnRef(db, ref, col);
        if (ok) return col;
    }
    return null;
}

async function detectTextColumn(db: Knex, ref: TableRef): Promise<string | null> {
    const candidates = ['content', 'body', 'caption', 'text', 'description', 'title', 'message', 'post_text'];
    for (const col of candidates) {
        const ok = await tableHasColumnRef(db, ref, col);
        if (ok) return col;
    }
    return null;
}

async function detectCreatedAtColumn(db: Knex, ref: TableRef): Promise<string | null> {
    const candidates = ['created_at', 'createdAt', 'created', 'date', 'inserted_at', 'published_at', 'timestamp'];
    for (const col of candidates) {
        const ok = await tableHasColumnRef(db, ref, col);
        if (ok) return col;
    }
    return null;
}

async function detectUpdatedAtColumn(db: Knex, ref: TableRef): Promise<string | null> {
    const candidates = ['updated_at', 'updatedAt', 'modified_at', 'modifiedAt', 'edited_at', 'last_updated_at'];
    for (const col of candidates) {
        const ok = await tableHasColumnRef(db, ref, col);
        if (ok) return col;
    }
    return null;
}

async function detectPostTypeColumn(db: Knex, ref: TableRef): Promise<string | null> {
    const candidates = ['post_type', 'postType', 'type', 'kind', 'content_type'];
    for (const col of candidates) {
        const ok = await tableHasColumnRef(db, ref, col);
        if (ok) return col;
    }
    return null;
}

async function detectMediaUrlColumn(db: Knex, ref: TableRef): Promise<string | null> {
    const candidates = ['media_url', 'mediaUrl', 'asset_url', 'assetUrl', 'file_url', 'fileUrl', 'url'];
    for (const col of candidates) {
        const ok = await tableHasColumnRef(db, ref, col);
        if (ok) return col;
    }
    return null;
}

async function detectVideoUrlColumn(db: Knex, ref: TableRef): Promise<string | null> {
    const candidates = ['video_url', 'videoUrl', 'stream_url', 'streamUrl', 'playback_url', 'playbackUrl'];
    for (const col of candidates) {
        const ok = await tableHasColumnRef(db, ref, col);
        if (ok) return col;
    }
    return null;
}

async function detectThumbnailUrlColumn(db: Knex, ref: TableRef): Promise<string | null> {
    const candidates = ['thumbnail_url', 'thumbnailUrl', 'thumb_url', 'thumbUrl', 'preview_url', 'previewUrl', 'image_url', 'imageUrl', 'cover_url', 'coverUrl'];
    for (const col of candidates) {
        const ok = await tableHasColumnRef(db, ref, col);
        if (ok) return col;
    }
    return null;
}

async function resolvePostSource(db: Knex): Promise<{
    table: string;
    schema: string;
    qualifiedTable: string;
    userIdCol: string;
    postIdCol: string;
    textCol: string | null;
    createdAtCol: string | null;
    updatedAtCol: string | null;
    postTypeCol: string | null;
    mediaUrlCol: string | null;
    videoUrlCol: string | null;
    thumbnailUrlCol: string | null;
} | null> {
    const preferredRefs: TableRef[] = [
        { schema: 'public', table: 'posts' },
        { schema: 'public', table: 'user_posts' },
        { schema: 'public', table: 'feed_posts' },
        { schema: 'app_public', table: 'posts' },
        { schema: 'app_public', table: 'user_posts' },
        { schema: 'app_public', table: 'feed_posts' },
    ];

    for (const ref of preferredRefs) {
        const exists = await hasTableRef(db, ref);
        if (!exists) continue;
        const userIdCol = await detectUserIdColumn(db, ref);
        const postIdCol = await detectPostIdColumn(db, ref);
        if (!userIdCol || !postIdCol) continue;
        return {
            schema: ref.schema,
            table: ref.table,
            qualifiedTable: tableQualifiedName(ref),
            userIdCol,
            postIdCol,
            textCol: await detectTextColumn(db, ref),
            createdAtCol: await detectCreatedAtColumn(db, ref),
            updatedAtCol: await detectUpdatedAtColumn(db, ref),
            postTypeCol: await detectPostTypeColumn(db, ref),
            mediaUrlCol: await detectMediaUrlColumn(db, ref),
            videoUrlCol: await detectVideoUrlColumn(db, ref),
            thumbnailUrlCol: await detectThumbnailUrlColumn(db, ref),
        };
    }

    const allTables = await listCandidatePostTables(db);
    for (const ref of allTables) {
        const userIdCol = await detectUserIdColumn(db, ref);
        const postIdCol = await detectPostIdColumn(db, ref);
        if (!userIdCol || !postIdCol) continue;
        return {
            schema: ref.schema,
            table: ref.table,
            qualifiedTable: tableQualifiedName(ref),
            userIdCol,
            postIdCol,
            textCol: await detectTextColumn(db, ref),
            createdAtCol: await detectCreatedAtColumn(db, ref),
            updatedAtCol: await detectUpdatedAtColumn(db, ref),
            postTypeCol: await detectPostTypeColumn(db, ref),
            mediaUrlCol: await detectMediaUrlColumn(db, ref),
            videoUrlCol: await detectVideoUrlColumn(db, ref),
            thumbnailUrlCol: await detectThumbnailUrlColumn(db, ref),
        };
    }

    return null;
}

export async function listAdminUserPosts(input: { userId: string; q?: string; limit: number; offset: number }): Promise<{ items: PostListItem[]; total: number; limit: number; offset: number; sourceTable?: string; degraded?: boolean; detail?: string }> {
    const db = adminDb();
    const source = await resolvePostSource(db);
    if (!source) {
        return {
            items: [],
            total: 0,
            limit: input.limit,
            offset: input.offset,
            degraded: true,
            detail: 'No supported posts table found (searched accessible non-system SQL schemas for post-like tables with user and id columns).',
        };
    }

    const q = asString(input.q || '');
    const like = `%${q}%`;
    const postIdExpr = `p.${quoteIdent(source.postIdCol)}`;
    const userIdExpr = `p.${quoteIdent(source.userIdCol)}`;
    const textExpr = source.textCol ? `COALESCE(CAST(p.${quoteIdent(source.textCol)} AS text), '')` : `''`;
    const createdExpr = source.createdAtCol ? `p.${quoteIdent(source.createdAtCol)}` : 'NULL';
    const updatedExpr = source.updatedAtCol ? `p.${quoteIdent(source.updatedAtCol)}` : createdExpr;
    const postTypeExpr = source.postTypeCol ? `COALESCE(CAST(p.${quoteIdent(source.postTypeCol)} AS text), 'post')` : `'post'`;
    const mediaUrlExpr = source.mediaUrlCol ? `NULLIF(CAST(p.${quoteIdent(source.mediaUrlCol)} AS text), '')` : 'NULL';
    const videoUrlExpr = source.videoUrlCol ? `NULLIF(CAST(p.${quoteIdent(source.videoUrlCol)} AS text), '')` : 'NULL';
    const thumbnailUrlExpr = source.thumbnailUrlCol ? `NULLIF(CAST(p.${quoteIdent(source.thumbnailUrlCol)} AS text), '')` : 'NULL';

    const selectSql = `
        SELECT
            CAST(${postIdExpr} AS text) AS post_id,
            CAST(${userIdExpr} AS text) AS user_id,
            ${textExpr} AS content,
            ${createdExpr} AS created_at,
            ${updatedExpr} AS updated_at,
            ${postTypeExpr} AS post_type,
            ${mediaUrlExpr} AS media_url,
            ${videoUrlExpr} AS video_url,
            ${thumbnailUrlExpr} AS thumbnail_url,
            COALESCE(ps.is_removed, false) AS is_removed,
            ps.removed_reason,
            ps.removed_at
        FROM ${source.qualifiedTable} p
        LEFT JOIN post_admin_state ps ON ps.post_id = CAST(${postIdExpr} AS text)
        WHERE CAST(${userIdExpr} AS text) = ?
          AND (? = '' OR ${textExpr} ILIKE ?)
        ORDER BY ${createdExpr} DESC NULLS LAST
        LIMIT ? OFFSET ?
    `;

    const countSql = `
        SELECT COUNT(*)::bigint AS total
        FROM ${source.qualifiedTable} p
        WHERE CAST(${userIdExpr} AS text) = ?
          AND (? = '' OR ${textExpr} ILIKE ?)
    `;

    const [rowsRs, countRs] = await Promise.all([
        db.raw(selectSql, [input.userId, q, like, input.limit, input.offset]),
        db.raw(countSql, [input.userId, q, like]),
    ]);

    const rows = ((rowsRs as any)?.rows || []) as Array<any>;
    const items: PostListItem[] = rows.map((r) => ({
        postId: String(r.post_id),
        userId: String(r.user_id),
        content: asString(r.content),
        createdAt: toIso(r.created_at),
        updatedAt: toIso(r.updated_at),
        postType: asString(r.post_type) || 'post',
        mediaUrl: asString(r.media_url) || null,
        videoUrl: asString(r.video_url) || null,
        thumbnailUrl: asString(r.thumbnail_url) || null,
        isRemoved: asBool(r.is_removed),
        removedReason: asString(r.removed_reason) || null,
        removedAt: toIso(r.removed_at),
    }));

    return {
        items,
        total: Number((countRs as any)?.rows?.[0]?.total || 0),
        limit: input.limit,
        offset: input.offset,
        sourceTable: `${source.schema}.${source.table}`,
    };
}

export async function removePostByAdmin(input: { actorUserId: string; targetPostId: string; userId?: string; reason: string | null }): Promise<void> {
    const db = adminDb();
    await db.raw(
        `
        INSERT INTO post_admin_state (post_id, is_removed, removed_reason, removed_by_user_id, removed_at)
        VALUES (?, true, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT (post_id)
        DO UPDATE SET
          is_removed = true,
          removed_reason = EXCLUDED.removed_reason,
          removed_by_user_id = EXCLUDED.removed_by_user_id,
          removed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        `,
        [input.targetPostId, input.reason, input.actorUserId]
    );

    // Mirror into Firestore so mobile For You / discovery drop the post immediately
    // via filterBlocked → moderation.hidden (Postgres-only remove left feeds intact).
    const hide = await setPostModerationHiddenFs(
        input.targetPostId,
        true,
        input.reason,
        input.actorUserId,
    );
    if (!hide.ok) {
        logger.warn(
            { postId: input.targetPostId, detail: hide.detail },
            '[admin] post_remove: Firestore hide incomplete; Postgres state was still updated',
        );
    }

    await writeAdminAudit({
        actorUserId: input.actorUserId,
        action: 'post_remove',
        targetType: 'post',
        targetId: input.targetPostId,
        metadata: {
            reason: input.reason,
            userId: input.userId || null,
            firestoreHidden: hide.ok,
        },
    });
}

export async function restorePostByAdmin(input: { actorUserId: string; targetPostId: string; userId?: string; reason: string | null }): Promise<void> {
    const db = adminDb();
    await db.raw(
        `
        INSERT INTO post_admin_state (post_id, is_removed, removed_reason, removed_by_user_id, removed_at)
        VALUES (?, false, NULL, NULL, NULL)
        ON CONFLICT (post_id)
        DO UPDATE SET
          is_removed = false,
          removed_reason = NULL,
          removed_by_user_id = NULL,
          removed_at = NULL,
          updated_at = CURRENT_TIMESTAMP
        `,
        [input.targetPostId]
    );

    const unhide = await setPostModerationHiddenFs(
        input.targetPostId,
        false,
        input.reason,
        input.actorUserId,
    );
    if (!unhide.ok) {
        logger.warn(
            { postId: input.targetPostId, detail: unhide.detail },
            '[admin] post_restore: Firestore unhide incomplete; Postgres state was still updated',
        );
    }

    await writeAdminAudit({
        actorUserId: input.actorUserId,
        action: 'post_restore',
        targetType: 'post',
        targetId: input.targetPostId,
        metadata: {
            reason: input.reason,
            userId: input.userId || null,
            firestoreHidden: false,
            firestoreUnhideOk: unhide.ok,
        },
    });
}

export async function setFeedPriorityByAdmin(input: {
    actorUserId: string;
    targetPostId: string;
    priority: FeedPriority | 'less';
    reason: string | null;
}): Promise<{ firestoreOk: boolean; feedPriority: FeedPriority; detail?: string }> {
    const priority = normalizePostFeedPriority(input.priority);
    const fsResult = await setPostFeedPriorityFs(
        input.targetPostId,
        priority,
        input.actorUserId,
    );

    await writeAdminAudit({
        actorUserId: input.actorUserId,
        action: 'post_feed_priority',
        targetType: 'post',
        targetId: input.targetPostId,
        metadata: {
            priority,
            reason: input.reason,
            firestoreOk: fsResult.ok,
            detail: fsResult.detail || null,
        },
    });

    if (!fsResult.ok) {
        const err: any = new Error(fsResult.detail || 'FEED_PRIORITY_FIRESTORE_FAILED');
        err.code = 'FEED_PRIORITY_FIRESTORE_FAILED';
        throw err;
    }

    return { firestoreOk: true, feedPriority: priority };
}

/**
 * Account-wide feed weight.
 * Persists to Firestore users/{uid}.feedPriorityAccount (read by mobile ranking)
 * and mirrors into Postgres user_admin_state.metadata for admin detail/audit.
 */
export async function setAccountFeedPriorityByAdmin(input: {
    actorUserId: string;
    targetUserId: string;
    priority: AccountFeedPriority;
    reason: string | null;
}): Promise<{
    firestoreOk: boolean;
    feedPriorityAccount: AccountFeedPriority;
    detail?: string;
}> {
    const priority = normalizeAccountFeedPriority(input.priority);
    const targetUserId = String(input.targetUserId || '').trim();
    if (!isCanonicalSubUserId(targetUserId)) {
        const err: any = new Error('INVALID_SUB');
        err.code = 'INVALID_SUB';
        throw err;
    }

    const fsResult = await setUserFeedPriorityFs(targetUserId, priority, input.actorUserId);

    const state = await getAdminStateRow(targetUserId);
    const metadata = parseJson(state?.metadata);
    const nextMetadata = {
        ...metadata,
        feedPriorityAccount: priority,
        feedPriorityAccountUpdatedAt: new Date().toISOString(),
        feedPriorityAccountUpdatedBy: input.actorUserId,
    };
    await writeUserMetadata(targetUserId, nextMetadata);

    await writeAdminAudit({
        actorUserId: input.actorUserId,
        action: 'user_feed_priority',
        targetType: 'user',
        targetId: targetUserId,
        metadata: {
            priority,
            reason: input.reason,
            firestoreOk: fsResult.ok,
            detail: fsResult.detail || null,
        },
    });

    if (!fsResult.ok) {
        const err: any = new Error(fsResult.detail || 'FEED_PRIORITY_FIRESTORE_FAILED');
        err.code = 'FEED_PRIORITY_FIRESTORE_FAILED';
        throw err;
    }

    return { firestoreOk: true, feedPriorityAccount: priority };
}

export async function getAdminUserDetail(userId: string): Promise<AdminUserDetail> {
    const db = adminDb();
    const state = await getAdminStateRow(userId);
    const metadata = parseJson(state?.metadata);
    const directoryUser = await findDirectoryUser(userId);

    const [actionsRs, messagesRs, publicFields] = await Promise.all([
        db.raw(
            `
            SELECT action, target_type, target_id, metadata, created_at
            FROM admin_audit_log
            WHERE target_type = 'user' AND target_id = ?
            ORDER BY created_at DESC
            LIMIT 20
            `,
            [userId]
        ),
        db.raw(
            `
            SELECT message_id, channel, status, subject, body, created_at
            FROM admin_user_messages
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT 20
            `,
            [userId]
        ),
        getFirestoreUserPublicFields(userId).catch(() => ({
            avatarFrame: null,
            photoURL: null,
            feedPriorityAccount: 'standard' as AccountFeedPriority,
        })),
    ]);

    const recentActions = (((actionsRs as any)?.rows || []) as Array<any>).map((r) => ({
        action: asString(r.action),
        targetType: asString(r.target_type),
        targetId: asString(r.target_id),
        metadata: parseJson(r.metadata),
        createdAt: toIso(r.created_at),
    }));

    const recentMessages = (((messagesRs as any)?.rows || []) as Array<any>).map((r) => ({
        messageId: asString(r.message_id),
        channel: asString(r.channel) || 'in_app',
        status: asString(r.status) || 'queued',
        subject: asString(r.subject),
        body: asString(r.body),
        createdAt: toIso(r.created_at),
    }));

    const metaPriority = normalizeAccountFeedPriority(metadata.feedPriorityAccount);
    const fsPriority = normalizeAccountFeedPriority(publicFields.feedPriorityAccount);
    // Prefer live Firestore value (what the feed reads); fall back to Postgres mirror.
    const feedPriorityAccount =
        fsPriority !== 'standard' || !metadata.feedPriorityAccount ? fsPriority : metaPriority;

    return {
        userId,
        username: directoryUser?.username || '',
        email: directoryUser?.email || '',
        phoneNumber: directoryUser?.phoneNumber || '',
        displayName: directoryUser?.displayName || '',
        dateOfBirth: directoryUser?.dateOfBirth || '',
        address: directoryUser?.address || '',
        city: directoryUser?.city || '',
        region: directoryUser?.region || '',
        postcode: directoryUser?.postcode || '',
        country: directoryUser?.country || '',
        userStatus: directoryUser?.userStatus || '',
        enabled: directoryUser?.enabled ?? true,
        role: asString(state?.role) || 'user',
        isBanned: asBool(state?.is_banned),
        banReason: asString(state?.ban_reason) || null,
        bannedUntil: toIso(state?.banned_until),
        verification: buildVerification(metadata),
        restrictions: buildRestrictions(metadata),
        fraud: (() => {
            const fraud = asObject(metadata.fraud);
            return {
                openChargebackCount: Math.max(0, Math.floor(Number(fraud.openChargebackCount) || 0)),
                accountFrozen: fraud.accountFrozen === true,
                underFraudReview: fraud.underFraudReview === true,
                chargebackNote: asString(fraud.chargebackNote) || null,
                updatedAt: toIso(fraud.updatedAt),
                updatedBy: asString(fraud.updatedBy) || null,
            };
        })(),
        avatarFrame: publicFields.avatarFrame || null,
        photoURL: publicFields.photoURL || null,
        feedPriorityAccount,
        createdAt: toIso(state?.created_at) || directoryUser?.createdAt || null,
        updatedAt: toIso(state?.updated_at) || directoryUser?.updatedAt || null,
        recentActions,
        recentMessages,
    };
}

export async function setAdminUserCapabilities(input: {
    actorUserId: string;
    targetUserId: string;
    verified: boolean;
    role?: string;
    verificationNote?: string | null;
    messagingRestricted: boolean;
    liveRestricted: boolean;
    loginRestricted: boolean;
    accountRestricted: boolean;
    reason?: string | null;
    expiresAt?: string | null;
    avatarFrame?: string | null;
}): Promise<AdminUserDetail> {
    const now = new Date().toISOString();
    const state = await getAdminStateRow(input.targetUserId);
    const metadata = parseJson(state?.metadata);

    const nextMetadata = {
        ...metadata,
        verification: {
            ...asObject(metadata.verification),
            isVerified: input.verified === true,
            note: asString(input.verificationNote || ''),
            updatedAt: now,
            updatedBy: input.actorUserId,
        },
        restrictions: {
            ...asObject(metadata.restrictions),
            messagingRestricted: input.messagingRestricted === true,
            liveRestricted: input.liveRestricted === true,
            loginRestricted: input.loginRestricted === true,
            accountRestricted: input.accountRestricted === true,
            reason: asString(input.reason || ''),
            expiresAt: toIso(input.expiresAt) || null,
            updatedAt: now,
            updatedBy: input.actorUserId,
        },
    };

    const nextRole = input.role || asString(state?.role) || 'user';
    const prevRole = asString(state?.role) || 'user';

    await upsertAdminState({
        userId: input.targetUserId,
        role: nextRole,
        isBanned: asBool(state?.is_banned),
        banReason: asString(state?.ban_reason) || null,
        bannedUntil: toIso(state?.banned_until),
    });

    await writeUserMetadata(input.targetUserId, nextMetadata);

    // Restrictions changed — drop liveRestrictionGuard TTL so go-live enforces immediately.
    invalidateLiveRestrictionCache(input.targetUserId);

    const directoryUser = await findDirectoryUser(input.targetUserId).catch(() => null);

    // Keep mobile in-app admin (useIsAdmin → users/{sub}.roles / isAdmin) in sync
    // whenever the dashboard role is set. Cognito sub == Firestore users doc id.
    let firestoreRoleSync: { ok: boolean; matchedDocs: number; detail?: string } | null = null;
    if (typeof input.role === 'string' && input.role.trim()) {
        firestoreRoleSync = await syncUserRoleToFirestore(input.targetUserId, nextRole, {
            email: directoryUser?.email || null,
        });
        if (!firestoreRoleSync.ok || firestoreRoleSync.matchedDocs === 0) {
            logger.warn(
                {
                    targetUserId: input.targetUserId,
                    nextRole,
                    prevRole,
                    sync: firestoreRoleSync,
                },
                '[admin] Firestore role sync incomplete; Postgres role was still updated'
            );
        }
    }

    let firestoreAvatarFrameSync: { ok: boolean; matchedDocs: number; detail?: string } | null = null;
    if (input.avatarFrame !== undefined) {
        const frame = input.avatarFrame === 'gold_crown' ? 'gold_crown' : null;
        firestoreAvatarFrameSync = await syncAvatarFrameToFirestore(input.targetUserId, frame, {
            email: directoryUser?.email || null,
        });
        if (!firestoreAvatarFrameSync.ok || firestoreAvatarFrameSync.matchedDocs === 0) {
            logger.warn(
                {
                    targetUserId: input.targetUserId,
                    frame,
                    sync: firestoreAvatarFrameSync,
                },
                '[admin] Firestore avatarFrame sync incomplete'
            );
        }
    }

    await writeAdminAudit({
        actorUserId: input.actorUserId,
        action: 'user_capabilities_set',
        targetType: 'user',
        targetId: input.targetUserId,
        metadata: {
            verification: nextMetadata.verification,
            restrictions: nextMetadata.restrictions,
            role: nextRole,
            previousRole: prevRole,
            avatarFrame: input.avatarFrame === undefined ? undefined : (input.avatarFrame === 'gold_crown' ? 'gold_crown' : null),
            firestoreRoleSync,
            firestoreAvatarFrameSync,
        },
    });

    return getAdminUserDetail(input.targetUserId);
}

export async function queueAdminUserMessage(input: {
    actorUserId: string;
    targetUserId: string;
    channel: string;
    subject?: string | null;
    message: string;
    deepLink?: string | null;
}): Promise<{ messageId: string; status: string; delivered: boolean }> {
    const db = adminDb();
    const messageId = `admmsg_${crypto.randomBytes(8).toString('hex')}`;
    const channel = asString(input.channel) || 'in_app';
    const deepLink = asString(input.deepLink || '') || null;

    await db.raw(
        `
        INSERT INTO admin_user_messages (message_id, user_id, channel, status, subject, body, metadata)
        VALUES (?, ?, ?, 'queued', ?, ?, ?::jsonb)
        `,
        [
            messageId,
            input.targetUserId,
            channel,
            asString(input.subject || '') || null,
            asString(input.message),
            JSON.stringify({
                actorUserId: input.actorUserId,
                ...(deepLink ? { deepLink } : {}),
            }),
        ]
    );

    let delivered = false;
    if (channel === 'in_app' || channel === 'both' || channel === 'push') {
        const mirror = await enqueueAdminInboxNotification({
            userId: input.targetUserId,
            messageId,
            title: asString(input.subject || '') || 'Blyp',
            body: asString(input.message),
            deepLink,
        });
        delivered = mirror.ok;
        if (delivered) {
            await db.raw(
                `UPDATE admin_user_messages
                 SET status = 'delivered', updated_at = CURRENT_TIMESTAMP
                 WHERE message_id = ?`,
                [messageId]
            );
        }
    }

    await writeAdminAudit({
        actorUserId: input.actorUserId,
        action: 'user_message_queued',
        targetType: 'user',
        targetId: input.targetUserId,
        metadata: {
            channel,
            messageId,
            subject: asString(input.subject || ''),
            delivered,
        },
    });

    return { messageId, status: delivered ? 'delivered' : 'queued', delivered };
}

export async function getEffectiveUserControls(userId: string): Promise<{
    userId: string;
    verification: AdminVerification;
    restrictions: AdminRestrictions;
    recentMessages: Array<{
        messageId: string;
        channel: string;
        status: string;
        subject: string;
        body: string;
        createdAt: string | null;
    }>;
    source: 'user_admin_state';
}> {
    const detail = await getAdminUserDetail(userId);
    return {
        userId,
        verification: detail.verification,
        restrictions: detail.restrictions,
        recentMessages: detail.recentMessages,
        source: 'user_admin_state',
    };
}

export async function getAdminMetricsOverview(): Promise<Record<string, unknown>> {
    const infra = getEconomyInfra();
    const db = infra.db;
    const userIdsCte = await buildUserIdsCte(db);

    const sql = `
        ${userIdsCte}
    SELECT
            (SELECT COUNT(*)::bigint FROM ids WHERE user_id IS NOT NULL AND user_id <> '') AS total_users,
      (SELECT COUNT(*)::bigint FROM user_admin_state WHERE is_banned = true) AS banned_users,
      (SELECT COALESCE(SUM(coin_balance + bonus_coin_balance), 0)::bigint FROM wallets) AS total_coin_supply,
      (SELECT COUNT(*)::bigint FROM gift_events WHERE created_at >= NOW() - INTERVAL '24 hours') AS gifts_24h,
      (SELECT COUNT(*)::bigint FROM ledger_entries WHERE created_at >= NOW() - INTERVAL '24 hours') AS ledger_entries_24h,
      (SELECT COUNT(*)::bigint FROM user_subscriptions WHERE status = 'active') AS active_subscriptions
  `;

    try {
        const rs = await db.raw(sql);
        const row = ((rs as any)?.rows?.[0] || {}) as Record<string, unknown>;

        return {
            totalUsers: Number(row.total_users || 0),
            bannedUsers: Number(row.banned_users || 0),
            totalCoinSupply: Number(row.total_coin_supply || 0),
            gifts24h: Number(row.gifts_24h || 0),
            ledgerEntries24h: Number(row.ledger_entries_24h || 0),
            activeSubscriptions: Number(row.active_subscriptions || 0),
            generatedAt: new Date().toISOString(),
            degraded: false,
        };
    } catch (e: any) {
        const [dbStatus, redisStatus] = await Promise.all([
            checkDb(infra.db),
            checkRedis(infra.redis),
        ]);

        return {
            totalUsers: 0,
            bannedUsers: 0,
            totalCoinSupply: 0,
            gifts24h: 0,
            ledgerEntries24h: 0,
            activeSubscriptions: 0,
            generatedAt: new Date().toISOString(),
            degraded: true,
            detail: 'Metrics unavailable: database/redis not ready',
            dependencyStatus: {
                db: dbStatus,
                redis: redisStatus,
            },
            error: e?.message || String(e),
        };
    }
}
