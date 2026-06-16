/**
 * Typed room signaling events.
 *
 * These are pushed over the existing Socket.IO bus (event name `room_event`) to
 * everyone in a `stream:{streamId}` room, so state changes (guest invited /
 * rejected / kicked / left, room ended) reach clients in real time instead of
 * waiting for the 2–2.5s REST poll. This is delivered ADDITIVELY: the existing
 * REST + polling + Firestore mirror remain authoritative until the push bus is
 * proven reliable under reconnect storms, at which point the polling path is
 * removed (see the signaling-bus cutover in the plan).
 *
 * Each event carries an `id` (for client-side de-duplication) and a server `ts`
 * (for ordering). A monotonic cross-instance sequence + snapshot/resync is added
 * with the presence slice that introduces the Redis-backed counter.
 */
export type RoomEventType =
  | 'guest.invited'
  | 'guest.rejected'
  | 'guest.kicked'
  | 'guest.left'
  | 'guest.muted'
  | 'guest.unmuted'
  | 'guest.camera_off'
  | 'guest.camera_on'
  | 'moderator.added'
  | 'moderator.removed'
  | 'viewer.joined'
  | 'room.ended';

export interface RoomEventBase {
  /** Unique event id; clients dedupe on this. */
  id: string;
  type: RoomEventType;
  /** Equals the live sessionId. */
  streamId: string;
  /** ISO server timestamp for ordering. */
  ts: string;
}

export interface GuestRoomEvent extends RoomEventBase {
  type:
    | 'guest.invited'
    | 'guest.rejected'
    | 'guest.kicked'
    | 'guest.left'
    | 'guest.muted'
    | 'guest.unmuted'
    | 'guest.camera_off'
    | 'guest.camera_on';
  guestUserId: string;
  slotIndex?: number;
}

export interface ModeratorRoomEvent extends RoomEventBase {
  type: 'moderator.added' | 'moderator.removed';
  moderatorUserId: string;
}

export interface ViewerRoomEvent extends RoomEventBase {
  type: 'viewer.joined';
  viewerUserId?: string;
  displayName?: string;
}

export interface RoomEndedEvent extends RoomEventBase {
  type: 'room.ended';
}

export type RoomEvent = GuestRoomEvent | ModeratorRoomEvent | ViewerRoomEvent | RoomEndedEvent;

/**
 * Caller-supplied shape for emitting an event. The server injects `id`, `ts`
 * (and already knows `streamId`), so callers only provide the discriminated
 * type + its payload. This stays type-safe per variant (unlike Omit over a
 * union, which collapses to the common keys).
 */
export type RoomEventInput =
  | { type: 'guest.invited' | 'guest.rejected' | 'guest.kicked' | 'guest.left' | 'guest.muted' | 'guest.unmuted' | 'guest.camera_off' | 'guest.camera_on'; guestUserId: string; slotIndex?: number }
  | { type: 'moderator.added' | 'moderator.removed'; moderatorUserId: string }
  | { type: 'viewer.joined'; viewerUserId?: string; displayName?: string }
  | { type: 'room.ended' };

export const ROOM_EVENT_CHANNEL = 'room_event' as const;
