/**
 * Grid 9 HTTP browse — public active matches for Games hub discoverability.
 * Auth optional for list (Cognito if present); never leaks private codes/tokens.
 */
import { Router } from 'express';
import { cognitoJwtMiddleware, AuthedRequest } from '../auth/cognitoJwtMiddleware';
import { logger } from '../config/logger';
import { listPublicActiveGrid9Matches } from '../games/grid9/grid9MatchDirectory';

const router = Router();

function grid9HttpEnabled(): boolean {
  // Client flag name mirrored for ops; default ON when unset so Games hub works.
  const raw = String(
    process.env.LIVE_GRID9_ENABLED ?? process.env.GRID9_ENABLED ?? '1',
  ).trim();
  return /^(1|true|yes|on)$/i.test(raw);
}

router.use((req, res, next) => {
  if (!req.path.startsWith('/grid9')) return next();
  if (!grid9HttpEnabled()) {
    return res.status(404).json({ error: 'DISABLED', code: 'DISABLED' });
  }
  next();
});

/** Cognito preferred; list itself is non-secret public summaries. */
router.get('/grid9/matches', cognitoJwtMiddleware, async (req: AuthedRequest, res) => {
  try {
    const limitRaw = Number(req.query.limit);
    const matches = await listPublicActiveGrid9Matches(limitRaw);
    return res.json({
      ok: true,
      matches,
      count: matches.length,
    });
  } catch (error: any) {
    logger.warn({ err: error?.message || String(error) }, '[grid9] list matches failed');
    return res.status(500).json({ error: 'INTERNAL', code: 'INTERNAL' });
  }
});

export default router;
