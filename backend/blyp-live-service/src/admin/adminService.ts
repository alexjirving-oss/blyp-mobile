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
            AND ($1 = '' OR ids.user_id ILIKE $2)
    ORDER BY ids.user_id ASC
    LIMIT $3 OFFSET $4
  `;

        const countSql = `
        ${userIdsCte}
    SELECT COUNT(*)::bigint AS total
    FROM ids
        WHERE ids.user_id IS NOT NULL
            AND ids.user_id <> ''
            AND ($1 = '' OR ids.user_id ILIKE $2)
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
    VALUES ($1, COALESCE($2, 'user'), $3, $4, $5)
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
    VALUES ($1, $2, $3, $4, $5::jsonb)
    `,
        [input.actorUserId, input.action, input.targetType, input.targetId, JSON.stringify(input.metadata || {})]
    );
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
