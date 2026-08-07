import { io, type Socket } from 'socket.io-client';
import { getCognitoJwtForApi } from '../api/getCognitoJwtForApi';
import { resolveEconomySocketUrl } from '../api/economyLiveApi';
import type { FrenemiesGameEvent } from '../api/ivsLiveApi';

export interface FrenemiesSocketSubscription {
  close: () => void;
}

/** Subscribe to server-authoritative Frenemies `frenemies_game_event`s. */
export async function subscribeToFrenemiesGameEvents(
  sessionId: string,
  onEvent: (payload: FrenemiesGameEvent) => void
): Promise<FrenemiesSocketSubscription> {
  const token = await getCognitoJwtForApi({ tokenType: 'id' });
  const url = resolveEconomySocketUrl();

  const socket: Socket = io(url, {
    autoConnect: false,
    transports: ['websocket'],
    auth: { token },
  });

  const join = () => {
    try {
      socket.emit('join', { streamId: sessionId });
    } catch {
      // ignore
    }
  };

  socket.on('connect', join);
  socket.on('frenemies_game_event', onEvent as any);
  socket.connect();

  return {
    close: () => {
      try {
        socket.off('frenemies_game_event', onEvent as any);
        socket.off('connect', join);
        socket.emit('leave', { streamId: sessionId });
        socket.disconnect();
      } catch {
        // ignore
      }
    },
  };
}
