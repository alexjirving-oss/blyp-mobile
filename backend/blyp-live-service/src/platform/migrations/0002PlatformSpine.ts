import type { PlatformMigration } from './types';

export const platformSpineMigration: PlatformMigration = {
  id: '0002_platform_spine',
  description: 'Create canonical identity-link, outbox, feature-flag, and API idempotency foundations.',
  transactional: true,
  reversible: false,
  async up(db) {
    await db.raw(`
      CREATE TABLE IF NOT EXISTS identity_links (
        provider text NOT NULL,
        legacy_user_id text NOT NULL,
        canonical_user_id text NOT NULL,
        status text NOT NULL DEFAULT 'verified',
        verification_method text NOT NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        linked_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        verified_at timestamptz,
        revoked_at timestamptz,
        PRIMARY KEY (provider, legacy_user_id),
        UNIQUE (provider, canonical_user_id),
        CHECK (provider IN ('firebase')),
        CHECK (status IN ('verified', 'revoked')),
        CHECK (length(legacy_user_id) BETWEEN 1 AND 256),
        CHECK (length(canonical_user_id) BETWEEN 1 AND 256)
      )
    `);

    await db.raw(`
      CREATE TABLE IF NOT EXISTS domain_outbox (
        event_id text PRIMARY KEY,
        event_type text NOT NULL,
        event_version integer NOT NULL,
        aggregate_type text NOT NULL,
        aggregate_id text NOT NULL,
        actor_user_id text,
        correlation_id text NOT NULL,
        payload jsonb NOT NULL,
        occurred_at timestamptz NOT NULL,
        available_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        published_at timestamptz,
        attempts integer NOT NULL DEFAULT 0,
        last_error text,
        locked_at timestamptz,
        locked_by text,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (event_version > 0),
        CHECK (attempts >= 0)
      )
    `);

    await db.raw(`
      CREATE TABLE IF NOT EXISTS domain_outbox_dead_letters (
        event_id text PRIMARY KEY,
        event_type text NOT NULL,
        event_version integer NOT NULL,
        aggregate_type text NOT NULL,
        aggregate_id text NOT NULL,
        actor_user_id text,
        correlation_id text NOT NULL,
        payload jsonb NOT NULL,
        occurred_at timestamptz NOT NULL,
        attempts integer NOT NULL,
        last_error text NOT NULL,
        dead_lettered_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        replayed_at timestamptz
      )
    `);

    await db.raw(`
      CREATE TABLE IF NOT EXISTS feature_flags (
        flag_key text PRIMARY KEY,
        enabled boolean NOT NULL DEFAULT false,
        rollout_percentage integer NOT NULL DEFAULT 0,
        allow_subjects jsonb NOT NULL DEFAULT '[]'::jsonb,
        deny_subjects jsonb NOT NULL DEFAULT '[]'::jsonb,
        configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
        description text NOT NULL DEFAULT '',
        updated_by_user_id text,
        updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (flag_key ~ '^[a-z][a-z0-9_.-]{2,127}$'),
        CHECK (rollout_percentage BETWEEN 0 AND 100),
        CHECK (jsonb_typeof(allow_subjects) = 'array'),
        CHECK (jsonb_typeof(deny_subjects) = 'array'),
        CHECK (jsonb_typeof(configuration) = 'object')
      )
    `);

    await db.raw(`
      CREATE TABLE IF NOT EXISTS api_idempotency_keys (
        actor_user_id text NOT NULL,
        operation text NOT NULL,
        idempotency_key text NOT NULL,
        request_hash text NOT NULL,
        response_status integer,
        response_body jsonb,
        state text NOT NULL DEFAULT 'processing',
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at timestamptz,
        PRIMARY KEY (actor_user_id, operation, idempotency_key),
        CHECK (state IN ('processing', 'completed', 'failed')),
        CHECK (length(idempotency_key) BETWEEN 8 AND 200)
      )
    `);

    await db.raw(`CREATE INDEX IF NOT EXISTS idx_identity_links_canonical ON identity_links (canonical_user_id)`);
    await db.raw(`CREATE INDEX IF NOT EXISTS idx_outbox_pending ON domain_outbox (available_at, created_at) WHERE published_at IS NULL`);
    await db.raw(`CREATE INDEX IF NOT EXISTS idx_outbox_locked ON domain_outbox (locked_at) WHERE published_at IS NULL`);
    await db.raw(`CREATE INDEX IF NOT EXISTS idx_outbox_dead_type ON domain_outbox_dead_letters (event_type, dead_lettered_at DESC)`);
    await db.raw(`CREATE INDEX IF NOT EXISTS idx_idempotency_expiry ON api_idempotency_keys (expires_at)`);

    await db.raw(`
      INSERT INTO feature_flags (flag_key, enabled, rollout_percentage, description)
      VALUES
        ('content.postgres_authority', false, 0, 'Cut content authority from Firestore to PostgreSQL.'),
        ('economy.postgres_read_model', false, 0, 'Read wallet and entitlement state from the authoritative PostgreSQL service.'),
        ('ai.gateway', false, 0, 'Route AI generation through the server-side gateway.'),
        ('live.rooms_v2', false, 0, 'Enable the communal-room orchestration contract.'),
        ('messaging.core_v1', false, 0, 'Enable the canonical messaging service.'),
        ('dating.v1', false, 0, 'Enable the age-gated Dating domain.'),
        ('team.v1', false, 0, 'Enable the Team domain.'),
        ('live.manifest', false, 0, 'Enable manifest-based live playback.'),
        ('live.playlist_viewer', false, 0, 'Enable the playlist manifest viewer.')
      ON CONFLICT (flag_key) DO NOTHING
    `);
  },
};
