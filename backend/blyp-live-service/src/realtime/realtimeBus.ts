import type { Server } from 'socket.io';
import { randomUUID } from 'crypto';
import { ROOM_EVENT_CHANNEL, type RoomEvent, type RoomEventInput } from './roomEvents';

let ioRef: Server | null = null;

export function setSocketIo(io: Server) {
  ioRef = io;
}

/**
 * Emit a typed room signaling event to everyone watching a stream. Best-effort:
 * if the socket server isn't wired (or a transient outage), this is a no-op and
 * the authoritative REST/polling path still carries the state change.
 */
export function emitRoomEvent(streamId: string, input: RoomEventInput): void {
  if (!ioRef) return;
  const event = {
    id: randomUUID(),
    streamId,
    ts: new Date().toISOString(),
    ...input,
  } as RoomEvent;
  ioRef.to(`stream:${streamId}`).emit(ROOM_EVENT_CHANNEL, event);
}

export function emitGiftEvent(streamId: string, payload: any) {
  if (!ioRef) return;
  ioRef.to(`stream:${streamId}`).emit('gift_event', payload);
}

export function emitLiveGameEvent(streamId: string, payload: any) {
  if (!ioRef) return;
  ioRef.to(`stream:${streamId}`).emit('live_game_event', payload);
}

// Blyp Artillery (server-authoritative battle-stage game). Carries either a full
// state snapshot or a shot outcome + resulting state for clients to render.
export function emitGameEvent(streamId: string, payload: any) {
  if (!ioRef) return;
  ioRef.to(`stream:${streamId}`).emit('game_event', payload);
}

// Matchday Live rooms reuse the stream room naming so clients join with
// streamId = `matchday:{eventId}`.
export function emitMatchdayEvent(eventId: string, payload: any) {
  if (!ioRef) return;
  ioRef.to(`stream:matchday:${eventId}`).emit('matchday_event', payload);
}
