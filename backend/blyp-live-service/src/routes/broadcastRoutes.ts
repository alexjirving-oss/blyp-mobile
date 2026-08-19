import { Router } from 'express';
import { z } from 'zod';
import { cognitoJwtMiddleware, AuthedRequest } from '../auth/cognitoJwtMiddleware';
import {
  broadcastPrepare,
  broadcastStart,
  broadcastGetStatus,
  broadcastSwapTikTok,
} from '../live/broadcastPrepare';

const router = Router();
router.use(cognitoJwtMiddleware);

const platformSchema = z.enum(['youtube', 'facebook', 'twitch', 'tiktok', 'custom_rtmp']);
const profileSchema = z.enum(['landscape_copy', 'portrait_crop']);

const destinationSchema = z
  .object({
    platform: platformSchema,
    rtmpUrl: z.string().min(8).max(2048),
    streamKey: z.string().min(8).max(512),
    profile: profileSchema.optional(),
    expiresAt: z.string().datetime().optional().nullable(),
  })
  .strict();

const prepareSchema = z
  .object({
    destinations: z.array(destinationSchema).min(1).max(8),
  })
  .strict();

const swapTikTokSchema = z
  .object({
    rtmpUrl: z.string().min(8).max(2048),
    streamKey: z.string().min(8).max(512),
    expiresAt: z.string().datetime().optional().nullable(),
  })
  .strict();

function mapBroadcastError(e: any, res: any) {
  const code = String(e?.code || 'INTERNAL');
  const status =
    code === 'FORBIDDEN' ? 403
      : code === 'SESSION_NOT_LIVE' || code === 'PREFLIGHT_REQUIRED' || code === 'NO_DESTINATIONS' ? 400
        : code === 'HLS_NOT_READY' ? 409
          : code === 'PROGRAM_FAILED' ? 503
          : code === 'NOT_CONFIGURED' ? 503
            : code === 'INVALID_RTMP_URL' || code === 'INVALID_STREAM_KEY' ? 400
              : code === 'NOT_FOUND' ? 404
                : 500;
  return res.status(status).json({
    error: e?.message || 'Broadcast error',
    code,
  });
}

/** Preflight: validate + store session-scoped RTMP creds. No RTMP probe. */
router.post('/live/:sessionId/broadcast/prepare', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub || req.user?.username;
    if (!userId) return res.status(401).json({ error: 'User not found in token' });
    const parsed = prepareSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
    }
    const out = await broadcastPrepare({
      sessionId: String(req.params.sessionId || '').trim(),
      hostUserId: userId,
      destinations: parsed.data.destinations,
    });
    return res.json(out);
  } catch (e: any) {
    return mapBroadcastError(e, res);
  }
});

/** Go Live fan-out: lease worker (or PROVISIONING fallback) and connect RTMP. */
router.post('/live/:sessionId/broadcast/start', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub || req.user?.username;
    if (!userId) return res.status(401).json({ error: 'User not found in token' });
    const out = await broadcastStart({
      sessionId: String(req.params.sessionId || '').trim(),
      hostUserId: userId,
    });
    return res.json(out);
  } catch (e: any) {
    return mapBroadcastError(e, res);
  }
});

router.get('/live/:sessionId/broadcast/status', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub || req.user?.username;
    if (!userId) return res.status(401).json({ error: 'User not found in token' });
    const out = await broadcastGetStatus({
      sessionId: String(req.params.sessionId || '').trim(),
      hostUserId: userId,
    });
    return res.json(out);
  } catch (e: any) {
    return mapBroadcastError(e, res);
  }
});

/** TikTok session key refresh — relay swap only, not full encoder restart. */
router.post('/live/:sessionId/broadcast/tiktok/swap', async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.sub || req.user?.username;
    if (!userId) return res.status(401).json({ error: 'User not found in token' });
    const parsed = swapTikTokSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT', detail: parsed.error.issues });
    }
    const out = await broadcastSwapTikTok({
      sessionId: String(req.params.sessionId || '').trim(),
      hostUserId: userId,
      rtmpUrl: parsed.data.rtmpUrl,
      streamKey: parsed.data.streamKey,
      expiresAt: parsed.data.expiresAt,
    });
    return res.json(out);
  } catch (e: any) {
    return mapBroadcastError(e, res);
  }
});

export default router;
