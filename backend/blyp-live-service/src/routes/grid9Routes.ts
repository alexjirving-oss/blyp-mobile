/**
 * Grid 9 HTTP browse — public active matches for Games hub discoverability.
 * Auth optional for list (Cognito if present); never leaks private codes/tokens.
 * LiveKit token mint is Grid9-local (no frozen IVS paths).
 */
import { createHmac } from 'crypto';
import { Router } from 'express';
import { cognitoJwtMiddleware, AuthedRequest } from '../auth/cognitoJwtMiddleware';
import { logger } from '../config/logger';
import { readGrid9State } from '../games/grid9/grid9AggregateStore';
import { Grid9Error } from '../games/grid9/grid9Errors';
import { listPublicActiveGrid9Matches } from '../games/grid9/grid9MatchDirectory';

const router = Router();

function grid9HttpEnabled(): boolean {
  // Client flag name mirrored for ops; default ON when unset so Games hub works.
  const raw = String(
    process.env.LIVE_GRID9_ENABLED ?? process.env.GRID9_ENABLED ?? '1',
  ).trim();
  return /^(1|true|yes|on)$/i.test(raw);
}

function livekitConfig(): {
  url: string;
  apiKey: string;
  apiSecret: string;
} | null {
  const url = String(process.env.LIVEKIT_URL || '').trim();
  const apiKey = String(process.env.LIVEKIT_API_KEY || '').trim();
  const apiSecret = String(process.env.LIVEKIT_API_SECRET || '').trim();
  if (!url || !apiKey || !apiSecret) return null;
  return { url, apiKey, apiSecret };
}

function mintLiveKitJwt(args: {
  apiKey: string;
  apiSecret: string;
  identity: string;
  name: string;
  roomName: string;
  canPublish: boolean;
  ttlSeconds?: number;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (args.ttlSeconds ?? 2 * 60 * 60);
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: args.apiKey,
      sub: args.identity,
      name: args.name,
      nbf: now - 10,
      exp,
      video: {
        roomJoin: true,
        room: args.roomName,
        canPublish: args.canPublish,
        canSubscribe: true,
        canPublishData: true,
      },
    }),
  ).toString('base64url');
  const data = `${header}.${payload}`;
  const sig = createHmac('sha256', args.apiSecret)
    .update(data)
    .digest('base64url');
  return `${data}.${sig}`;
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

/**
 * POST /api/grid9/livekit-token — Grid9-local A/V only.
 * Soft-fails with ok:false when LIVEKIT_* env is missing (client → SentinelStage).
 */
router.post(
  '/grid9/livekit-token',
  cognitoJwtMiddleware,
  async (req: AuthedRequest, res) => {
    try {
      const userId = String(req.user?.sub || '').trim();
      if (!userId) {
        return res.status(401).json({ error: 'AUTH_REQUIRED', code: 'AUTH_REQUIRED' });
      }
      const matchId = String(req.body?.matchId || '').trim();
      if (!matchId) {
        return res.status(400).json({ error: 'INVALID_PAYLOAD', code: 'INVALID_PAYLOAD' });
      }
      const cfg = livekitConfig();
      if (!cfg) {
        return res.status(200).json({ ok: false, reason: 'livekit-not-configured' });
      }

      const state = await readGrid9State(matchId);
      const human = state.players.find(
        (player): player is Extract<typeof player, { kind: 'human' }> =>
          player.kind === 'human' && player.userId === userId,
      );
      const openPhases = new Set([
        'lobby_waiting',
        'countdown',
        'roulette',
        'combat',
        'private_lobby',
      ]);
      if (!human && !openPhases.has(state.phase)) {
        return res.status(403).json({ error: 'NOT_ELIGIBLE', code: 'NOT_ELIGIBLE' });
      }

      const roomName = `grid9:${state.liveSessionId || state.matchId}`;
      const identity = human
        ? String(
            (human.feed as { participantId?: string } | undefined)?.participantId ||
              human.userId,
          )
        : `audience:${userId}`;
      const token = mintLiveKitJwt({
        apiKey: cfg.apiKey,
        apiSecret: cfg.apiSecret,
        identity,
        name: human?.displayName || identity,
        roomName,
        canPublish: Boolean(human),
      });
      return res.json({
        ok: true,
        url: cfg.url,
        token,
        room: roomName,
        participantId: identity,
        canPublish: Boolean(human),
      });
    } catch (error: any) {
      if (error instanceof Grid9Error && error.code === 'MATCH_NOT_FOUND') {
        return res.status(404).json({ error: 'MATCH_NOT_FOUND', code: 'MATCH_NOT_FOUND' });
      }
      logger.warn(
        { err: error?.message || String(error) },
        '[grid9] livekit token mint failed',
      );
      return res.status(200).json({ ok: false, reason: 'mint-failed' });
    }
  },
);

export default router;
