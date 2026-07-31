import './config/env';
import { randomUUID } from 'crypto';
import { logger } from './config/logger';
import { checkDb, getBullmqRedis, getEconomyInfra } from './economy/infra';
import { BullMqDomainEventPublisher } from './platform/events/bullmqPublisher';
import { dispatchOutboxBatch } from './platform/events/outbox';
import { runPlatformMigrations } from './platform/migrations/runner';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const { db, redis } = getEconomyInfra();
  const status = await checkDb(db);
  if (!status.ok) {
    throw new Error(`Database is unavailable: ${status.error || 'unknown error'}`);
  }
  await runPlatformMigrations(db);

  const publisher = new BullMqDomainEventPublisher();
  const workerId = `${process.env.HOSTNAME || 'local'}:${process.pid}:${randomUUID()}`;
  const pollMs = Math.max(100, Number(process.env.OUTBOX_POLL_MS) || 1000);
  const batchSize = Math.max(1, Math.min(Number(process.env.OUTBOX_BATCH_SIZE) || 50, 200));
  let stopping = false;

  const requestStop = (signal: string) => {
    logger.info({ signal, workerId }, '[outbox_worker_stopping]');
    stopping = true;
  };
  process.once('SIGTERM', () => requestStop('SIGTERM'));
  process.once('SIGINT', () => requestStop('SIGINT'));

  logger.info({ workerId, pollMs, batchSize }, '[outbox_worker_started]');
  try {
    while (!stopping) {
      try {
        const claimed = await dispatchOutboxBatch(db, publisher, { workerId, batchSize });
        if (claimed === 0) await sleep(pollMs);
      } catch (error) {
        logger.error(
          { err: error instanceof Error ? error.message : String(error), workerId },
          '[outbox_worker_cycle_failed]'
        );
        await sleep(Math.max(pollMs, 1000));
      }
    }
  } finally {
    await Promise.allSettled([
      publisher.close(),
      getBullmqRedis().quit(),
      redis.quit(),
      db.destroy(),
    ]);
    logger.info({ workerId }, '[outbox_worker_stopped]');
  }
}

main().catch((error: unknown) => {
  logger.fatal(
    { err: error instanceof Error ? error.message : String(error) },
    '[outbox_worker_fatal]'
  );
  process.exitCode = 1;
});
