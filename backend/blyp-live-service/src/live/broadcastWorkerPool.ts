import { randomUUID } from 'crypto';
import { getEconomyInfra } from '../economy/infra';
import { logger } from '../config/logger';
import { BROADCAST_PROVISIONING_ETA_SECONDS } from './broadcastRtmpValidate';

export type BroadcastWorkerRecord = {
  workerId: string;
  region: string;
  baseUrl: string;
  status: 'idle' | 'busy';
  sessionId?: string | null;
  heartbeatAt: string;
};

export type WorkerLeaseResult =
  | { ok: true; worker: BroadcastWorkerRecord }
  | { ok: false; reason: 'no_workers' | 'redis_down' };

const WORKER_KEY_PREFIX = 'broadcast:worker:';
const LEASE_KEY_PREFIX = 'broadcast:lease:';
const QUEUE_KEY_PREFIX = 'broadcast:queue:';
const JOB_KEY_PREFIX = 'broadcast:job:';

function workerKey(workerId: string): string {
  return `${WORKER_KEY_PREFIX}${workerId}`;
}

function leaseKey(sessionId: string): string {
  return `${LEASE_KEY_PREFIX}${sessionId}`;
}

function queueKey(region: string): string {
  return `${QUEUE_KEY_PREFIX}${region}`;
}

function jobKey(sessionId: string): string {
  return `${JOB_KEY_PREFIX}${sessionId}`;
}

export function newWorkerId(): string {
  return `bfw_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export async function registerWorkerHeartbeat(input: {
  workerId: string;
  region: string;
  baseUrl: string;
  status: 'idle' | 'busy';
  sessionId?: string | null;
}): Promise<void> {
  const { redis } = getEconomyInfra();
  const record: BroadcastWorkerRecord = {
    workerId: input.workerId,
    region: input.region,
    baseUrl: input.baseUrl.replace(/\/+$/, ''),
    status: input.status,
    sessionId: input.sessionId ?? null,
    heartbeatAt: new Date().toISOString(),
  };
  await redis.set(workerKey(input.workerId), JSON.stringify(record), 'EX', 30);
}

export async function listIdleWorkers(region: string): Promise<BroadcastWorkerRecord[]> {
  try {
    const { redis } = getEconomyInfra();
    const keys = await redis.keys(`${WORKER_KEY_PREFIX}*`);
    const out: BroadcastWorkerRecord[] = [];
    for (const key of keys) {
      const raw = await redis.get(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as BroadcastWorkerRecord;
        if (parsed.region === region && parsed.status === 'idle') {
          out.push(parsed);
        }
      } catch {
        /* skip corrupt */
      }
    }
    out.sort((a, b) => a.heartbeatAt.localeCompare(b.heartbeatAt));
    return out;
  } catch (e: any) {
    logger.warn({ err: e?.message || String(e) }, '[broadcast] listIdleWorkers redis fail');
    return [];
  }
}

export async function tryLeaseWorker(sessionId: string, region: string): Promise<WorkerLeaseResult> {
  try {
    const { redis } = getEconomyInfra();
    const existingLease = await redis.get(leaseKey(sessionId));
    if (existingLease) {
      const raw = await redis.get(workerKey(existingLease));
      if (raw) {
        const worker = JSON.parse(raw) as BroadcastWorkerRecord;
        return { ok: true, worker };
      }
    }

    const idleWorkers = await listIdleWorkers(region);
    for (const worker of idleWorkers) {
      const acquired = await redis.set(leaseKey(sessionId), worker.workerId, 'EX', 14400, 'NX');
      if (acquired !== 'OK') continue;
      await registerWorkerHeartbeat({
        workerId: worker.workerId,
        region: worker.region,
        baseUrl: worker.baseUrl,
        status: 'busy',
        sessionId,
      });
      return { ok: true, worker };
    }
    return { ok: false, reason: 'no_workers' };
  } catch (e: any) {
    logger.warn({ err: e?.message || String(e), sessionId }, '[broadcast] tryLeaseWorker fail');
    return { ok: false, reason: 'redis_down' };
  }
}

export async function releaseWorkerLease(sessionId: string): Promise<void> {
  try {
    const { redis } = getEconomyInfra();
    const workerId = await redis.get(leaseKey(sessionId));
    if (workerId) {
      const raw = await redis.get(workerKey(workerId));
      if (raw) {
        const worker = JSON.parse(raw) as BroadcastWorkerRecord;
        await registerWorkerHeartbeat({
          workerId: worker.workerId,
          region: worker.region,
          baseUrl: worker.baseUrl,
          status: 'idle',
          sessionId: null,
        });
      }
    }
    await redis.del(leaseKey(sessionId));
    await redis.del(jobKey(sessionId));
  } catch (e: any) {
    logger.warn({ err: e?.message || String(e), sessionId }, '[broadcast] releaseWorkerLease fail');
  }
}

export type BroadcastJobPayload = {
  sessionId: string;
  region: string;
  hlsUrl: string;
  destinations: Array<{
    destinationId: string;
    platform: string;
    profile: string;
    publishUrl: string;
    relayPath: string;
  }>;
};

export async function storePendingJob(payload: BroadcastJobPayload): Promise<void> {
  const { redis } = getEconomyInfra();
  await redis.set(jobKey(payload.sessionId), JSON.stringify(payload), 'EX', 14400);
  await redis.rpush(queueKey(payload.region), payload.sessionId);
}

export async function loadJob(sessionId: string): Promise<BroadcastJobPayload | null> {
  try {
    const { redis } = getEconomyInfra();
    const raw = await redis.get(jobKey(sessionId));
    if (!raw) return null;
    return JSON.parse(raw) as BroadcastJobPayload;
  } catch {
    return null;
  }
}

export async function peekQueuedSessionId(region: string): Promise<string | null> {
  try {
    const { redis } = getEconomyInfra();
    const items = await redis.lrange(queueKey(region), 0, 0);
    return items[0] ? String(items[0]) : null;
  } catch {
    return null;
  }
}

export async function removeQueuedSessionId(region: string, sessionId: string): Promise<void> {
  try {
    const { redis } = getEconomyInfra();
    await redis.lrem(queueKey(region), 1, sessionId);
  } catch {
    /* best effort */
  }
}

export async function assignLeaseToWorker(
  sessionId: string,
  worker: BroadcastWorkerRecord,
): Promise<boolean> {
  try {
    const { redis } = getEconomyInfra();
    const acquired = await redis.set(leaseKey(sessionId), worker.workerId, 'EX', 14400, 'NX');
    if (acquired !== 'OK') return false;
    await registerWorkerHeartbeat({
      workerId: worker.workerId,
      region: worker.region,
      baseUrl: worker.baseUrl,
      status: 'busy',
      sessionId,
    });
    return true;
  } catch {
    return false;
  }
}

export async function popQueuedSessionId(region: string): Promise<string | null> {
  try {
    const { redis } = getEconomyInfra();
    const id = await redis.lpop(queueKey(region));
    return id ? String(id) : null;
  } catch {
    return null;
  }
}

export function provisioningFallback() {
  return {
    phase: 'provisioning' as const,
    provisioningEtaSeconds: BROADCAST_PROVISIONING_ETA_SECONDS,
    message: `Provisioning broadcast servers (~${BROADCAST_PROVISIONING_ETA_SECONDS}s)...`,
  };
}

export async function dispatchJobToWorker(
  worker: BroadcastWorkerRecord,
  payload: BroadcastJobPayload,
  internalSecret: string,
): Promise<{ ok: boolean; detail?: string }> {
  const url = `${worker.baseUrl}/internal/job/start`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': internalSecret,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, detail: text || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, detail: e?.message || String(e) };
  }
}

export async function stopWorkerJob(
  worker: BroadcastWorkerRecord,
  sessionId: string,
  internalSecret: string,
): Promise<void> {
  const url = `${worker.baseUrl}/internal/job/stop`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': internalSecret,
      },
      body: JSON.stringify({ sessionId }),
    });
  } catch (e: any) {
    logger.warn({ err: e?.message || String(e), sessionId }, '[broadcast] stopWorkerJob fail');
  }
}

export async function swapWorkerRelayTarget(input: {
  worker: BroadcastWorkerRecord;
  sessionId: string;
  relayPath: string;
  publishUrl: string;
  profile: string;
  internalSecret: string;
}): Promise<{ ok: boolean; detail?: string }> {
  const url = `${input.worker.baseUrl}/internal/job/swap-relay`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': input.internalSecret,
      },
      body: JSON.stringify({
        sessionId: input.sessionId,
        relayPath: input.relayPath,
        publishUrl: input.publishUrl,
        profile: input.profile,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, detail: text || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, detail: e?.message || String(e) };
  }
}
