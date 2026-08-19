import { logger } from '../config/logger';
import { assertSessionHost } from './liveService';
import { getRegionFromStageArn } from '../aws/ivsRealtimeClient';
import {
  type BroadcastPlatform,
  type BroadcastProfile,
  validateRtmpCredentials,
  buildRtmpPublishUrl,
  profileForPlatform,
  BROADCAST_PROVISIONING_ETA_SECONDS,
} from './broadcastRtmpValidate';
import { broadcastCryptoConfigured } from './broadcastSecretCrypto';
import {
  upsertBroadcastSession,
  getBroadcastSession,
  listBroadcastDestinations,
  replaceBroadcastDestinations,
  updateBroadcastPhase,
  markBroadcastStopped,
  decodeDestinationSecret,
  updateDestinationCredentials,
  publicSessionView,
  type BroadcastDestinationRow,
} from './broadcastStore';
import {
  tryLeaseWorker,
  storePendingJob,
  loadJob,
  dispatchJobToWorker,
  releaseWorkerLease,
  stopWorkerJob,
  swapWorkerRelayTarget,
  peekQueuedSessionId,
  removeQueuedSessionId,
  assignLeaseToWorker,
  type BroadcastJobPayload,
  type BroadcastWorkerRecord,
  provisioningFallback,
} from './broadcastWorkerPool';
import { assertProgramReadyForFanout } from './programEgress';

export type BroadcastDestinationInput = {
  platform: BroadcastPlatform;
  rtmpUrl: string;
  streamKey: string;
  profile?: BroadcastProfile;
  expiresAt?: string | null;
};

function internalSecret(): string {
  return String(process.env.INTERNAL_SHARED_SECRET || '').trim();
}

function relayPathFor(platform: string, destinationId: string): string {
  return `${platform}-${destinationId.slice(0, 8)}`;
}

function sessionRegion(session: { region?: string; stageArn: string }): string {
  return session.region || getRegionFromStageArn(session.stageArn);
}

function buildJobPayload(
  sessionId: string,
  region: string,
  hlsUrl: string,
  destinations: BroadcastDestinationRow[],
): BroadcastJobPayload {
  return {
    sessionId,
    region,
    hlsUrl,
    destinations: destinations.map((d) => {
      const secret = decodeDestinationSecret(d);
      return {
        destinationId: d.destination_id,
        platform: d.platform,
        profile: d.profile,
        publishUrl: buildRtmpPublishUrl(secret.rtmpUrl, secret.streamKey),
        relayPath: d.relay_path || relayPathFor(d.platform, d.destination_id),
      };
    }),
  };
}

export async function broadcastPrepare(input: {
  sessionId: string;
  hostUserId: string;
  destinations: BroadcastDestinationInput[];
}): Promise<{
  ok: true;
  view: ReturnType<typeof publicSessionView>;
}> {
  if (!broadcastCryptoConfigured()) {
    throw Object.assign(new Error('Broadcast encryption not configured'), { code: 'NOT_CONFIGURED' });
  }

  const session = await assertSessionHost(input.sessionId, input.hostUserId);
  if (session.status !== 'LIVE') {
    throw Object.assign(new Error('Session is not live'), { code: 'SESSION_NOT_LIVE' });
  }

  const region = sessionRegion(session);
  const validated: Array<{
    platform: BroadcastPlatform;
    profile: BroadcastProfile;
    rtmpUrl: string;
    streamKey: string;
    expiresAt?: string | null;
    relayPath: string;
  }> = [];

  for (const dest of input.destinations) {
    const v = validateRtmpCredentials(dest.rtmpUrl, dest.streamKey);
    if (!v.ok) {
      throw Object.assign(new Error(v.detail), { code: v.code });
    }
    const platform = dest.platform;
    const profile = dest.profile || profileForPlatform(platform);
    validated.push({
      platform,
      profile,
      rtmpUrl: v.rtmpUrl,
      streamKey: v.streamKey,
      expiresAt: dest.expiresAt ?? (platform === 'tiktok' ? new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() : null),
      relayPath: relayPathFor(platform, `${input.sessionId}-${platform}`),
    });
  }

  await upsertBroadcastSession({
    sessionId: input.sessionId,
    hostUserId: input.hostUserId,
    region,
    hlsUrl: session.playbackUrl ?? null,
    phase: 'preflight',
  });

  await replaceBroadcastDestinations(
    input.sessionId,
    validated.map((d) => ({
      platform: d.platform,
      profile: d.profile,
      rtmpUrl: d.rtmpUrl,
      streamKey: d.streamKey,
      expiresAt: d.expiresAt,
      relayPath: d.relayPath,
    })),
  );

  const rows = await listBroadcastDestinations(input.sessionId);
  const broadcast = await getBroadcastSession(input.sessionId);
  if (!broadcast) {
    throw Object.assign(new Error('Broadcast session missing after preflight'), { code: 'INTERNAL' });
  }

  return { ok: true, view: publicSessionView(broadcast, rows) };
}

export async function broadcastStart(input: {
  sessionId: string;
  hostUserId: string;
}): Promise<{
  ok: true;
  view: ReturnType<typeof publicSessionView>;
}> {
  const session = await assertSessionHost(input.sessionId, input.hostUserId);
  if (session.status !== 'LIVE') {
    throw Object.assign(new Error('Session is not live'), { code: 'SESSION_NOT_LIVE' });
  }

  const program = await assertProgramReadyForFanout(input.sessionId);

  const broadcast = await getBroadcastSession(input.sessionId);
  if (!broadcast || broadcast.phase === 'idle') {
    throw Object.assign(new Error('Run broadcast prepare before start'), { code: 'PREFLIGHT_REQUIRED' });
  }

  const destinations = await listBroadcastDestinations(input.sessionId);
  if (!destinations.length) {
    throw Object.assign(new Error('No broadcast destinations configured'), { code: 'NO_DESTINATIONS' });
  }

  const region = sessionRegion(session);
  const job = buildJobPayload(input.sessionId, region, program.playbackUrl, destinations);
  const secret = internalSecret();
  if (!secret) {
    throw Object.assign(new Error('INTERNAL_SHARED_SECRET not configured'), { code: 'NOT_CONFIGURED' });
  }

  const lease = await tryLeaseWorker(input.sessionId, region);
  if (!lease.ok) {
    await storePendingJob(job);
    const fb = provisioningFallback();
    await updateBroadcastPhase(input.sessionId, 'provisioning', {
      hlsUrl: program.playbackUrl,
      provisioningEtaSeconds: fb.provisioningEtaSeconds,
      workerId: null,
      workerBaseUrl: null,
      errorDetail: null,
    });
    const updated = await getBroadcastSession(input.sessionId);
    const destRows = await listBroadcastDestinations(input.sessionId);
    logger.info({ sessionId: input.sessionId, region }, '[broadcast] queued — no warm worker');
    return {
      ok: true,
      view: publicSessionView(updated!, destRows),
    };
  }

  return startOnWorker(input.sessionId, lease.worker, job, program.playbackUrl);
}

async function startOnWorker(
  sessionId: string,
  worker: BroadcastWorkerRecord,
  job: BroadcastJobPayload,
  hlsUrl: string,
): Promise<{ ok: true; view: ReturnType<typeof publicSessionView> }> {
  const secret = internalSecret();
  await updateBroadcastPhase(sessionId, 'starting', {
    workerId: worker.workerId,
    workerBaseUrl: worker.baseUrl,
    hlsUrl,
    provisioningEtaSeconds: null,
    errorDetail: null,
  });

  const dispatched = await dispatchJobToWorker(worker, job, secret);
  if (!dispatched.ok) {
    await updateBroadcastPhase(sessionId, 'failed', {
      errorDetail: dispatched.detail || 'worker_dispatch_failed',
      workerId: worker.workerId,
      workerBaseUrl: worker.baseUrl,
    });
    await releaseWorkerLease(sessionId);
    throw Object.assign(new Error(dispatched.detail || 'Worker dispatch failed'), { code: 'WORKER_DISPATCH_FAILED' });
  }

  await updateBroadcastPhase(sessionId, 'live', {
    workerId: worker.workerId,
    workerBaseUrl: worker.baseUrl,
    hlsUrl,
  });

  const updated = await getBroadcastSession(sessionId);
  const destRows = await listBroadcastDestinations(sessionId);
  logger.info({ sessionId, workerId: worker.workerId }, '[broadcast] fan-out started');
  return { ok: true, view: publicSessionView(updated!, destRows) };
}

/** Worker heartbeat hook: claim a queued session when idle. */
export async function broadcastClaimQueuedJob(input: {
  workerId: string;
  region: string;
  baseUrl: string;
}): Promise<{ claimed: boolean; sessionId?: string }> {
  const sessionId = await peekQueuedSessionId(input.region);
  if (!sessionId) return { claimed: false };

  const job = await loadJob(sessionId);
  if (!job) {
    await removeQueuedSessionId(input.region, sessionId);
    return { claimed: false };
  }

  const worker: BroadcastWorkerRecord = {
    workerId: input.workerId,
    region: input.region,
    baseUrl: input.baseUrl.replace(/\/+$/, ''),
    status: 'idle',
    sessionId: null,
    heartbeatAt: new Date().toISOString(),
  };

  const leased = await assignLeaseToWorker(sessionId, worker);
  if (!leased) return { claimed: false };

  try {
    const program = await assertProgramReadyForFanout(sessionId);
    await removeQueuedSessionId(input.region, sessionId);
    await startOnWorker(
      sessionId,
      { ...worker, status: 'busy', sessionId },
      { ...job, hlsUrl: program.playbackUrl },
      program.playbackUrl,
    );
    return { claimed: true, sessionId };
  } catch (e: any) {
    await releaseWorkerLease(sessionId);
    if (String(e?.code || '') === 'HLS_NOT_READY') {
      return { claimed: false };
    }
    await removeQueuedSessionId(input.region, sessionId);
    await updateBroadcastPhase(sessionId, 'failed', {
      errorDetail: e?.message || 'program_not_ready',
    }).catch(() => undefined);
    return { claimed: false };
  }
}

export async function broadcastGetStatus(input: {
  sessionId: string;
  hostUserId: string;
}): Promise<{ ok: true; view: ReturnType<typeof publicSessionView> }> {
  await assertSessionHost(input.sessionId, input.hostUserId);
  const broadcast = await getBroadcastSession(input.sessionId);
  const destinations = await listBroadcastDestinations(input.sessionId);
  if (!broadcast) {
    return {
      ok: true,
      view: {
        sessionId: input.sessionId,
        phase: 'idle',
        region: '',
        workerAssigned: false,
        provisioningEtaSeconds: null,
        message: null,
        errorDetail: null,
        destinations: destinations.map((d) => ({
          destinationId: d.destination_id,
          platform: d.platform,
          profile: d.profile,
          status: d.status,
          expiresAt: d.expires_at ? new Date(d.expires_at).toISOString() : null,
          lastError: d.last_error,
          relayPath: d.relay_path,
        })),
        updatedAt: new Date().toISOString(),
      },
    };
  }
  return { ok: true, view: publicSessionView(broadcast, destinations) };
}

/** TikTok key refresh — swaps outbound relay pusher only (FFmpeg main encoder keeps running). */
export async function broadcastSwapTikTok(input: {
  sessionId: string;
  hostUserId: string;
  rtmpUrl: string;
  streamKey: string;
  expiresAt?: string | null;
}): Promise<{ ok: true; view: ReturnType<typeof publicSessionView> }> {
  await assertSessionHost(input.sessionId, input.hostUserId);
  const v = validateRtmpCredentials(input.rtmpUrl, input.streamKey);
  if (!v.ok) {
    throw Object.assign(new Error(v.detail), { code: v.code });
  }

  const broadcast = await getBroadcastSession(input.sessionId);
  if (!broadcast?.worker_id || !broadcast.worker_base_url) {
    throw Object.assign(new Error('No active fan-out worker for this session'), { code: 'WORKER_NOT_ASSIGNED' });
  }

  const row = await updateDestinationCredentials(
    input.sessionId,
    'tiktok',
    { rtmpUrl: v.rtmpUrl, streamKey: v.streamKey },
    input.expiresAt ?? new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  );
  if (!row) {
    throw Object.assign(new Error('TikTok destination not found'), { code: 'NOT_FOUND' });
  }

  const secret = internalSecret();
  if (!secret) {
    throw Object.assign(new Error('INTERNAL_SHARED_SECRET not configured'), { code: 'NOT_CONFIGURED' });
  }

  const worker: BroadcastWorkerRecord = {
    workerId: broadcast.worker_id,
    region: broadcast.region,
    baseUrl: broadcast.worker_base_url,
    status: 'busy',
    sessionId: input.sessionId,
    heartbeatAt: new Date().toISOString(),
  };

  const swapped = await swapWorkerRelayTarget({
    worker,
    sessionId: input.sessionId,
    relayPath: row.relay_path || relayPathFor('tiktok', row.destination_id),
    publishUrl: buildRtmpPublishUrl(v.rtmpUrl, v.streamKey),
    profile: row.profile,
    internalSecret: secret,
  });

  if (!swapped.ok) {
    throw Object.assign(new Error(swapped.detail || 'Relay swap failed'), { code: 'RELAY_SWAP_FAILED' });
  }

  const updated = await getBroadcastSession(input.sessionId);
  const destinations = await listBroadcastDestinations(input.sessionId);
  return { ok: true, view: publicSessionView(updated!, destinations) };
}

export async function broadcastStopForSession(sessionId: string): Promise<void> {
  const broadcast = await getBroadcastSession(sessionId);
  if (!broadcast) return;

  const secret = internalSecret();
  if (broadcast.worker_id && broadcast.worker_base_url && secret) {
    await stopWorkerJob(
      {
        workerId: broadcast.worker_id,
        region: broadcast.region,
        baseUrl: broadcast.worker_base_url,
        status: 'busy',
        sessionId,
        heartbeatAt: new Date().toISOString(),
      },
      sessionId,
      secret,
    );
  }

  await releaseWorkerLease(sessionId);
  await markBroadcastStopped(sessionId);
  logger.info({ sessionId }, '[broadcast] stopped');
}

export { BROADCAST_PROVISIONING_ETA_SECONDS };
