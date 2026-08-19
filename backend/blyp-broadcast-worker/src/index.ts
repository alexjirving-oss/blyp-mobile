import 'dotenv/config';
import express from 'express';
import { RelayJobRunner, type JobPayload } from './jobRunner';
import {
  requireInternalSecret,
  workerIdFromEnv,
  startHeartbeatLoop,
} from './internalAuth';

const port = Number(process.env.PORT || 4100);
const region = String(process.env.BROADCAST_WORKER_REGION || 'eu-west-1').trim();
const workerId = workerIdFromEnv();
const publicBaseUrl = String(process.env.BROADCAST_WORKER_PUBLIC_URL || `http://127.0.0.1:${port}`).trim();

const runner = new RelayJobRunner();
const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'blyp-broadcast-worker',
    workerId,
    region,
    activeSessionId: runner.activeSessionId(),
  });
});

app.post('/internal/job/start', requireInternalSecret, async (req, res) => {
  try {
    const payload = req.body as JobPayload;
    if (!payload?.sessionId || !payload?.hlsUrl || !Array.isArray(payload.destinations)) {
      return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
    }
    await runner.startJob(payload);
    return res.json({ ok: true, sessionId: payload.sessionId });
  } catch (e: any) {
    console.error('[job/start] failed', e?.message || String(e));
    return res.status(500).json({ error: e?.message || 'start_failed', code: 'INTERNAL' });
  }
});

app.post('/internal/job/stop', requireInternalSecret, async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || '').trim();
    if (!sessionId) {
      return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
    }
    await runner.stopJob(sessionId);
    return res.json({ ok: true, sessionId });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'stop_failed', code: 'INTERNAL' });
  }
});

app.post('/internal/job/swap-relay', requireInternalSecret, async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || '').trim();
    const relayPath = String(req.body?.relayPath || '').trim();
    const publishUrl = String(req.body?.publishUrl || '').trim();
    const profile = String(req.body?.profile || 'portrait_crop').trim();
    if (!sessionId || !relayPath || !publishUrl) {
      return res.status(400).json({ error: 'INVALID_INPUT', code: 'INVALID_INPUT' });
    }
    await runner.swapRelayTarget({ sessionId, relayPath, publishUrl, profile });
    return res.json({ ok: true, sessionId, relayPath });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'swap_failed', code: 'INTERNAL' });
  }
});

startHeartbeatLoop(() => ({
  workerId,
  region,
  baseUrl: publicBaseUrl,
  status: runner.activeSessionId() ? 'busy' : 'idle',
  sessionId: runner.activeSessionId(),
}));

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`[blyp-broadcast-worker] listening on ${port} workerId=${workerId} region=${region}`);
});

async function shutdown() {
  await runner.shutdown();
  server.close();
  process.exit(0);
}

process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
