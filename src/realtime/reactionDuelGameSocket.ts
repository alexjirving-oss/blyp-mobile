import { io, type Socket } from 'socket.io-client';
import { getCognitoJwtForApi } from '../api/getCognitoJwtForApi';
import { resolveEconomySocketUrl } from '../api/economyLiveApi';
import type { ReactionDuelGameEvent } from '../api/ivsLiveApi';

export interface ReactionDuelSocketSubscription {
  close: () => void;
}

/** Subscribe to authoritative lock, prompt, score and settlement events. */
export async function subscribeToReactionDuelEvents(
  sessionId: string,
  onEvent: (payload: ReactionDuelGameEvent) => void,
): Promise<ReactionDuelSocketSubscription> {
  const token = await getCognitoJwtForApi({ tokenType: 'id' });
  const socket: Socket = io(resolveEconomySocketUrl(), {
    autoConnect: false,
    transports: ['websocket'],
    auth: { token },
  });

  const join = () => {
    try {
      socket.emit('join', { streamId: sessionId });
    } catch {
      // Ignore transient reconnect races.
    }
  };

  socket.on('connect', join);
  socket.on('reaction_duel_event', onEvent as any);
  socket.connect();

  return {
    close: () => {
      try {
        socket.off('reaction_duel_event', onEvent as any);
        socket.off('connect', join);
        socket.emit('leave', { streamId: sessionId });
        socket.disconnect();
      } catch {
        // Best-effort cleanup.
      }
    },
  };
}
