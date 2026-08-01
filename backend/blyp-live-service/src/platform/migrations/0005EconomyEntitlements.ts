import type { PlatformMigration } from './types';

export const economyEntitlementsMigration: PlatformMigration = {
  id: '0005_economy_entitlements',
  description:
    'Create server-authoritative Free/Premium entitlements, UTC quota periods, reservations, and usage ledger.',
  transactional: true,
  reversible: false,
  async up(db) {
    // The development bootstrap already creates these two legacy tables. The
    // migration deliberately extends them instead of introducing a second
    // subscription authority.
    await db.raw(`
      CREATE TABLE IF NOT EXISTS subscription_plans (
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
      )
    `);
    await db.raw(`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS plan_tier text`);
    await db.raw(
      `ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS entitlement_configuration jsonb NOT NULL DEFAULT '{}'::jsonb`
    );
    await db.raw(`
      UPDATE subscription_plans
      SET plan_tier = CASE WHEN upper(plan_id) = 'PREMIUM' THEN 'PREMIUM' ELSE 'FREE' END
      WHERE plan_tier IS NULL
    `);
    await db.raw(`ALTER TABLE subscription_plans ALTER COLUMN plan_tier SET NOT NULL`);
    await db.raw(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'chk_subscription_plans_tier'
        ) THEN
          ALTER TABLE subscription_plans
            ADD CONSTRAINT chk_subscription_plans_tier
            CHECK (plan_tier IN ('FREE', 'PREMIUM'));
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'chk_subscription_plans_entitlement_configuration'
        ) THEN
          ALTER TABLE subscription_plans
            ADD CONSTRAINT chk_subscription_plans_entitlement_configuration
            CHECK (jsonb_typeof(entitlement_configuration) = 'object');
        END IF;
      END $$
    `);

    await db.raw(`
      CREATE TABLE IF NOT EXISTS user_subscriptions (
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
      )
    `);
    await db.raw(`ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS provider_status text`);
    await db.raw(
      `ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS provider_verified_at timestamptz`
    );
    await db.raw(`ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS provider_event_id text`);
    await db.raw(`ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1`);
    await db.raw(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'chk_user_subscriptions_version'
        ) THEN
          ALTER TABLE user_subscriptions
            ADD CONSTRAINT chk_user_subscriptions_version CHECK (version > 0);
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'chk_user_subscriptions_period'
        ) THEN
          ALTER TABLE user_subscriptions
            ADD CONSTRAINT chk_user_subscriptions_period CHECK (
              current_period_start IS NULL
              OR current_period_end IS NULL
              OR current_period_end > current_period_start
            );
        END IF;
      END $$
    `);

    await db.raw(`
      CREATE TABLE IF NOT EXISTS entitlement_definitions (
        plan_id text NOT NULL REFERENCES subscription_plans(plan_id),
        entitlement_key text NOT NULL,
        unit_name text NOT NULL,
        period_kind text NOT NULL,
        allowance_units integer NOT NULL,
        reservation_ttl_seconds integer NOT NULL,
        enabled boolean NOT NULL DEFAULT true,
        configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (plan_id, entitlement_key),
        CHECK (entitlement_key ~ '^[a-z][a-z0-9_.-]{2,127}$'),
        CHECK (length(unit_name) BETWEEN 1 AND 64),
        CHECK (period_kind = 'UTC_DAY'),
        CHECK (allowance_units >= 0),
        CHECK (reservation_ttl_seconds BETWEEN 60 AND 3600),
        CHECK (jsonb_typeof(configuration) = 'object')
      )
    `);

    await db.raw(`
      CREATE TABLE IF NOT EXISTS quota_periods (
        quota_period_id text PRIMARY KEY,
        user_id text NOT NULL,
        entitlement_key text NOT NULL,
        plan_id text NOT NULL REFERENCES subscription_plans(plan_id),
        period_start timestamptz NOT NULL,
        period_end timestamptz NOT NULL,
        allowance_units integer NOT NULL,
        reserved_units integer NOT NULL DEFAULT 0,
        committed_units integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, entitlement_key, period_start),
        CHECK (length(user_id) BETWEEN 1 AND 256),
        CHECK (entitlement_key ~ '^[a-z][a-z0-9_.-]{2,127}$'),
        CHECK (period_end > period_start),
        CHECK (allowance_units >= 0),
        CHECK (reserved_units >= 0),
        CHECK (committed_units >= 0),
        CHECK (reserved_units + committed_units <= allowance_units)
      )
    `);

    await db.raw(`
      CREATE TABLE IF NOT EXISTS quota_reservations (
        reservation_id text PRIMARY KEY,
        user_id text NOT NULL,
        entitlement_key text NOT NULL,
        plan_id text NOT NULL REFERENCES subscription_plans(plan_id),
        quota_period_id text NOT NULL REFERENCES quota_periods(quota_period_id),
        requested_units integer NOT NULL,
        status text NOT NULL,
        expires_at timestamptz NOT NULL,
        idempotency_key text NOT NULL,
        commit_idempotency_key text,
        refund_idempotency_key text,
        correlation_id text NOT NULL,
        reserved_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        committed_at timestamptz,
        refunded_at timestamptz,
        expired_at timestamptz,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, idempotency_key),
        CHECK (length(user_id) BETWEEN 1 AND 256),
        CHECK (entitlement_key ~ '^[a-z][a-z0-9_.-]{2,127}$'),
        CHECK (requested_units > 0),
        CHECK (status IN ('RESERVED', 'COMMITTED', 'REFUNDED', 'EXPIRED')),
        CHECK (length(idempotency_key) BETWEEN 1 AND 200),
        CHECK (commit_idempotency_key IS NULL OR length(commit_idempotency_key) BETWEEN 1 AND 200),
        CHECK (refund_idempotency_key IS NULL OR length(refund_idempotency_key) BETWEEN 1 AND 200),
        CHECK (length(correlation_id) BETWEEN 1 AND 256),
        CHECK (jsonb_typeof(metadata) = 'object'),
        CHECK (
          (status = 'RESERVED' AND committed_at IS NULL AND refunded_at IS NULL AND expired_at IS NULL)
          OR (status = 'COMMITTED' AND committed_at IS NOT NULL AND refunded_at IS NULL AND expired_at IS NULL)
          OR (status = 'REFUNDED' AND committed_at IS NULL AND refunded_at IS NOT NULL AND expired_at IS NULL)
          OR (status = 'EXPIRED' AND committed_at IS NULL AND refunded_at IS NULL AND expired_at IS NOT NULL)
        )
      )
    `);

    await db.raw(`
      CREATE TABLE IF NOT EXISTS quota_usage_ledger (
        usage_entry_id text PRIMARY KEY,
        user_id text NOT NULL,
        entitlement_key text NOT NULL,
        quota_period_id text NOT NULL REFERENCES quota_periods(quota_period_id),
        reservation_id text NOT NULL REFERENCES quota_reservations(reservation_id),
        entry_type text NOT NULL,
        units integer NOT NULL,
        idempotency_key text NOT NULL,
        correlation_id text NOT NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, idempotency_key),
        CHECK (length(user_id) BETWEEN 1 AND 256),
        CHECK (entitlement_key ~ '^[a-z][a-z0-9_.-]{2,127}$'),
        CHECK (entry_type IN ('RESERVE', 'COMMIT', 'REFUND', 'EXPIRE')),
        CHECK (units > 0),
        CHECK (length(idempotency_key) BETWEEN 1 AND 200),
        CHECK (length(correlation_id) BETWEEN 1 AND 256),
        CHECK (jsonb_typeof(metadata) = 'object')
      )
    `);

    await db.raw(`
      CREATE INDEX IF NOT EXISTS idx_user_subscriptions_current
      ON user_subscriptions (user_id, status, current_period_end DESC)
    `);
    await db.raw(`
      CREATE INDEX IF NOT EXISTS idx_user_subscriptions_verified_provider
      ON user_subscriptions (provider, provider_subscription_id, provider_verified_at)
      WHERE provider_subscription_id IS NOT NULL
    `);
    await db.raw(`
      CREATE INDEX IF NOT EXISTS idx_entitlement_definitions_plan
      ON entitlement_definitions (plan_id, enabled, entitlement_key)
    `);
    await db.raw(`
      CREATE INDEX IF NOT EXISTS idx_quota_periods_user_current
      ON quota_periods (user_id, period_end DESC, entitlement_key)
    `);
    await db.raw(`
      CREATE INDEX IF NOT EXISTS idx_quota_reservations_expiry
      ON quota_reservations (quota_period_id, expires_at)
      WHERE status = 'RESERVED'
    `);
    await db.raw(`
      CREATE INDEX IF NOT EXISTS idx_quota_reservations_user_status
      ON quota_reservations (user_id, status, reserved_at DESC)
    `);
    await db.raw(`
      CREATE INDEX IF NOT EXISTS idx_quota_usage_user_time
      ON quota_usage_ledger (user_id, occurred_at DESC, usage_entry_id DESC)
    `);

    await db.raw(`
      CREATE OR REPLACE FUNCTION reject_quota_usage_ledger_mutation()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'quota_usage_ledger is append-only';
      END;
      $$
    `);
    await db.raw(`DROP TRIGGER IF EXISTS trg_quota_usage_ledger_append_only ON quota_usage_ledger`);
    await db.raw(`
      CREATE TRIGGER trg_quota_usage_ledger_append_only
      BEFORE UPDATE OR DELETE ON quota_usage_ledger
      FOR EACH ROW EXECUTE FUNCTION reject_quota_usage_ledger_mutation()
    `);

    await db.raw(`
      INSERT INTO subscription_plans (
        plan_id,
        plan_name,
        price_cents,
        currency,
        interval,
        coin_allowance,
        enabled,
        metadata,
        plan_tier,
        entitlement_configuration,
        updated_at
      )
      VALUES
        (
          'FREE',
          'Free',
          0,
          'GBP',
          'month',
          0,
          true,
          '{"commercialState":"configured_server_side"}'::jsonb,
          'FREE',
          '{"quotaPolicy":"UTC_DAY"}'::jsonb,
          CURRENT_TIMESTAMP
        ),
        (
          'PREMIUM',
          'Premium',
          0,
          'GBP',
          'month',
          0,
          true,
          '{"commercialState":"provider_product_not_configured"}'::jsonb,
          'PREMIUM',
          '{"quotaPolicy":"UTC_DAY","requiresVerifiedProviderState":true}'::jsonb,
          CURRENT_TIMESTAMP
        )
      ON CONFLICT (plan_id) DO UPDATE SET
        plan_name = EXCLUDED.plan_name,
        plan_tier = EXCLUDED.plan_tier,
        enabled = EXCLUDED.enabled,
        entitlement_configuration = EXCLUDED.entitlement_configuration,
        updated_at = CURRENT_TIMESTAMP
    `);

    // Commercial allowances are intentionally not invented in source. Both
    // tiers remain zero and disabled until approved values are configured on the
    // server; the client never gains authority to set or override these rows.
    await db.raw(`
      INSERT INTO entitlement_definitions (
        plan_id,
        entitlement_key,
        unit_name,
        period_kind,
        allowance_units,
        reservation_ttl_seconds,
        enabled,
        configuration
      )
      VALUES
        ('FREE', 'ai.generation', 'request', 'UTC_DAY', 0, 900, true, '{"configurationState":"pending_approval"}'::jsonb),
        ('PREMIUM', 'ai.generation', 'request', 'UTC_DAY', 0, 900, true, '{"configurationState":"pending_approval"}'::jsonb)
      ON CONFLICT (plan_id, entitlement_key) DO NOTHING
    `);

    await db.raw(`
      INSERT INTO feature_flags (flag_key, enabled, rollout_percentage, description)
      VALUES (
        'economy.entitlements_v1',
        false,
        0,
        'Enable server-authoritative subscription entitlement and quota contracts.'
      )
      ON CONFLICT (flag_key) DO NOTHING
    `);
  },
};
