import type { Response, NextFunction } from 'express';
import type { AuthedRequest } from '../auth/cognitoJwtMiddleware';
import { getEconomyInfra } from '../economy/infra';
import { logger } from '../config/logger';

// Small TTL cache so the per-request ban check doesn't hammer Postgres. Bans are
// rare and tolerating up to TTL_MS of staleness is fine; ban/unban explicitly
// invalidate the entry for immediate effect.
const cache = new Map<string, { banned: boolean; expires: number }>();
const TTL_MS = 30_000;

export function invalidateBanCache(userId: string): void {
  if (userId) cache.delete(userId);
}

/** Ops visibility for P0.8 — in-process cache only (per Cloud Run instance). */
export function getBanCacheStats(): {
  size: number;
  ttlMs: number;
  failOpenOnDbMiss: boolean;
  note: string;
} {
  const now = Date.now();
  // Prune expired entries opportunistically so size reflects live entries.
  for (const [k, v] of cache.entries()) {
    if (v.expires <= now) cache.delete(k);
  }
  return {
    size: cache.size,
    ttlMs: TTL_MS,
    failOpenOnDbMiss: true,
    note: 'Per-instance Map; ban/unban invalidate immediately. Fail-open only when DB errors and no cache entry exists.',
  };
}

/**
 * Probe ban status for a user: compares live DB truth vs any cached value,
 * optionally refreshing the cache.
 */
export async function probeBanCache(userId: string): Promise<{
  userId: string;
  dbBanned: boolean | null;
  cachedBanned: boolean | null;
  cacheHit: boolean;
  cacheExpiresAt: string | null;
  inSync: boolean | null;
  detail?: string;
}> {
  const id = String(userId || '').trim();
  if (!id) {
    return {
      userId: '',
      dbBanned: null,
      cachedBanned: null,
      cacheHit: false,
      cacheExpiresAt: null,
      inSync: null,
      detail: 'missing_userId',
    };
  }

  const now = Date.now();
  const hit = cache.get(id);
  const cacheHit = Boolean(hit && hit.expires > now);
  const cachedBanned = cacheHit ? Boolean(hit!.banned) : null;
  const cacheExpiresAt = cacheHit ? new Date(hit!.expires).toISOString() : null;

  let dbBanned: boolean | null = null;
  let detail: string | undefined;
  try {
    const db = getEconomyInfra().db;
    const rs = await db.raw(
      `SELECT is_banned, banned_until FROM user_admin_state WHERE user_id = ? LIMIT 1`,
      [id]
    );
    const row = (rs as any)?.rows?.[0];
    if (row) {
      const until = row.banned_until ? new Date(row.banned_until).getTime() : null;
      dbBanned = Boolean(row.is_banned) && (until == null || until > now);
    } else {
      dbBanned = false;
      detail = 'no_user_admin_state_row';
    }
  } catch (e: any) {
    detail = e?.message || String(e);
  }

  // Refresh cache from DB when available so probe can also heal staleness.
  if (dbBanned !== null) {
    cache.set(id, { banned: dbBanned, expires: now + TTL_MS });
  }

  return {
    userId: id,
    dbBanned,
    cachedBanned,
    cacheHit,
    cacheExpiresAt,
    inSync: dbBanned === null || cachedBanned === null ? null : dbBanned === cachedBanned,
    detail,
  };
}

export async function isUserBanned(userId: string): Promise<boolean> {
  if (!userId) return false;
  const now = Date.now();
  const hit = cache.get(userId);
  if (hit && hit.expires > now) return hit.banned;

  let banned = false;
  try {
    const db = getEconomyInfra().db;
    const rs = await db.raw(
      `SELECT is_banned, banned_until FROM user_admin_state WHERE user_id = ? LIMIT 1`,
      [userId]
    );
    const row = (rs as any)?.rows?.[0];
    if (row) {
      const until = row.banned_until ? new Date(row.banned_until).getTime() : null;
      banned = Boolean(row.is_banned) && (until == null || until > now);
    }
  } catch (e: any) {
    // On infra error, honor a stale cache entry if we have one so a KNOWN-banned
    // user stays blocked even during a DB blip (P1.8). We only fail open when we
    // have no signal at all — a documented availability>risk tradeoff, since a
    // blanket fail-closed would 403 every legitimate user during a transient DB
    // outage (a far larger blast radius than a rare banned user slipping through).
    if (hit) {
      logger.warn({ err: e?.message || String(e), userId }, '[banGuard] check failed; honoring stale cache');
      return hit.banned;
    }
    logger.warn({ err: e?.message || String(e), userId }, '[banGuard] check failed with no cache; failing open');
    return false;
  }

  cache.set(userId, { banned, expires: now + TTL_MS });
  return banned;
}

// Express guard: rejects requests from banned users. Place AFTER cognitoJwtMiddleware.
export function requireNotBanned(req: AuthedRequest, res: Response, next: NextFunction): void {
  const userId = String(req.user?.sub || req.user?.username || '');
  isUserBanned(userId)
    .then((banned) => {
      if (banned) {
        res.status(403).json({
          error: 'ACCOUNT_BANNED',
          code: 'ACCOUNT_BANNED',
          detail: 'This account has been suspended.',
        });
        return;
      }
      next();
    })
    .catch(() => next());
}
