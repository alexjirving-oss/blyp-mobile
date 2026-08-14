import { io, type Socket } from 'socket.io-client';
import { getCognitoJwtForApi } from '../api/getCognitoJwtForApi';
import { resolveEconomySocketUrl } from '../api/economyLiveApi';

/**
 * Real-time room signaling consumer.
 *
 * Listens for typed `room_event` messages (guest invited/rejected/kicked/left,
 * room ended) pushed by the live service, so the UI can react in real time
 * instead of waiting on the 2–2.5s REST poll. This is ADDITIVE: it runs
 * alongside the existing polling/Firestore-mirror path, which remains the
 * source of truth until the push bus is proven reliable. Events carry an `id`
 * for de-duplication and a server `ts` for ordering.
 */
export type RoomEventType =
  | 'guest.invited'
  | 'guest.rejected'
  | 'guest.kicked'
  | 'guest.left'
  | 'guest.muted'
  | 'guest.unmuted'
  | 'moderator.added'
  | 'moderator.removed'
  | 'viewer.joined'
  | 'room.ended'
  | 'frenemies.jump.seated'
  | 'frenemies.life.saved';

export interface RoomEventPayload {
  id: string;
  type: RoomEventType;
  streamId: string;
  ts: string;
  guestUserId?: string;
  slotIndex?: number;
  moderatorUserId?: string;
  viewerUserId?: string;
  displayName?: string;
  force?: boolean;
  reason?: string;
}

export interface RoomEventsSubscription {
  close: () => void;
}

export async function subscribeToRoomEvents(
  streamId: string,
  onRoomEvent: (payload: RoomEventPayload) => void
): Promise<RoomEventsSubscription> {
  const token = await getCognitoJwtForApi({ tokenType: 'id' });
  const url = resolveEconomySocketUrl();

  const socket: Socket = io(url, {
    autoConnect: false,
    transports: ['websocket'],
    auth: { token },
  });

  // Dedupe by event id so a reconnect/replay never double-applies an event.
  const seen = new Set<string>();
  const handler = (payload: RoomEventPayload) => {
    if (!payload || typeof payload !== 'object') return;
    if (payload.id) {
      if (seen.has(payload.id)) return;
      seen.add(payload.id);
      // Bound memory: keep the set from growing without limit on long streams.
      if (seen.size > 500) {
        seen.clear();
      }
    }
    onRoomEvent(payload);
  };

  const join = () => {
    try {
      socket.emit('join', { streamId });
    } catch {
      // ignore
    }
  };

  socket.on('connect', join);
  socket.on('room_event', handler as any);

  socket.connect();

  return {
    close: () => {
      try {
        socket.off('room_event', handler as any);
        socket.off('connect', join);
        socket.emit('leave', { streamId });
        socket.disconnect();
      } catch {
        // ignore
      }
    },
  };
}
