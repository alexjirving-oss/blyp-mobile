import Redis from 'ioredis';
import knex, { Knex } from 'knex';
import { getEconomyEnv } from '../config/economyEnv';
import { logger } from '../config/logger';

export type EconomyInfra = {
  env: ReturnType<typeof getEconomyEnv>;
  db: Knex;
  redis: Redis;
};

let cachedInfra: EconomyInfra | null = null;
let cachedBullmqRedis: Redis | null = null;

function getPostgresConnection(postgresUrl: string) {
  try {
    const parsed = new URL(postgresUrl);
    const sslmode = parsed.searchParams.get('sslmode')?.toLowerCase();

    // Wave 0: never ship rejectUnauthorized:false for sslmode=require.
    // Explicit no-verify remains opt-in for local/dev only.
    if (sslmode === 'require') {
      return {
        connectionString: postgresUrl,
        ssl: { rejectUnauthorized: true },
      };
    }
    if (sslmode === 'no-verify') {
      return {
        connectionString: postgresUrl,
        ssl: { rejectUnauthorized: false },
      };
    }
  } catch {
    // Preserve the original URL so Knex surfaces the configuration error.
  }

  return postgresUrl;
}

function getPostgresTarget(postgresUrl: string) {
  try {
    const parsed = new URL(postgresUrl);
    return {
      host: parsed.hostname,
      database: parsed.pathname.replace(/^\//, ''),
      sslmode: parsed.searchParams.get('sslmode') || 'default',
    };
  } catch {
    return { host: 'unparseable', database: 'unparseable', sslmode: 'unknown' };
  }
}

export function getEconomyInfra(): EconomyInfra {
  if (cachedInfra) return cachedInfra;

  const env = getEconomyEnv();
  const postgresTarget = getPostgresTarget(env.POSTGRES_URL);
  logger.info(postgresTarget, '[POSTGRES_CONFIG]');

  const db = knex({
    client: 'pg',
    connection: getPostgresConnection(env.POSTGRES_URL),
    pool: { min: 0, max: 10 },
  });

  // Keep Redis failures from hanging request flows.
  // - Fast connect timeout
  // - Capped reconnect backoff
  // - No offline queueing (fail fast when disconnected)
  const redis = new Redis(env.REDIS_URL, {
    connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS) || 4000,
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    lazyConnect: true,
    enableOfflineQueue: false,
    retryStrategy: (times) => {
      // Cap backoff to avoid long hangs; keep trying in background.
      const base = Math.min(2000, 250 * Math.pow(2, Math.max(0, times - 1)));
      return base;
    },
  });

  redis.on('ready', () => {
    logger.info({ ok: true }, '[REDIS_HEALTH_STATE]');
  });

  redis.on('error', (err: any) => {
    // Avoid Node's default "Unhandled error event" crash/noise.
    logger.warn({ code: err?.code, message: err?.message }, '[REDIS_CONNECT_ERROR]');
  });

  cachedInfra = { env, db, redis };
  return cachedInfra;
}

export function getBullmqRedis(): Redis {
  if (cachedBullmqRedis) return cachedBullmqRedis;
  const env = getEconomyEnv();
  const redis = new Redis(env.REDIS_URL, {
    // BullMQ requirement: must be null
    maxRetriesPerRequest: null,
    connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS) || 4000,
    enableReadyCheck: true,
    lazyConnect: true,
    retryStrategy: (times) => {
      const base = Math.min(2000, 250 * Math.pow(2, Math.max(0, times - 1)));
      return base;
    },
  });
  redis.on('ready', () => {
    logger.info({ ok: true, client: 'bullmq' }, '[REDIS_HEALTH_STATE]');
  });
  redis.on('error', (err: any) => {
    logger.warn({ code: err?.code, message: err?.message, client: 'bullmq' }, '[REDIS_CONNECT_ERROR]');
  });
  cachedBullmqRedis = redis;
  return redis;
}

export async function checkDb(db: Knex): Promise<{ ok: boolean; error?: string }> {
  try {
    await db.raw('select 1 as ok');
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function checkRedis(redis: Redis): Promise<{ ok: boolean; error?: string }> {
  try {
    const pong = await redis.ping();
    if (pong !== 'PONG') {
      return { ok: false, error: `Unexpected PING response: ${pong}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
