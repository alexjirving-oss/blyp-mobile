import { isGrid9RoomEventType } from './protocol';
import type {
  Grid9AuthoritativeGameState,
  Grid9EscrowWallet,
  Grid9IntentRejectedPayload,
  Grid9LedgerReceipt,
  Grid9MatchAssignedPayload,
  Grid9PublicPlayer,
  Grid9QueueStatusPayload,
  Grid9ServerEvent,
  Grid9TurnState,
} from './protocol';

export type Grid9ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected';

export interface Grid9ClientSession {
  connectionStatus: Grid9ConnectionStatus;
  connectionSessionId: string | null;
  connectionId: string | null;
  region: string | null;
  matchId: string | null;
  assignment: Grid9MatchAssignedPayload | null;
  queue: Grid9QueueStatusPayload | null;
  match: Grid9AuthoritativeGameState | null;
  escrow: Grid9EscrowWallet | null;
  lastSeenStateVersion: number | null;
  lastSeenSequence: number | null;
  lastReceipt: Grid9LedgerReceipt | null;
  lastRejection: Grid9IntentRejectedPayload | null;
  lastError: string | null;
  lastPongAt: string | null;
  needsResync: boolean;
  droppedStalePackets: number;
}

export interface Grid9ApplyEffects {
  dropped: boolean;
  requestSnapshot: boolean;
  joinMatch: boolean;
}

export interface Grid9ApplyResult {
  session: Grid9ClientSession;
  effects: Grid9ApplyEffects;
}

export function createEmptyGrid9Session(): Grid9ClientSession {
  return {
    connectionStatus: 'idle',
    connectionSessionId: null,
    connectionId: null,
    region: null,
    matchId: null,
    assignment: null,
    queue: null,
    match: null,
    escrow: null,
    lastSeenStateVersion: null,
    lastSeenSequence: null,
    lastReceipt: null,
    lastRejection: null,
    lastError: null,
    lastPongAt: null,
    needsResync: false,
    droppedStalePackets: 0,
  };
}

function noEffects(): Grid9ApplyEffects {
  return { dropped: false, requestSnapshot: false, joinMatch: false };
}

function withMatchVersion(
  match: Grid9AuthoritativeGameState,
  stateVersion: number,
  sequence: number,
): Grid9AuthoritativeGameState {
  return {
    ...match,
    stateVersion,
    eventSequence: sequence,
  };
}

function mapPlayer(
  match: Grid9AuthoritativeGameState,
  slotIndex: number,
  update: (player: Grid9PublicPlayer) => Grid9PublicPlayer,
): Grid9AuthoritativeGameState {
  return {
    ...match,
    players: match.players.map((player) =>
      player.slotIndex === slotIndex ? update(player) : player,
    ),
  };
}

function applyRoomPatch(
  session: Grid9ClientSession,
  event: Extract<Grid9ServerEvent, { routing: 'room' }>,
): Grid9ClientSession {
  const current = session.match;
  if (!current && event.type !== 'MATCH_COMPLETED') {
    return session;
  }

  let nextMatch = current;
  if (event.type === 'WEAPON_RESOLVED' && nextMatch) {
    nextMatch = event.payload.damage.reduce(
      (state, hit) =>
        mapPlayer(state, hit.slotIndex, (player) => ({
          ...player,
          health: hit.healthAfter,
          shieldPoints: hit.shieldAfter,
          status: hit.eliminated ? 'eliminated' : player.status,
          mode:
            hit.eliminated && player.kind === 'human' ? 'sabotage' : player.mode,
        })),
      nextMatch,
    );
    if (
      event.payload.sourceSlotIndex != null &&
      Array.isArray(event.payload.inventoryAfter)
    ) {
      nextMatch = mapPlayer(nextMatch, event.payload.sourceSlotIndex, (player) => ({
        ...player,
        inventory: [...event.payload.inventoryAfter],
      }));
    }
    nextMatch = {
      ...nextMatch,
      jackpot: { ...nextMatch.jackpot, currentCoins: event.payload.jackpotCoins },
    };
  } else if (event.type === 'SHIELD_RESOLVED' && nextMatch) {
    nextMatch = mapPlayer(nextMatch, event.payload.beneficiarySlotIndex, (player) => ({
      ...player,
      shieldPoints: event.payload.shieldAfter,
    }));
    if (
      event.payload.sourceSlotIndex != null &&
      Array.isArray(event.payload.inventoryAfter)
    ) {
      nextMatch = mapPlayer(nextMatch, event.payload.sourceSlotIndex, (player) => ({
        ...player,
        inventory: [...event.payload.inventoryAfter],
      }));
    }
    nextMatch = {
      ...nextMatch,
      jackpot: { ...nextMatch.jackpot, currentCoins: event.payload.jackpotCoins },
    };
  } else if (event.type === 'MERCENARY_FUNDED' && nextMatch) {
    nextMatch = mapPlayer(nextMatch, event.payload.beneficiarySlotIndex, (player) => ({
      ...player,
      mercenaryBankrollCoins: event.payload.bankrollAfter,
    }));
  } else if (event.type === 'ARSENAL_GRANTED' && nextMatch) {
    nextMatch = mapPlayer(nextMatch, event.payload.recipientSlotIndex, (player) => ({
      ...player,
      inventory: [...event.payload.inventoryAfter],
      mercenaryBankrollCoins: player.mercenaryBankrollCoins + event.payload.seatCoins,
      mercenarySponsorCoins:
        (player.mercenarySponsorCoins ?? 0) + event.payload.seatCoins,
    }));
    nextMatch = {
      ...nextMatch,
      jackpot: {
        ...nextMatch.jackpot,
        currentCoins: event.payload.jackpotTotalCoins,
      },
    };
  } else if (event.type === 'TURN_ADVANCED' && nextMatch) {
    nextMatch = { ...nextMatch, turn: event.payload.turn, phase: 'combat', roulette: null };
  } else if (event.type === 'TURN_TICK' && nextMatch) {
    nextMatch = { ...nextMatch, turn: event.payload.turn, phase: 'combat' };
  } else if (event.type === 'ROULETTE_START' && nextMatch) {
    nextMatch = {
      ...nextMatch,
      phase: 'roulette',
      turn: null,
      roulette: {
        turnNumber: event.payload.turnNumber,
        candidateSlotIndices: event.payload.candidateSlotIndices as Grid9TurnState['spotlightSlotIndex'][],
        selectedSlotIndex: event.payload.selectedSlotIndex as Grid9TurnState['spotlightSlotIndex'],
        startedAt: nextMatch.serverTime,
        endsAt: event.payload.endsAt,
        entropyDigest: event.payload.entropyDigest,
      },
    };
  } else if (event.type === 'ROULETTE_LAND' && nextMatch) {
    nextMatch = {
      ...nextMatch,
      phase: 'combat',
      turn: event.payload.turn,
      roulette: null,
    };
  } else if (event.type === 'MICRO_DROP_RESOLVED' && nextMatch) {
    const result = event.payload.result;
    nextMatch = {
      ...mapPlayer(nextMatch, result.recipientSlotIndex, (player) => {
        if (result.reward.kind === 'coins') {
          return {
            ...player,
            mercenaryBankrollCoins: player.mercenaryBankrollCoins + result.reward.amountCoins,
            mercenaryMicroDropCoins:
              (player.mercenaryMicroDropCoins ?? 0) + result.reward.amountCoins,
          };
        }
        return {
          ...player,
          shieldPoints: Math.min(
            player.maxShieldPoints,
            player.shieldPoints + result.reward.shieldPoints,
          ),
        };
      }),
      lastMicroDrop: result,
    };
  } else if (event.type === 'PLAYER_CONNECTION_CHANGED' && nextMatch) {
    if (event.payload.replacementPlayer) {
      nextMatch = {
        ...nextMatch,
        players: nextMatch.players.map((player) =>
          player.slotIndex === event.payload.slotIndex
            ? event.payload.replacementPlayer!
            : player,
        ),
        audienceCount:
          typeof event.payload.audienceCount === 'number'
            ? event.payload.audienceCount
            : nextMatch.audienceCount,
      };
    } else {
      nextMatch = mapPlayer(nextMatch, event.payload.slotIndex, (player) =>
        player.kind === 'human'
          ? { ...player, connectionState: event.payload.connectionState }
          : player,
      );
    }
  } else if (event.type === 'PLAYER_ELIMINATED' && nextMatch) {
    nextMatch = mapPlayer(nextMatch, event.payload.slotIndex, (player) => ({
      ...player,
      status: 'eliminated',
      mode: event.payload.humanEnteredSabotageMode ? 'sabotage' : player.mode,
    }));
  } else if (event.type === 'JACKPOT_CHANGED' && nextMatch) {
    nextMatch = { ...nextMatch, jackpot: event.payload.jackpot };
  } else if (event.type === 'MATCH_COMPLETED') {
    nextMatch = event.payload.finalState;
  }

  if (!nextMatch) return session;
  const stamped = withMatchVersion(nextMatch, event.stateVersion, event.sequence);
  return {
    ...session,
    matchId: event.matchId,
    match: stamped,
    lastSeenStateVersion: stamped.stateVersion,
    lastSeenSequence: stamped.eventSequence,
    needsResync: false,
  };
}

function applyPrivateEvent(
  session: Grid9ClientSession,
  event: Extract<Grid9ServerEvent, { routing: 'private' }>,
): { session: Grid9ClientSession; effects: Grid9ApplyEffects } {
  const effects = noEffects();
  if (event.type === 'WELCOME') {
    return {
      session: {
        ...session,
        connectionStatus: 'connected',
        connectionId: event.payload.connectionId,
        connectionSessionId: event.payload.connectionSessionId,
        lastError: null,
      },
      effects: {
        ...effects,
        requestSnapshot: !!session.matchId,
      },
    };
  }
  if (event.type === 'QUEUE_STATUS') {
    return {
      session: {
        ...session,
        queue: event.payload,
        region: event.payload.entry?.region ?? session.region,
      },
      effects,
    };
  }
  if (event.type === 'MATCH_ASSIGNED') {
    return {
      session: {
        ...session,
        assignment: event.payload,
        matchId: event.payload.matchId,
        queue: session.queue
          ? { ...session.queue, status: 'assigned' }
          : session.queue,
      },
      effects: { ...effects, joinMatch: true },
    };
  }
  if (event.type === 'PRIVATE_ROOM_STATUS') {
    const kicked = event.payload.status === 'kicked';
    const left = event.payload.status === 'left' || event.payload.status === 'closed';
    if (left) {
      return {
        session: {
          ...session,
          matchId: null,
          assignment: null,
          match: null,
          queue: null,
          escrow: null,
          lastSeenStateVersion: null,
          lastSeenSequence: null,
          lastError: null,
        },
        effects,
      };
    }
    return {
      session: {
        ...session,
        matchId: event.payload.matchId,
        assignment: kicked
          ? null
          : event.payload.slotIndex == null
            ? session.assignment
            : {
                assignmentId: `private-${event.payload.matchId}`,
                matchId: event.payload.matchId,
                liveSessionId: event.payload.matchId,
                slotIndex: event.payload.slotIndex as Grid9TurnState['spotlightSlotIndex'],
                assignmentToken: 'private',
                assignmentExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
              },
      },
      effects,
    };
  }
  if (event.type === 'STATE_SNAPSHOT') {
    const state = event.payload.state;
    return {
      session: {
        ...session,
        matchId: state.matchId,
        match: state,
        lastSeenStateVersion: state.stateVersion,
        lastSeenSequence: state.eventSequence,
        needsResync: false,
        lastError: null,
      },
      effects,
    };
  }
  if (event.type === 'ESCROW_UPDATED') {
    return { session: { ...session, escrow: event.payload.wallet }, effects };
  }
  if (event.type === 'INTENT_COMMITTED') {
    return {
      session: { ...session, lastReceipt: event.payload.receipt, lastRejection: null },
      effects,
    };
  }
  if (event.type === 'INTENT_REJECTED') {
    const stale = event.payload.code === 'STALE_STATE';
    return {
      session: {
        ...session,
        lastRejection: event.payload,
        lastError: event.payload.message,
        needsResync: session.needsResync || stale,
      },
      effects: { ...effects, requestSnapshot: stale },
    };
  }
  if (event.type === 'RESYNC_REQUIRED') {
    return {
      session: { ...session, needsResync: true },
      effects: { ...effects, requestSnapshot: true },
    };
  }
  if (event.type === 'PONG') {
    return {
      session: { ...session, lastPongAt: event.payload.serverTime },
      effects,
    };
  }
  return { session, effects };
}

export function readGrid9Sequence(event: {
  sequence?: unknown;
  sequenceId?: unknown;
}): number | null {
  if (typeof event.sequence === 'number' && Number.isInteger(event.sequence)) {
    return event.sequence;
  }
  if (typeof event.sequenceId === 'number' && Number.isInteger(event.sequenceId)) {
    return event.sequenceId;
  }
  return null;
}

export function applyGrid9ServerEvent(
  session: Grid9ClientSession,
  event: Grid9ServerEvent,
): Grid9ApplyResult {
  if (event.routing === 'private') {
    return applyPrivateEvent(session, event);
  }

  const sequence = readGrid9Sequence(event);
  if (sequence == null) {
    return {
      session: { ...session, needsResync: true },
      effects: { dropped: true, requestSnapshot: true, joinMatch: false },
    };
  }

  const lastSeen = session.lastSeenSequence;
  if (lastSeen == null) {
    return {
      session: { ...session, needsResync: true },
      effects: { dropped: true, requestSnapshot: true, joinMatch: false },
    };
  }
  if (sequence <= lastSeen) {
    return {
      session: {
        ...session,
        droppedStalePackets: session.droppedStalePackets + 1,
      },
      effects: { dropped: true, requestSnapshot: false, joinMatch: false },
    };
  }
  if (sequence > lastSeen + 1) {
    return {
      session: { ...session, needsResync: true },
      effects: { dropped: true, requestSnapshot: true, joinMatch: false },
    };
  }

  return {
    session: applyRoomPatch(session, { ...event, sequence }),
    effects: noEffects(),
  };
}

export function asGrid9ServerEvent(raw: unknown): Grid9ServerEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (value.protocol !== 'grid9.ws' || value.protocolVersion !== 2) return null;
  if (value.direction !== 'server_to_client' || typeof value.type !== 'string') {
    return null;
  }
  if (value.routing === 'room' && isGrid9RoomEventType(value.type)) {
    const sequence = readGrid9Sequence(value);
    if (sequence == null || typeof value.stateVersion !== 'number') return null;
    return { ...(value as unknown as Grid9ServerEvent), sequence } as Grid9ServerEvent;
  }
  if (value.routing === 'private') {
    return value as unknown as Grid9ServerEvent;
  }
  return null;
}
