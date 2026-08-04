import crypto from 'crypto';
import { getEconomyInfra } from '../economy/infra';
import { logger } from '../config/logger';

export const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const REDIS_KEY_PREFIX = 'admin:session:';

type StoredSession = {
  actorUserId: string;
  expiresAt: number;
};

const localSessions = new Map<string, StoredSession>();

function redisKey(token: string): string {
  return `${REDIS_KEY_PREFIX}${token}`;
}

export async function issueAdminSession(actorUserId: string): Promise<string> {
  const token = crypto.randomBytes(24).toString('hex');
  const session: StoredSession = {
    actorUserId,
    expiresAt: Date.now() + ADMIN_SESSION_TTL_MS,
  };

  try {
    const redis = getEconomyInfra().redis;
    await redis.set(redisKey(token), JSON.stringify(session), 'PX', ADMIN_SESSION_TTL_MS);
    return token;
  } catch (e: any) {
    logger.warn({ err: e?.message || String(e) }, '[admin] Redis session store unavailable; using process-local fallback');
    localSessions.set(token, session);
    return token;
  }
}

export async function readAdminSession(token: string): Promise<StoredSession | null> {
  const trimmed = String(token || '').trim();
  if (!trimmed) return null;

  try {
    const redis = getEconomyInfra().redis;
    const raw = await redis.get(redisKey(trimmed));
    if (raw) {
      const parsed = JSON.parse(raw) as StoredSession;
      if (parsed?.expiresAt && parsed.expiresAt > Date.now()) {
        return parsed;
      }
      await redis.del(redisKey(trimmed)).catch(() => {});
      return null;
    }
  } catch (e: any) {
    logger.warn({ err: e?.message || String(e) }, '[admin] Redis session read failed; checking local fallback');
  }

  const local = localSessions.get(trimmed);
  if (!local) return null;
  if (local.expiresAt <= Date.now()) {
    localSessions.delete(trimmed);
    return null;
  }
  return local;
}

export async function revokeAdminSession(token: string): Promise<void> {
  const trimmed = String(token || '').trim();
  if (!trimmed) return;
  localSessions.delete(trimmed);
  try {
    const redis = getEconomyInfra().redis;
    await redis.del(redisKey(trimmed));
  } catch {
    // best-effort
  }
}
