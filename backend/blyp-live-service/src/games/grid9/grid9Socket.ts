import { randomUUID } from 'crypto';
import type { Server, Socket } from 'socket.io';
import { getEconomyInfra } from '../../economy/infra';
import { logger } from '../../config/logger';
import {
  GRID9_SOCKET_CHANNEL,
  GRID9_SOCKET_ROOM_PREFIX,
} from './constants';
import {
  createGrid9PrivateEvent,
  createGrid9RoomEvent,
  createGrid9Welcome,
  emitGrid9Private,
  emitGrid9Room,
  grid9ConnectionRoom,
} from './grid9Broadcast';
import { parseGrid9ClientIntent } from './grid9IntentSchemas';
import {
  consumeGrid9Assignment,
  consumeGrid9ConnectionNonce,
  enqueueGrid9Player,
  leaveGrid9Queue,
} from './grid9Matchmaker';
import {
  buyGrid9InventoryItem,
  fireGrid9Weapon,
  fundGrid9Mercenary,
  purchaseGrid9Shield,
  sendGrid9ArsenalGift,
} from './grid9MatchService';
import { reserveGrid9Coins } from './grid9WalletService';
import { resolveGrid9Identity } from './grid9Identity';
import {
  commitGrid9ServerMutation,
  newGrid9ServerOperationReceipt,
  readGrid9State,
} from './grid9AggregateStore';
import { grid9CanonicalOperationHash } from './canonical';
import { asGrid9Error, Grid9Error } from './grid9Errors';
import { markGrid9Connection } from './grid9Engine';
import { toGrid9PublicGameState } from './grid9Projection';
import { grid9RedisKeys } from './redisKeys';
import {
  cancelGrid9DisconnectTimeout,
  claimDueGrid9DisconnectTimeouts,
  ensureGrid9DisconnectTimeout,
  hasOtherGrid9UserPresence,
  refreshGrid9Presence,
  removeGrid9PresenceSocket,
  scheduleGrid9DisconnectTimeout,
  upsertGrid9Presence,
} from './grid9Presence';
import {
  changeGrid9PrivateSettings,
  createGrid9PrivateRoom,
  joinGrid9PrivateRoom,
  kickGrid9PrivatePlayer,
  startGrid9PrivateMatch,
} from './grid9PrivateRooms';
import type { Grid9ClientIntent } from './protocol';

const MAX_MESSAGES_PER_SECOND = 30;

function redis() {
  return getEconomyInfra().redis;
}

export function isGrid9Enabled(): boolean {
  const value = String(process.env.LIVE_GRID9_ENABLED ?? '0')
    .trim()
    .toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function rejectGrid9Intent(
  socket: Socket,
  connectionSessionId: string,
  intentId: string,
  matchId: string | null,
  error: unknown,
): void {
  const normalized = asGrid9Error(error);
  emitGrid9Private(
    socket,
    createGrid9PrivateEvent({
      type: 'INTENT_REJECTED',
      connectionSessionId,
      matchId,
      stateVersion: normalized.stateVersion,
      causationIntentId: intentId,
      payload: {
        intentId,
        code: normalized.code,
        retryable: normalized.retryable,
        message: normalized.message,
        authoritativeStateVersion: normalized.stateVersion,
      },
    }),
  );
}

async function upsertPresence(args: {
  matchId: string;
  socket: Socket;
  userId: string;
  role: 'player' | 'audience';
  slotIndex: number | null;
}): Promise<void> {
  await upsertGrid9Presence({
    matchId: args.matchId,
    socketId: args.socket.id,
    userId: args.userId,
    role: args.role,
    slotIndex: args.slotIndex,
  });
  args.socket.data.grid9MatchId = args.matchId;
  args.socket.data.grid9Role = args.role;
}

async function refreshPresence(socket: Socket): Promise<void> {
  const matchId = socket.data.grid9MatchId as string | undefined;
  const userId = socket.data.userId as string | undefined;
  if (!matchId || !userId) return;
  await refreshGrid9Presence(matchId, socket.id, userId);
}

async function setPlayerConnectionState(args: {
  io: Server;
  matchId: string;
  userId: string;
  connectionState: 'connected' | 'reconnecting' | 'disconnected';
  operationSuffix: string;
}): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await readGrid9State(args.matchId);
    const human = current.players.find(
      (player) => player.kind === 'human' && player.userId === args.userId,
    );
    if (!human || human.connectionState === args.connectionState) return;
    const next = markGrid9Connection(
      current,
      args.userId,
      args.connectionState,
      0,
    );
    const operationId =
      `connection-${args.operationSuffix}-${current.authority.stateVersion}`;
    const operationHash = grid9CanonicalOperationHash({
      matchId: args.matchId,
      operationId,
      kind: 'connection_state',
      payload: {
        userId: args.userId,
        connectionState: args.connectionState,
      },
    });
    const event = createGrid9RoomEvent({
      type: 'PLAYER_CONNECTION_CHANGED',
      matchId: args.matchId,
      sequence: next.authority.eventSequence,
      stateVersion: next.authority.stateVersion,
      causationIntentId: null,
      payload: {
        slotIndex: human.slotIndex,
        connectionState: args.connectionState,
      },
    });
    try {
      const committed = await commitGrid9ServerMutation({
        currentState: current,
        nextState: next,
        operationReceipt: newGrid9ServerOperationReceipt({
          matchId: args.matchId,
          operationId,
          kind: 'connection_state',
          canonicalOperationHash: operationHash,
          stateVersion: next.authority.stateVersion,
          result: event.payload,
          recordedAt: event.sentAt,
        }),
      });
      if (committed.status === 'committed') {
        emitGrid9Room(args.io, args.matchId, event);
      }
      return;
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
}

async function joinGrid9Match(args: {
  io: Server;
  socket: Socket;
  userId: string;
  connectionSessionId: string;
  intent: Extract<Grid9ClientIntent, { type: 'MATCH_JOIN' }>;
}): Promise<void> {
  await consumeGrid9ConnectionNonce(
    args.connectionSessionId,
    args.intent.nonce,
  );
  await consumeGrid9Assignment({
    region: args.intent.payload.region,
    assignmentId: args.intent.payload.assignmentId,
    assignmentToken: args.intent.payload.assignmentToken,
    matchId: args.intent.matchId,
    userId: args.userId,
  });
  const state = await readGrid9State(args.intent.matchId);
  const player = state.players.find(
    (candidate) =>
      candidate.kind === 'human' && candidate.userId === args.userId,
  );
  if (!player) {
    throw new Grid9Error('NOT_ELIGIBLE', 'User is not assigned to this match');
  }
  await args.socket.join(
    `${GRID9_SOCKET_ROOM_PREFIX}${args.intent.matchId}`,
  );
  await upsertPresence({
    matchId: args.intent.matchId,
    socket: args.socket,
    userId: args.userId,
    role: 'player',
    slotIndex: player.slotIndex,
  });
  await setPlayerConnectionState({
    io: args.io,
    matchId: args.intent.matchId,
    userId: args.userId,
    connectionState: 'connected',
    operationSuffix: args.socket.id,
  });
  const updated = await readGrid9State(args.intent.matchId);
  emitGrid9Private(
    args.socket,
    createGrid9PrivateEvent({
      type: 'STATE_SNAPSHOT',
      connectionSessionId: args.connectionSessionId,
      matchId: updated.matchId,
      stateVersion: updated.authority.stateVersion,
      causationIntentId: args.intent.intentId,
      payload: {
        state: toGrid9PublicGameState(updated),
        reason: 'join',
      },
    }),
  );
}

async function requestGrid9Snapshot(args: {
  io: Server;
  socket: Socket;
  userId: string;
  connectionSessionId: string;
  intent: Extract<Grid9ClientIntent, { type: 'REQUEST_SNAPSHOT' }>;
}): Promise<void> {
  await consumeGrid9ConnectionNonce(
    args.connectionSessionId,
    args.intent.nonce,
  );
  const state = await readGrid9State(args.intent.matchId);
  const player = state.players.find(
    (candidate) =>
      candidate.kind === 'human' && candidate.userId === args.userId,
  );
  await args.socket.join(
    `${GRID9_SOCKET_ROOM_PREFIX}${args.intent.matchId}`,
  );
  await upsertPresence({
    matchId: args.intent.matchId,
    socket: args.socket,
    userId: args.userId,
    role: player ? 'player' : 'audience',
    slotIndex: player?.slotIndex ?? null,
  });
  if (player) {
    await setPlayerConnectionState({
      io: args.io,
      matchId: args.intent.matchId,
      userId: args.userId,
      connectionState: 'connected',
      operationSuffix: args.socket.id,
    });
  }
  const updated = await readGrid9State(args.intent.matchId);
  emitGrid9Private(
    args.socket,
    createGrid9PrivateEvent({
      type: 'STATE_SNAPSHOT',
      connectionSessionId: args.connectionSessionId,
      matchId: updated.matchId,
      stateVersion: updated.authority.stateVersion,
      causationIntentId: args.intent.intentId,
      payload: {
        state: toGrid9PublicGameState(updated),
        reason:
          args.intent.payload.lastSeenStateVersion === null
            ? 'reconnect'
            : 'requested',
      },
    }),
  );
}

async function resumeExistingGrid9Match(args: {
  io: Server;
  socket: Socket;
  userId: string;
  connectionSessionId: string;
}): Promise<void> {
  const matchId = await redis().get(grid9RedisKeys.userMatch(args.userId));
  if (!matchId) return;
  let state;
  try {
    state = await readGrid9State(matchId);
  } catch (error) {
    if (error instanceof Grid9Error && error.code === 'MATCH_NOT_FOUND') {
      await redis().del(grid9RedisKeys.userMatch(args.userId));
      return;
    }
    throw error;
  }
  const player = state.players.find(
    (candidate) =>
      candidate.kind === 'human' && candidate.userId === args.userId,
  );
  if (!player) {
    await redis().del(grid9RedisKeys.userMatch(args.userId));
    return;
  }
  await args.socket.join(`${GRID9_SOCKET_ROOM_PREFIX}${matchId}`);
  await upsertPresence({
    matchId,
    socket: args.socket,
    userId: args.userId,
    role: 'player',
    slotIndex: player.slotIndex,
  });
  await setPlayerConnectionState({
    io: args.io,
    matchId,
    userId: args.userId,
    connectionState: 'connected',
    operationSuffix: args.socket.id,
  });
  state = await readGrid9State(matchId);
  emitGrid9Private(
    args.socket,
    createGrid9PrivateEvent({
      type: 'STATE_SNAPSHOT',
      connectionSessionId: args.connectionSessionId,
      matchId,
      stateVersion: state.authority.stateVersion,
      causationIntentId: null,
      payload: {
        state: toGrid9PublicGameState(state),
        reason: 'reconnect',
      },
    }),
  );
}

async function handleGrid9Intent(args: {
  io: Server;
  socket: Socket;
  userId: string;
  connectionSessionId: string;
  intent: Grid9ClientIntent;
}): Promise<void> {
  const { io, socket, userId, connectionSessionId, intent } = args;
  if (intent.connectionSessionId !== connectionSessionId) {
    throw new Grid9Error(
      'AUTH_REQUIRED',
      'Grid 9 connection session mismatch',
    );
  }
  if (intent.type === 'PING') {
    await consumeGrid9ConnectionNonce(connectionSessionId, intent.nonce);
    await refreshPresence(socket);
    emitGrid9Private(
      socket,
      createGrid9PrivateEvent({
        type: 'PONG',
        connectionSessionId,
        matchId: null,
        stateVersion: null,
        causationIntentId: intent.intentId,
        payload: {
          clientTime: intent.payload.clientTime,
          serverTime: new Date().toISOString(),
        },
      }),
    );
    return;
  }
  if (!isGrid9Enabled()) {
    throw new Grid9Error('MATCH_NOT_ACTIVE', 'Grid 9 is currently disabled');
  }
  const identity = await resolveGrid9Identity(userId);
  if (intent.type === 'QUEUE_JOIN') {
    const payload = await enqueueGrid9Player({
      io,
      intent,
      identity,
      connectionSessionId,
    });
    emitGrid9Private(
      socket,
      createGrid9PrivateEvent({
        type: 'QUEUE_STATUS',
        connectionSessionId,
        matchId: null,
        stateVersion: null,
        causationIntentId: intent.intentId,
        payload,
      }),
    );
  } else if (intent.type === 'QUEUE_LEAVE') {
    const payload = await leaveGrid9Queue({
      intent,
      userId,
      connectionSessionId,
    });
    emitGrid9Private(
      socket,
      createGrid9PrivateEvent({
        type: 'QUEUE_STATUS',
        connectionSessionId,
        matchId: null,
        stateVersion: null,
        causationIntentId: intent.intentId,
        payload,
      }),
    );
  } else if (intent.type === 'MATCH_JOIN') {
    await joinGrid9Match({
      io,
      socket,
      userId,
      connectionSessionId,
      intent,
    });
  } else if (intent.type === 'PRIVATE_ROOM_CREATE') {
    await consumeGrid9ConnectionNonce(connectionSessionId, intent.nonce);
    await createGrid9PrivateRoom({
      io,
      socket,
      identity,
      connectionSessionId,
      region: intent.payload.region,
      intentId: intent.intentId,
    });
  } else if (intent.type === 'PRIVATE_ROOM_JOIN') {
    await consumeGrid9ConnectionNonce(connectionSessionId, intent.nonce);
    await joinGrid9PrivateRoom({
      io,
      socket,
      identity,
      connectionSessionId,
      region: intent.payload.region,
      roomCode: intent.payload.roomCode,
      intentId: intent.intentId,
    });
  } else if (intent.type === 'START_PRIVATE_MATCH') {
    await consumeGrid9ConnectionNonce(connectionSessionId, intent.nonce);
    await startGrid9PrivateMatch({
      io,
      identity,
      matchId: intent.matchId,
      expectedStateVersion: intent.expectedStateVersion,
      intentId: intent.intentId,
    });
  } else if (intent.type === 'KICK_PLAYER') {
    await consumeGrid9ConnectionNonce(connectionSessionId, intent.nonce);
    await kickGrid9PrivatePlayer({
      io,
      identity,
      matchId: intent.matchId,
      targetUserId: intent.payload.targetUserId,
      expectedStateVersion: intent.expectedStateVersion,
      intentId: intent.intentId,
    });
  } else if (intent.type === 'CHANGE_SETTINGS') {
    await consumeGrid9ConnectionNonce(connectionSessionId, intent.nonce);
    await changeGrid9PrivateSettings({
      identity,
      matchId: intent.matchId,
      expectedStateVersion: intent.expectedStateVersion,
    });
  } else if (intent.type === 'REQUEST_SNAPSHOT') {
    await requestGrid9Snapshot({
      io,
      socket,
      userId,
      connectionSessionId,
      intent,
    });
  } else if (intent.type === 'RESERVE_COINS') {
    const messageId = randomUUID();
    const result = await reserveGrid9Coins({
      intent,
      userId,
      connectionSessionId,
      privateMessageId: messageId,
    });
    emitGrid9Private(
      socket,
      createGrid9PrivateEvent({
        type: 'ESCROW_UPDATED',
        connectionSessionId,
        matchId: intent.matchId,
        stateVersion: result.receipt.stateVersion,
        causationIntentId: intent.intentId,
        messageId,
        payload: {
          wallet: result.wallet,
          reservation: result.reservation,
        },
      }),
    );
    emitGrid9Private(
      socket,
      createGrid9PrivateEvent({
        type: 'INTENT_COMMITTED',
        connectionSessionId,
        matchId: intent.matchId,
        stateVersion: result.receipt.stateVersion,
        causationIntentId: intent.intentId,
        payload: { receipt: result.receipt },
      }),
    );
  } else {
    const action =
      intent.type === 'FIRE_WEAPON'
        ? await fireGrid9Weapon({ intent, identity })
        : intent.type === 'FUND_MERCENARY'
          ? await fundGrid9Mercenary({ intent, identity })
          : intent.type === 'SEND_ARSENAL_GIFT'
            ? await sendGrid9ArsenalGift({ intent, identity })
            : intent.type === 'BUY_INVENTORY_ITEM'
              ? await buyGrid9InventoryItem({ intent, identity })
              : await purchaseGrid9Shield({ intent, identity });
    emitGrid9Private(
      socket,
      createGrid9PrivateEvent({
        type: 'INTENT_COMMITTED',
        connectionSessionId,
        matchId: intent.matchId,
        stateVersion: action.privateReceipt.stateVersion,
        causationIntentId: intent.intentId,
        payload: { receipt: action.privateReceipt },
      }),
    );
    for (const event of action.roomEvents) {
      emitGrid9Room(io, intent.matchId, event);
    }
  }
}

export function registerGrid9Socket(
  io: Server,
  socket: Socket,
): void {
  const userId = socket.data.userId as string | undefined;
  if (!userId) return;
  const connectionSessionId = randomUUID();
  socket.data.grid9ConnectionSessionId = connectionSessionId;
  void socket.join(grid9ConnectionRoom(connectionSessionId));
  emitGrid9Private(
    socket,
    createGrid9Welcome(socket, connectionSessionId),
  );
  void resumeExistingGrid9Match({
    io,
    socket,
    userId,
    connectionSessionId,
  }).catch((error: any) => {
    logger.warn(
      { userId, err: error?.message || String(error) },
      '[grid9] automatic reconnect failed',
    );
  });

  let chain = Promise.resolve();
  let messageTimes: number[] = [];
  socket.on(GRID9_SOCKET_CHANNEL, (raw: unknown) => {
    const now = Date.now();
    messageTimes = messageTimes.filter((time) => now - time < 1_000);
    if (messageTimes.length >= MAX_MESSAGES_PER_SECOND) {
      rejectGrid9Intent(
        socket,
        connectionSessionId,
        randomUUID(),
        null,
        new Grid9Error('RATE_LIMITED', 'Grid 9 rate limit exceeded'),
      );
      return;
    }
    messageTimes.push(now);
    chain = chain
      .then(async () => {
        let intent: Grid9ClientIntent;
        try {
          intent = parseGrid9ClientIntent(raw);
        } catch {
          throw new Grid9Error(
            'INVALID_PAYLOAD',
            'Invalid Grid 9 message',
          );
        }
        await handleGrid9Intent({
          io,
          socket,
          userId,
          connectionSessionId,
          intent,
        });
      })
      .catch((error) => {
        const rawRecord =
          raw && typeof raw === 'object'
            ? (raw as Record<string, unknown>)
            : {};
        rejectGrid9Intent(
          socket,
          connectionSessionId,
          typeof rawRecord.intentId === 'string'
            ? rawRecord.intentId
            : randomUUID(),
          typeof rawRecord.matchId === 'string'
            ? rawRecord.matchId
            : null,
          error,
        );
      });
  });

  socket.on('disconnect', () => {
    const matchId = socket.data.grid9MatchId as string | undefined;
    if (!matchId) return;
    void (async () => {
      const stillPresent = await removeGrid9PresenceSocket(
        matchId,
        userId,
        socket.id,
      );
      if (socket.data.grid9Role !== 'player') return;
      if (stillPresent || (await hasOtherGrid9UserPresence(matchId, userId))) {
        return;
      }
      await scheduleGrid9DisconnectTimeout(matchId, userId);
      await setPlayerConnectionState({
        io,
        matchId,
        userId,
        connectionState: 'reconnecting',
        operationSuffix: socket.id,
      });
    })().catch((error: any) => {
      logger.warn(
        { matchId, userId, err: error?.message || String(error) },
        '[grid9] disconnect state update failed',
      );
    });
  });
}

export async function processGrid9PresenceTimeouts(
  io: Server,
): Promise<void> {
  const due = await claimDueGrid9DisconnectTimeouts();
  for (const { matchId, userId } of due) {
    try {
      if (await hasOtherGrid9UserPresence(matchId, userId)) {
        await cancelGrid9DisconnectTimeout(matchId, userId);
        continue;
      }
      await setPlayerConnectionState({
        io,
        matchId,
        userId,
        connectionState: 'disconnected',
        operationSuffix: `presence-timeout-${userId}`,
      });
      const after = await readGrid9State(matchId);
      const human = after.players.find(
        (player) => player.kind === 'human' && player.userId === userId,
      );
      if (
        after.phase === 'combat' &&
        after.turn &&
        human &&
        human.slotIndex === after.turn.spotlightSlotIndex
      ) {
        const { forceGrid9DisconnectedTurnEnd } = await import('./grid9GameLoop');
        await forceGrid9DisconnectedTurnEnd(io, matchId);
      }
    } catch (error: any) {
      if (error instanceof Grid9Error && error.code === 'MATCH_NOT_FOUND') {
        await cancelGrid9DisconnectTimeout(matchId, userId);
        continue;
      }
      logger.warn(
        { matchId, userId, err: error?.message || String(error) },
        '[grid9] presence timeout update failed',
      );
      await scheduleGrid9DisconnectTimeout(matchId, userId);
    }
  }
}

export async function repairGrid9PresenceTimeouts(
  matchId: string,
  userId: string,
  connectionState: 'connected' | 'reconnecting' | 'disconnected',
): Promise<void> {
  if (connectionState === 'disconnected') {
    await cancelGrid9DisconnectTimeout(matchId, userId);
    return;
  }
  if (await hasOtherGrid9UserPresence(matchId, userId)) {
    await cancelGrid9DisconnectTimeout(matchId, userId);
    return;
  }
  await ensureGrid9DisconnectTimeout(matchId, userId);
}
