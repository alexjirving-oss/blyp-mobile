import type { Server } from 'socket.io';

let ioRef: Server | null = null;

export function setSocketIo(io: Server) {
  ioRef = io;
}

export function emitGiftEvent(streamId: string, payload: any) {
  if (!ioRef) return;
  ioRef.to(`stream:${streamId}`).emit('gift_event', payload);
}

export function emitLiveGameEvent(streamId: string, payload: any) {
  if (!ioRef) return;
  ioRef.to(`stream:${streamId}`).emit('live_game_event', payload);
}
