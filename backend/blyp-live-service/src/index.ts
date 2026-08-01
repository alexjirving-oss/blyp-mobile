import './config/env';
import express from 'express';
import cors from 'cors';
import http from 'http';
import liveRoutes from './routes/liveRoutes';
import economyRoutes from './economy/economyRoutes';
import adminRoutes from './admin/adminRoutes';
import appVersionRoutes from './appVersion/appVersionRoutes';

import { getEconomyInfra, checkDb, checkRedis } from './economy/infra';
import { createSocketServer } from './realtime/socketServer';
import { logger } from './config/logger';
import { platformRouter } from './platform/routes';
import {
  platformErrorHandler,
  platformNotFound,
  requestContextMiddleware,
} from './platform/gatewayMiddleware';
import { runPlatformMigrations } from './platform/migrations/runner';
import { trustRouter } from './trust/trustRoutes';

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
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '1mb' }));
app.use(requestContextMiddleware);

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

// Economy contracts (auth required inside router)
app.use(economyRoutes);

// New domain work is mounted only beneath the explicit v1 gateway contract.
app.use('/api/v1/platform', platformRouter);
app.use('/api/v1/trust', trustRouter);
app.use('/api/v1', platformNotFound);

// Legacy live routes remain available at /api/* until their domain migrations cut over.
app.use('/api', liveRoutes);

app.use((err: unknown, req: any, res: any, next: any) => {
  if (String(req.originalUrl || '').startsWith('/api/v1/')) {
    return platformErrorHandler(err, req, res, next);
  }
  logger.error(
    { err: err instanceof Error ? err.message : String(err) },
    '[legacy_http_unhandled_error]'
  );
  res.status(500).json({ error: 'Internal server error' });
});

// Explicitly bind to 0.0.0.0 so physical devices on LAN can reach the server
async function main() {
  const { db, redis } = getEconomyInfra();

  const [dbStatus, redisStatus] = await Promise.all([checkDb(db), checkRedis(redis)]);
  const allowDegradedStartup =
    process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEGRADED_STARTUP === 'true';

  if (!dbStatus.ok || !redisStatus.ok) {
    if (!allowDegradedStartup) {
      throw new Error(
        `Required dependencies are unavailable (db=${dbStatus.ok}, redis=${redisStatus.ok}).`
      );
    }
    logger.warn({ db: dbStatus, redis: redisStatus }, '[startup] degraded local startup explicitly enabled');
  }

  if (dbStatus.ok) {
    await runPlatformMigrations(db);
  }

  const server = http.createServer(app);
  createSocketServer(server);

  server.listen(port, '0.0.0.0', () => {
    const url = `http://0.0.0.0:${port}`;
    logger.info(`✅ blyp-live-service LISTENING ${url}`);
    logger.info(`📍 /health endpoint ready`);
    logger.info(`📍 /api/v1/platform/* contract ready`);
    logger.info(`📍 /api/v1/trust/* contract ready`);
    logger.info(`📍 /api/* legacy routes ready`);

    logger.info(`📍 Socket.IO ready`);
  });
}

main().catch((err) => {
  logger.error({ err: err?.message }, '[startup] fatal');
  process.exit(1);
});
