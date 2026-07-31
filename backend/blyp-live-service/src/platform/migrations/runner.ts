import type { Knex } from 'knex';
import { logger } from '../../config/logger';
import { adoptExistingSchemaMigration } from './0001AdoptExistingSchema';
import { platformSpineMigration } from './0002PlatformSpine';
import type { PlatformMigration } from './types';

const LOCK_NAMESPACE = 7319;
const LOCK_ID = 20260731;

export const platformMigrations: PlatformMigration[] = [
  adoptExistingSchemaMigration,
  platformSpineMigration,
];

function validateRegistry() {
  const ids = new Set<string>();
  let previous = '';
  for (const migration of platformMigrations) {
    if (!/^\d{4}_[a-z0-9_]+$/.test(migration.id)) {
      throw new Error(`Invalid migration id: ${migration.id}`);
    }
    if (ids.has(migration.id)) {
      throw new Error(`Duplicate migration id: ${migration.id}`);
    }
    if (previous && migration.id <= previous) {
      throw new Error(`Migration registry is not ordered: ${migration.id}`);
    }
    ids.add(migration.id);
    previous = migration.id;
  }
}

async function ensureMigrationLedger(db: Knex) {
  await db.raw(`
    CREATE TABLE IF NOT EXISTS platform_schema_migrations (
      migration_id text PRIMARY KEY,
      description text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      execution_ms integer NOT NULL,
      CHECK (migration_id ~ '^\\d{4}_[a-z0-9_]+$'),
      CHECK (execution_ms >= 0)
    )
  `);
}

async function withMigrationLock<T>(db: Knex, operation: () => Promise<T>): Promise<T> {
  // Session advisory locks must be acquired and released on the same PostgreSQL
  // connection. Holding a dedicated pool connection also protects migrations
  // that intentionally execute outside a transaction.
  const client = db.client as Knex['client'] & {
    acquireConnection(): Promise<{ query(sql: string, values?: unknown[]): Promise<unknown> }>;
    releaseConnection(connection: unknown): Promise<void>;
    destroyRawConnection(connection: unknown): Promise<void>;
  };
  const connection = await client.acquireConnection();
  let locked = false;
  let destroyConnection = false;
  try {
    await connection.query('select pg_advisory_lock($1, $2)', [LOCK_NAMESPACE, LOCK_ID]);
    locked = true;
    return await operation();
  } finally {
    if (locked) {
      try {
        await connection.query('select pg_advisory_unlock($1, $2)', [LOCK_NAMESPACE, LOCK_ID]);
      } catch (error) {
        destroyConnection = true;
        logger.error(
          { err: error instanceof Error ? error.message : String(error) },
          '[migration_lock_release_failed]'
        );
      }
    }
    if (destroyConnection) {
      await client.destroyRawConnection(connection);
    } else {
      await client.releaseConnection(connection);
    }
  }
}

async function appliedMigrationIds(db: Knex): Promise<string[]> {
  const rows = await db('platform_schema_migrations')
    .select<{ migration_id: string }[]>('migration_id')
    .orderBy('migration_id', 'asc');
  return rows.map((row) => row.migration_id);
}

export async function getMigrationStatus(db: Knex) {
  validateRegistry();
  await ensureMigrationLedger(db);
  const applied = new Set(await appliedMigrationIds(db));
  return platformMigrations.map((migration) => ({
    id: migration.id,
    description: migration.description,
    applied: applied.has(migration.id),
    reversible: migration.reversible,
  }));
}

export async function runPlatformMigrations(db: Knex): Promise<void> {
  validateRegistry();
  await withMigrationLock(db, async () => {
    await ensureMigrationLedger(db);
    const appliedIds = await appliedMigrationIds(db);
    const registryIds = new Set(platformMigrations.map((migration) => migration.id));
    const unknown = appliedIds.filter((id) => !registryIds.has(id));
    if (unknown.length > 0) {
      throw new Error(`Database contains migrations not present in this build: ${unknown.join(', ')}`);
    }

    const applied = new Set(appliedIds);
    for (const migration of platformMigrations) {
      if (applied.has(migration.id)) continue;
      const startedAtMs = Date.now();
      logger.info({ migrationId: migration.id }, '[migration_start]');

      const execute = async (connection: Knex | Knex.Transaction) => {
        await migration.up(connection);
        await connection('platform_schema_migrations').insert({
          migration_id: migration.id,
          description: migration.description,
          execution_ms: Date.now() - startedAtMs,
        });
      };

      if (migration.transactional) {
        await db.transaction(async (trx) => execute(trx));
      } else {
        await execute(db);
      }

      logger.info(
        { migrationId: migration.id, executionMs: Date.now() - startedAtMs },
        '[migration_complete]'
      );
    }
  });
}

export async function rollbackLastPlatformMigration(db: Knex): Promise<string> {
  validateRegistry();
  return withMigrationLock(db, async () => {
    await ensureMigrationLedger(db);
    const appliedIds = await appliedMigrationIds(db);
    const lastId = appliedIds.at(-1);
    if (!lastId) throw new Error('No platform migration is applied.');

    const migration = platformMigrations.find((candidate) => candidate.id === lastId);
    if (!migration) throw new Error(`Applied migration is unknown to this build: ${lastId}`);
    if (!migration.reversible || !migration.down) {
      throw new Error(`Migration ${lastId} is irreversible and cannot be rolled back automatically.`);
    }

    const execute = async (connection: Knex | Knex.Transaction) => {
      await migration.down!(connection);
      await connection('platform_schema_migrations').where({ migration_id: migration.id }).delete();
    };

    if (migration.transactional) {
      await db.transaction(async (trx) => execute(trx));
    } else {
      await execute(db);
    }

    logger.warn({ migrationId: migration.id }, '[migration_rolled_back]');
    return migration.id;
  });
}
