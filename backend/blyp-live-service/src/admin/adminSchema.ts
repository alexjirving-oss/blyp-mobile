import type { Knex } from 'knex';
import { logger } from '../config/logger';

let ensurePromise: Promise<void> | null = null;

/**
 * Idempotent bootstrap for the admin-dashboard tables.
 *
 * These tables back the admin console (blyp.world/admin-*) and were never
 * part of the economy schema bootstrap, so without this they simply don't
 * exist in the deployed database and every admin read/write degrades.
 *
 * Mirrors ensureEconomySchema: Postgres-native CREATE TABLE IF NOT EXISTS,
 * serialized across processes with an advisory lock, never drops/alters.
 */
export async function ensureAdminSchema(db: Knex): Promise<void> {
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    const lockKey1 = 4242;
    const lockKey2 = 9002;
    await db.raw('select pg_advisory_lock(?, ?)', [lockKey1, lockKey2]);

    try {
      const ddl: string[] = [
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
          id bigserial PRIMARY KEY,
          actor_user_id text,
          action text NOT NULL,
          target_type text,
          target_id text,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,

        `CREATE TABLE IF NOT EXISTS post_admin_state (
          post_id text PRIMARY KEY,
          is_removed boolean NOT NULL DEFAULT false,
          removed_reason text,
          removed_by_user_id text,
          removed_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,

        `CREATE TABLE IF NOT EXISTS admin_user_messages (
          message_id text PRIMARY KEY,
          user_id text NOT NULL,
          channel text NOT NULL DEFAULT 'in_app',
          status text NOT NULL DEFAULT 'queued',
          subject text,
          body text NOT NULL,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,

        // Referenced (unguarded) by the admin metrics overview query and as a
        // user-id source. Minimal shape sufficient for those reads; created only
        // if a richer subscriptions table does not already exist.
        `CREATE TABLE IF NOT EXISTS user_subscriptions (
          subscription_id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
          user_id text NOT NULL,
          status text NOT NULL DEFAULT 'inactive',
          created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,

        // Key/value store for admin-managed platform config (feature flags, etc.).
        `CREATE TABLE IF NOT EXISTS admin_config (
          config_key text PRIMARY KEY,
          value jsonb NOT NULL DEFAULT '{}'::jsonb,
          updated_by_user_id text,
          updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,

        `CREATE INDEX IF NOT EXISTS idx_user_admin_state_is_banned ON user_admin_state (is_banned)`,
        `CREATE INDEX IF NOT EXISTS idx_admin_audit_log_target ON admin_audit_log (target_type, target_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_admin_audit_log_actor ON admin_audit_log (actor_user_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_admin_user_messages_user ON admin_user_messages (user_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user ON user_subscriptions (user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_user_subscriptions_status ON user_subscriptions (status)`,
      ];

      for (const stmt of ddl) {
        await db.raw(stmt);
      }

      logger.info('[admin-schema] ensured');
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
