import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { verifyCognitoJwt } from '../auth/verifyCognitoJwt';
import { logger } from '../config/logger';
import { setSocketIo } from './realtimeBus';
import { sanitizeBearerAuthorization, sanitizeHeaderValue } from '../utils/headerSanitize';
import {
  isGrid9Enabled,
  registerGrid9Socket,
} from '../games/grid9/grid9Socket';
import { startGrid9GameLoop } from '../games/grid9/grid9GameLoop';

export type SocketServer = {
  io: Server;
};

// On Cloud Run the live-service autoscales to multiple instances with no session
// affinity. A gift POST and a viewer's websocket frequently land on DIFFERENT
// instances, so an in-memory Socket.IO server would only deliver `gift_event` to
// sockets connected to the SAME instance that processed the send — silently
// dropping gift animations/host notifications for everyone else. Wiring the
// Redis pub/sub adapter fans every emit out to all instances so gifts are
// delivered to every connected client regardless of which instance handled them.
function attachRedisAdapter(io: Server): void {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl || !redisUrl.trim()) {
    logger.warn('[socket] REDIS_URL not set — running Socket.IO without a cross-instance adapter (single-instance only)');
    return;
  }

  try {
    // Dedicated pub/sub connections (the adapter must not share clients with the
    // request-path Redis). Keep them resilient so a transient Redis blip never
    // crashes the process; Socket.IO falls back to local delivery until reconnect.
    const pubClient = new Redis(redisUrl, {
      connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS) || 4000,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: (times: number) => Math.min(2000, 250 * Math.pow(2, Math.max(0, times - 1))),
    });
    const subClient = pubClient.duplicate();

    pubClient.on('error', (err: any) => {
      logger.warn({ code: err?.code, message: err?.message, client: 'socket-pub' }, '[socket] redis adapter error');
    });
    subClient.on('error', (err: any) => {
      logger.warn({ code: err?.code, message: err?.message, client: 'socket-sub' }, '[socket] redis adapter error');
    });
    pubClient.on('ready', () => logger.info('[socket] redis adapter pub client ready'));

    io.adapter(createAdapter(pubClient, subClient));
    logger.info('[socket] Socket.IO Redis adapter attached (cross-instance gift fan-out enabled)');
  } catch (e: any) {
    // Never let adapter wiring take down the socket server; degrade to local.
    logger.error({ err: e?.message || String(e) }, '[socket] failed to attach Redis adapter — degrading to single-instance delivery');
  }
}

export function createSocketServer(server: HttpServer): SocketServer {
  const io = new Server(server, {
    cors: {
      origin: true,
      methods: ['GET', 'POST'],
    },
  });

  attachRedisAdapter(io);

  io.use(async (socket, next) => {
    try {
      const tokenFromAuth = sanitizeHeaderValue(socket.handshake.auth?.token as string | undefined);
      const tokenFromHeader = sanitizeBearerAuthorization(socket.handshake.headers?.authorization as string | undefined).replace(
        /^Bearer\s+/i,
        ''
      );
      const tokenFromQuery = sanitizeHeaderValue(socket.handshake.query?.token as string | undefined);

      const authToken = tokenFromAuth || tokenFromHeader || tokenFromQuery;

      if (!authToken) {
        next(new Error('UNAUTH'));
        return;
      }

      const decoded = await verifyCognitoJwt(authToken);
      const userId = decoded?.sub;
      if (!userId) {
        next(new Error('UNAUTH'));
        return;
      }

      socket.data.userId = userId;
      next();
    } catch (e: any) {
      logger.warn({ err: e?.message }, '[socket] auth failed');
      next(new Error('UNAUTH'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId as string | undefined;
    logger.info({ userId, socketId: socket.id }, '[socket] connected');
    registerGrid9Socket(io, socket);

    socket.on('join', (payload: any) => {
      const streamId = payload?.streamId as string | undefined;
      if (!streamId) return;
      socket.join(`stream:${streamId}`);
    });

    socket.on('leave', (payload: any) => {
      const streamId = payload?.streamId as string | undefined;
      if (!streamId) return;
      socket.leave(`stream:${streamId}`);
    });

    socket.on('disconnect', (reason) => {
      logger.info({ userId, socketId: socket.id, reason }, '[socket] disconnected');
    });
  });

  setSocketIo(io);
  startGrid9GameLoop(io);
  if (isGrid9Enabled()) {
    logger.info('[grid9] authoritative game loop enabled');
  } else {
    logger.info('[grid9] recovery loop active; new matchmaking disabled');
  }

  return { io };
}
