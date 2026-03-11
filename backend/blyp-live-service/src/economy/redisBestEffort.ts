import { logger } from '../config/logger';
import { getEconomyInfra } from './infra';

type RedisSoftFail = {
  code?: string;
  message: string;
};

function normalizeRedisError(err: any): RedisSoftFail {
  const code = typeof err?.code === 'string' ? err.code : undefined;
  const message = typeof err?.message === 'string' ? err.message : String(err);
  return { code, message };
}

function isTimeoutOrConnError(code?: string, message?: string): boolean {
  const c = (code || '').toUpperCase();
  const m = (message || '').toUpperCase();
  return (
    c.includes('ETIMEDOUT') ||
    c.includes('ECONNREFUSED') ||
    c.includes('EHOSTUNREACH') ||
    c.includes('ENOTFOUND') ||
    c.includes('EAI_AGAIN') ||
    m.includes('ETIMEDOUT') ||
    m.includes('ECONNREFUSED') ||
    m.includes('TIMED OUT')
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const e: any = new Error(label);
      e.code = label;
      reject(e);
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

const loggedOkOps = new Set<string>();
const loggedConnectErrorOps = new Set<string>();

export async function bestEffortRedisPing(opts: {
  op: string;
  timeoutMs?: number;
  meta?: Record<string, unknown>;
}): Promise<{ ok: boolean; error?: RedisSoftFail }> {
  const timeoutMs = typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0 ? opts.timeoutMs : 3000;

  try {
    const { redis } = getEconomyInfra();
    const pong = await withTimeout(redis.ping(), timeoutMs, 'REDIS_PING_TIMEOUT');
    const ok = pong === 'PONG';

    if (ok && !loggedOkOps.has(opts.op)) {
      loggedOkOps.add(opts.op);
      logger.info({ op: opts.op, ok: true, ...(opts.meta || {}) }, '[REDIS_HEALTH_STATE]');
    }

    if (!ok) {
      const error = { message: `Unexpected PING response: ${pong}` };
      logger.warn({ op: opts.op, ok: false, ...error, ...(opts.meta || {}) }, '[REDIS_DEGRADED]');
      return { ok: false, error };
    }

    return { ok: true };
  } catch (err: any) {
    const error = normalizeRedisError(err);

    // Only treat network/timeouts as soft-fail; anything else still shouldn't crash callers,
    // but we record it distinctly.
    const soft = isTimeoutOrConnError(error.code, error.message);

    // Some Redis failure modes only surface as a command failure (no client-level `error` event).
    // Mirror the infra-level tag so Cloud Run log proof can consistently detect Redis unavailability.
    if (soft && !loggedConnectErrorOps.has(opts.op)) {
      loggedConnectErrorOps.add(opts.op);
      logger.warn(
        {
          op: opts.op,
          code: error.code,
          message: error.message,
          ...(opts.meta || {}),
        },
        '[REDIS_CONNECT_ERROR]'
      );
    }

    logger.warn(
      {
        op: opts.op,
        ok: false,
        soft,
        code: error.code,
        message: error.message,
        ...(opts.meta || {}),
      },
      '[REDIS_DEGRADED]'
    );

    return { ok: false, error };
  }
}
