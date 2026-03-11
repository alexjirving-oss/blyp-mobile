import type { Knex } from 'knex';
import { getEconomyInfra } from '../economy/infra';
import { checkDb, checkRedis } from '../economy/infra';

export type AdminUserRow = {
    userId: string;
    role: string;
    isBanned: boolean;
    banReason: string | null;
    bannedUntil: string | null;
    createdAt: string | null;
    updatedAt: string | null;
};

function adminDb(): Knex {
    return getEconomyInfra().db;
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

async function tableHasAnyColumn(db: Knex, table: string, columns: string[]): Promise<boolean> {
    if (!columns.length) return false;
    const placeholders = columns.map(() => '?').join(', ');
    const rs = await db.raw(
        `
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ?
          AND column_name IN (${placeholders})
        LIMIT 1
        `,
        [table, ...columns]
    );
    return Boolean((rs as any)?.rows?.[0]);
}

function sqlIdent(name: string): string {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
        throw new Error(`Unsafe SQL identifier: ${name}`);
    }
    return `"${name}"`;
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
    const db = adminDb();
    const userIdsCte = await buildUserIdsCte(db);
    const q = (input.q || '').trim();
    const like = `%${q}%`;

    const usersSql = `
    ${userIdsCte}
    SELECT
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
            AND (? = '' OR ids.user_id ILIKE ?)
    ORDER BY ids.user_id ASC
    LIMIT ? OFFSET ?
  `;

    const countSql = `
        ${userIdsCte}
    SELECT COUNT(*)::bigint AS total
    FROM ids
        WHERE ids.user_id IS NOT NULL
            AND ids.user_id <> ''
            AND (? = '' OR ids.user_id ILIKE ?)
  `;

    const [usersRs, countRs] = await Promise.all([
        db.raw(usersSql, [q, like, input.limit, input.offset]),
        db.raw(countSql, [q, like]),
    ]);

    const rows = ((usersRs as any)?.rows || []) as Array<any>;
    const items: AdminUserRow[] = rows.map((r) => ({
        userId: String(r.user_id),
        role: String(r.role || 'user'),
        isBanned: Boolean(r.is_banned),
        banReason: r.ban_reason ? String(r.ban_reason) : null,
        bannedUntil: r.banned_until ? new Date(r.banned_until).toISOString() : null,
        createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
        updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
    }));

    const total = Number(((countRs as any)?.rows?.[0]?.total) || 0);
    return { items, total, limit: input.limit, offset: input.offset };
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

export type AdminUserPostRow = {
    postId: string;
    userId: string;
    postType: string | null;
    content: string | null;
    likeCount: number;
    commentCount: number;
    isRemoved: boolean;
    removedReason: string | null;
    removedByUserId: string | null;
    removedAt: string | null;
    createdAt: string | null;
    updatedAt: string | null;
};

type ResolvedPostSource = {
    table: string;
    userCol: string;
    idCol: string;
    typeCol: string | null;
    contentCol: string | null;
    likeCol: string | null;
    commentCol: string | null;
    createdCol: string | null;
    updatedCol: string | null;
};

const POST_TABLE_PREFERENCES = [
    'posts',
    'user_posts',
    'feed_posts',
    'videos',
    'user_videos',
    'content_posts',
    'creator_posts',
    'social_posts',
    'timeline_posts',
    'for_you_posts',
];

const POST_USER_COLS = ['user_id', 'author_user_id', 'creator_user_id', 'owner_user_id', 'uid'];
const POST_ID_COLS = ['post_id', 'id', 'content_id', 'video_id', 'item_id'];
const POST_TYPE_COLS = ['post_type', 'type', 'media_type', 'kind'];
const POST_CONTENT_COLS = ['content', 'caption', 'text', 'description', 'body', 'title'];
const POST_LIKE_COLS = ['like_count', 'likes_count', 'likes', 'heart_count'];
const POST_COMMENT_COLS = ['comment_count', 'comments_count', 'comments', 'reply_count'];
const POST_CREATED_COLS = ['created_at', 'posted_at', 'published_at', 'timestamp'];
const POST_UPDATED_COLS = ['updated_at', 'modified_at', 'last_updated_at'];

function pickFirst(columns: Set<string>, preferences: string[]): string | null {
    for (const c of preferences) {
        if (columns.has(c)) return c;
    }
    return null;
}

function scorePostTable(table: string, cols: Set<string>): number {
    let score = 0;
    const prefIdx = POST_TABLE_PREFERENCES.indexOf(table);
    if (prefIdx >= 0) score += 200 - prefIdx;
    if (table.includes('post')) score += 50;
    if (table.includes('video')) score += 30;
    if (pickFirst(cols, POST_USER_COLS)) score += 25;
    if (pickFirst(cols, POST_ID_COLS)) score += 25;
    if (pickFirst(cols, POST_CONTENT_COLS)) score += 12;
    if (pickFirst(cols, POST_CREATED_COLS) || pickFirst(cols, POST_UPDATED_COLS)) score += 8;
    return score;
}

async function resolvePostsTableColumns(db: Knex): Promise<ResolvedPostSource | null> {
    const allColumns = [
        ...POST_USER_COLS,
        ...POST_ID_COLS,
        ...POST_TYPE_COLS,
        ...POST_CONTENT_COLS,
        ...POST_LIKE_COLS,
        ...POST_COMMENT_COLS,
        ...POST_CREATED_COLS,
        ...POST_UPDATED_COLS,
    ];

    const placeholders = allColumns.map(() => '?').join(', ');
    const rs = await db.raw(
        `
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name IN (${placeholders})
        `,
        allColumns
    );

    const rows = ((rs as any)?.rows || []) as Array<{ table_name: string; column_name: string }>;
    if (!rows.length) return null;

    const tableCols = new Map<string, Set<string>>();
    for (const r of rows) {
        const t = String(r.table_name || '').trim();
        const c = String(r.column_name || '').trim();
        if (!t || !c) continue;
        if (!tableCols.has(t)) tableCols.set(t, new Set<string>());
        tableCols.get(t)!.add(c);
    }

    const candidates: Array<{ table: string; cols: Set<string>; score: number }> = [];
    for (const [table, cols] of tableCols.entries()) {
        const userCol = pickFirst(cols, POST_USER_COLS);
        const idCol = pickFirst(cols, POST_ID_COLS);
        if (!userCol || !idCol) continue;
        candidates.push({ table, cols, score: scorePostTable(table, cols) });
    }

    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    return {
        table: best.table,
        userCol: pickFirst(best.cols, POST_USER_COLS)!,
        idCol: pickFirst(best.cols, POST_ID_COLS)!,
        typeCol: pickFirst(best.cols, POST_TYPE_COLS),
        contentCol: pickFirst(best.cols, POST_CONTENT_COLS),
        likeCol: pickFirst(best.cols, POST_LIKE_COLS),
        commentCol: pickFirst(best.cols, POST_COMMENT_COLS),
        createdCol: pickFirst(best.cols, POST_CREATED_COLS),
        updatedCol: pickFirst(best.cols, POST_UPDATED_COLS),
    };
}

async function ensurePostAdminStateTable(db: Knex): Promise<void> {
    await db.raw(
        `
        CREATE TABLE IF NOT EXISTS post_admin_state (
          post_id text PRIMARY KEY,
          is_removed boolean NOT NULL DEFAULT false,
          removed_reason text,
          removed_by_user_id text,
          removed_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        `
    );

    await db.raw(
        `CREATE INDEX IF NOT EXISTS idx_post_admin_state_removed ON post_admin_state (is_removed, updated_at DESC)`
    );
}

export async function listAdminUserPosts(input: {
    userId: string;
    q?: string;
    limit: number;
    offset: number;
}): Promise<{ items: AdminUserPostRow[]; total: number; limit: number; offset: number; degraded?: boolean; detail?: string }> {
    const db = adminDb();
    const q = String(input.q || '').trim();
    const like = `%${q}%`;

    const source = await resolvePostsTableColumns(db);
    if (!source) {
        return {
            items: [],
            total: 0,
            limit: input.limit,
            offset: input.offset,
            degraded: true,
            detail: 'No supported posts table found (searched all public tables for post-like schemas with user and id columns).',
        };
    }

    const table = sqlIdent(source.table);
    const userCol = sqlIdent(source.userCol);
    const idCol = sqlIdent(source.idCol);
    const typeExpr = source.typeCol ? `p.${sqlIdent(source.typeCol)}` : 'NULL::text';
    const contentExpr = source.contentCol ? `p.${sqlIdent(source.contentCol)}` : 'NULL::text';
    const likeExpr = source.likeCol ? `COALESCE(p.${sqlIdent(source.likeCol)}, 0)` : '0';
    const commentExpr = source.commentCol ? `COALESCE(p.${sqlIdent(source.commentCol)}, 0)` : '0';
    const createdExpr = source.createdCol ? `p.${sqlIdent(source.createdCol)}` : 'NULL::timestamptz';
    const updatedExpr = source.updatedCol
        ? `p.${sqlIdent(source.updatedCol)}`
        : source.createdCol
            ? `p.${sqlIdent(source.createdCol)}`
            : 'NULL::timestamptz';
    const orderExpr = source.updatedCol
        ? `p.${sqlIdent(source.updatedCol)}`
        : source.createdCol
            ? `p.${sqlIdent(source.createdCol)}`
            : `p.${idCol}`;

    const listSql = `
        SELECT
          p.${idCol} AS post_id,
          p.${userCol} AS user_id,
          ${typeExpr} AS post_type,
          ${contentExpr} AS content_text,
          ${likeExpr}::bigint AS like_count,
          ${commentExpr}::bigint AS comment_count,
          COALESCE(s.is_removed, false) AS is_removed,
          s.removed_reason,
          s.removed_by_user_id,
          s.removed_at,
          ${createdExpr} AS created_at,
          ${updatedExpr} AS updated_at
        FROM ${table} p
        LEFT JOIN post_admin_state s ON s.post_id = CAST(p.${idCol} AS text)
        WHERE CAST(p.${userCol} AS text) = ?
          AND (? = '' OR CAST(p.${idCol} AS text) ILIKE ? OR CAST(COALESCE(${contentExpr}, '') AS text) ILIKE ?)
        ORDER BY ${orderExpr} DESC NULLS LAST
        LIMIT ? OFFSET ?
    `;

    const countSql = `
        SELECT COUNT(*)::bigint AS total
        FROM ${table} p
        WHERE CAST(p.${userCol} AS text) = ?
          AND (? = '' OR CAST(p.${idCol} AS text) ILIKE ? OR CAST(COALESCE(${contentExpr}, '') AS text) ILIKE ?)
    `;

    try {
        const [listRs, countRs] = await Promise.all([
            db.raw(listSql, [input.userId, q, like, like, input.limit, input.offset]),
            db.raw(countSql, [input.userId, q, like, like]),
        ]);

        const rows = ((listRs as any)?.rows || []) as Array<any>;
        const items: AdminUserPostRow[] = rows.map((r) => ({
            postId: String(r.post_id),
            userId: String(r.user_id || input.userId),
            postType: r.post_type ? String(r.post_type) : null,
            content: r.content_text ? String(r.content_text) : null,
            likeCount: Number(r.like_count || 0),
            commentCount: Number(r.comment_count || 0),
            isRemoved: Boolean(r.is_removed),
            removedReason: r.removed_reason ? String(r.removed_reason) : null,
            removedByUserId: r.removed_by_user_id ? String(r.removed_by_user_id) : null,
            removedAt: r.removed_at ? new Date(r.removed_at).toISOString() : null,
            createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
            updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
        }));

        const total = Number(((countRs as any)?.rows?.[0]?.total) || 0);
        return { items, total, limit: input.limit, offset: input.offset };
    } catch (e: any) {
        return {
            items: [],
            total: 0,
            limit: input.limit,
            offset: input.offset,
            degraded: true,
            detail: `Post list degraded: ${e?.message || String(e)} (source table: ${source.table})`,
        };
    }
}

export async function removePostByAdmin(input: {
    actorUserId: string;
    targetPostId: string;
    userId?: string;
    reason: string | null;
}): Promise<void> {
    const db = adminDb();
    await ensurePostAdminStateTable(db);

    await db.raw(
        `
        INSERT INTO post_admin_state (post_id, is_removed, removed_reason, removed_by_user_id, removed_at)
        VALUES (?, true, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT (post_id)
        DO UPDATE SET
          is_removed = true,
          removed_reason = EXCLUDED.removed_reason,
          removed_by_user_id = EXCLUDED.removed_by_user_id,
          removed_at = EXCLUDED.removed_at,
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
            userId: input.userId || null,
            reason: input.reason,
        },
    });
}

export async function restorePostByAdmin(input: {
    actorUserId: string;
    targetPostId: string;
    userId?: string;
    reason: string | null;
}): Promise<void> {
    const db = adminDb();
    await ensurePostAdminStateTable(db);

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
            userId: input.userId || null,
            reason: input.reason,
        },
    });
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
