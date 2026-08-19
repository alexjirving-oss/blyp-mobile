import { randomUUID } from 'crypto';
import type { Server, Socket } from 'socket.io';
import {
  GRID9_NONCE_TTL_SECONDS,
  GRID9_PROTOCOL_VERSION,
  GRID9_SOCKET_CHANNEL,
  GRID9_SOCKET_ROOM_PREFIX,
  createGrid9CryptographicNonce,
} from './constants';
import type {
  Grid9EscrowUpdatedPayload,
  Grid9IntentCommittedPayload,
  Grid9IntentRejectedPayload,
  Grid9JackpotChangedPayload,
  Grid9MatchAssignedPayload,
  Grid9MatchCompletedPayload,
  Grid9MercenaryFundedPayload,
  Grid9ArsenalGrantedPayload,
  Grid9MicroDropResolvedPayload,
  Grid9PlayerEliminatedPayload,
  Grid9PlayerBuybackPayload,
  Grid9PlayerConnectionChangedPayload,
  Grid9PongPayload,
  Grid9PrivateRoomStatusPayload,
  Grid9PrivateServerEvent,
  Grid9QueueStatusPayload,
  Grid9ResyncRequiredPayload,
  Grid9RoomServerEvent,
  Grid9RouletteLandPayload,
  Grid9RouletteStartPayload,
  Grid9ShieldResolvedPayload,
  Grid9StateSnapshotPayload,
  Grid9TurnAdvancedPayload,
  Grid9TurnTickPayload,
  Grid9WeaponResolvedPayload,
  Grid9WelcomePayload,
} from './protocol';

type PrivatePayloadMap = {
  WELCOME: Grid9WelcomePayload;
  QUEUE_STATUS: Grid9QueueStatusPayload;
  MATCH_ASSIGNED: Grid9MatchAssignedPayload;
  PRIVATE_ROOM_STATUS: Grid9PrivateRoomStatusPayload;
  STATE_SNAPSHOT: Grid9StateSnapshotPayload;
  ESCROW_UPDATED: Grid9EscrowUpdatedPayload;
  INTENT_COMMITTED: Grid9IntentCommittedPayload;
  INTENT_REJECTED: Grid9IntentRejectedPayload;
  RESYNC_REQUIRED: Grid9ResyncRequiredPayload;
  PONG: Grid9PongPayload;
};

type RoomPayloadMap = {
  WEAPON_RESOLVED: Grid9WeaponResolvedPayload;
  SHIELD_RESOLVED: Grid9ShieldResolvedPayload;
  MERCENARY_FUNDED: Grid9MercenaryFundedPayload;
  ARSENAL_GRANTED: Grid9ArsenalGrantedPayload;
  TURN_ADVANCED: Grid9TurnAdvancedPayload;
  TURN_TICK: Grid9TurnTickPayload;
  ROULETTE_START: Grid9RouletteStartPayload;
  ROULETTE_LAND: Grid9RouletteLandPayload;
  MICRO_DROP_RESOLVED: Grid9MicroDropResolvedPayload;
  PLAYER_CONNECTION_CHANGED: Grid9PlayerConnectionChangedPayload;
  PLAYER_ELIMINATED: Grid9PlayerEliminatedPayload;
  PLAYER_BUYBACK: Grid9PlayerBuybackPayload;
  JACKPOT_CHANGED: Grid9JackpotChangedPayload;
  MATCH_COMPLETED: Grid9MatchCompletedPayload;
};

const serverSessionId = randomUUID();

export function grid9ConnectionRoom(connectionSessionId: string): string {
  return `grid9:connection:${connectionSessionId}`;
}

export function createGrid9PrivateEvent<K extends keyof PrivatePayloadMap>(args: {
  type: K;
  connectionSessionId: string;
  matchId: string | null;
  stateVersion: number | null;
  causationIntentId: string | null;
  payload: PrivatePayloadMap[K];
  messageId?: string;
}): Extract<Grid9PrivateServerEvent, { type: K }> {
  return {
    protocol: 'grid9.ws',
    protocolVersion: GRID9_PROTOCOL_VERSION,
    direction: 'server_to_client',
    routing: 'private',
    type: args.type,
    messageId: args.messageId ?? randomUUID(),
    connectionSessionId: args.connectionSessionId,
    matchId: args.matchId,
    nonce: createGrid9CryptographicNonce(),
    sentAt: new Date().toISOString(),
    sequence: null,
    stateVersion: args.stateVersion,
    causationIntentId: args.causationIntentId,
    payload: args.payload,
  } as Extract<Grid9PrivateServerEvent, { type: K }>;
}

export function createGrid9RoomEvent<K extends keyof RoomPayloadMap>(args: {
  type: K;
  matchId: string;
  sequence: number;
  stateVersion: number;
  causationIntentId: string | null;
  payload: RoomPayloadMap[K];
  messageId?: string;
}): Extract<Grid9RoomServerEvent, { type: K }> {
  return {
    protocol: 'grid9.ws',
    protocolVersion: GRID9_PROTOCOL_VERSION,
    direction: 'server_to_client',
    routing: 'room',
    type: args.type,
    messageId: args.messageId ?? randomUUID(),
    serverSessionId,
    matchId: args.matchId,
    nonce: createGrid9CryptographicNonce(),
    sentAt: new Date().toISOString(),
    sequence: args.sequence,
    stateVersion: args.stateVersion,
    causationIntentId: args.causationIntentId,
    payload: args.payload,
  } as Extract<Grid9RoomServerEvent, { type: K }>;
}

export function createGrid9Welcome(
  socket: Socket,
  connectionSessionId: string,
): Grid9PrivateServerEvent {
  return createGrid9PrivateEvent({
    type: 'WELCOME',
    connectionSessionId,
    matchId: null,
    stateVersion: null,
    causationIntentId: null,
    payload: {
      connectionId: socket.id,
      connectionSessionId,
      serverTime: new Date().toISOString(),
      minimumProtocolVersion: 2,
      nonceTtlSeconds: GRID9_NONCE_TTL_SECONDS,
    },
  });
}

export function emitGrid9Private(
  socket: Socket,
  event: Grid9PrivateServerEvent,
): void {
  socket.emit(GRID9_SOCKET_CHANNEL, event);
}

export function emitGrid9ToConnection(
  io: Server,
  connectionSessionId: string,
  event: Grid9PrivateServerEvent,
): void {
  io.to(grid9ConnectionRoom(connectionSessionId)).emit(
    GRID9_SOCKET_CHANNEL,
    event,
  );
}

export function emitGrid9Room(
  io: Server,
  matchId: string,
  event: Grid9RoomServerEvent,
): void {
  io.to(`${GRID9_SOCKET_ROOM_PREFIX}${matchId}`).emit(
    GRID9_SOCKET_CHANNEL,
    event,
  );
}
