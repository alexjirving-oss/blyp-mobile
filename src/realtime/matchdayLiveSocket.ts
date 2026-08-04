import { io, type Socket } from 'socket.io-client';
import { getCognitoJwtForApi } from '../api/getCognitoJwtForApi';
import { resolveEconomySocketUrl } from '../api/economyLiveApi';
import { matchdayChatRoomId } from '../services/matchdayService';

// Reuses the proven gift socket pattern. The server emits `matchday_event` to
// room `stream:matchday:{eventId}`; clients join with streamId = the same id.

export interface MatchdayRealtimeEvent {
  type: 'matchday_reaction' | 'matchday_settled';
  eventId: string;
  emoji?: string;
  userId?: string;
  status?: string;
  ts?: number;
}

export interface MatchdaySocketSubscription {
  close: () => void;
}

export async function subscribeToMatchdayEvents(
  eventId: string,
  onEvent: (payload: MatchdayRealtimeEvent) => void
): Promise<MatchdaySocketSubscription> {
  const token = await getCognitoJwtForApi({ tokenType: 'id' });
  const url = resolveEconomySocketUrl();
  const streamId = matchdayChatRoomId(eventId);

  const socket: Socket = io(url, {
    autoConnect: false,
    transports: ['websocket'],
    auth: { token },
  });

  const join = () => {
    try {
      socket.emit('join', { streamId });
    } catch {
      // ignore
    }
  };

  socket.on('connect', join);
  socket.on('matchday_event', onEvent as any);
  socket.connect();

  return {
    close: () => {
      try {
        socket.off('matchday_event', onEvent as any);
        socket.off('connect', join);
        socket.emit('leave', { streamId });
        socket.disconnect();
      } catch {
        // ignore
      }
    },
  };
}
