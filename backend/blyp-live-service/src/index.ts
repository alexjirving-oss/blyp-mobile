import './config/env';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import http from 'http';
import liveRoutes from './routes/liveRoutes';
import roomsRoutes from './routes/roomsRoutes';
import gameRoutes from './routes/gameRoutes';
import marbleRoutes from './routes/marbleRoutes';
import frenemiesRoutes from './routes/frenemiesRoutes';
import reactionDuelRoutes from './routes/reactionDuelRoutes';
import economyRoutes from './economy/economyRoutes';
import internalRoutes from './internal/internalRoutes';
import adminRoutes from './admin/adminRoutes';
import { ensureAdminSchema } from './admin/adminSchema';
import { getEconomyInfra, checkDb, checkRedis } from './economy/infra';
import { ensureEconomySchema } from './economy/schema';
import { createSocketServer } from './realtime/socketServer';
import { logger } from './config/logger';

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

// Wallet polls every few seconds from the app. Express's default weak ETag makes
// OkHttp send If-None-Match and receive HTTP 304 with an empty body. RN fetch
// then fails JSON parse, so the UI keeps its initial balance of 0 even when
// Postgres has coins. Disable ETags and force no-store for all JSON API GETs.
app.set('etag', false);
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
  }
  next();
});

// Security headers (safe defaults for a JSON API; CSP disabled since we serve no HTML).
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));

// CORS: native mobile clients send no Origin (always allowed). Browser origins
// (the admin dashboard) are restricted to an env-driven allowlist. If the
// allowlist is unset we log and fall back to permissive so prod/admin never
// breaks on a missing config — set CORS_ALLOWED_ORIGINS to lock it down (P1.6).
const corsAllowlist = String(process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (corsAllowlist.length === 0) {
  logger.warn('[cors] CORS_ALLOWED_ORIGINS not set — allowing all browser origins (set it to restrict)');
}
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // native apps / server-to-server
      if (corsAllowlist.length === 0) return cb(null, true);
      if (corsAllowlist.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
  }),
);

// Stripe webhooks need the raw body for signature verification — mount BEFORE json parser.
app.post(
  '/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { handleStripeWebhook } = require('./economy/withdrawalService');
      const sig = req.headers['stripe-signature'];
      const out = await handleStripeWebhook(
        Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || '')),
        typeof sig === 'string' ? sig : Array.isArray(sig) ? sig[0] : undefined,
      );
      res.status(200).json(out);
    } catch (e: any) {
      const status = Number(e?.httpStatus) || 400;
      res.status(status).json({ error: e?.message || 'webhook failed', code: e?.code });
    }
  },
);

// Cap request body size to blunt memory-exhaustion abuse (payloads here are small).
app.use(express.json({ limit: '1mb' }));

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

// Admin dashboard API (self-contained auth via requireAdmin / per-route cognito).
// Must be mounted BEFORE economyRoutes, whose router-level cognito middleware
// otherwise intercepts every unauthenticated request (including /admin/auth/login).
app.use(adminRoutes);

// Internal service-to-service routes (shared-secret auth). Must be mounted
// BEFORE economyRoutes for the same reason adminRoutes is: the economy router's
// router-level Cognito middleware would otherwise reject these as unauthenticated.
app.use(internalRoutes);

// Economy contracts (auth required inside router)
app.use(economyRoutes);

app.use('/api', liveRoutes);

// Hostless, topic-based group video rooms (open-seat, symmetric multi-party).
app.use('/api', roomsRoutes);

// Blyp Artillery — server-authoritative battle-stage game (gated by
// LIVE_ARTILLERY_ENABLED inside the router).
app.use('/api', gameRoutes);

// Blyp Marble Race — Guest Grand Prix overlay (gated by LIVE_MARBLE_RACE_ENABLED).
app.use('/api', marbleRoutes);

// Frenemies live party game + session engagement tallies.
app.use('/api', frenemiesRoutes);

// Reaction Duel — paid, server-authoritative two-player live skill game.
app.use('/api', reactionDuelRoutes);

app.use((err: any, _req: any, res: any, _next: any) => {
  // Central error handler to avoid unhandled rejections leaking details
  console.error('Unhandled error', err);
  res.status(500).json({ error: 'Internal server error' });
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Ensure DB schema is bootstrapped without blocking server startup.
// On Cloud Run the VPC/Redis/DB connections are frequently NOT ready during the
// very first readiness probe, so a one-shot gate at boot would permanently skip
// schema creation on a cold DB. This retries (out of band of listen()) until the
// database is reachable, then runs the idempotent ensures exactly once.
async function bootstrapSchemaWithRetry(db: any): Promise<void> {
  const maxAttempts = 30;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const dbStatus = await checkDb(db);
    if (dbStatus.ok) {
      try {
        await ensureEconomySchema(db);
      } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[startup] economy schema ensure failed');
      }
      try {
        await ensureAdminSchema(db);
      } catch (e: any) {
        logger.error({ err: e?.message || String(e) }, '[startup] admin schema ensure failed');
      }
      logger.info({ attempt }, '[startup] schema bootstrap complete');
      return;
    }
    logger.warn({ attempt, db: dbStatus }, '[startup] DB not ready; retrying schema bootstrap');
    await sleep(2000);
  }
  logger.error('[startup] DB never became ready; schema bootstrap abandoned');
}

// Explicitly bind to 0.0.0.0 so physical devices on LAN can reach the server
async function main() {
  const { db } = getEconomyInfra();

  const server = http.createServer(app);
  createSocketServer(server);

  server.listen(port, '0.0.0.0', () => {
    const url = `http://0.0.0.0:${port}`;
    logger.info(`✅ blyp-live-service LISTENING ${url}`);
    logger.info(`📍 /health endpoint ready`);
    logger.info(`📍 /api/* routes ready`);
    logger.info(`📍 Socket.IO ready`);
  });

  // Kick off schema bootstrap in the background so listen() (and thus the
  // Cloud Run startup probe) is never delayed by a cold database.
  void bootstrapSchemaWithRetry(db);
}

main().catch((err) => {
  logger.error({ err: err?.message }, '[startup] fatal');
  process.exit(1);
});
