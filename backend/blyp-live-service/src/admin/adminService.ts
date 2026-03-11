import crypto from 'crypto';
import type { Knex } from 'knex';
import { checkDb, checkRedis, getEconomyInfra } from '../economy/infra';
import { findDirectoryUser, listDirectoryUsers, type DirectoryUser } from './adminCognitoDirectory';
import { getAdminFirestore } from '../config/firebaseAdmin';

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

const OPTIONAL_USER_SOURCES: Array<{ table: string; column: string }> = [
    { table: 'users', column: 'id' },
    { table: 'users', column: 'user_id' },
    { table: 'user_profiles', column: 'user_id' },
    { table: 'profiles', column: 'user_id' },
    { table: 'accounts', column: 'id' },
    { table: 'accounts', column: 'user_id' },
];

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

async function buildUserIdsCte(db: Knex): Promise<string> {
    const selects: string[] = [
        'SELECT user_id FROM wallets',
        'SELECT user_id FROM user_admin_state',
        'SELECT user_id FROM ledger_entries',
        'SELECT sender_user_id AS user_id FROM gift_events',
        'SELECT receiver_user_id AS user_id FROM gift_events',
        'SELECT creator_user_id AS user_id FROM stream_earnings',
        'SELECT user_id FROM promotions',
        'SELECT host_user_id AS user_id FROM live_games',
        'SELECT user_id FROM live_game_entries',
        'SELECT host_user_id AS user_id FROM live_game_settlements',
        'SELECT user_id FROM user_subscriptions',
        'SELECT actor_user_id AS user_id FROM admin_audit_log',
        "SELECT target_id AS user_id FROM admin_audit_log WHERE target_type = 'user'",
    ];

    for (const src of OPTIONAL_USER_SOURCES) {
        try {
            const ok = await tableHasColumn(db, src.table, src.column);
            if (ok) {
                selects.push(`SELECT ${src.column} AS user_id FROM ${src.table}`);
            }
        } catch {
            // Optional source probes should never break admin listing.
        }
    }

    return `WITH ids AS (${selects.join(' UNION ')})`;
}

function mergeUserRowWithDirectory(row: AdminUserRow | null, directoryUser: DirectoryUser | null): AdminUserRow {
    return {
        userId: row?.userId || directoryUser?.userId || '',
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
    const userIdsCte = await buildUserIdsCte(db);
    const sql = `
    ${userIdsCte}
    SELECT DISTINCT
      ids.user_id,
      COALESCE(s.role, 'user') AS role,
      COALESCE(s.is_banned, false) AS is_banned,
      s.ban_reason,
      s.banned_until,
      s.created_at,
      s.updated_at
    FROM ids
    LEFT JOIN user_admin_state s ON s.user_id = ids.user_id
    WHERE ids.user_id IS NOT NULL
      AND ids.user_id <> ''
    ORDER BY ids.user_id ASC
    `;

    const usersRs = await db.raw(sql);
    const rows = ((usersRs as any)?.rows || []) as Array<any>;
    return rows.map((r) => ({
        userId: String(r.user_id),
        role: String(r.role || 'user'),
        isBanned: Boolean(r.is_banned),
        banReason: r.ban_reason ? String(r.ban_reason) : null,
        bannedUntil: r.banned_until ? new Date(r.banned_until).toISOString() : null,
        createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
        updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
    }));
}

export async function getAdminUserSourceStats(): Promise<Record<string, unknown>> {
    const db = adminDb();

    const sources: Array<{ name: string; table: string; sql?: string }> = [
        { name: 'wallets.user_id', table: 'wallets' },
        { name: 'user_admin_state.user_id', table: 'user_admin_state' },
        { name: 'ledger_entries.user_id', table: 'ledger_entries' },
        { name: 'gift_events.sender_user_id', table: 'gift_events', sql: 'SELECT COUNT(DISTINCT sender_user_id)::bigint AS n FROM gift_events' },
        { name: 'gift_events.receiver_user_id', table: 'gift_events', sql: 'SELECT COUNT(DISTINCT receiver_user_id)::bigint AS n FROM gift_events' },
        { name: 'stream_earnings.creator_user_id', table: 'stream_earnings', sql: 'SELECT COUNT(DISTINCT creator_user_id)::bigint AS n FROM stream_earnings' },
        { name: 'promotions.user_id', table: 'promotions' },
        { name: 'live_games.host_user_id', table: 'live_games', sql: 'SELECT COUNT(DISTINCT host_user_id)::bigint AS n FROM live_games' },
        { name: 'live_game_entries.user_id', table: 'live_game_entries' },
        { name: 'live_game_settlements.host_user_id', table: 'live_game_settlements', sql: 'SELECT COUNT(DISTINCT host_user_id)::bigint AS n FROM live_game_settlements' },
        { name: 'user_subscriptions.user_id', table: 'user_subscriptions' },
        { name: 'admin_audit_log.actor_user_id', table: 'admin_audit_log', sql: 'SELECT COUNT(DISTINCT actor_user_id)::bigint AS n FROM admin_audit_log' },
        { name: 'admin_audit_log.target_id(user)', table: 'admin_audit_log', sql: "SELECT COUNT(DISTINCT target_id)::bigint AS n FROM admin_audit_log WHERE target_type = 'user'" },
    ];

    const optionalSources = [
        { name: 'users.id', table: 'users', column: 'id' },
        { name: 'users.user_id', table: 'users', column: 'user_id' },
        { name: 'user_profiles.user_id', table: 'user_profiles', column: 'user_id' },
        { name: 'profiles.user_id', table: 'profiles', column: 'user_id' },
        { name: 'accounts.id', table: 'accounts', column: 'id' },
        { name: 'accounts.user_id', table: 'accounts', column: 'user_id' },
    ];

    const counts: Array<Record<string, unknown>> = [];

    for (const src of sources) {
        try {
            const exists = await tableExists(db, src.table);
            if (!exists) {
                counts.push({ source: src.name, table: src.table, exists: false, distinctUsers: 0 });
                continue;
            }

            const sql = src.sql || `SELECT COUNT(DISTINCT user_id)::bigint AS n FROM ${src.table}`;
            const rs = await db.raw(sql);
            const n = Number((rs as any)?.rows?.[0]?.n || 0);
            counts.push({ source: src.name, table: src.table, exists: true, distinctUsers: n });
        } catch (e: any) {
            counts.push({ source: src.name, table: src.table, exists: true, error: e?.message || String(e) });
        }
    }

    for (const src of optionalSources) {
        try {
            const exists = await tableHasColumn(db, src.table, src.column);
            if (!exists) {
                counts.push({ source: src.name, table: src.table, exists: false, distinctUsers: 0 });
                continue;
            }
            const rs = await db.raw(`SELECT COUNT(DISTINCT ${src.column})::bigint AS n FROM ${src.table}`);
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
        byId.set(row.userId, row);
    }
    for (const directoryUser of directoryUsers) {
        byId.set(directoryUser.userId, mergeUserRowWithDirectory(byId.get(directoryUser.userId) || null, directoryUser));
    }

    const merged = Array.from(byId.values())
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

async function hasTable(db: Knex, tableName: string): Promise<boolean> {
    const rs = await db.raw(
        `
        SELECT to_regclass(?)::text AS name
        `,
        [`public.${tableName}`]
    );
    return Boolean((rs as any)?.rows?.[0]?.name);
}

async function detectUserIdColumn(db: Knex, tableName: string): Promise<string | null> {
    const candidates = ['user_id', 'userid', 'userId', 'author_user_id', 'creator_user_id'];
    for (const col of candidates) {
        const ok = await tableHasColumn(db, tableName, col);
        if (ok) return col;
    }
    return null;
}

async function detectPostIdColumn(db: Knex, tableName: string): Promise<string | null> {
    const candidates = ['post_id', 'id'];
    for (const col of candidates) {
        const ok = await tableHasColumn(db, tableName, col);
        if (ok) return col;
    }
    return null;
}

async function detectTextColumn(db: Knex, tableName: string): Promise<string | null> {
    const candidates = ['content', 'body', 'caption', 'text', 'description'];
    for (const col of candidates) {
        const ok = await tableHasColumn(db, tableName, col);
        if (ok) return col;
    }
    return null;
}

async function detectCreatedAtColumn(db: Knex, tableName: string): Promise<string | null> {
    const candidates = ['created_at', 'createdAt', 'date'];
    for (const col of candidates) {
        const ok = await tableHasColumn(db, tableName, col);
        if (ok) return col;
    }
    return null;
}

async function resolvePostSource(db: Knex): Promise<{
    table: string;
    userIdCol: string;
    postIdCol: string;
    textCol: string | null;
    createdAtCol: string | null;
} | null> {
    const preferredTables = ['posts', 'user_posts', 'feed_posts'];
    for (const tableName of preferredTables) {
        const exists = await hasTable(db, tableName);
        if (!exists) continue;
        const userIdCol = await detectUserIdColumn(db, tableName);
        const postIdCol = await detectPostIdColumn(db, tableName);
        if (!userIdCol || !postIdCol) continue;
        return {
            table: tableName,
            userIdCol,
            postIdCol,
            textCol: await detectTextColumn(db, tableName),
            createdAtCol: await detectCreatedAtColumn(db, tableName),
        };
    }

    const rs = await db.raw(
        `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name ASC
        `
    );
    const allTables = ((rs as any)?.rows || []).map((r: any) => String(r.table_name || '')).filter(Boolean);
    for (const tableName of allTables) {
        const userIdCol = await detectUserIdColumn(db, tableName);
        const postIdCol = await detectPostIdColumn(db, tableName);
        if (!userIdCol || !postIdCol) continue;
        return {
            table: tableName,
            userIdCol,
            postIdCol,
            textCol: await detectTextColumn(db, tableName),
            createdAtCol: await detectCreatedAtColumn(db, tableName),
        };
    }

    return null;
}

export async function listAdminUserPosts(input: { userId: string; q?: string; limit: number; offset: number }): Promise<{ items: PostListItem[]; total: number; limit: number; offset: number; degraded?: boolean; detail?: string }> {
    const firestoreDb = getAdminFirestore();
    if (firestoreDb) {
        try {
            const snap = await firestoreDb
                .collection('posts')
                .where('userId', '==', input.userId)
                .orderBy('date', 'desc')
                .get();

            const q = asString(input.q || '').toLowerCase();
            let allDocs: PostListItem[] = snap.docs.map((doc) => {
                const data = doc.data();
                const rawDate = data.date as { toDate?: () => Date } | Date | string | null | undefined;
                let dateIso: string | null = null;
                if (rawDate) {
                    if (typeof (rawDate as { toDate?: () => Date }).toDate === 'function') {
                        dateIso = toIso((rawDate as { toDate: () => Date }).toDate());
                    } else {
                        dateIso = toIso(rawDate);
                    }
                }
                return {
                    postId: doc.id,
                    userId: asString(data['userId']),
                    content: asString(data['caption'] || data['description'] || data['title'] || ''),
                    createdAt: dateIso,
                    isRemoved: false,
                    removedReason: null as string | null,
                    removedAt: null as string | null,
                };
            });

            if (q) {
                allDocs = allDocs.filter(
                    (item) =>
                        item.content.toLowerCase().includes(q) ||
                        item.postId.toLowerCase().includes(q),
                );
            }

            // Enrich with admin remove/restore state from Postgres
            if (allDocs.length > 0) {
                try {
                    const db = adminDb();
                    const postIds = allDocs.map((d) => d.postId);
                    const stateRows = await db('post_admin_state')
                        .whereIn('post_id', postIds)
                        .select('post_id', 'is_removed', 'removed_reason', 'removed_at');
                    const stateMap = new Map<string, Record<string, unknown>>();
                    for (const row of stateRows as Array<Record<string, unknown>>) {
                        stateMap.set(String(row['post_id']), row);
                    }
                    for (const item of allDocs) {
                        const state = stateMap.get(item.postId);
                        if (state) {
                            item.isRemoved = asBool(state['is_removed']);
                            item.removedReason = asString(state['removed_reason']) || null;
                            item.removedAt = toIso(state['removed_at']);
                        }
                    }
                } catch {
                    // post_admin_state enrichment is optional; Postgres may be unavailable
                }
            }

            const total = allDocs.length;
            const items = allDocs.slice(input.offset, input.offset + input.limit);
            return { items, total, limit: input.limit, offset: input.offset };
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            return {
                items: [],
                total: 0,
                limit: input.limit,
                offset: input.offset,
                degraded: true,
                detail: `Firestore posts query failed: ${msg}`,
            };
        }
    }

    // Firestore not configured — fall back to SQL table scan
    const db = adminDb();
    const source = await resolvePostSource(db);
    if (!source) {
        return {
            items: [],
            total: 0,
            limit: input.limit,
            offset: input.offset,
            degraded: true,
            detail: 'Posts not available: Firestore not configured (set FIREBASE_SERVICE_ACCOUNT_JSON) and no SQL posts table found.',
        };
    }

    const q = asString(input.q || '');
    const like = `%${q}%`;
    const textExpr = source.textCol ? `COALESCE(CAST(p.${source.textCol} AS text), '')` : `''`;
    const createdExpr = source.createdAtCol ? `p.${source.createdAtCol}` : 'NULL';

    const selectSql = `
        SELECT
            CAST(p.${source.postIdCol} AS text) AS post_id,
            CAST(p.${source.userIdCol} AS text) AS user_id,
            ${textExpr} AS content,
            ${createdExpr} AS created_at,
            COALESCE(ps.is_removed, false) AS is_removed,
            ps.removed_reason,
            ps.removed_at
        FROM ${source.table} p
        LEFT JOIN post_admin_state ps ON ps.post_id = CAST(p.${source.postIdCol} AS text)
        WHERE CAST(p.${source.userIdCol} AS text) = ?
          AND (? = '' OR ${textExpr} ILIKE ?)
        ORDER BY ${createdExpr} DESC NULLS LAST
        LIMIT ? OFFSET ?
    `;

    const countSql = `
        SELECT COUNT(*)::bigint AS total
        FROM ${source.table} p
        WHERE CAST(p.${source.userIdCol} AS text) = ?
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
        isRemoved: asBool(r.is_removed),
        removedReason: asString(r.removed_reason) || null,
        removedAt: toIso(r.removed_at),
    }));

    return {
        items,
        total: Number((countRs as any)?.rows?.[0]?.total || 0),
        limit: input.limit,
        offset: input.offset,
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

    await writeAdminAudit({
        actorUserId: input.actorUserId,
        action: 'post_remove',
        targetType: 'post',
        targetId: input.targetPostId,
        metadata: {
            reason: input.reason,
            userId: input.userId || null,
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

    await writeAdminAudit({
        actorUserId: input.actorUserId,
        action: 'post_restore',
        targetType: 'post',
        targetId: input.targetPostId,
        metadata: {
            reason: input.reason,
            userId: input.userId || null,
        },
    });
}

export async function getAdminUserDetail(userId: string): Promise<AdminUserDetail> {
    const db = adminDb();
    const state = await getAdminStateRow(userId);
    const metadata = parseJson(state?.metadata);
    const directoryUser = await findDirectoryUser(userId);

    const [actionsRs, messagesRs] = await Promise.all([
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

    await upsertAdminState({
        userId: input.targetUserId,
        role: input.role || asString(state?.role) || 'user',
        isBanned: asBool(state?.is_banned),
        banReason: asString(state?.ban_reason) || null,
        bannedUntil: toIso(state?.banned_until),
    });

    await writeUserMetadata(input.targetUserId, nextMetadata);

    await writeAdminAudit({
        actorUserId: input.actorUserId,
        action: 'user_capabilities_set',
        targetType: 'user',
        targetId: input.targetUserId,
        metadata: {
            verification: nextMetadata.verification,
            restrictions: nextMetadata.restrictions,
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
}): Promise<{ messageId: string; status: string }> {
    const db = adminDb();
    const messageId = `admmsg_${crypto.randomBytes(8).toString('hex')}`;
    const channel = asString(input.channel) || 'in_app';

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
            JSON.stringify({ actorUserId: input.actorUserId }),
        ]
    );

    await writeAdminAudit({
        actorUserId: input.actorUserId,
        action: 'user_message_queued',
        targetType: 'user',
        targetId: input.targetUserId,
        metadata: {
            channel,
            messageId,
            subject: asString(input.subject || ''),
        },
    });

    return { messageId, status: 'queued' };
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
