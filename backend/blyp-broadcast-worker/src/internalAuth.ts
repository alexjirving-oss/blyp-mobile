import crypto from 'crypto';
import { randomUUID } from 'crypto';

const HEARTBEAT_MS = 10_000;

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function requireInternalSecret(req: any, res: any, next: any) {
  const expected = String(process.env.INTERNAL_SHARED_SECRET || '').trim();
  if (!expected) {
    return res.status(503).json({ error: 'NOT_CONFIGURED', code: 'NOT_CONFIGURED' });
  }
  const provided = String(req.headers['x-internal-secret'] || '').trim();
  if (!provided || !timingSafeEqual(provided, expected)) {
    return res.status(401).json({ error: 'UNAUTH', code: 'UNAUTH' });
  }
  return next();
}

export function workerIdFromEnv(): string {
  return String(process.env.BROADCAST_WORKER_ID || '').trim() || `bfw_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export async function postHeartbeat(input: {
  workerId: string;
  region: string;
  baseUrl: string;
  status: 'idle' | 'busy';
  sessionId?: string | null;
}): Promise<void> {
  const liveServiceUrl = String(process.env.LIVE_SERVICE_URL || '').trim().replace(/\/+$/, '');
  const secret = String(process.env.INTERNAL_SHARED_SECRET || '').trim();
  if (!liveServiceUrl || !secret) return;

  try {
    await fetch(`${liveServiceUrl}/internal/broadcast/worker/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': secret,
      },
      body: JSON.stringify(input),
    });
  } catch (e: any) {
    console.warn('[heartbeat] failed', e?.message || String(e));
  }
}

export function startHeartbeatLoop(getState: () => {
  workerId: string;
  region: string;
  baseUrl: string;
  status: 'idle' | 'busy';
  sessionId: string | null;
}): NodeJS.Timeout {
  const tick = () => {
    const state = getState();
    void postHeartbeat(state);
  };
  tick();
  return setInterval(tick, HEARTBEAT_MS);
}
