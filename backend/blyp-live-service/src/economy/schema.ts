import type { Knex } from 'knex';
import { logger } from '../config/logger';
import { IAP_CATALOG } from './iapCatalog';

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

        // Team earnings: per (team, member) precise accrual of the team coin/gem
        // bonus. Members earn an extra 10% of their base gems; the team leader
        // earns 5% of each member's base gems. Wallet credits are whole gems, so
        // we accrue in micro-gems (1 gem = 1_000_000 micro) and credit the floor,
        // carrying the fractional remainder forward — this makes the 2.5-gem-type
        // cuts exact over time instead of being lost to rounding.
        `CREATE TABLE IF NOT EXISTS team_earnings (
          team_id text NOT NULL,
          member_user_id text NOT NULL,
          leader_user_id text NOT NULL,
          coins_received bigint NOT NULL DEFAULT 0,
          base_gems bigint NOT NULL DEFAULT 0,
          member_bonus_micro bigint NOT NULL DEFAULT 0,
          member_bonus_paid bigint NOT NULL DEFAULT 0,
          leader_bonus_micro bigint NOT NULL DEFAULT 0,
          leader_bonus_paid bigint NOT NULL DEFAULT 0,
          updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (team_id, member_user_id)
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

        `CREATE TABLE IF NOT EXISTS matchday_entitlements (
          entitlement_id text PRIMARY KEY,
          user_id text NOT NULL,
          event_id text NOT NULL,
          status text NOT NULL,
          coin_cost bigint NOT NULL DEFAULT 0,
          expires_at timestamptz,
          idempotency_key text NOT NULL,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (user_id, event_id),
          UNIQUE (user_id, idempotency_key)
        )`,

        `CREATE TABLE IF NOT EXISTS matchday_predictions (
          prediction_id text PRIMARY KEY,
          user_id text NOT NULL,
          event_id text NOT NULL,
          market text NOT NULL,
          selection text NOT NULL,
          stake_coins bigint NOT NULL DEFAULT 0,
          status text NOT NULL,
          payout_coins bigint NOT NULL DEFAULT 0,
          idempotency_key text NOT NULL,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          settled_at timestamptz,
          UNIQUE (user_id, idempotency_key),
          UNIQUE (user_id, event_id, market)
        )`,

        `CREATE TABLE IF NOT EXISTS matchday_settlements (
          settlement_id text PRIMARY KEY,
          event_id text NOT NULL UNIQUE,
          settled_by text NOT NULL,
          idempotency_key text NOT NULL,
          response_json jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,

        `CREATE TABLE IF NOT EXISTS battle_escrows (
          battle_id text PRIMARY KEY,
          creator_uid text NOT NULL,
          opponent_uid text NOT NULL,
          stake_coins bigint NOT NULL DEFAULT 0,
          pool_coins bigint NOT NULL DEFAULT 0,
          creator_paid boolean NOT NULL DEFAULT false,
          opponent_paid boolean NOT NULL DEFAULT false,
          creator_paid_coins bigint NOT NULL DEFAULT 0,
          opponent_paid_coins bigint NOT NULL DEFAULT 0,
          creator_joined boolean NOT NULL DEFAULT false,
          opponent_joined boolean NOT NULL DEFAULT false,
          status text NOT NULL DEFAULT 'OPEN',
          settlement_json jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,

        `CREATE TABLE IF NOT EXISTS payout_accounts (
          user_id text PRIMARY KEY,
          stripe_account_id text NOT NULL UNIQUE,
          payouts_enabled boolean NOT NULL DEFAULT false,
          details_submitted boolean NOT NULL DEFAULT false,
          charges_enabled boolean NOT NULL DEFAULT false,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,

        `CREATE TABLE IF NOT EXISTS withdrawal_requests (
          withdrawal_id text PRIMARY KEY,
          user_id text NOT NULL,
          amount_gems bigint NOT NULL,
          fee_gems bigint NOT NULL DEFAULT 0,
          net_gems bigint NOT NULL,
          gross_minor bigint NOT NULL,
          fee_minor bigint NOT NULL,
          net_minor bigint NOT NULL,
          currency text NOT NULL DEFAULT 'gbp',
          status text NOT NULL,
          reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
          stripe_transfer_id text,
          stripe_account_id text,
          idempotency_key text NOT NULL,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          settled_at timestamptz,
          UNIQUE (user_id, idempotency_key)
        )`,

        `CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_user ON withdrawal_requests (user_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status ON withdrawal_requests (status)`,

        `CREATE INDEX IF NOT EXISTS idx_ledger_entries_user_id ON ledger_entries (user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_ledger_user_created ON ledger_entries (user_id, created_at DESC, ledger_id DESC)`,
        // Hard guarantee that a single store purchase token can only ever be
        // redeemed once across the whole system (race-proof double-grant guard).
        // NOTE: use jsonb_exists(metadata, 'purchaseToken') rather than the jsonb
        // `?` operator — knex's db.raw() treats `?` as a bind placeholder and
        // rewrites it to `$1`, producing a syntax error that aborted the whole
        // schema bootstrap (and silently blocked the gift-catalog seed).
        `CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_iap_purchase_token ON ledger_entries ((metadata->>'purchaseToken')) WHERE entry_type = 'COIN_PURCHASE' AND jsonb_exists(metadata, 'purchaseToken')`,
        `CREATE INDEX IF NOT EXISTS idx_team_earnings_team ON team_earnings (team_id)`,
        `CREATE INDEX IF NOT EXISTS idx_team_earnings_leader ON team_earnings (leader_user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_gift_events_stream_id ON gift_events (stream_id)`,
        `CREATE INDEX IF NOT EXISTS idx_gift_events_sender_user_id ON gift_events (sender_user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_gift_events_receiver_user_id ON gift_events (receiver_user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_promotions_user_id ON promotions (user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_live_games_stream_id ON live_games (stream_id)`,
        `CREATE INDEX IF NOT EXISTS idx_live_games_host_user_id ON live_games (host_user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_live_game_entries_game_id ON live_game_entries (game_id)`,
        `CREATE INDEX IF NOT EXISTS idx_live_game_entries_user_id ON live_game_entries (user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_matchday_entitlements_user ON matchday_entitlements (user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_matchday_predictions_event ON matchday_predictions (event_id)`,
        `CREATE INDEX IF NOT EXISTS idx_matchday_predictions_user ON matchday_predictions (user_id)`,
      ];

      // Resilient: a single failing DDL statement must never abort the whole
      // schema bootstrap (and thereby silently block the gift-catalog seed that
      // runs below). Log and continue so the rest of the schema + seed still run.
      for (const stmt of ddl) {
        try {
          await db.raw(stmt);
        } catch (e: any) {
          logger.warn(
            { err: e?.message || String(e), stmt: String(stmt).slice(0, 140) },
            '[economy-schema] DDL statement failed; continuing'
          );
        }
      }

      // Seed gift catalog if empty (so gifting works immediately in local dev)
      try {
        // If the table doesn't exist (for any unexpected reason), don't crash startup.
        const existsRow = await db.raw("select to_regclass('public.gift_catalog') is not null as ok");
        const exists = Boolean((existsRow as any)?.rows?.[0]?.ok);
        if (!exists) {
          logger.warn('[economy-schema] gift_catalog missing after ensure; skipping seed');
        } else {
        // Always UPSERT the standard gifts so the catalog can never drift into an
        // empty or all-disabled state (which surfaced to users as "gift is no longer
        // available" on send, because sendGift rejects missing/disabled gifts).
        // Idempotent: inserts what's missing and re-enables/refreshes existing rows.
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
            { gift_id: 'revive', name: 'Revive', coin_cost: 30, enabled: true, rarity: 'epic', min_level: 0, cooldown_ms: 0, asset_json: { emoji: '🛟', action: 'revive' } },
            { gift_id: 'cheer_burst', name: 'Cheer Burst', coin_cost: 25, enabled: true, rarity: 'rare', min_level: 0, cooldown_ms: 0, asset_json: { emoji: '💨', action: 'cheer_burst' } },
          ])
          .onConflict('gift_id')
          .merge(['name', 'coin_cost', 'enabled', 'rarity', 'asset_json']);

        // Operational visibility: log the catalog state after seeding so an empty
        // or disabled catalog (which surfaces to users as "gift no longer
        // available") is diagnosable from logs without DB access.
        const seededRows = await db('gift_catalog').select('gift_id', 'enabled').orderBy('gift_id');
        logger.info(
          { count: seededRows.length, gifts: seededRows.map((g: any) => `${g.gift_id}:${g.enabled}`).join(',') },
          '[economy-schema] gift_catalog state after seed'
        );
        }
      } catch (e: any) {
        logger.warn({ err: e?.message || String(e) }, '[economy-schema] seed gift_catalog failed');
      }

      // Seed IAP products if empty so /iap/verify can resolve a grant out of the
      // box. Override coin grants / add SKUs via the iap_products table in prod.
      try {
        const existsRow = await db.raw("select to_regclass('public.iap_products') is not null as ok");
        const exists = Boolean((existsRow as any)?.rows?.[0]?.ok);
        if (!exists) {
          logger.warn('[economy-schema] iap_products missing after ensure; skipping seed');
        } else {
          // coins_granted = total coins delivered to the wallet (base + bonus).
          // SKUs must match the Google Play product IDs and the client coin packs.
          // Idempotent (onConflict ignore) so it safely tops up already-seeded DBs
          // with any newly added packs without overwriting manual edits.
          await db('iap_products')
            .insert(
              IAP_CATALOG.map((entry) => ({
                platform: entry.platform,
                sku: entry.sku,
                coins_granted: entry.coinsGranted,
                enabled: true,
                metadata: jsonbDefault(db, { label: entry.label, priceUsd: entry.priceUsd }),
              }))
            )
            .onConflict(['platform', 'sku'])
            .ignore();
        }
      } catch (e: any) {
        logger.warn({ err: e?.message || String(e) }, '[economy-schema] seed iap_products failed');
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
