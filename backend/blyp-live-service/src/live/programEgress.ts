import {
  GetCompositionCommand,
  StartCompositionCommand,
  StopCompositionCommand,
} from '@aws-sdk/client-ivs-realtime';
import { GetStreamCommand } from '@aws-sdk/client-ivs';
import { getIvsRealtimeClient, getRegionFromStageArn } from '../aws/ivsRealtimeClient';
import { getIvsLowLatencyClient } from '../aws/ivsLowLatencyClient';
import { getEconomyInfra } from '../economy/infra';
import { logger } from '../config/logger';
import {
  getSessionById,
  updateSessionProgram,
  type CompositionState,
  type LiveSession,
} from './liveSessionStore';

/**
 * SSC for unsigned watch + RTMP fan-out.
 * Host publishes a client-composited program (layout tiles + overlays).
 * Featured-only PiP: no participant has `sscPip`, so guests are not extra tiles.
 * Guests still publish for app Real-Time subscribers.
 */
export const PROGRAM_SSC_LAYOUT = {
  pip: {
    featuredParticipantAttribute: 'featured',
    omitStoppedVideo: true,
    videoFillMode: 'COVER' as const,
    pipParticipantAttribute: 'sscPip',
    pipBehavior: 'DYNAMIC' as const,
  },
};

export function mapAwsCompositionState(aws: string): CompositionState {
  if (aws === 'STARTING') return 'STARTING';
  if (aws === 'ACTIVE') return 'ACTIVE';
  if (aws === 'STOPPING') return 'STARTING';
  if (aws === 'FAILED') return 'FAILED';
  if (aws === 'STOPPED') return 'STOPPED';
  return 'UNKNOWN';
}

export function mapFromGetComposition(comp: {
  state?: string;
  destinations?: Array<{ state?: string }>;
}): CompositionState {
  const destState = comp.destinations && comp.destinations[0] && comp.destinations[0].state;
  if (destState === 'ACTIVE') return 'ACTIVE';
  if (destState === 'RECONNECTING') return 'RECONNECTING';
  if (destState === 'FAILED' || comp.state === 'FAILED') return 'FAILED';
  if (destState === 'STOPPED' || comp.state === 'STOPPED') return 'STOPPED';
  return 'STARTING';
}

export function encoderArnForRegion(region: string): string | undefined {
  const r = String(region || '').trim().toLowerCase();
  const key =
    r === 'eu-west-1' ? 'EUWEST1' : r === 'us-east-1' ? 'USEAST1' : r === 'us-west-2' ? 'USWEST2' : '';
  if (!key) return undefined;
  const arn = String(process.env[`IVS_ENCODER_ARN_LANDSCAPE_${key}`] || '').trim();
  return arn || undefined;
}

/** Fan-out may pull HLS only after SSC is ACTIVE, or the channel is already LIVE. */
export function isProgramReadyForFanout(input: {
  playbackUrl?: string | null;
  compositionState?: CompositionState | null;
  channelLive?: boolean;
}): boolean {
  if (!String(input.playbackUrl || '').trim()) return false;
  if (input.compositionState === 'ACTIVE') return true;
  return input.channelLive === true;
}

/**
 * `/api/live/join` watch mode. CreateChannel always has a playbackUrl;
 * that is not a live picture. HLS only after composition is ACTIVE.
 */
export function massJoinMode(session: {
  playbackUrl?: string | null;
  compositionState?: CompositionState | null;
}): { mode: 'playback' | 'realtime'; playbackUrl?: string } {
  const playbackUrl = String(session.playbackUrl || '').trim();
  if (session.compositionState === 'ACTIVE' && playbackUrl) {
    return { mode: 'playback', playbackUrl };
  }
  return { mode: 'realtime' };
}

function sessionRegion(session: LiveSession): string {
  return session.region || getRegionFromStageArn(session.stageArn);
}

function isNotFound(err: any): boolean {
  const name = String(err?.name || '');
  const status = Number(err?.$metadata?.httpStatusCode);
  return (
    name === 'ResourceNotFoundException' ||
    name === 'ResourceNotFound' ||
    status === 404
  );
}

function isChannelNotBroadcasting(err: any): boolean {
  const name = String(err?.name || '');
  const status = Number(err?.$metadata?.httpStatusCode);
  return (
    name === 'ChannelNotBroadcasting' ||
    name === 'ChannelNotBroadcastingException' ||
    status === 404
  );
}

async function channelStreamIsLive(session: LiveSession): Promise<boolean> {
  if (!session.channelArn) return false;
  try {
    const gs = await getIvsLowLatencyClient(sessionRegion(session)).send(
      new GetStreamCommand({ channelArn: session.channelArn }),
    );
    return gs.stream?.state === 'LIVE';
  } catch (e: any) {
    if (isChannelNotBroadcasting(e)) return false;
    logger.warn(
      { err: e?.message || String(e), sessionId: session.sessionId },
      '[programEgress] GetStream for fan-out ready check failed',
    );
    return false;
  }
}

async function tryRedisSetNx(key: string, exSeconds: number): Promise<'acquired' | 'held' | 'down'> {
  try {
    const redis = getEconomyInfra().redis;
    const ok = await redis.set(key, '1', 'EX', exSeconds, 'NX');
    return ok === 'OK' ? 'acquired' : 'held';
  } catch (e: any) {
    logger.warn({ err: e?.message || String(e), key }, '[programEgress] redis unavailable');
    return 'down';
  }
}

async function tryRedisDel(key: string): Promise<void> {
  try {
    await getEconomyInfra().redis.del(key);
  } catch {
    /* ignore */
  }
}

export async function refreshCompositionFromAws(session: LiveSession): Promise<LiveSession> {
  if (!session.compositionArn) return session;
  try {
    const result = await getIvsRealtimeClient(sessionRegion(session)).send(
      new GetCompositionCommand({ arn: session.compositionArn }),
    );
    const comp = result.composition;
    if (!comp || !comp.state) return session;
    await updateSessionProgram(session.sessionId, {
      compositionState: mapFromGetComposition(comp),
      compositionArn: comp.arn || session.compositionArn,
    });
    return (await getSessionById(session.sessionId)) || session;
  } catch (e: any) {
    if (isNotFound(e)) {
      await updateSessionProgram(session.sessionId, { compositionState: 'STOPPED' });
      return (await getSessionById(session.sessionId)) || session;
    }
    logger.warn(
      { err: e?.message || String(e), sessionId: session.sessionId },
      '[programEgress] GetComposition failed',
    );
    return session;
  }
}

export async function ensureProgram(
  sessionId: string,
  opts?: { hasPublisher?: boolean },
): Promise<void> {
  const lockKey = `live:comp-lock:${sessionId}`;
  let lockHeld = false;
  try {
    const session0 = await getSessionById(sessionId);
    if (!session0 || session0.status !== 'LIVE') return;

    const lock = await tryRedisSetNx(lockKey, 30);
    if (lock === 'held') return;
    lockHeld = lock === 'acquired';

    let session = (await getSessionById(sessionId)) || session0;
    if (!session.channelArn || !session.playbackUrl) {
      logger.warn({ sessionId }, '[programEgress] missing channel; CreateChannel is startLiveSession only');
      return;
    }

    if (session.compositionArn) {
      try {
        const result = await getIvsRealtimeClient(sessionRegion(session)).send(
          new GetCompositionCommand({ arn: session.compositionArn }),
        );
        const awsState = result.composition?.state;
        if (awsState === 'STARTING' || awsState === 'ACTIVE' || awsState === 'STOPPING') {
          await updateSessionProgram(session.sessionId, {
            compositionState: mapFromGetComposition(result.composition || {}),
          });
          return;
        }
      } catch (e: any) {
        if (!isNotFound(e)) {
          logger.warn(
            { err: e?.message || String(e), sessionId },
            '[programEgress] GetComposition unexpected',
          );
          return;
        }
      }
    }

    if (opts?.hasPublisher !== true) {
      await updateSessionProgram(session.sessionId, { compositionState: 'STOPPED' }).catch(() => undefined);
      return;
    }

    const ll = getIvsLowLatencyClient(sessionRegion(session));
    const waitUntilOffline = async (): Promise<'offline' | 'still-live'> => {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        try {
          const gs = await ll.send(new GetStreamCommand({ channelArn: session.channelArn }));
          if (gs.stream?.state === 'LIVE') {
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }
          return 'offline';
        } catch (e: any) {
          if (isChannelNotBroadcasting(e)) return 'offline';
          throw e;
        }
      }
      return 'still-live';
    };

    try {
      const gs = await ll.send(new GetStreamCommand({ channelArn: session.channelArn }));
      if (gs.stream?.state === 'LIVE') {
        const waited = await waitUntilOffline();
        if (waited === 'still-live') {
          logger.warn({ sessionId }, '[programEgress] channel still LIVE after 15s; skip StartComposition');
          return;
        }
      }
    } catch (e: any) {
      if (!isChannelNotBroadcasting(e)) {
        logger.warn({ err: e?.message || String(e), sessionId }, '[programEgress] GetStream unexpected');
        return;
      }
    }

    const encoderConfigurationArn = encoderArnForRegion(sessionRegion(session));
    if (!encoderConfigurationArn) {
      logger.error({ sessionId, region: sessionRegion(session) }, '[programEgress] missing encoder ARN env');
      await updateSessionProgram(session.sessionId, { compositionState: 'FAILED' });
      return;
    }

    try {
      const result = await getIvsRealtimeClient(sessionRegion(session)).send(
        new StartCompositionCommand({
          stageArn: session.stageArn,
          idempotencyToken: `${sessionId}-${Date.now()}`,
          layout: PROGRAM_SSC_LAYOUT,
          destinations: [
            {
              channel: {
                channelArn: session.channelArn,
                encoderConfigurationArn,
              },
            },
          ],
        }),
      );
      const started = result.composition;
      if (!started?.arn) {
        await updateSessionProgram(session.sessionId, { compositionState: 'FAILED' });
        return;
      }
      await updateSessionProgram(session.sessionId, {
        compositionArn: started.arn,
        compositionState: 'STARTING',
      });
    } catch (e: any) {
      logger.error({ err: e?.message || String(e), sessionId }, '[programEgress] StartComposition failed');
      await updateSessionProgram(session.sessionId, { compositionState: 'FAILED' });
    }
  } catch (e: any) {
    logger.error({ err: e?.message || String(e), sessionId }, '[programEgress] ensureProgram failed');
  } finally {
    if (lockHeld) await tryRedisDel(lockKey);
  }
}

/**
 * Start SSC if needed, then require program HLS that actually has an ingest.
 * playbackUrl exists at CreateChannel — that is not enough for RTMP fan-out.
 */
export async function assertProgramReadyForFanout(
  sessionId: string,
): Promise<{ playbackUrl: string }> {
  const session0 = await getSessionById(sessionId);
  if (!session0 || session0.status !== 'LIVE') {
    throw Object.assign(new Error('Session is not live'), { code: 'SESSION_NOT_LIVE' });
  }
  if (!session0.playbackUrl) {
    throw Object.assign(new Error('Program HLS URL not ready yet'), { code: 'HLS_NOT_READY' });
  }

  await ensureProgram(sessionId, { hasPublisher: true });

  let session = (await getSessionById(sessionId)) || session0;
  session = await refreshCompositionFromAws(session);

  if (session.compositionState === 'FAILED') {
    throw Object.assign(new Error('Program composition failed'), { code: 'PROGRAM_FAILED' });
  }

  const channelLive = await channelStreamIsLive(session);
  const playbackUrl = String(session.playbackUrl || session0.playbackUrl || '').trim();
  if (
    isProgramReadyForFanout({
      playbackUrl,
      compositionState: session.compositionState,
      channelLive,
    })
  ) {
    return { playbackUrl };
  }

  throw Object.assign(new Error('Program HLS not ready yet'), { code: 'HLS_NOT_READY' });
}

export async function stopCompositionBestEffort(compositionArn: string | undefined, region: string): Promise<void> {
  if (!compositionArn) return;
  try {
    await getIvsRealtimeClient(region).send(new StopCompositionCommand({ arn: compositionArn }));
  } catch (e: any) {
    logger.warn({ err: e?.message || String(e), compositionArn }, '[programEgress] StopComposition failed');
  }
}
