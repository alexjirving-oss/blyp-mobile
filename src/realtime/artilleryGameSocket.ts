import { io, type Socket } from 'socket.io-client';
import { getCognitoJwtForApi } from '../api/getCognitoJwtForApi';
import { resolveEconomySocketUrl } from '../api/economyLiveApi';
import type { ArtilleryStateEvent } from '../api/ivsLiveApi';

export interface ArtillerySocketSubscription {
  close: () => void;
}

/**
 * Subscribe to server-authoritative Blyp Artillery `game_event`s for a session.
 * The server broadcasts STATE snapshots (start/join/revive) and SHOT outcomes;
 * the client renders whatever arrives.
 */
export async function subscribeToGameEvents(
  sessionId: string,
  onGameEvent: (payload: ArtilleryStateEvent) => void
): Promise<ArtillerySocketSubscription> {
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
  socket.on('game_event', onGameEvent as any);

  socket.connect();

  return {
    close: () => {
      try {
        socket.off('game_event', onGameEvent as any);
        socket.off('connect', join);
        socket.emit('leave', { streamId: sessionId });
        socket.disconnect();
      } catch {
        // ignore
      }
    },
  };
}
