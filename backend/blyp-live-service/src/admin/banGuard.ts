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
