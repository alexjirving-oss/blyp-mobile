import type { Response, NextFunction } from 'express';
import type { AuthedRequest } from '../auth/cognitoJwtMiddleware';
import { getEconomyInfra } from '../economy/infra';
import { logger } from '../config/logger';

const cache = new Map<string, { restricted: boolean; expires: number }>();
const TTL_MS = 30_000;

function parseRestrictions(metadata: unknown): { liveRestricted: boolean } {
  if (!metadata || typeof metadata !== 'object') return { liveRestricted: false };
  const restrictions = (metadata as Record<string, unknown>).restrictions;
  if (!restrictions || typeof restrictions !== 'object') return { liveRestricted: false };
  return { liveRestricted: (restrictions as Record<string, unknown>).liveRestricted === true };
}

export async function isLiveRestricted(userId: string): Promise<boolean> {
  if (!userId) return false;
  const now = Date.now();
  const hit = cache.get(userId);
  if (hit && hit.expires > now) return hit.restricted;

  let restricted = false;
  try {
    const db = getEconomyInfra().db;
    const rs = await db.raw(
      `SELECT metadata FROM user_admin_state WHERE user_id = ? LIMIT 1`,
      [userId],
    );
    const row = (rs as any)?.rows?.[0];
    let metadata = row?.metadata;
    if (typeof metadata === 'string') {
      try { metadata = JSON.parse(metadata); } catch { metadata = {}; }
    }
    restricted = parseRestrictions(metadata).liveRestricted;
  } catch (e: any) {
    if (hit) {
      logger.warn({ err: e?.message || String(e), userId }, '[liveRestriction] check failed; honoring stale cache');
      return hit.restricted;
    }
    logger.warn({ err: e?.message || String(e), userId }, '[liveRestriction] check failed with no cache; failing open');
    return false;
  }

  cache.set(userId, { restricted, expires: now + TTL_MS });
  return restricted;
}

export function invalidateLiveRestrictionCache(userId: string): void {
  if (userId) cache.delete(userId);
}

/** Blocks go-live when admin has restricted live for this user. */
export function requireCanGoLive(req: AuthedRequest, res: Response, next: NextFunction): void {
  const userId = String(req.user?.sub || req.user?.username || '');
  isLiveRestricted(userId)
    .then((restricted) => {
      if (restricted) {
        res.status(403).json({
          error: 'LIVE_RESTRICTED',
          code: 'LIVE_RESTRICTED',
          message: 'Your account is restricted from going live.',
        });
        return;
      }
      next();
    })
    .catch((e: any) => {
      logger.error({ err: e?.message || String(e), userId }, '[liveRestriction] guard failed');
      next();
    });
}
