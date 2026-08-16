import { randomBytes, randomUUID } from 'crypto';
import type { Server, Socket } from 'socket.io';
import { getEconomyInfra } from '../../economy/infra';
import {
  GRID9_MATCH_TTL_SECONDS,
  GRID9_PRIVATE_ROOM_CODE_LENGTH,
  GRID9_SOCKET_ROOM_PREFIX,
  type Grid9SlotIndex,
} from './constants';
import {
  commitGrid9ServerMutation,
  createGrid9Aggregate,
  newGrid9ServerOperationReceipt,
  projectGrid9Timer,
  readGrid9State,
} from './grid9AggregateStore';
import {
  createGrid9PrivateEvent,
  createGrid9RoomEvent,
  emitGrid9Room,
  emitGrid9ToConnection,
} from './grid9Broadcast';
import {
  createGrid9Match,
  kickGrid9SeatToAudience,
  startPrivateMatchFromLobby,
  type Grid9Identity,
} from './grid9Engine';
import { Grid9Error } from './grid9Errors';
import { grid9CanonicalOperationHash } from './canonical';
import { toGrid9PublicGameState } from './grid9Projection';
import { timerOutboxForState } from './grid9MatchService';
import { grid9RedisKeys, type Grid9TimerOutboxRecord } from './redisKeys';
import type { Grid9GameState } from './state';
import type { Grid9HumanPlayer } from './players';
import {
  upsertGrid9Presence,
} from './grid9Presence';

function redis() {
  return getEconomyInfra().redis;
}

function mintRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(GRID9_PRIVATE_ROOM_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < GRID9_PRIVATE_ROOM_CODE_LENGTH; i += 1) {
    code += alphabet[bytes[i]! % alphabet.length];
  }
  return code;
}

function requireHost(state: Awaited<ReturnType<typeof readGrid9State>>, userId: string): void {
  if (!state.ownerUserId || state.ownerUserId !== userId) {
    throw new Grid9Error('NOT_ELIGIBLE', 'Host-only action', {
      stateVersion: state.authority.stateVersion,
    });
  }
}

async function bindPrivateSocket(args: {
  socket: Socket;
  matchId: string;
  userId: string;
  slotIndex: number;
}): Promise<void> {
  await args.socket.join(`${GRID9_SOCKET_ROOM_PREFIX}${args.matchId}`);
  await upsertGrid9Presence({
    matchId: args.matchId,
    socketId: args.socket.id,
    userId: args.userId,
    role: 'player',
    slotIndex: args.slotIndex,
  });
  args.socket.data.grid9MatchId = args.matchId;
  args.socket.data.grid9Role = 'player';
}

export async function createGrid9PrivateRoom(args: {
  io: Server;
  socket: Socket;
  identity: Grid9Identity;
  connectionSessionId: string;
  region: string;
  intentId: string;
}): Promise<void> {
  const roomCode = mintRoomCode();
  const matchId = randomUUID();
  const state = createGrid9Match({
    matchId,
    liveSessionId: matchId,
    region: args.region,
    roomMode: 'private',
    ownerUserId: args.identity.userId,
    roomCode,
    houseSeedCoins: 0,
    humans: [
      {
        ...args.identity,
        queueTicketId: `private-${matchId}`,
        sponsorPassId: null,
      },
    ],
  });
  const created = await createGrid9Aggregate(state);
  if (!created) {
    throw new Grid9Error('INTERNAL_ERROR', 'Failed to create private room');
  }
  await redis()
    .multi()
    .set(
      grid9RedisKeys.privateRoomCode(args.region, roomCode),
      matchId,
      'EX',
      GRID9_MATCH_TTL_SECONDS,
    )
    .set(
      grid9RedisKeys.userMatch(args.identity.userId),
      matchId,
      'EX',
      GRID9_MATCH_TTL_SECONDS,
    )
    .exec();
  await bindPrivateSocket({
    socket: args.socket,
    matchId,
    userId: args.identity.userId,
    slotIndex: 0,
  });
  emitGrid9ToConnection(
    args.io,
    args.connectionSessionId,
    createGrid9PrivateEvent({
      type: 'PRIVATE_ROOM_STATUS',
      connectionSessionId: args.connectionSessionId,
      matchId,
      stateVersion: state.authority.stateVersion,
      causationIntentId: args.intentId,
      payload: {
        status: 'created',
        matchId,
        roomCode,
        ownerUserId: args.identity.userId,
        slotIndex: 0,
      },
    }),
  );
  emitGrid9ToConnection(
    args.io,
    args.connectionSessionId,
    createGrid9PrivateEvent({
      type: 'STATE_SNAPSHOT',
      connectionSessionId: args.connectionSessionId,
      matchId,
      stateVersion: state.authority.stateVersion,
      causationIntentId: args.intentId,
      payload: {
        state: toGrid9PublicGameState(state),
        reason: 'join',
      },
    }),
  );
}

function joinHumanIntoPrivateLobby(
  current: Grid9GameState,
  identity: Grid9Identity,
  intentId: string,
): { next: Grid9GameState; slotIndex: Grid9SlotIndex } {
  const already = current.players.find(
    (player) => player.kind === 'human' && player.userId === identity.userId,
  );
  if (already) {
    return { next: current, slotIndex: already.slotIndex };
  }
  const open = current.players.findIndex((player) => player.kind === 'sentinel');
  if (open < 0) {
    throw new Grid9Error('NOT_ELIGIBLE', 'Private room is full', {
      stateVersion: current.authority.stateVersion,
    });
  }
  const next = JSON.parse(JSON.stringify(current)) as Grid9GameState;
  const joinedAt = new Date().toISOString();
  next.players[open] = {
    slotId: randomUUID(),
    slotIndex: open as Grid9SlotIndex,
    kind: 'human',
    userId: identity.userId,
    publicProfileId: identity.publicProfileId,
    displayName: identity.displayName,
    avatarUrl: identity.avatarUrl,
    feed: {
      kind: 'human_live',
      provider: 'livekit',
      streamId: next.liveSessionId,
      participantId: identity.userId,
    },
    status: 'alive',
    mode: 'combatant',
    connectionState: 'connected',
    health: next.rules.maxHealth,
    maxHealth: next.rules.maxHealth,
    shieldPoints: 0,
    maxShieldPoints: next.rules.maxShieldPoints,
    inventory: [],
    mercenaryBankrollCoins: 0,
    mercenarySponsorCoins: 0,
    mercenaryMicroDropCoins: 0,
    supporterTotalCoins: 0,
    topSupporters: [],
    stats: {
      attacksPurchased: 0,
      shieldsPurchased: 0,
      damageDealt: 0,
      damageReceived: 0,
      coinsSpent: 0,
      mercenaryCoinsReceived: 0,
      microDropsReceived: 0,
    },
    joinedAt,
    eliminatedAt: null,
    eliminatedBy: null,
    lastDamagedAt: null,
    queueTicketId: `private-join-${intentId}`,
    sponsorPassId: null,
  } satisfies Grid9HumanPlayer;
  next.authority.stateVersion += 1;
  next.authority.mutationCount += 1;
  next.authority.lastMutationAt = joinedAt;
  next.updatedAt = joinedAt;
  return { next, slotIndex: open as Grid9SlotIndex };
}

export async function joinGrid9PrivateRoom(args: {
  io: Server;
  socket: Socket;
  identity: Grid9Identity;
  connectionSessionId: string;
  region: string;
  roomCode: string;
  intentId: string;
}): Promise<void> {
  const code = args.roomCode.trim().toUpperCase();
  const matchId = await redis().get(
    grid9RedisKeys.privateRoomCode(args.region, code),
  );
  if (!matchId) {
    throw new Grid9Error('MATCH_NOT_FOUND', 'Private room code not found');
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const state = await readGrid9State(matchId);
    if (state.phase !== 'private_lobby') {
      throw new Grid9Error('MATCH_NOT_ACTIVE', 'Private room already started');
    }
    const { next, slotIndex } = joinHumanIntoPrivateLobby(
      state,
      args.identity,
      args.intentId,
    );
    if (next === state) {
      await redis().set(
        grid9RedisKeys.userMatch(args.identity.userId),
        matchId,
        'EX',
        GRID9_MATCH_TTL_SECONDS,
      );
      await bindPrivateSocket({
        socket: args.socket,
        matchId,
        userId: args.identity.userId,
        slotIndex,
      });
      emitGrid9ToConnection(
        args.io,
        args.connectionSessionId,
        createGrid9PrivateEvent({
          type: 'PRIVATE_ROOM_STATUS',
          connectionSessionId: args.connectionSessionId,
          matchId,
          stateVersion: state.authority.stateVersion,
          causationIntentId: args.intentId,
          payload: {
            status: 'joined',
            matchId,
            roomCode: state.roomCode ?? code,
            ownerUserId: state.ownerUserId ?? '',
            slotIndex,
          },
        }),
      );
      emitGrid9ToConnection(
        args.io,
        args.connectionSessionId,
        createGrid9PrivateEvent({
          type: 'STATE_SNAPSHOT',
          connectionSessionId: args.connectionSessionId,
          matchId,
          stateVersion: state.authority.stateVersion,
          causationIntentId: args.intentId,
          payload: {
            state: toGrid9PublicGameState(state),
            reason: 'join',
          },
        }),
      );
      return;
    }
    const operationId = `private-join-${args.intentId}-${state.authority.stateVersion}`;
    try {
      const result = await commitGrid9ServerMutation({
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
            payload: { intentId: args.intentId, userId: args.identity.userId },
          }),
          stateVersion: next.authority.stateVersion,
          result: { slotIndex },
          recordedAt: next.updatedAt,
        }),
      });
      if (result.status === 'committed' || result.status === 'replay') {
        await redis().set(
          grid9RedisKeys.userMatch(args.identity.userId),
          matchId,
          'EX',
          GRID9_MATCH_TTL_SECONDS,
        );
        await bindPrivateSocket({
          socket: args.socket,
          matchId,
          userId: args.identity.userId,
          slotIndex,
        });
        const latest = await readGrid9State(matchId);
        emitGrid9ToConnection(
          args.io,
          args.connectionSessionId,
          createGrid9PrivateEvent({
            type: 'PRIVATE_ROOM_STATUS',
            connectionSessionId: args.connectionSessionId,
            matchId,
            stateVersion: latest.authority.stateVersion,
            causationIntentId: args.intentId,
            payload: {
              status: 'joined',
              matchId,
              roomCode: latest.roomCode ?? code,
              ownerUserId: latest.ownerUserId ?? '',
              slotIndex,
            },
          }),
        );
        emitGrid9ToConnection(
          args.io,
          args.connectionSessionId,
          createGrid9PrivateEvent({
            type: 'STATE_SNAPSHOT',
            connectionSessionId: args.connectionSessionId,
            matchId,
            stateVersion: latest.authority.stateVersion,
            causationIntentId: args.intentId,
            payload: {
              state: toGrid9PublicGameState(latest),
              reason: 'join',
            },
          }),
        );
        return;
      }
    } catch (error) {
      if (
        error instanceof Grid9Error &&
        error.code === 'STALE_STATE' &&
        attempt < 3
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Grid9Error('STALE_STATE', 'Private join raced; retry', {
    retryable: true,
  });
}

export async function startGrid9PrivateMatch(args: {
  io: Server;
  identity: Grid9Identity;
  matchId: string;
  expectedStateVersion: number;
  intentId: string;
}): Promise<void> {
  const state = await readGrid9State(args.matchId);
  requireHost(state, args.identity.userId);
  if (state.authority.stateVersion !== args.expectedStateVersion) {
    throw new Grid9Error('STALE_STATE', 'Stale private start', {
      stateVersion: state.authority.stateVersion,
      retryable: true,
    });
  }
  const next = startPrivateMatchFromLobby(state, args.identity.userId);
  const roomEvent = createGrid9RoomEvent({
    type: 'ROULETTE_START',
    matchId: state.matchId,
    sequence: next.authority.eventSequence,
    stateVersion: next.authority.stateVersion,
    causationIntentId: args.intentId,
    payload: {
      turnNumber: next.roulette!.turnNumber,
      candidateSlotIndices: next.roulette!.candidateSlotIndices,
      selectedSlotIndex: next.roulette!.selectedSlotIndex,
      endsAt: next.roulette!.endsAt,
      entropyDigest: next.roulette!.entropyDigest,
    },
  });
  const operationId = `private-start-${state.matchId}-${state.authority.stateVersion}`;
  const result = await commitGrid9ServerMutation({
    currentState: state,
    nextState: next,
    operationReceipt: newGrid9ServerOperationReceipt({
      matchId: state.matchId,
      operationId,
      kind: 'phase_transition',
      canonicalOperationHash: grid9CanonicalOperationHash({
        matchId: state.matchId,
        operationId,
        kind: 'phase_transition',
        payload: { intentId: args.intentId },
      }),
      stateVersion: next.authority.stateVersion,
      result: roomEvent.payload,
      recordedAt: roomEvent.sentAt,
    }),
    timerOutbox: timerOutboxForState(next),
  });
  if (result.status === 'committed') {
    emitGrid9Room(args.io, state.matchId, roomEvent);
    const timer = timerOutboxForState(next);
    if (timer) await projectGrid9Timer(timer);
  }
}

export async function kickGrid9PrivatePlayer(args: {
  io: Server;
  identity: Grid9Identity;
  matchId: string;
  targetUserId: string;
  expectedStateVersion: number;
  intentId: string;
}): Promise<void> {
  const state = await readGrid9State(args.matchId);
  requireHost(state, args.identity.userId);
  if (state.authority.stateVersion !== args.expectedStateVersion) {
    throw new Grid9Error('STALE_STATE', 'Stale kick', {
      stateVersion: state.authority.stateVersion,
      retryable: true,
    });
  }
  const resolution = kickGrid9SeatToAudience(
    state,
    args.identity.userId,
    args.targetUserId,
  );
  const operationId = `kick-${args.intentId}`;
  const roomEvent = createGrid9RoomEvent({
    type: 'PLAYER_CONNECTION_CHANGED',
    matchId: state.matchId,
    sequence: resolution.state.authority.eventSequence,
    stateVersion: resolution.state.authority.stateVersion,
    causationIntentId: args.intentId,
    payload: {
      slotIndex: resolution.kickedSlotIndex,
      connectionState: 'disconnected',
    },
  });
  const result = await commitGrid9ServerMutation({
    currentState: state,
    nextState: resolution.state,
    operationReceipt: newGrid9ServerOperationReceipt({
      matchId: state.matchId,
      operationId,
      kind: 'phase_transition',
      canonicalOperationHash: grid9CanonicalOperationHash({
        matchId: state.matchId,
        operationId,
        kind: 'phase_transition',
        payload: {
          intentId: args.intentId,
          kickedUserId: args.targetUserId,
          slotIndex: resolution.kickedSlotIndex,
        },
      }),
      stateVersion: resolution.state.authority.stateVersion,
      result: {
        kickedUserId: args.targetUserId,
        slotIndex: resolution.kickedSlotIndex,
      },
      recordedAt: roomEvent.sentAt,
    }),
    timerOutbox: timerOutboxForState(resolution.state),
  });
  if (result.status !== 'committed') return;
  emitGrid9Room(args.io, state.matchId, roomEvent);
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

export async function changeGrid9PrivateSettings(args: {
  identity: Grid9Identity;
  matchId: string;
  expectedStateVersion: number;
}): Promise<void> {
  const state = await readGrid9State(args.matchId);
  requireHost(state, args.identity.userId);
  if (state.authority.stateVersion !== args.expectedStateVersion) {
    throw new Grid9Error('STALE_STATE', 'Stale settings', {
      stateVersion: state.authority.stateVersion,
      retryable: true,
    });
  }
}
