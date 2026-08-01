import type { PlatformMigration } from './types';

export const trustFoundationMigration: PlatformMigration = {
  id: '0003_trust_foundation',
  description: 'Create auditable consent, privacy, block, mute, and policy-decision foundations.',
  transactional: true,
  reversible: false,
  async up(db) {
    await db.raw(`
      CREATE TABLE IF NOT EXISTS trust_policy_profiles (
        user_id text PRIMARY KEY,
        date_of_birth date NOT NULL,
        age_band text NOT NULL,
        jurisdiction text NOT NULL,
        consent_status text NOT NULL,
        accepted_policy_version text NOT NULL,
        acceptance_source text NOT NULL,
        accepted_at timestamptz,
        withdrawn_at timestamptz,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (length(user_id) BETWEEN 1 AND 256),
        CHECK (date_of_birth >= DATE '1900-01-01' AND date_of_birth <= CURRENT_DATE),
        CHECK (age_band IN ('under_13', '13_15', '16_17', '18_plus')),
        CHECK (jurisdiction ~ '^[A-Z]{2}$'),
        CHECK (consent_status IN ('accepted', 'withdrawn')),
        CHECK (length(accepted_policy_version) BETWEEN 1 AND 64),
        CHECK (acceptance_source IN ('mobile', 'web', 'admin', 'migration')),
        CHECK (version > 0),
        CHECK (
          (consent_status = 'accepted' AND accepted_at IS NOT NULL AND withdrawn_at IS NULL)
          OR
          (consent_status = 'withdrawn' AND withdrawn_at IS NOT NULL)
        )
      )
    `);

    await db.raw(`
      CREATE TABLE IF NOT EXISTS trust_consent_history (
        consent_event_id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES trust_policy_profiles(user_id) ON DELETE CASCADE,
        consent_status text NOT NULL,
        policy_version text NOT NULL,
        date_of_birth date NOT NULL,
        age_band text NOT NULL,
        jurisdiction text NOT NULL,
        acceptance_source text NOT NULL,
        profile_version integer NOT NULL,
        correlation_id text NOT NULL,
        occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (consent_status IN ('accepted', 'withdrawn')),
        CHECK (age_band IN ('under_13', '13_15', '16_17', '18_plus')),
        CHECK (jurisdiction ~ '^[A-Z]{2}$'),
        CHECK (profile_version > 0),
        CHECK (length(correlation_id) BETWEEN 1 AND 256)
      )
    `);

    await db.raw(`
      CREATE TABLE IF NOT EXISTS trust_privacy_settings (
        user_id text PRIMARY KEY,
        account_visibility text NOT NULL DEFAULT 'private',
        content_visibility text NOT NULL DEFAULT 'followers',
        message_permission text NOT NULL DEFAULT 'nobody',
        discoverability text NOT NULL DEFAULT 'hidden',
        location_precision text NOT NULL DEFAULT 'off',
        allow_personalization boolean NOT NULL DEFAULT false,
        allow_analytics boolean NOT NULL DEFAULT false,
        allow_ai_training boolean NOT NULL DEFAULT false,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (length(user_id) BETWEEN 1 AND 256),
        CHECK (account_visibility IN ('public', 'followers', 'private')),
        CHECK (content_visibility IN ('public', 'followers', 'private')),
        CHECK (message_permission IN ('everyone', 'followers', 'nobody')),
        CHECK (discoverability IN ('discoverable', 'followers_only', 'hidden')),
        CHECK (location_precision IN ('off', 'approximate', 'precise')),
        CHECK (version > 0)
      )
    `);

    await db.raw(`
      CREATE TABLE IF NOT EXISTS trust_privacy_history (
        privacy_event_id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES trust_privacy_settings(user_id) ON DELETE CASCADE,
        settings jsonb NOT NULL,
        settings_version integer NOT NULL,
        correlation_id text NOT NULL,
        occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (jsonb_typeof(settings) = 'object'),
        CHECK (settings_version > 0),
        CHECK (length(correlation_id) BETWEEN 1 AND 256)
      )
    `);

    await db.raw(`
      CREATE TABLE IF NOT EXISTS trust_relationship_controls (
        actor_user_id text NOT NULL,
        target_user_id text NOT NULL,
        control_type text NOT NULL,
        reason_code text,
        expires_at timestamptz,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (actor_user_id, target_user_id, control_type),
        CHECK (length(actor_user_id) BETWEEN 1 AND 256),
        CHECK (length(target_user_id) BETWEEN 1 AND 256),
        CHECK (actor_user_id <> target_user_id),
        CHECK (control_type IN ('block', 'mute')),
        CHECK (reason_code IS NULL OR length(reason_code) BETWEEN 1 AND 64),
        CHECK (version > 0),
        CHECK (control_type = 'mute' OR expires_at IS NULL)
      )
    `);

    await db.raw(`
      CREATE TABLE IF NOT EXISTS trust_relationship_history (
        relationship_event_id text PRIMARY KEY,
        actor_user_id text NOT NULL,
        target_user_id text NOT NULL,
        control_type text NOT NULL,
        action text NOT NULL,
        reason_code text,
        expires_at timestamptz,
        control_version integer NOT NULL,
        correlation_id text NOT NULL,
        occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (actor_user_id <> target_user_id),
        CHECK (control_type IN ('block', 'mute')),
        CHECK (action IN ('added', 'removed')),
        CHECK (control_version > 0),
        CHECK (length(correlation_id) BETWEEN 1 AND 256)
      )
    `);

    await db.raw(`CREATE INDEX IF NOT EXISTS idx_trust_controls_actor ON trust_relationship_controls (actor_user_id, control_type, updated_at DESC)`);
    await db.raw(`CREATE INDEX IF NOT EXISTS idx_trust_controls_target ON trust_relationship_controls (target_user_id, control_type, updated_at DESC)`);
    await db.raw(`CREATE INDEX IF NOT EXISTS idx_trust_controls_expiry ON trust_relationship_controls (expires_at) WHERE expires_at IS NOT NULL`);
    await db.raw(`CREATE INDEX IF NOT EXISTS idx_trust_relationship_history_actor ON trust_relationship_history (actor_user_id, occurred_at DESC)`);
    await db.raw(`CREATE INDEX IF NOT EXISTS idx_trust_consent_history_user ON trust_consent_history (user_id, occurred_at DESC)`);
    await db.raw(`CREATE INDEX IF NOT EXISTS idx_trust_privacy_history_user ON trust_privacy_history (user_id, occurred_at DESC)`);
    await db.raw(`CREATE INDEX IF NOT EXISTS idx_trust_profiles_jurisdiction_age ON trust_policy_profiles (jurisdiction, age_band)`);

    await db.raw(`
      INSERT INTO feature_flags (flag_key, enabled, rollout_percentage, description)
      VALUES ('trust.policy_v1', false, 0, 'Enable canonical Trust policy enforcement at domain boundaries.')
      ON CONFLICT (flag_key) DO NOTHING
    `);
  },
};
