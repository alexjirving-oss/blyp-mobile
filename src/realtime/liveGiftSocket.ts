import { io, type Socket } from 'socket.io-client';
import { getCognitoJwtForApi } from '../api/getCognitoJwtForApi';
import { resolveEconomySocketUrl } from '../api/economyLiveApi';

export interface GiftEventPayload {
  streamId: string;
  sequenceNo: number;
  giftEventId: string;
  giftId: string;
  quantity: number;
  coinSpent: number;
  gemsCredited: number;
  sender?: { userId?: string; handle?: string | null; avatarUrl?: string | null };
  receiver?: { userId?: string; handle?: string | null; avatarUrl?: string | null };
  createdAt: string;
}

export interface GiftSocketSubscription {
  close: () => void;
}

export async function subscribeToGiftEvents(
  streamId: string,
  onGiftEvent: (payload: GiftEventPayload) => void
): Promise<GiftSocketSubscription> {
  const token = await getCognitoJwtForApi({ tokenType: 'id' });
  const url = resolveEconomySocketUrl();

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
  socket.on('gift_event', onGiftEvent as any);

  socket.connect();

  return {
    close: () => {
      try {
        socket.off('gift_event', onGiftEvent as any);
        socket.off('connect', join);
        socket.emit('leave', { streamId });
        socket.disconnect();
      } catch {
        // ignore
      }
    },
  };
}
