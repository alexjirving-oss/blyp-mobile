import crypto from 'crypto';
import type { Knex } from 'knex';
import { checkDb, checkRedis, getEconomyInfra } from '../economy/infra';
import { getAdminFirestore } from '../config/firebaseAdmin';
import { logger } from '../config/logger';
import { findDirectoryUser, listDirectoryUsers, type DirectoryUser } from './adminCognitoDirectory';

// Keep UUID-shape validation for Cognito subs while accepting observed variant nibble values.
const COGNITO_SUB_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    photoURL?: string;
    avatarUrl?: string;
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

function isCanonicalSubUserId(value: unknown): boolean {
    const s = asString(value);
    return COGNITO_SUB_REGEX.test(s);
}

function toTrimmedString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed || null;
}

const PLACEHOLDER_NAMES = new Set(['anonymous', 'anonymous user', 'anon']);

function isPlaceholderName(value: unknown): boolean {
    const trimmed = toTrimmedString(value);
    if (!trimmed) return true;
    return PLACEHOLDER_NAMES.has(trimmed.replace(/^@+/, '').toLowerCase());
}

function pickBestProfileNameFromUserDoc(userDocData: any, userId: string): { username: string | null; displayName: string } {
    const username = toTrimmedString(userDocData?.username || userDocData?.handle || userDocData?.userName);
    const displayName = toTrimmedString(userDocData?.displayName || userDocData?.userName || userDocData?.name);

    if (username && !isPlaceholderName(username) && username !== userId) {
        return { username, displayName: username };
    }

    if (displayName && !isPlaceholderName(displayName) && displayName !== userId) {
        return { username: null, displayName };
    }

    return { username: null, displayName: userId };
}

type AdminFirestoreUserProfile = {
    username: string | null;
    displayName: string | null;
    email: string | null;
    photoURL: string | null;
    createdAt: string | null;
    updatedAt: string | null;
};

function pickIdentityFromPostDoc(postData: any, userId: string): { username: string | null; displayName: string | null; photoURL: string | null } {
    const username = toTrimmedString(postData?.username || postData?.handle || postData?.userName);
    const displayName = toTrimmedString(postData?.displayName || postData?.userName || postData?.userName || postData?.name);
    const photoURL = toTrimmedString(
        postData?.userPhotoURL || postData?.photoURL || postData?.photoUrl || postData?.avatarUrl || postData?.profileImageUrl || postData?.imageUrl
    );

    const safeUsername = username && !isPlaceholderName(username) && username !== userId ? username : null;
    const safeDisplayName = displayName && !isPlaceholderName(displayName) && displayName !== userId ? displayName : null;

    return {
        username: safeUsername,
        displayName: safeUsername || safeDisplayName,
        photoURL,
    };
}

function firestoreTimestampToIso(value: any): string | null {
    if (!value) return null;
    try {
        if (typeof value?.toDate === 'function') {
            return value.toDate().toISOString();
        }
        return toIso(value);
    } catch {
        return null;
    }
}

async function getFirestoreUserProfile(userId: string, directoryUser: DirectoryUser | null): Promise<AdminFirestoreUserProfile | null> {
    const firestore = getAdminFirestore();
    if (!firestore) return null;

    const candidateDocIds = Array.from(new Set([
        userId,
        directoryUser?.username || '',
        directoryUser?.email || '',
    ].map((value) => String(value || '').trim()).filter(Boolean)));

    for (const docId of candidateDocIds) {
        try {
            const snap = await firestore.collection('users').doc(docId).get();
            if (!snap.exists) continue;
            const userData = snap.data() || {};
            const picked = pickBestProfileNameFromUserDoc(userData, userId);
            return {
                username: picked.username,
                displayName: picked.displayName,
                email: toTrimmedString(userData.email),
                photoURL: toTrimmedString(
                    userData.photoURL || userData.photoUrl || userData.avatarUrl || userData.profileImageUrl || userData.imageUrl
                ),
                createdAt: firestoreTimestampToIso(userData.createdAt),
                updatedAt: firestoreTimestampToIso(userData.updatedAt),
            };
        } catch (error: any) {
            logger.warn({ err: error?.message || String(error), userId, docId }, '[admin] getAdminUserDetail: firestore user profile lookup failed');
        }
    }

    // Fallback: some older accounts carry display identity fields on post documents.
    try {
        const postSnap = await firestore.collection('posts').where('userId', '==', userId).limit(1).get();
        if (!postSnap.empty) {
            const postData = postSnap.docs[0]?.data() || {};
            const picked = pickIdentityFromPostDoc(postData, userId);
            if (picked.displayName || picked.username || picked.photoURL) {
                return {
                    username: picked.username,
                    displayName: picked.displayName,
                    email: null,
                    photoURL: picked.photoURL,
                    createdAt: null,
                    updatedAt: null,
                };
            }
        }
    } catch (error: any) {
        logger.warn({ err: error?.message || String(error), userId }, '[admin] getAdminUserDetail: firestore posts fallback lookup failed');
    }

    return null;
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

const LINKED_DIRECTORY_STATUSES = new Set([
    'CONFIRMED',
    'EXTERNAL_PROVIDER',
    'FORCE_CHANGE_PASSWORD',
    'RESET_REQUIRED',
]);

function normalizeDirectoryStatus(value: unknown): string {
    return asString(value).toUpperCase();
}

function isAppLinkedDirectoryUser(user: DirectoryUser): boolean {
    if (!asString(user.userId)) {
        return false;
    }
    if (user.enabled === false) {
        return false;
    }

    const status = normalizeDirectoryStatus(user.userStatus);
    if (!status) {
        return true;
    }

    return LINKED_DIRECTORY_STATUSES.has(status);
}

function buildVisibleAdminUsers(sqlUsers: AdminUserRow[], directoryUsers: DirectoryUser[]): AdminUserRow[] {
    const sqlUsersById = new Map<string, AdminUserRow>();
    for (const row of sqlUsers) {
        sqlUsersById.set(row.userId, row);
    }

    const mergedFromDirectory = directoryUsers
        .filter(isAppLinkedDirectoryUser)
        .map((directoryUser) => mergeUserRowWithDirectory(sqlUsersById.get(directoryUser.userId) || null, directoryUser));

    const mergedIds = new Set(mergedFromDirectory.map((row) => row.userId));
    const sqlOnlyUsers = sqlUsers
        .filter((row) => row.userId && isCanonicalSubUserId(row.userId) && !mergedIds.has(row.userId))
        .map((row) => mergeUserRowWithDirectory(row, null));

    return [...mergedFromDirectory, ...sqlOnlyUsers];
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

    const baseVisibleUsers = buildVisibleAdminUsers(sqlUsers, directoryUsers);
    const merged = baseVisibleUsers
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

function isExcludedPostSourceTable(tableName: string): boolean {
    return /(flag|admin|state|audit|warning|report|restriction|message|moderat)/i.test(tableName || '');
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
        .filter((r: TableRef) => r.schema && r.table)
        .filter((r: TableRef) => !isExcludedPostSourceTable(r.table));

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

function toMillisFromUnknown(value: any): number {
    if (!value) return 0;
    try {
        if (typeof value?.toDate === 'function') {
            const d = value.toDate();
            return d instanceof Date ? d.getTime() : 0;
        }
        if (value instanceof Date) return value.getTime();
        if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
        if (typeof value === 'string') {
            const t = Date.parse(value);
            return Number.isFinite(t) ? t : 0;
        }
        if (typeof value === 'object') {
            const seconds = Number(value.seconds ?? value._seconds ?? 0);
            const nanos = Number(value.nanoseconds ?? value._nanoseconds ?? 0);
            if (Number.isFinite(seconds) && seconds > 0) {
                return seconds * 1000 + Math.floor((Number.isFinite(nanos) ? nanos : 0) / 1_000_000);
            }
        }
    } catch {
        return 0;
    }
    return 0;
}

function pickStringFrom(value: any): string {
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = pickStringFrom(item);
            if (found) return found;
        }
    }
    if (value && typeof value === 'object') {
        const candidates = [
            value.url,
            value.uri,
            value.src,
            value.imageUrl,
            value.videoUrl,
            value.mediaUrl,
            value.thumbnailUrl,
            value.thumbnail,
        ];
        for (const c of candidates) {
            const found = pickStringFrom(c);
            if (found) return found;
        }
    }
    return '';
}

async function listAdminUserPostsFromFirestore(input: { userId: string; q?: string; limit: number; offset: number }): Promise<{ items: PostListItem[]; total: number; limit: number; offset: number; sourceTable?: string; degraded?: boolean; detail?: string }> {
    const firestore = getAdminFirestore();
    if (!firestore) {
        return {
            items: [],
            total: 0,
            limit: input.limit,
            offset: input.offset,
            degraded: true,
            detail: 'No supported SQL posts table found and Firestore admin is not configured.',
        };
    }

    const q = asString(input.q || '').toLowerCase();
    // Keep Firestore reads bounded for admin paging to avoid loading an entire user history on each request.
    const boundedFetchSize = Math.max(input.limit + input.offset, input.limit, 25);
    const snap = await firestore
        .collection('posts')
        .where('userId', '==', input.userId)
        .limit(boundedFetchSize)
        .get();
    const docs = snap.docs.map((docSnap) => {
        const data = (docSnap.data() || {}) as Record<string, any>;
        const content = asString(data.content || data.text || data.caption || data.description || data.title);
        const postType = asString(data.postType || data.type || data.kind) || 'post';
        const mediaUrl = asString(data.mediaUrl || data.imageUrl || data.image || pickStringFrom(data.media));
        const videoUrl = asString(data.videoUrl || data.streamUrl || data.playbackUrl);
        const thumbnailUrl = asString(data.thumbnailUrl || data.thumbUrl || data.previewUrl || data.coverUrl || data.imageUrl);
        const createdAtRaw = data.date || data.createdAt || data.created_at || data.timestamp;
        const updatedAtRaw = data.updatedAt || data.updated_at || createdAtRaw;

        return {
            postId: asString(data.postId || data.id) || docSnap.id,
            userId: asString(data.userId) || input.userId,
            content,
            createdAt: toIso(createdAtRaw),
            updatedAt: toIso(updatedAtRaw),
            _createdMs: toMillisFromUnknown(createdAtRaw),
            postType,
            mediaUrl: mediaUrl || null,
            videoUrl: videoUrl || null,
            thumbnailUrl: thumbnailUrl || null,
        };
    });

    const filtered = docs
        .filter((d) => !q || d.content.toLowerCase().includes(q) || d.postId.toLowerCase().includes(q))
        .sort((a, b) => b._createdMs - a._createdMs);

    let total = filtered.length;
    try {
        const aggregate = await firestore.collection('posts').where('userId', '==', input.userId).count().get();
        const aggregateCount = Number(aggregate.data()?.count || 0);
        if (Number.isFinite(aggregateCount) && aggregateCount >= 0) {
            total = aggregateCount;
        }
    } catch {
        // If aggregate count isn't available, fall back to bounded fetch count.
    }

    const paged = filtered.slice(input.offset, input.offset + input.limit);

    const moderationByPostId = new Map<string, { isRemoved: boolean; removedReason: string | null; removedAt: string | null }>();
    const postIds = paged.map((p) => p.postId).filter(Boolean);
    if (postIds.length > 0) {
        try {
            const rows = await adminDb()('post_admin_state')
                .select('post_id', 'is_removed', 'removed_reason', 'removed_at')
                .whereIn('post_id', postIds as string[]);
            for (const row of rows as Array<any>) {
                moderationByPostId.set(String(row.post_id), {
                    isRemoved: asBool(row.is_removed),
                    removedReason: asString(row.removed_reason) || null,
                    removedAt: toIso(row.removed_at),
                });
            }
        } catch {
            // If moderation table read fails, keep posts visible with default moderation state.
        }
    }

    const items: PostListItem[] = paged.map((p) => {
        const m = moderationByPostId.get(p.postId);
        return {
            postId: p.postId,
            userId: p.userId,
            content: p.content,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
            postType: p.postType,
            mediaUrl: p.mediaUrl,
            videoUrl: p.videoUrl,
            thumbnailUrl: p.thumbnailUrl,
            isRemoved: m?.isRemoved === true,
            removedReason: m?.removedReason || null,
            removedAt: m?.removedAt || null,
        };
    });

    return {
        items,
        total,
        limit: input.limit,
        offset: input.offset,
        sourceTable: 'firestore.posts',
    };
}

export async function listAdminUserPosts(input: { userId: string; q?: string; limit: number; offset: number }): Promise<{ items: PostListItem[]; total: number; limit: number; offset: number; sourceTable?: string; degraded?: boolean; detail?: string }> {
    const db = adminDb();
    const source = await resolvePostSource(db);
    if (!source) {
        return listAdminUserPostsFromFirestore(input);
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
    let state: any | null = null;
    try {
        state = await getAdminStateRow(userId);
    } catch (error: any) {
        logger.warn({ err: error?.message || String(error), userId }, '[admin] getAdminUserDetail: user_admin_state unavailable');
    }
    const metadata = parseJson(state?.metadata);
    let directoryUser: DirectoryUser | null = null;
    try {
        directoryUser = await findDirectoryUser(userId);
    } catch (error: any) {
        logger.warn({ err: error?.message || String(error), userId }, '[admin] getAdminUserDetail: directory lookup failed');
    }

    let firestoreProfile: AdminFirestoreUserProfile | null = null;
    try {
        firestoreProfile = await getFirestoreUserProfile(userId, directoryUser);
    } catch (error: any) {
        logger.warn({ err: error?.message || String(error), userId }, '[admin] getAdminUserDetail: firestore user profile fetch failed');
    }

    let actionsRs: any = { rows: [] };
    let messagesRs: any = { rows: [] };

    try {
        if (await hasTable(db, 'admin_audit_log')) {
            actionsRs = await db.raw(
                `
                SELECT action, target_type, target_id, metadata, created_at
                FROM admin_audit_log
                WHERE target_type = 'user' AND target_id = ?
                ORDER BY created_at DESC
                LIMIT 20
                `,
                [userId]
            );
        }
    } catch (error: any) {
        logger.warn({ err: error?.message || String(error), userId }, '[admin] getAdminUserDetail: audit log query failed');
    }

    try {
        if (await hasTable(db, 'admin_user_messages')) {
            messagesRs = await db.raw(
                `
                SELECT message_id, channel, status, subject, body, created_at
                FROM admin_user_messages
                WHERE target_user_id = ?
                ORDER BY created_at DESC
                LIMIT 20
                `,
                [userId]
            );
        }
    } catch (error: any) {
        logger.warn({ err: error?.message || String(error), userId }, '[admin] getAdminUserDetail: user messages query failed');
    }

    const inferredEmail = firestoreProfile?.email || directoryUser?.email || (userId.includes('@') ? userId : '');
    const inferredUsername = firestoreProfile?.username || directoryUser?.username || (inferredEmail ? inferredEmail.split('@')[0] : '');
    const inferredDisplayName = firestoreProfile?.displayName || directoryUser?.displayName || inferredUsername || inferredEmail || userId;
    const inferredPhotoURL = firestoreProfile?.photoURL || null;

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
        username: inferredUsername,
        email: inferredEmail,
        phoneNumber: directoryUser?.phoneNumber || '',
        displayName: inferredDisplayName,
        photoURL: inferredPhotoURL || undefined,
        avatarUrl: inferredPhotoURL || undefined,
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
        createdAt: toIso(state?.created_at) || firestoreProfile?.createdAt || directoryUser?.createdAt || null,
        updatedAt: toIso(state?.updated_at) || firestoreProfile?.updatedAt || directoryUser?.updatedAt || null,
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
        INSERT INTO admin_user_messages (message_id, actor_user_id, target_user_id, channel, status, subject, body, metadata)
        VALUES (?, ?, ?, ?, 'queued', ?, ?, ?::jsonb)
        `,
        [
            messageId,
            input.actorUserId,
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

    const sql = `
    SELECT
      (SELECT COALESCE(SUM(coin_balance + bonus_coin_balance), 0)::bigint FROM wallets) AS total_coin_supply,
      (SELECT COUNT(*)::bigint FROM gift_events WHERE created_at >= NOW() - INTERVAL '24 hours') AS gifts_24h,
      (SELECT COUNT(*)::bigint FROM ledger_entries WHERE created_at >= NOW() - INTERVAL '24 hours') AS ledger_entries_24h,
      (SELECT COUNT(*)::bigint FROM user_subscriptions WHERE status = 'active') AS active_subscriptions
  `;

    try {
        const [rs, sqlUsers, directoryUsers] = await Promise.all([
            db.raw(sql),
            listSqlKnownUsers(),
            listDirectoryUsers(),
        ]);
        const row = ((rs as any)?.rows?.[0] || {}) as Record<string, unknown>;
        const visibleUsers = buildVisibleAdminUsers(sqlUsers, directoryUsers);

        return {
            totalUsers: visibleUsers.length,
            bannedUsers: visibleUsers.filter((user) => user.isBanned).length,
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
