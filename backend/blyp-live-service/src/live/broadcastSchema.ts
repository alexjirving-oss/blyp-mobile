import type { Knex } from 'knex';
import { logger } from '../config/logger';

let ensurePromise: Promise<void> | null = null;

/** Postgres tables for creator multistream fan-out (P-BLYP-BROADCAST-2). */
export async function ensureBroadcastSchema(db: Knex): Promise<void> {
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    const lockKey1 = 4242;
    const lockKey2 = 9017;
    await db.raw('select pg_advisory_lock(?, ?)', [lockKey1, lockKey2]);

    try {
      const ddl: string[] = [
        `CREATE TABLE IF NOT EXISTS broadcast_sessions (
          session_id text PRIMARY KEY,
          host_user_id text NOT NULL,
          region text NOT NULL,
          hls_url text,
          phase text NOT NULL DEFAULT 'idle',
          worker_id text,
          worker_base_url text,
          provisioning_eta_seconds integer,
          error_detail text,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,

        `CREATE TABLE IF NOT EXISTS broadcast_session_destinations (
          destination_id text PRIMARY KEY,
          session_id text NOT NULL,
          platform text NOT NULL,
          profile text NOT NULL,
          rtmp_url_ciphertext text NOT NULL,
          stream_key_ciphertext text NOT NULL,
          status text NOT NULL DEFAULT 'pending',
          expires_at timestamptz,
          last_error text,
          relay_path text,
          created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,

        `CREATE INDEX IF NOT EXISTS idx_broadcast_dest_session ON broadcast_session_destinations (session_id)`,
        `CREATE INDEX IF NOT EXISTS idx_broadcast_sessions_phase ON broadcast_sessions (phase, updated_at DESC)`,
      ];

      for (const stmt of ddl) {
        await db.raw(stmt);
      }

      logger.info('[broadcast] schema ensured');
    } finally {
      await db.raw('select pg_advisory_unlock(?, ?)', [lockKey1, lockKey2]);
    }
  })();

  return ensurePromise;
}
