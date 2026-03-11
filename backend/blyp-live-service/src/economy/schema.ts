import type { Knex } from 'knex';
import { logger } from '../config/logger';

let ensurePromise: Promise<void> | null = null;

function jsonbDefault(db: Knex, value: any) {
  return db.raw('?::jsonb', [JSON.stringify(value)]);
}

export async function ensureEconomySchema(db: Knex): Promise<void> {
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    // NOTE: This is a dev-safety bootstrap. It only creates tables if missing.
    // It is intentionally idempotent and does not drop/alter existing tables.

    // IMPORTANT: serialize schema creation across multiple Node processes.
    // Without this, concurrent startups can race between hasTable() and createTable(),
    // producing Postgres catalog errors like pg_type_typname_nsp_index duplicates.
    const lockKey1 = 4242;
    const lockKey2 = 9001;
    await db.raw('select pg_advisory_lock(?, ?)', [lockKey1, lockKey2]);

    try {
      // Knex's hasTable() has proven unreliable in this repo's dev loop (racy/misreported).
      // Use Postgres-native IF NOT EXISTS DDL for robust, idempotent bootstrapping.
      const ddl: string[] = [
        `CREATE TABLE IF NOT EXISTS wallets (
          user_id text PRIMARY KEY,
          coin_balance bigint NOT NULL DEFAULT 0,
          bonus_coin_balance bigint NOT NULL DEFAULT 0,
          gem_available bigint NOT NULL DEFAULT 0,
          gem_pending bigint NOT NULL DEFAULT 0,
          lifetime_spend_coins bigint NOT NULL DEFAULT 0,
          lifetime_earned_gems bigint NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,

        `CREATE TABLE IF NOT EXISTS ledger_entries (
          ledger_id text PRIMARY KEY,
          user_id text NOT NULL,
          entry_type text NOT NULL,
          currency text NOT NULL,
          amount bigint NOT NULL,
          status text NOT NULL,
          reference_type text,
          reference_id text,
          idempotency_key text UNIQUE,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,

        `CREATE TABLE IF NOT EXISTS iap_products (
          platform text NOT NULL,
          sku text NOT NULL,
          coins_granted bigint NOT NULL DEFAULT 0,
          enabled boolean NOT NULL DEFAULT true,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (platform, sku)
        )`,

        `CREATE TABLE IF NOT EXISTS gift_catalog (
          gift_id text PRIMARY KEY,
          name text NOT NULL,
          coin_cost bigint NOT NULL DEFAULT 0,
          enabled boolean NOT NULL DEFAULT true,
          rarity text NOT NULL DEFAULT 'common',
          min_level integer NOT NULL DEFAULT 0,
          cooldown_ms integer NOT NULL DEFAULT 0,
          asset_json jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,

        `CREATE TABLE IF NOT EXISTS stream_counters (
          stream_id text PRIMARY KEY,
          last_sequence bigint NOT NULL DEFAULT 0,
          updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,

        `CREATE TABLE IF NOT EXISTS gift_events (
          gift_event_id text PRIMARY KEY,
          stream_id text NOT NULL,
          sender_user_id text NOT NULL,
          receiver_user_id text NOT NULL,
          gift_id text NOT NULL,
          quantity integer NOT NULL DEFAULT 1,
          coin_cost bigint NOT NULL,
          gems_credited bigint NOT NULL DEFAULT 0,
          sequence_no bigint NOT NULL DEFAULT 0,
          idempotency_key text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (sender_user_id, idempotency_key)
        )`,

        `CREATE TABLE IF NOT EXISTS stream_earnings (
          stream_id text NOT NULL,
          creator_user_id text NOT NULL,
          coins_received bigint NOT NULL DEFAULT 0,
          gems_earned bigint NOT NULL DEFAULT 0,
          updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (stream_id, creator_user_id)
        )`,

        `CREATE TABLE IF NOT EXISTS promotions (
          promotion_id text PRIMARY KEY,
          user_id text NOT NULL,
          promotion_type text NOT NULL,
          status text NOT NULL,
          starts_at timestamptz NOT NULL,
          ends_at timestamptz NOT NULL,
          coin_cost bigint NOT NULL DEFAULT 0,
          idempotency_key text NOT NULL,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (user_id, idempotency_key)
        )`,

        `CREATE TABLE IF NOT EXISTS live_games (
          game_id text PRIMARY KEY,
          stream_id text NOT NULL,
          host_user_id text NOT NULL,
          status text NOT NULL,
          entry_fee_coins bigint NOT NULL DEFAULT 0,
          pool_coins bigint NOT NULL DEFAULT 0,
          idempotency_key text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          started_at timestamptz,
          ended_at timestamptz,
          updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (host_user_id, idempotency_key)
        )`,

        `CREATE TABLE IF NOT EXISTS live_game_entries (
          entry_id text PRIMARY KEY,
          game_id text NOT NULL,
          stream_id text NOT NULL,
          user_id text NOT NULL,
          coin_cost bigint NOT NULL DEFAULT 0,
          bonus_coin_cost bigint NOT NULL DEFAULT 0,
          idempotency_key text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (user_id, idempotency_key),
          UNIQUE (game_id, user_id)
        )`,

        `CREATE TABLE IF NOT EXISTS live_game_settlements (
          settlement_id text PRIMARY KEY,
          game_id text NOT NULL,
          stream_id text NOT NULL,
          host_user_id text NOT NULL,
          idempotency_key text NOT NULL,
          response_json jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (host_user_id, idempotency_key)
        )`,

        `CREATE TABLE IF NOT EXISTS user_admin_state (
          user_id text PRIMARY KEY,
          role text NOT NULL DEFAULT 'user',
          is_banned boolean NOT NULL DEFAULT false,
          ban_reason text,
          banned_until timestamptz,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,

        `CREATE TABLE IF NOT EXISTS admin_audit_log (
          audit_id bigserial PRIMARY KEY,
          actor_user_id text NOT NULL,
          action text NOT NULL,
          target_type text NOT NULL,
          target_id text NOT NULL,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,

        `CREATE TABLE IF NOT EXISTS subscription_plans (
          plan_id text PRIMARY KEY,
          plan_name text NOT NULL,
          price_cents integer NOT NULL DEFAULT 0,
          currency text NOT NULL DEFAULT 'USD',
          interval text NOT NULL DEFAULT 'month',
          coin_allowance bigint NOT NULL DEFAULT 0,
          enabled boolean NOT NULL DEFAULT true,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,

        `CREATE TABLE IF NOT EXISTS user_subscriptions (
          subscription_id text PRIMARY KEY,
          user_id text NOT NULL,
          plan_id text NOT NULL,
          status text NOT NULL DEFAULT 'inactive',
          provider text NOT NULL DEFAULT 'stripe',
          provider_subscription_id text,
          current_period_start timestamptz,
          current_period_end timestamptz,
          cancel_at_period_end boolean NOT NULL DEFAULT false,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (provider, provider_subscription_id)
        )`,

        `CREATE INDEX IF NOT EXISTS idx_ledger_entries_user_id ON ledger_entries (user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_ledger_user_created ON ledger_entries (user_id, created_at DESC, ledger_id DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_gift_events_stream_id ON gift_events (stream_id)`,
        `CREATE INDEX IF NOT EXISTS idx_gift_events_sender_user_id ON gift_events (sender_user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_gift_events_receiver_user_id ON gift_events (receiver_user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_promotions_user_id ON promotions (user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_live_games_stream_id ON live_games (stream_id)`,
        `CREATE INDEX IF NOT EXISTS idx_live_games_host_user_id ON live_games (host_user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_live_game_entries_game_id ON live_game_entries (game_id)`,
        `CREATE INDEX IF NOT EXISTS idx_live_game_entries_user_id ON live_game_entries (user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_user_admin_state_role ON user_admin_state (role)`,
        `CREATE INDEX IF NOT EXISTS idx_user_admin_state_is_banned ON user_admin_state (is_banned)`,
        `CREATE INDEX IF NOT EXISTS idx_admin_audit_actor_created ON admin_audit_log (actor_user_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_admin_audit_target_created ON admin_audit_log (target_type, target_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_status ON user_subscriptions (user_id, status)`,
      ];

      for (const stmt of ddl) {
        await db.raw(stmt);
      }

      // Seed gift catalog if empty (so gifting works immediately in local dev)
      try {
        // If the table doesn't exist (for any unexpected reason), don't crash startup.
        const existsRow = await db.raw("select to_regclass('public.gift_catalog') is not null as ok");
        const exists = Boolean((existsRow as any)?.rows?.[0]?.ok);
        if (!exists) {
          logger.warn('[economy-schema] gift_catalog missing after ensure; skipping seed');
        } else {
          const row = await db('gift_catalog').count<{ count: string }[]>({ count: '*' }).first();
          const count = Number((row as any)?.count ?? 0);
          if (!Number.isFinite(count) || count === 0) {
            await db('gift_catalog')
              .insert([
                { gift_id: 'heart', name: 'Heart', coin_cost: 1, enabled: true, rarity: 'common', min_level: 0, cooldown_ms: 0, asset_json: { emoji: '❤️' } },
                { gift_id: 'thumbsup', name: 'Thumbs Up', coin_cost: 2, enabled: true, rarity: 'common', min_level: 0, cooldown_ms: 0, asset_json: { emoji: '👍' } },
                { gift_id: 'clap', name: 'Clap', coin_cost: 5, enabled: true, rarity: 'common', min_level: 0, cooldown_ms: 0, asset_json: { emoji: '👏' } },
                { gift_id: 'fire', name: 'Fire', coin_cost: 10, enabled: true, rarity: 'rare', min_level: 0, cooldown_ms: 0, asset_json: { emoji: '🔥' } },
                { gift_id: 'star', name: 'Star', coin_cost: 15, enabled: true, rarity: 'rare', min_level: 0, cooldown_ms: 0, asset_json: { emoji: '⭐' } },
                { gift_id: 'diamond', name: 'Diamond', coin_cost: 25, enabled: true, rarity: 'epic', min_level: 0, cooldown_ms: 0, asset_json: { emoji: '💎' } },
                { gift_id: 'crown', name: 'Crown', coin_cost: 50, enabled: true, rarity: 'legendary', min_level: 0, cooldown_ms: 0, asset_json: { emoji: '👑' } },
                { gift_id: 'rocket', name: 'Rocket', coin_cost: 100, enabled: true, rarity: 'legendary', min_level: 0, cooldown_ms: 0, asset_json: { emoji: '🚀' } },
              ])
              .onConflict('gift_id')
              .ignore();
          }
        }
      } catch (e: any) {
        logger.warn({ err: e?.message || String(e) }, '[economy-schema] seed gift_catalog failed');
      }

      logger.info('[economy-schema] ensured');
    } finally {
      await db.raw('select pg_advisory_unlock(?, ?)', [lockKey1, lockKey2]).catch(() => undefined);
    }
  })().catch((err) => {
    // Reset so a later call can retry.
    ensurePromise = null;
    throw err;
  });

  return ensurePromise;
}
