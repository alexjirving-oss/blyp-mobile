import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import { getSessionById } from '../live/liveSessionStore';
import { refreshCompositionFromAws } from '../live/programEgress';
import { getEconomyInfra } from '../economy/infra';
import { logger } from '../config/logger';

const router = Router();

const FROZEN_ORIGINS = [
  'https://blyp.world',
  'https://www.blyp.world',
  'http://localhost:3000',
];

export function programOrigins(): string[] {
  const extra = String(process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('https://') || s.startsWith('http://localhost'));
  return [...new Set([...FROZEN_ORIGINS, ...extra])];
}

export function applyProgramCors(req: Request, res: Response): boolean {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
  if (!origin) {
    res.removeHeader('Access-Control-Allow-Origin');
    return true;
  }
  if (!programOrigins().includes(origin)) {
    res.removeHeader('Access-Control-Allow-Origin');
    res.status(403).json({ error: 'CORS', code: 'CORS' });
    return false;
  }
  res.set('Access-Control-Allow-Origin', origin);
  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.set('Access-Control-Max-Age', '600');
  return true;
}

async function rateLimit(
  req: Request,
  res: Response,
  keyPrefix: string,
  maxPerMin: number,
): Promise<boolean> {
  try {
    const redis = getEconomyInfra().redis;
    const ip = String(req.ip || req.socket?.remoteAddress || 'unknown');
    const key = `${keyPrefix}:${ip}`;
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, 60);
    if (n > maxPerMin) {
      res.status(429).json({ error: 'RATE_LIMIT', code: 'RATE_LIMIT' });
      return false;
    }
  } catch (e: any) {
    logger.warn({ err: e?.message || String(e) }, '[live-program] redis rate limit skipped');
  }
  return true;
}

router.options('/live/program/:sessionId', (req, res) => {
  if (!applyProgramCors(req, res)) return;
  return res.status(204).end();
});

router.get('/live/program/:sessionId', async (req, res) => {
  if (!applyProgramCors(req, res)) return;
  if (!(await rateLimit(req, res, 'live:prog', 30))) return;
  const sessionId = String(req.params.sessionId || '').trim();
  if (!sessionId) {
    return res.status(404).json({ error: 'NOT_LIVE', code: 'NOT_LIVE' });
  }
  try {
    let session = await getSessionById(sessionId);
    if (!session || session.status !== 'LIVE' || !session.playbackUrl) {
      return res.status(404).json({ error: 'NOT_LIVE', code: 'NOT_LIVE' });
    }
    if (session.compositionState !== 'ACTIVE' && session.compositionArn) {
      const lock = await (async () => {
        try {
          const redis = getEconomyInfra().redis;
          const ok = await redis.set(`live:comp-refresh:${sessionId}`, '1', 'EX', 3, 'NX');
          return ok === 'OK' ? 'acquired' : 'held';
        } catch {
          return 'down';
        }
      })();
      if (lock === 'acquired' || lock === 'down') {
        session = await refreshCompositionFromAws(session);
      }
    }
    if (!session || session.status !== 'LIVE' || !session.playbackUrl) {
      return res.status(404).json({ error: 'NOT_LIVE', code: 'NOT_LIVE' });
    }
    return res.status(200).json({
      sessionId,
      status: 'LIVE',
      title: session.title || 'LIVE',
      playbackUrl: session.playbackUrl,
      compositionState: session.compositionState || 'UNKNOWN',
    });
  } catch (e: any) {
    logger.error({ err: e?.message || String(e), sessionId }, '[live-program] GET failed');
    return res.status(404).json({ error: 'NOT_LIVE', code: 'NOT_LIVE' });
  }
});

router.options('/live/watch/:sessionId', (req, res) => {
  if (!applyProgramCors(req, res)) return;
  return res.status(204).end();
});

router.get('/live/watch/:sessionId', async (req, res) => {
  if (!applyProgramCors(req, res)) return;
  if (!(await rateLimit(req, res, 'live:watch', 12))) return;
  const sessionId = String(req.params.sessionId || '').trim();
  if (!sessionId) {
    return res.status(404).json({ error: 'NOT_LIVE', code: 'NOT_LIVE' });
  }
  try {
    const session = await getSessionById(sessionId);
    if (!session || session.status !== 'LIVE' || !session.stageArn) {
      return res.status(404).json({ error: 'NOT_LIVE', code: 'NOT_LIVE' });
    }
    const { createViewerToken } = await import('../live/liveService');
    const minted = await createViewerToken(sessionId, `web-${randomUUID()}`);
    return res.status(200).json({
      sessionId,
      token: minted.token,
      stageArn: minted.stageArn,
    });
  } catch (e: any) {
    logger.error({ err: e?.message || String(e), sessionId }, '[live-watch] GET failed');
    return res.status(404).json({ error: 'NOT_LIVE', code: 'NOT_LIVE' });
  }
});

export default router;
