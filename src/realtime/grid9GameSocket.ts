import { io, type Socket } from 'socket.io-client';
import { getCognitoJwtForApi } from '../api/getCognitoJwtForApi';
import { resolveEconomySocketUrl } from '../api/economyLiveApi';
import { GRID9_SOCKET_CHANNEL } from '../games/grid9/constants';
import type { Grid9ClientIntent, Grid9ServerEvent } from '../games/grid9/protocol';

export async function getGrid9SocketAuthToken(): Promise<string> {
  return getCognitoJwtForApi({ tokenType: 'id' });
}

export function createGrid9Socket(
  getToken: () => Promise<string> = getGrid9SocketAuthToken,
): Socket {
  return io(resolveEconomySocketUrl(), {
    autoConnect: false,
    transports: ['websocket'],
    reconnection: true,
    auth: (callback: (data: { token: string } | Error) => void) => {
      getToken()
        .then((token) => callback({ token }))
        .catch((error: unknown) =>
          callback(error instanceof Error ? error : new Error('Grid 9 auth failed')),
        );
    },
  });
}

export function emitGrid9Intent(socket: Socket, intent: Grid9ClientIntent): void {
  socket.emit(GRID9_SOCKET_CHANNEL, intent);
}

export function subscribeGrid9Channel(
  socket: Socket,
  onEvent: (event: unknown) => void,
): () => void {
  socket.on(GRID9_SOCKET_CHANNEL, onEvent);
  return () => {
    socket.off(GRID9_SOCKET_CHANNEL, onEvent);
  };
}

export type { Grid9ServerEvent };
