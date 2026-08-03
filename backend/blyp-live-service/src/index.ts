import './config/env';
import express from 'express';
import cors from 'cors';
import http from 'http';
import liveRoutes from './routes/liveRoutes';
import economyRoutes from './economy/economyRoutes';
import adminRoutes from './admin/adminRoutes';
import appVersionRoutes from './appVersion/appVersionRoutes';
import firebaseTokenRoutes from './auth/firebaseTokenRoutes';

import { getEconomyInfra, checkDb, checkRedis } from './economy/infra';
import { ensureEconomySchema } from './economy/schema';
import { createSocketServer } from './realtime/socketServer';
import { logger } from './config/logger';
import { getAdminAuth } from './config/firebaseAdmin';

const port = (() => {
  const rawPort = process.env.PORT;
  if (rawPort) {
    const parsed = Number(rawPort);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
    console.warn('[live-service] Invalid PORT provided, defaulting to 4000', { rawPort });
  }
  return 4000;
})();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', async (_req, res) => {
  // Liveness check: return 200 if the process/server is up.
  // Dependency readiness is exposed via `ready` and `/ready`.
  try {
    const { db, redis } = getEconomyInfra();
    const [dbStatus, redisStatus] = await Promise.all([checkDb(db), checkRedis(redis)]);
    const ready = dbStatus.ok && redisStatus.ok;
    res.status(200).json({
      ok: true,
      ready,
      service: 'blyp-live-service',
      db: dbStatus,
      redis: redisStatus,
      firebaseAdmin: !!getAdminAuth(),
    });
  } catch (e: any) {
    res.status(200).json({
      ok: true,
      ready: false,
      service: 'blyp-live-service',
      error: e?.message || String(e),
    });
  }
});

app.get('/ready', async (_req, res) => {
  // Readiness check: only return 200 when DB/Redis are reachable.
  try {
    const { db, redis } = getEconomyInfra();
    const [dbStatus, redisStatus] = await Promise.all([checkDb(db), checkRedis(redis)]);
    const ready = dbStatus.ok && redisStatus.ok;
    res.status(ready ? 200 : 503).json({
      ok: ready,
      service: 'blyp-live-service',
      db: dbStatus,
      redis: redisStatus,
    });
  } catch (e: any) {
    res.status(503).json({
      ok: false,
      service: 'blyp-live-service',
      error: e?.message || String(e),
    });
  }
});

// Public update policy is intentionally available before auth so stale clients
// can determine whether to show an update-required screen during startup.
app.use(appVersionRoutes);

// Admin auth surface must be mounted before economy routes because
// economy router applies Cognito middleware at router level.
app.use(adminRoutes);

// Cognito → Firebase custom-token federation (uid = Cognito sub).
app.use(firebaseTokenRoutes);

// Economy contracts (auth required inside router)
app.use(economyRoutes);

app.use('/api', liveRoutes);

app.use((err: any, _req: any, res: any, _next: any) => {
  // Central error handler to avoid unhandled rejections leaking details
  console.error('Unhandled error', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Explicitly bind to 0.0.0.0 so physical devices on LAN can reach the server
async function main() {
  const { db, redis } = getEconomyInfra();

  // For local/dev bring-up we still want the service to boot (so mobile can hit /health
  // and non-economy endpoints), even if DB/Redis aren't available.
  // Schema bootstrap only depends on DB; do not gate it on Redis readiness.
  const [dbStatus, redisStatus] = await Promise.all([checkDb(db), checkRedis(redis)]);
  if (dbStatus.ok) {
    try {
      await ensureEconomySchema(db);
    } catch (e: any) {
      logger.error({ err: e?.message || String(e) }, '[startup] economy schema ensure failed');
    }
  } else {
    logger.warn({ db: dbStatus, redis: redisStatus }, '[startup] DB not ready; starting anyway');
  }

  const server = http.createServer(app);
  createSocketServer(server);

  server.listen(port, '0.0.0.0', () => {
    const url = `http://0.0.0.0:${port}`;
    logger.info(`✅ blyp-live-service LISTENING ${url}`);
    logger.info(`📍 /health endpoint ready`);
    logger.info(`📍 /api/* routes ready`);
    logger.info(`📍 Socket.IO ready`);
  });
}

main().catch((err) => {
  logger.error({ err: err?.message }, '[startup] fatal');
  process.exit(1);
});
