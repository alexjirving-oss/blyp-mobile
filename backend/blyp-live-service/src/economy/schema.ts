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

        `CREATE TABLE IF NOT EXISTS reaction_duel_entries (
          duel_id text NOT NULL,
          session_id text NOT NULL,
          user_id text NOT NULL,
          status text NOT NULL DEFAULT 'PENDING',
          coin_cost bigint NOT NULL DEFAULT 0,
          bonus_coin_cost bigint NOT NULL DEFAULT 0,
          refund_reason text,
          created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          locked_at timestamptz,
          refunded_at timestamptz,
          settled_at timestamptz,
          updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (duel_id, user_id)
        )`,

        `CREATE TABLE IF NOT EXISTS grid9_wallet_reservations (
          reservation_id text PRIMARY KEY,
          match_id text NOT NULL,
          user_id text NOT NULL,
          intent_id text NOT NULL,
          amount_coins bigint NOT NULL,
          captured_coins bigint NOT NULL DEFAULT 0,
          released_coins bigint NOT NULL DEFAULT 0,
          status text NOT NULL DEFAULT 'PENDING',
          platform_ledger_entry_id text,
          redis_applied_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (match_id, user_id, intent_id)
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

        // Canonical event registry. This is intentionally separate from
        // battle_escrows: a free battle has no escrow row but must still be
        // authorized for the shared IVS stage and server lifecycle.
        `CREATE TABLE IF NOT EXISTS battle_registry (
          battle_id text PRIMARY KEY,
          room_id text NOT NULL UNIQUE,
          creator_uid text NOT NULL,
          opponent_uid text NOT NULL,
          creator_name text NOT NULL DEFAULT '',
          creator_username text NOT NULL DEFAULT '',
          opponent_name text NOT NULL DEFAULT '',
          opponent_username text NOT NULL DEFAULT '',
          title text NOT NULL DEFAULT '',
          state text NOT NULL DEFAULT 'INVITED',
          scheduled_start_at timestamptz NOT NULL,
          duration_sec integer NOT NULL DEFAULT 300,
          deposit_mode text NOT NULL DEFAULT 'free',
          stake_coins bigint NOT NULL DEFAULT 0,
          session_id text,
          stage_arn text,
          side_a_joined_at timestamptz,
          side_b_joined_at timestamptz,
          countdown_ends_at timestamptz,
          live_started_at timestamptz,
          finalizing_at timestamptz,
          ended_at timestamptz,
          terminal_reason text,
          winner_side text,
          score_a bigint NOT NULL DEFAULT 0,
          score_b bigint NOT NULL DEFAULT 0,
          settlement_json jsonb NOT NULL DEFAULT '{}'::jsonb,
          version integer NOT NULL DEFAULT 1,
          created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE INDEX IF NOT EXISTS idx_battle_registry_state_start ON battle_registry (state, scheduled_start_at)`,
        `CREATE INDEX IF NOT EXISTS idx_battle_registry_session ON battle_registry (session_id)`,

        // A gift can affect a battle score once, enforced independently of
        // client retries, socket redelivery, or Cloud Run instance races.
        `CREATE TABLE IF NOT EXISTS battle_score_events (
          gift_event_id text PRIMARY KEY,
          battle_id text NOT NULL,
          side text NOT NULL,
          score_coins bigint NOT NULL,
          created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE INDEX IF NOT EXISTS idx_battle_score_events_battle ON battle_score_events (battle_id, created_at)`,

        // One free audience vote per battle. Votes and gifts update the same
        // authoritative A/B score; Firestore only mirrors the resulting totals.
        `CREATE TABLE IF NOT EXISTS battle_vote_events (
          battle_id text NOT NULL,
          voter_uid text NOT NULL,
          side text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (battle_id, voter_uid)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_battle_vote_events_battle ON battle_vote_events (battle_id, created_at)`,

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

        // Pre-arranged gifts for upcoming battles: coins debited at pledge time
        // (HELD), converted to gems + gift_events when match starts (APPLIED),
        // or refunded if the battle is cancelled (REFUNDED).
        `CREATE TABLE IF NOT EXISTS battle_gift_pledges (
          pledge_id text PRIMARY KEY,
          battle_id text NOT NULL,
          pledger_uid text NOT NULL,
          side text NOT NULL,
          receiver_uid text NOT NULL,
          gift_id text NOT NULL,
          quantity integer NOT NULL DEFAULT 1,
          coin_cost bigint NOT NULL,
          status text NOT NULL DEFAULT 'HELD',
          stream_id text,
          gift_event_id text,
          score_coins bigint NOT NULL DEFAULT 0,
          idempotency_key text NOT NULL,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          applied_at timestamptz,
          refunded_at timestamptz,
          UNIQUE (pledger_uid, idempotency_key)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_battle_gift_pledges_battle_status ON battle_gift_pledges (battle_id, status)`,
        `CREATE INDEX IF NOT EXISTS idx_battle_gift_pledges_pledger ON battle_gift_pledges (pledger_uid, created_at DESC)`,

        `CREATE TABLE IF NOT EXISTS payout_accounts (
          user_id text PRIMARY KEY,
          stripe_account_id text UNIQUE,
          paypal_email text,
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
          payout_method text NOT NULL DEFAULT 'stripe',
          paypal_email text,
          paypal_payout_batch_id text,
          idempotency_key text NOT NULL,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          settled_at timestamptz,
          UNIQUE (user_id, idempotency_key)
        )`,

        `CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_user ON withdrawal_requests (user_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status ON withdrawal_requests (status)`,

        // PayPal withdraw path (independent of Stripe Connect).
        // stripe_account_id becomes nullable so PayPal-only creators can cash out.
        `ALTER TABLE payout_accounts ALTER COLUMN stripe_account_id DROP NOT NULL`,
        `ALTER TABLE payout_accounts ADD COLUMN IF NOT EXISTS paypal_email text`,
        `ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS payout_method text NOT NULL DEFAULT 'stripe'`,
        `ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS paypal_email text`,
        `ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS paypal_payout_batch_id text`,

        `CREATE INDEX IF NOT EXISTS idx_ledger_entries_user_id ON ledger_entries (user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_ledger_user_created ON ledger_entries (user_id, created_at DESC, ledger_id DESC)`,
        // Rankings P1: windowed board aggregates filter by type + time.
        `CREATE INDEX IF NOT EXISTS idx_ledger_type_created ON ledger_entries (entry_type, created_at DESC)`,

        // Durable rankings rollups (P1 query-time writes; P1.5 cron materialize).
        // "window" is a Postgres reserved word — must be quoted in DDL.
        `CREATE TABLE IF NOT EXISTS rankings_snapshots (
          board text NOT NULL,
          "window" text NOT NULL,
          user_id text NOT NULL,
          rank integer NOT NULL,
          score bigint NOT NULL DEFAULT 0,
          display_name text NOT NULL DEFAULT '',
          photo_url text NOT NULL DEFAULT '',
          handle text NOT NULL DEFAULT '',
          computed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (board, "window", user_id)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_rankings_snapshots_board_window_rank ON rankings_snapshots (board, "window", rank)`,
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
        `CREATE INDEX IF NOT EXISTS idx_promotions_active_window ON promotions (status, starts_at, ends_at)`,
        `CREATE INDEX IF NOT EXISTS idx_live_games_stream_id ON live_games (stream_id)`,
        `CREATE INDEX IF NOT EXISTS idx_live_games_host_user_id ON live_games (host_user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_live_game_entries_game_id ON live_game_entries (game_id)`,
        `CREATE INDEX IF NOT EXISTS idx_live_game_entries_user_id ON live_game_entries (user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_reaction_duel_entries_session ON reaction_duel_entries (session_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_reaction_duel_entries_user ON reaction_duel_entries (user_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_grid9_reservations_match ON grid9_wallet_reservations (match_id, status)`,
        `CREATE INDEX IF NOT EXISTS idx_grid9_reservations_pending_redis ON grid9_wallet_reservations (redis_applied_at, status)`,
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
            { gift_id: 'heart', name: 'Heart', coin_cost: 1, enabled: true, rarity: 'common', min_level: 0, cooldown_ms: 0, asset_json: { emoji: '❤️', motionTier: 'small', motif: 'pulse_bloom' } },
            { gift_id: 'thumbsup', name: 'Thumbs Up', coin_cost: 2, enabled: true, rarity: 'common', min_level: 0, cooldown_ms: 0, asset_json: { emoji: '👍', motionTier: 'small', motif: 'pop_ack' } },
            { gift_id: 'clap', name: 'Clap', coin_cost: 5, enabled: true, rarity: 'common', min_level: 0, cooldown_ms: 0, asset_json: { emoji: '👏', motionTier: 'small', motif: 'shock_clap' } },
            { gift_id: 'fire', name: 'Fire', coin_cost: 10, enabled: true, rarity: 'rare', min_level: 0, cooldown_ms: 0, asset_json: { emoji: '🔥', motionTier: 'mid', motif: 'flame_column' } },
            { gift_id: 'star', name: 'Star', coin_cost: 15, enabled: true, rarity: 'rare', min_level: 0, cooldown_ms: 0, asset_json: { emoji: '⭐', motionTier: 'mid', motif: 'constellation' } },
            { gift_id: 'diamond', name: 'Diamond', coin_cost: 25, enabled: true, rarity: 'epic', min_level: 0, cooldown_ms: 0, asset_json: { emoji: '💎', motionTier: 'epic', motif: 'crystal_prism' } },
            { gift_id: 'crown', name: 'Crown', coin_cost: 50, enabled: true, rarity: 'legendary', min_level: 0, cooldown_ms: 0, asset_json: { emoji: '👑', motionTier: 'legendary', motif: 'regal_drop' } },
            { gift_id: 'rocket', name: 'Rocket', coin_cost: 100, enabled: true, rarity: 'legendary', min_level: 0, cooldown_ms: 0, asset_json: { emoji: '🚀', motionTier: 'ultimate', motif: 'orbital_launch' } },
            { gift_id: 'revive', name: 'Revive', coin_cost: 30, enabled: true, rarity: 'epic', min_level: 0, cooldown_ms: 0, asset_json: { emoji: '🛟', action: 'revive', motionTier: 'epic', motif: 'life_ring' } },
            { gift_id: 'cheer_burst', name: 'Cheer Burst', coin_cost: 25, enabled: true, rarity: 'rare', min_level: 0, cooldown_ms: 0, asset_json: { emoji: '💨', action: 'cheer_burst', motionTier: 'epic', motif: 'stadium_wave' } },
            { gift_id: 'lion_baby', name: 'Baby Lion', coin_cost: 1000, enabled: true, rarity: 'legendary', min_level: 0, cooldown_ms: 0, asset_json: { emoji: '🦁', motionTier: 'ultimate', motif: 'regal_drop', cinemaId: 'lion_baby', filmClip: true } },
            { gift_id: 'lion_big', name: 'Big Lion', coin_cost: 5000, enabled: true, rarity: 'legendary', min_level: 0, cooldown_ms: 0, asset_json: { emoji: '🦁', motionTier: 'ultimate', motif: 'orbital_launch', cinemaId: 'lion_big', filmClip: true } },
            { gift_id: 'mad_hearts', name: 'Mad Hearts', coin_cost: 100, enabled: true, rarity: 'rare', min_level: 0, cooldown_ms: 0, asset_json: { emoji: '💖', motionTier: 'mid', motif: 'pulse_bloom', cinemaId: 'mad_hearts', filmClip: true } },
            { gift_id: 'mad_confetti', name: 'Mad Confetti', coin_cost: 100, enabled: true, rarity: 'rare', min_level: 0, cooldown_ms: 0, asset_json: { emoji: '🎊', motionTier: 'mid', motif: 'stadium_wave', cinemaId: 'mad_confetti', filmClip: true } },
            { gift_id: 'mad_rose', name: 'Mad Rose', coin_cost: 200, enabled: true, rarity: 'epic', min_level: 0, cooldown_ms: 0, asset_json: { emoji: '🌹', motionTier: 'epic', motif: 'regal_drop', cinemaId: 'mad_rose', filmClip: true } },
            { gift_id: 'mad_donut', name: 'Mad Donut', coin_cost: 200, enabled: true, rarity: 'epic', min_level: 0, cooldown_ms: 0, asset_json: { emoji: '🍩', motionTier: 'epic', motif: 'pop_ack', cinemaId: 'mad_donut', filmClip: true } },
            { gift_id: 'mad_thanks_gift', name: 'Thanks Gift', coin_cost: 300, enabled: true, rarity: 'epic', min_level: 0, cooldown_ms: 0, asset_json: { emoji: '🎁', motionTier: 'epic', motif: 'pulse_bloom', cinemaId: 'mad_thanks_gift', filmClip: true } },
            { gift_id: 'mad_thanks_likes', name: 'Thanks Likes', coin_cost: 300, enabled: true, rarity: 'epic', min_level: 0, cooldown_ms: 0, asset_json: { emoji: '👍', motionTier: 'epic', motif: 'pop_ack', cinemaId: 'mad_thanks_likes', filmClip: true } },
            { gift_id: 'mad_thanks_share', name: 'Thanks Share', coin_cost: 500, enabled: true, rarity: 'legendary', min_level: 0, cooldown_ms: 0, asset_json: { emoji: '🔗', motionTier: 'legendary', motif: 'stadium_wave', cinemaId: 'mad_thanks_share', filmClip: true } },
            { gift_id: 'mad_gift_avalanche', name: 'Gift Avalanche', coin_cost: 750, enabled: true, rarity: 'legendary', min_level: 0, cooldown_ms: 0, asset_json: { emoji: '🎁', motionTier: 'ultimate', motif: 'orbital_launch', cinemaId: 'mad_gift_avalanche', filmClip: true } },
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
          // coins_granted = website BASE only (1 coin = 1p). App never grants web bonus.
          // Merge on conflict so legacy bonus totals (550/1150/…) converge to catalog.
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
            .merge({
              coins_granted: db.raw('excluded.coins_granted'),
              enabled: true,
              metadata: db.raw('excluded.metadata'),
            });
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
