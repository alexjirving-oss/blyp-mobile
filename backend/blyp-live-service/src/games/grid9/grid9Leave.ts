import type { Server, Socket } from 'socket.io';
import { getEconomyInfra } from '../../economy/infra';
import { grid9CanonicalOperationHash } from './canonical';
import {
  GRID9_SOCKET_ROOM_PREFIX,
} from './constants';
import {
  cancelGrid9PrivateLobby,
  leaveGrid9SeatAsCombatant,
  type Grid9Identity,
} from './grid9Engine';
import {
  commitGrid9ServerMutation,
  newGrid9ServerOperationReceipt,
  projectGrid9Timer,
  readGrid9State,
  removeGrid9ActiveMatch,
} from './grid9AggregateStore';
import { Grid9Error } from './grid9Errors';
import {
  createGrid9PrivateEvent,
  createGrid9RoomEvent,
  emitGrid9Private,
  emitGrid9Room,
} from './grid9Broadcast';
import { timerOutboxForState } from './grid9MatchService';
import {
  cancelGrid9DisconnectTimeout,
  clearGrid9MatchPresence,
  upsertGrid9Presence,
} from './grid9Presence';
import { toGrid9PublicGameState } from './grid9Projection';
import { settleGrid9Match } from './grid9Settlement';
import { grid9RedisKeys, type Grid9TimerOutboxRecord } from './redisKeys';
import type { Grid9GameState } from './state';
import type { Grid9HumanPlayer } from './players';

function redis() {
  return getEconomyInfra().redis;
}

async function clearUserMatchBinding(userId: string, matchId: string): Promise<void> {
  const key = grid9RedisKeys.userMatch(userId);
  const current = await redis().get(key);
  if (current === matchId) {
    await redis().del(key);
  }
}

async function clearUserPresence(matchId: string, userId: string): Promise<void> {
  await upsertGrid9Presence({
    matchId,
    socketId: `__leave__${userId}`,
    userId,
    role: 'audience',
    slotIndex: null,
  });
  // Drop the placeholder socket and the user index entry.
  const raw = await redis().get(grid9RedisKeys.presenceUser(matchId, userId));
  if (raw) {
    await redis()
      .multi()
      .del(grid9RedisKeys.presenceUser(matchId, userId))
      .srem(grid9RedisKeys.presenceIndex(matchId), userId)
      .exec();
  }
  await cancelGrid9DisconnectTimeout(matchId, userId);
}

/**
 * MATCH_LEAVE — exit queue room / combat seat / audience.
 *
 * Fail-closed private lobby host leave: cancel lobby (no host transfer).
 * Combatant leave: Sentinel fill + clear userMatch (no ghost resume).
 * Audience leave: clear presence + userMatch + leave socket room.
 */
export async function leaveGrid9Match(args: {
  io: Server;
  socket: Socket;
  identity: Grid9Identity;
  connectionSessionId: string;
  matchId: string;
  expectedStateVersion: number | null;
  intentId: string;
}): Promise<{ clearedUserMatch: boolean; mode: string }> {
  const matchId = args.matchId;
  let state: Grid9GameState;
  try {
    state = await readGrid9State(matchId);
  } catch (error) {
    if (error instanceof Grid9Error && error.code === 'MATCH_NOT_FOUND') {
      await redis().del(grid9RedisKeys.userMatch(args.identity.userId));
      await args.socket.leave(`${GRID9_SOCKET_ROOM_PREFIX}${matchId}`);
      return { clearedUserMatch: true, mode: 'stale_binding' };
    }
    throw error;
  }

  if (
    args.expectedStateVersion != null &&
    state.authority.stateVersion !== args.expectedStateVersion
  ) {
    throw new Grid9Error('STALE_STATE', 'Stale leave', {
      stateVersion: state.authority.stateVersion,
      retryable: true,
    });
  }

  const seated = state.players.find(
    (player): player is Grid9HumanPlayer =>
      player.kind === 'human' && player.userId === args.identity.userId,
  );
  const isHost = state.ownerUserId === args.identity.userId;
  const roomName = `${GRID9_SOCKET_ROOM_PREFIX}${matchId}`;

  // Private lobby host: cancel entire lobby (fail-closed, no transfer).
  if (state.phase === 'private_lobby' && isHost) {
    const next = cancelGrid9PrivateLobby(state, args.identity.userId);
    const operationId = `leave-cancel-${args.intentId}`;
    const roomEvent = createGrid9RoomEvent({
      type: 'MATCH_COMPLETED',
      matchId,
      sequence: next.authority.eventSequence,
      stateVersion: next.authority.stateVersion,
      causationIntentId: args.intentId,
      payload: {
        outcome: toGrid9PublicGameState(next).outcome!,
        finalState: toGrid9PublicGameState(next),
      },
    });
    const committed = await commitGrid9ServerMutation({
      currentState: state,
      nextState: next,
      operationReceipt: newGrid9ServerOperationReceipt({
        matchId,
        operationId,
        kind: 'phase_transition',
        canonicalOperationHash: grid9CanonicalOperationHash({
          matchId,
          operationId,
          kind: 'phase_transition',
          payload: { reason: 'host_leave_cancel', intentId: args.intentId },
        }),
        stateVersion: next.authority.stateVersion,
        result: { cancelled: true },
        recordedAt: roomEvent.sentAt,
      }),
      timerOutbox: null,
    });
    if (committed.status === 'committed') {
      emitGrid9Room(args.io, matchId, roomEvent);
      for (const player of state.players) {
        if (player.kind === 'human') {
          await clearUserMatchBinding(player.userId, matchId);
        }
      }
      await clearGrid9MatchPresence(matchId);
      await settleGrid9Match(args.io, next);
      await removeGrid9ActiveMatch(matchId);
    }
    await args.socket.leave(roomName);
    emitGrid9Private(
      args.socket,
      createGrid9PrivateEvent({
        type: 'PRIVATE_ROOM_STATUS',
        connectionSessionId: args.connectionSessionId,
        matchId,
        stateVersion: next.authority.stateVersion,
        causationIntentId: args.intentId,
        payload: {
          status: 'left',
          matchId,
          roomCode: state.roomCode ?? '',
          ownerUserId: state.ownerUserId ?? '',
          slotIndex: null,
        },
      }),
    );
    return { clearedUserMatch: true, mode: 'host_lobby_cancel' };
  }

  // Seated combatant: Sentinel fill + exit entirely.
  if (seated) {
    const resolution = leaveGrid9SeatAsCombatant(state, args.identity.userId);
    const publicAfter = toGrid9PublicGameState(resolution.state);
    const replacementPlayer = publicAfter.players[resolution.kickedSlotIndex];
    const operationId = `leave-seat-${args.intentId}`;
    const roomEvent = createGrid9RoomEvent({
      type: 'PLAYER_CONNECTION_CHANGED',
      matchId,
      sequence: resolution.state.authority.eventSequence,
      stateVersion: resolution.state.authority.stateVersion,
      causationIntentId: args.intentId,
      payload: {
        slotIndex: resolution.kickedSlotIndex,
        connectionState: 'disconnected',
        replacementPlayer,
        audienceCount: publicAfter.audienceCount,
      },
    });
    const committed = await commitGrid9ServerMutation({
      currentState: state,
      nextState: resolution.state,
      operationReceipt: newGrid9ServerOperationReceipt({
        matchId,
        operationId,
        kind: 'phase_transition',
        canonicalOperationHash: grid9CanonicalOperationHash({
          matchId,
          operationId,
          kind: 'phase_transition',
          payload: {
            intentId: args.intentId,
            leftUserId: args.identity.userId,
            slotIndex: resolution.kickedSlotIndex,
          },
        }),
        stateVersion: resolution.state.authority.stateVersion,
        result: {
          leftUserId: args.identity.userId,
          slotIndex: resolution.kickedSlotIndex,
        },
        recordedAt: roomEvent.sentAt,
      }),
      timerOutbox: timerOutboxForState(resolution.state),
    });
    if (committed.status === 'committed') {
      emitGrid9Room(args.io, matchId, roomEvent);
      if (resolution.wasSpotlight && resolution.state.phase === 'combat') {
        const dueNow: Grid9TimerOutboxRecord = {
          schemaVersion: 1,
          matchId: resolution.state.matchId,
          reason: 'turn_end',
          stateVersion: resolution.state.authority.stateVersion,
          dueAt: new Date().toISOString(),
          projectedAt: null,
        };
        await projectGrid9Timer(dueNow);
      }
    }
    await clearUserMatchBinding(args.identity.userId, matchId);
    await clearUserPresence(matchId, args.identity.userId);
    await args.socket.leave(roomName);
    emitGrid9Private(
      args.socket,
      createGrid9PrivateEvent({
        type: 'PRIVATE_ROOM_STATUS',
        connectionSessionId: args.connectionSessionId,
        matchId,
        stateVersion: resolution.state.authority.stateVersion,
        causationIntentId: args.intentId,
        payload: {
          status: 'left',
          matchId,
          roomCode: resolution.state.roomCode ?? '',
          ownerUserId: resolution.state.ownerUserId ?? '',
          slotIndex: null,
        },
      }),
    );
    return { clearedUserMatch: true, mode: 'combatant_leave' };
  }

  // Audience (or unbound presence): clear binding and leave room.
  await clearUserMatchBinding(args.identity.userId, matchId);
  await clearUserPresence(matchId, args.identity.userId);
  await args.socket.leave(roomName);
  emitGrid9Private(
    args.socket,
    createGrid9PrivateEvent({
      type: 'PRIVATE_ROOM_STATUS',
      connectionSessionId: args.connectionSessionId,
      matchId,
      stateVersion: state.authority.stateVersion,
      causationIntentId: args.intentId,
      payload: {
        status: 'left',
        matchId,
        roomCode: state.roomCode ?? '',
        ownerUserId: state.ownerUserId ?? '',
        slotIndex: null,
      },
    }),
  );
  return { clearedUserMatch: true, mode: 'audience_leave' };
}
