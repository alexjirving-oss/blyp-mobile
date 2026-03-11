import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { verifyCognitoJwt } from '../auth/verifyCognitoJwt';
import { logger } from '../config/logger';
import { setSocketIo } from './realtimeBus';
import { sanitizeBearerAuthorization, sanitizeHeaderValue } from '../utils/headerSanitize';

export type SocketServer = {
  io: Server;
};

export function createSocketServer(server: HttpServer): SocketServer {
  const io = new Server(server, {
    cors: {
      origin: true,
      methods: ['GET', 'POST'],
    },
  });

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

  return { io };
}
