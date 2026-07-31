import '../../config/env';
import { getEconomyInfra } from '../../economy/infra';
import {
  getMigrationStatus,
  rollbackLastPlatformMigration,
  runPlatformMigrations,
} from './runner';

async function main() {
  const command = String(process.argv[2] || 'status').toLowerCase();
  const { db, redis } = getEconomyInfra();

  try {
    if (command === 'up') {
      await runPlatformMigrations(db);
      console.log(JSON.stringify({ ok: true, command: 'up' }));
      return;
    }
    if (command === 'rollback') {
      if (process.env.ALLOW_PLATFORM_MIGRATION_ROLLBACK !== 'true') {
        throw new Error('Set ALLOW_PLATFORM_MIGRATION_ROLLBACK=true to acknowledge a rollback.');
      }
      const migrationId = await rollbackLastPlatformMigration(db);
      console.log(JSON.stringify({ ok: true, command: 'rollback', migrationId }));
      return;
    }
    if (command === 'status') {
      const migrations = await getMigrationStatus(db);
      console.log(JSON.stringify({ ok: true, command: 'status', migrations }, null, 2));
      return;
    }
    throw new Error(`Unknown migration command: ${command}`);
  } finally {
    await Promise.allSettled([db.destroy(), redis.quit()]);
  }
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  );
  process.exitCode = 1;
});
