import { randomUUID } from 'crypto';
import type { Server } from 'socket.io';
import { getEconomyInfra } from '../../economy/infra';
import { logger } from '../../config/logger';
import {
  GRID9_SHIELD_CATALOG,
  GRID9_WEAPON_CATALOG,
  type Grid9WeaponId,
} from './catalog';
import { grid9CanonicalOperationHash } from './canonical';
import {
  advanceGrid9Turn,
  applyGrid9MicroDrop,
  applyGrid9Shield,
  applyGrid9Weapon,
  landGrid9Roulette,
  startGrid9Roulette,
  type Grid9Identity,
} from './grid9Engine';
import {
  commitGrid9ServerMutation,
  emptyGrid9Escrow,
  newGrid9ServerOperationReceipt,
  projectGrid9Timer,
  readGrid9Aggregate,
  readGrid9State,
  removeGrid9ActiveMatch,
} from './grid9AggregateStore';
import { Grid9Error } from './grid9Errors';
import {
  createGrid9RoomEvent,
  emitGrid9Room,
} from './grid9Broadcast';
import { chooseGrid9SentinelDecision, grid9CombatTimerDueAtMs } from './grid9Sentinels';
import {
  allocateGrid9MercenarySpend,
  type Grid9EscrowWallet,
  type Grid9LedgerEntry,
  type Grid9PublicPurchaseReceipt,
} from './ledger';
import type {
  Grid9ActionActor,
  Grid9HumanPlayer,
  Grid9Player,
  Grid9SentinelPlayer,
} from './players';
import type { Grid9RoomServerEvent } from './protocol';
import { grid9RedisKeys, type Grid9TimerOutboxRecord } from './redisKeys';
import { timerOutboxForState } from './grid9MatchService';
import { toGrid9PublicGameState } from './grid9Projection';
import type { Grid9GameState, Grid9MatchOutcome } from './state';
import { settleGrid9Match } from './grid9Settlement';
import { recoverGrid9InitializingMatch, clearOpenPublicLobbyMatchId } from './grid9Matchmaker';
import {
  processGrid9PresenceTimeouts,
  repairGrid9PresenceTimeouts,
} from './grid9Socket';

const POLL_MS = 250;
const REPAIR_MS = 5_000;
const BATCH_SIZE = 24;

function redis() {
  return getEconomyInfra().redis;
}

function timerMember(record: Grid9TimerOutboxRecord): string {
  return `${record.matchId}|${record.reason}|${record.stateVersion}`;
}

export async function scheduleGrid9Timers(
  state: Grid9GameState,
): Promise<void> {
  const timer = timerOutboxForState(state);
  if (timer) await projectGrid9Timer(timer);
  if (state.phase === 'combat') {
    await redis().zadd(
      grid9RedisKeys.timersProjection(),
      Date.parse(state.authority.matchDeadlineAt),
      `${state.matchId}|match_deadline|${state.authority.stateVersion}`,
    );
  }
}

function completionEvent(
  state: Grid9GameState,
  sequence: number,
): Grid9RoomServerEvent {
  const publicState = toGrid9PublicGameState(state);
  return createGrid9RoomEvent({
    type: 'MATCH_COMPLETED',
    matchId: state.matchId,
    sequence,
    stateVersion: state.authority.stateVersion,
    causationIntentId: null,
    payload: {
      outcome: publicState.outcome!,
      finalState: publicState,
    },
  });
}

async function commitSimpleStateEvent(args: {
  io: Server;
  current: Grid9GameState;
  next: Grid9GameState;
  operationId: string;
  kind: 'phase_transition' | 'turn_advance';
  roomEvent: Grid9RoomServerEvent;
}): Promise<void> {
  const operationHash = grid9CanonicalOperationHash({
    matchId: args.current.matchId,
    operationId: args.operationId,
    kind: args.kind,
    payload: {
      stateVersion: args.current.authority.stateVersion,
      eventType: args.roomEvent.type,
    },
  });
  const result = await commitGrid9ServerMutation({
    currentState: args.current,
    nextState: args.next,
    operationReceipt: newGrid9ServerOperationReceipt({
      matchId: args.current.matchId,
      operationId: args.operationId,
      kind: args.kind,
      canonicalOperationHash: operationHash,
      stateVersion: args.next.authority.stateVersion,
      result: args.roomEvent.payload,
      recordedAt: args.roomEvent.sentAt,
    }),
    timerOutbox: timerOutboxForState(args.next),
  });
  if (result.status === 'committed') {
    emitGrid9Room(args.io, args.current.matchId, args.roomEvent);
    await scheduleGrid9Timers(args.next);
  }
}

async function processLobbyWaiting(io: Server, state: Grid9GameState): Promise<void> {
  if (state.phase !== 'lobby_waiting' && state.phase !== 'countdown') return;
  await clearOpenPublicLobbyMatchId(state.region, state.matchId);
  const nowMs = Math.max(Date.now(), Date.parse(state.phaseEndsAt as string));
  const next = startGrid9Roulette(state, nowMs);
  const event = next.outcome
    ? completionEvent(next, next.authority.eventSequence)
    : createGrid9RoomEvent({
        type: 'ROULETTE_START',
        matchId: state.matchId,
        sequence: next.authority.eventSequence,
        stateVersion: next.authority.stateVersion,
        causationIntentId: null,
        payload: {
          turnNumber: next.roulette!.turnNumber,
          candidateSlotIndices: next.roulette!.candidateSlotIndices,
          selectedSlotIndex: next.roulette!.selectedSlotIndex,
          endsAt: next.roulette!.endsAt,
          entropyDigest: next.roulette!.entropyDigest,
        },
      });
  await commitSimpleStateEvent({
    io,
    current: state,
    next,
    operationId: `lobby-${state.matchId}-${state.authority.stateVersion}`,
    kind: 'phase_transition',
    roomEvent: event,
  });
  if (next.phase === 'completed') {
    await settleGrid9Match(io, next);
  }
}

async function processRouletteEnd(io: Server, state: Grid9GameState): Promise<void> {
  if (state.phase !== 'roulette' || !state.roulette) return;
  const nowMs = Math.max(Date.now(), Date.parse(state.roulette.endsAt));
  const next = landGrid9Roulette(state, nowMs);
  const event = createGrid9RoomEvent({
    type: 'ROULETTE_LAND',
    matchId: state.matchId,
    sequence: next.authority.eventSequence,
    stateVersion: next.authority.stateVersion,
    causationIntentId: null,
    payload: {
      turn: next.turn!,
      freeDropItemId: next.turn!.freeDropItemId,
      freeDropEquipped: next.turn!.freeDropEquipped,
    },
  });
  await commitSimpleStateEvent({
    io,
    current: state,
    next,
    operationId: `roulette-${state.matchId}-${state.roulette.turnNumber}`,
    kind: 'phase_transition',
    roomEvent: event,
  });
}

async function processMicroDrop(io: Server, state: Grid9GameState): Promise<void> {
  if (state.phase !== 'combat' || !state.turn || state.turn.microDropAwarded) {
    return;
  }
  const operationId = `drop-${state.matchId}-${state.turn.turnNumber}`;
  const ledgerEntryId = randomUUID();
  const resolution = applyGrid9MicroDrop({
    state,
    operationId,
    ledgerEntryId,
    nowMs: Math.max(Date.now(), Date.parse(state.turn.spotlightEndsAt)),
  });
  let currentEscrow: Grid9EscrowWallet | null = null;
  let nextEscrow: Grid9EscrowWallet | null = null;
  let escrowUserId: string | null = null;
  let ledger: Grid9LedgerEntry | null = null;
  if (resolution.humanCoinCredit) {
    escrowUserId = resolution.humanCoinCredit.userId;
    const snapshot = await readGrid9Aggregate(state.matchId, escrowUserId);
    if (snapshot.state.authority.stateVersion !== state.authority.stateVersion) {
      throw new Grid9Error('STALE_STATE', 'Micro-drop state changed', {
        retryable: true,
      });
    }
    currentEscrow =
      snapshot.escrow ?? emptyGrid9Escrow(state.matchId, escrowUserId);
    nextEscrow = {
      ...currentEscrow,
      microDropCreditCoins:
        currentEscrow.microDropCreditCoins +
        resolution.humanCoinCredit.amountCoins,
      availableCoins:
        currentEscrow.availableCoins +
        resolution.humanCoinCredit.amountCoins,
      version: currentEscrow.version + 1,
      updatedAt: resolution.state.lastMicroDrop!.awardedAt,
    };
    ledger = {
      schemaVersion: 1,
      entryId: ledgerEntryId,
      intentId: null,
      matchId: state.matchId,
      kind: 'micro_drop_credit',
      actorUserId: null,
      beneficiaryUserId: escrowUserId,
      sourceSlotIndex: null,
      targetSlotIndex: resolution.state.lastMicroDrop!.recipientSlotIndex,
      itemId: null,
      fundingSource: 'house_micro_drop',
      fundingBreakdown: {
        platformReservationCoins: 0,
        microDropCoins: resolution.humanCoinCredit.amountCoins,
        mercenaryBankrollCoins: 0,
        jackpotPoolCoins: 0,
      },
      serverOperationId: operationId,
      canonicalPayloadHash: grid9CanonicalOperationHash({
        matchId: state.matchId,
        operationId,
        kind: 'micro_drop',
        payload: resolution.state.lastMicroDrop,
      }),
      debitCoins: 0,
      creditCoins: resolution.humanCoinCredit.amountCoins,
      jackpotDeltaCoins: 0,
      escrowBalanceBefore: currentEscrow.availableCoins,
      escrowBalanceAfter: nextEscrow.availableCoins,
      stateVersionBefore: state.authority.stateVersion,
      stateVersionAfter: resolution.state.authority.stateVersion,
      createdAt: resolution.state.lastMicroDrop!.awardedAt,
    };
  }
  const event = createGrid9RoomEvent({
    type: 'MICRO_DROP_RESOLVED',
    matchId: state.matchId,
    sequence: resolution.state.authority.eventSequence,
    stateVersion: resolution.state.authority.stateVersion,
    causationIntentId: null,
    payload: { result: resolution.state.lastMicroDrop! },
  });
  const operationHash = grid9CanonicalOperationHash({
    matchId: state.matchId,
    operationId,
    kind: 'micro_drop',
    payload: resolution.state.lastMicroDrop,
  });
  const committed = await commitGrid9ServerMutation({
    currentState: state,
    nextState: resolution.state,
    operationReceipt: newGrid9ServerOperationReceipt({
      matchId: state.matchId,
      operationId,
      kind: 'micro_drop',
      canonicalOperationHash: operationHash,
      stateVersion: resolution.state.authority.stateVersion,
      ledgerEntryId: ledger?.entryId ?? null,
      result: event.payload,
      recordedAt: event.sentAt,
    }),
    ledger,
    escrowUserId,
    currentEscrow,
    nextEscrow,
    timerOutbox: timerOutboxForState(resolution.state),
  });
  if (committed.status === 'committed') {
    emitGrid9Room(io, state.matchId, event);
    await scheduleGrid9Timers(resolution.state);
  }
}

function lowestEffectiveHealthTarget(
  state: Grid9GameState,
  source: Grid9Player,
): Grid9Player | null {
  return (
    state.players
      .filter(
        (candidate) =>
          candidate.status === 'alive' &&
          candidate.slotIndex !== source.slotIndex,
      )
      .sort(
        (left, right) =>
          left.health +
            left.shieldPoints -
            (right.health + right.shieldPoints) ||
          left.slotIndex - right.slotIndex,
      )[0] ?? null
  );
}

function chooseProxyWeapon(bankrollCoins: number): Grid9WeaponId | null {
  if (bankrollCoins >= GRID9_WEAPON_CATALOG.mega_bomb.costCoins) {
    return 'mega_bomb';
  }
  if (bankrollCoins >= GRID9_WEAPON_CATALOG.fireball.costCoins) {
    return 'fireball';
  }
  if (bankrollCoins >= GRID9_WEAPON_CATALOG.arrow.costCoins) {
    return 'arrow';
  }
  return null;
}

async function processAutomatedPurchase(
  io: Server,
  state: Grid9GameState,
): Promise<Grid9GameState> {
  if (!state.turn) return state;
  const source = state.players[state.turn.spotlightSlotIndex];
  if (source.status !== 'alive') {
    return state;
  }

  if (source.kind === 'sentinel') {
    const decision = chooseGrid9SentinelDecision(
      state,
      source as Grid9SentinelPlayer,
    );
    if (!decision) return state;

    const operationId = `auto-${state.matchId}-${state.turn.turnNumber}-${source.slotIndex}`;
    const actor: Grid9ActionActor = {
      kind: 'sentinel',
      sentinelId: source.sentinelId,
      displayName: source.displayName,
    };
    const ledgerEntryId = randomUUID();

    if (decision.kind === 'shield') {
      const payment =
        decision.payment === 'mercenary_bankroll'
          ? {
              kind: 'mercenary_bankroll' as const,
              sourceSlotIndex: source.slotIndex,
            }
          : { kind: decision.payment };
      const resolution = applyGrid9Shield({
        state,
        actor,
        sourceSlotIndex: source.slotIndex,
        shieldId: decision.shieldId,
        beneficiarySlotIndex: source.slotIndex,
        intentId: null,
        serverOperationId: operationId,
        ledgerEntryId,
        payment,
      });
      const shield = GRID9_SHIELD_CATALOG[decision.shieldId];
      const isFree =
        decision.payment === 'inventory' || decision.payment === 'free_drop';
      const operationHash = grid9CanonicalOperationHash({
        matchId: state.matchId,
        operationId,
        kind: 'sentinel_purchase',
        payload: decision,
      });
      const ledger: Grid9LedgerEntry | null = isFree
        ? null
        : {
            schemaVersion: 1,
            entryId: ledgerEntryId,
            intentId: null,
            matchId: state.matchId,
            kind: 'shield_purchase',
            actorUserId: null,
            beneficiaryUserId: null,
            sourceSlotIndex: source.slotIndex,
            targetSlotIndex: source.slotIndex,
            itemId: decision.shieldId,
            fundingSource: 'mercenary_bankroll',
            fundingBreakdown: {
              platformReservationCoins: 0,
              microDropCoins: 0,
              mercenaryBankrollCoins: shield.costCoins,
              jackpotPoolCoins: 0,
            },
            serverOperationId: operationId,
            canonicalPayloadHash: operationHash,
            debitCoins: shield.costCoins,
            creditCoins: 0,
            jackpotDeltaCoins: shield.jackpotContributionCoins,
            escrowBalanceBefore: null,
            escrowBalanceAfter: null,
            stateVersionBefore: state.authority.stateVersion,
            stateVersionAfter: resolution.state.authority.stateVersion,
            createdAt: resolution.state.lastAction!.committedAt,
          };
      const receipt: Grid9PublicPurchaseReceipt = {
        entryId: ledgerEntryId,
        intentId: null,
        serverOperationId: operationId,
        itemId: decision.shieldId,
        debitCoins: isFree ? 0 : shield.costCoins,
        jackpotContributionCoins: isFree ? 0 : shield.jackpotContributionCoins,
        stateVersion: resolution.state.authority.stateVersion,
        committedAt: resolution.state.lastAction!.committedAt,
      };
      const event = createGrid9RoomEvent({
        type: 'SHIELD_RESOLVED',
        matchId: state.matchId,
        sequence: state.authority.eventSequence + 1,
        stateVersion: resolution.state.authority.stateVersion,
        causationIntentId: null,
        payload: {
          actor: resolution.state.lastAction!.actor,
          sourceSlotIndex: source.slotIndex,
          beneficiarySlotIndex: source.slotIndex,
          shieldId: decision.shieldId,
          shieldBefore: resolution.shieldBefore,
          shieldAfter: resolution.shieldAfter,
          receipt,
          jackpotCoins: resolution.state.jackpot.currentCoins,
          inventoryAfter: resolution.inventoryAfter,
        },
      });
      const committed = await commitGrid9ServerMutation({
        currentState: state,
        nextState: resolution.state,
        operationReceipt: newGrid9ServerOperationReceipt({
          matchId: state.matchId,
          operationId,
          kind: 'sentinel_purchase',
          canonicalOperationHash: operationHash,
          stateVersion: resolution.state.authority.stateVersion,
          ledgerEntryId: ledger?.entryId ?? null,
          result: event.payload,
          recordedAt: event.sentAt,
        }),
        ledger,
        timerOutbox: timerOutboxForState(resolution.state),
      });
      if (committed.status === 'committed') {
        emitGrid9Room(io, state.matchId, event);
        await scheduleGrid9Timers(resolution.state);
      }
      return resolution.state;
    }

    const payment =
      decision.payment === 'mercenary_bankroll'
        ? {
            kind: 'mercenary_bankroll' as const,
            sourceSlotIndex: source.slotIndex,
          }
        : { kind: decision.payment };
    const resolution = applyGrid9Weapon({
      state,
      actor,
      sourceSlotIndex: source.slotIndex,
      weaponId: decision.weaponId,
      targetSlotIndex: decision.targetSlotIndex,
      intentId: null,
      serverOperationId: operationId,
      ledgerEntryId,
      payment,
    });
    const weapon = GRID9_WEAPON_CATALOG[decision.weaponId];
    const isFree =
      decision.payment === 'inventory' || decision.payment === 'free_drop';
    const operationHash = grid9CanonicalOperationHash({
      matchId: state.matchId,
      operationId,
      kind: 'sentinel_purchase',
      payload: decision,
    });
    const ledger: Grid9LedgerEntry | null = isFree
      ? null
      : {
          schemaVersion: 1,
          entryId: ledgerEntryId,
          intentId: null,
          matchId: state.matchId,
          kind: 'weapon_purchase',
          actorUserId: null,
          beneficiaryUserId: null,
          sourceSlotIndex: source.slotIndex,
          targetSlotIndex: decision.targetSlotIndex,
          itemId: decision.weaponId,
          fundingSource: 'mercenary_bankroll',
          fundingBreakdown: {
            platformReservationCoins: 0,
            microDropCoins: 0,
            mercenaryBankrollCoins: weapon.costCoins,
            jackpotPoolCoins: 0,
          },
          serverOperationId: operationId,
          canonicalPayloadHash: operationHash,
          debitCoins: weapon.costCoins,
          creditCoins: 0,
          jackpotDeltaCoins: weapon.jackpotContributionCoins,
          escrowBalanceBefore: null,
          escrowBalanceAfter: null,
          stateVersionBefore: state.authority.stateVersion,
          stateVersionAfter: resolution.state.authority.stateVersion,
          createdAt: resolution.state.lastAction!.committedAt,
        };
    const receipt: Grid9PublicPurchaseReceipt = {
      entryId: ledgerEntryId,
      intentId: null,
      serverOperationId: operationId,
      itemId: decision.weaponId,
      debitCoins: isFree ? 0 : weapon.costCoins,
      jackpotContributionCoins: isFree ? 0 : weapon.jackpotContributionCoins,
      stateVersion: resolution.state.authority.stateVersion,
      committedAt: resolution.state.lastAction!.committedAt,
    };
    const event = createGrid9RoomEvent({
      type: 'WEAPON_RESOLVED',
      matchId: state.matchId,
      sequence: state.authority.eventSequence + 1,
      stateVersion: resolution.state.authority.stateVersion,
      causationIntentId: null,
      payload: {
        actor: resolution.state.lastAction!.actor,
        sourceSlotIndex: source.slotIndex,
        targetSlotIndex: decision.targetSlotIndex,
        weaponId: decision.weaponId,
        damage: resolution.damage,
        receipt,
        jackpotCoins: resolution.state.jackpot.currentCoins,
        inventoryAfter: resolution.inventoryAfter,
      },
    });
    const committed = await commitGrid9ServerMutation({
      currentState: state,
      nextState: resolution.state,
      operationReceipt: newGrid9ServerOperationReceipt({
        matchId: state.matchId,
        operationId,
        kind: 'sentinel_purchase',
        canonicalOperationHash: operationHash,
        stateVersion: resolution.state.authority.stateVersion,
        ledgerEntryId: ledger?.entryId ?? null,
        result: event.payload,
        recordedAt: event.sentAt,
      }),
      ledger,
      timerOutbox: timerOutboxForState(resolution.state),
    });
    if (committed.status === 'committed') {
      emitGrid9Room(io, state.matchId, event);
      if (resolution.state.outcome) {
        emitGrid9Room(
          io,
          state.matchId,
          completionEvent(
            resolution.state,
            resolution.state.authority.eventSequence,
          ),
        );
      }
      await scheduleGrid9Timers(resolution.state);
    }
    return resolution.state;
  }

  if (source.mercenaryBankrollCoins < GRID9_WEAPON_CATALOG.arrow.costCoins) {
    return state;
  }
  const target = lowestEffectiveHealthTarget(state, source);
  const weaponId = chooseProxyWeapon(source.mercenaryBankrollCoins);
  if (!target || !weaponId) return state;

  const decision = { targetSlotIndex: target.slotIndex, weaponId };
  const operationId = `auto-${state.matchId}-${state.turn.turnNumber}-${source.slotIndex}`;
  const actor: Grid9ActionActor = {
    kind: 'mercenary_proxy',
    sourceSlotIndex: source.slotIndex,
    operationId,
    displayName: `${source.displayName}'s proxy`,
  };
  const ledgerEntryId = randomUUID();
  const resolution = applyGrid9Weapon({
    state,
    actor,
    sourceSlotIndex: source.slotIndex,
    weaponId: decision.weaponId,
    targetSlotIndex: decision.targetSlotIndex,
    intentId: null,
    serverOperationId: operationId,
    ledgerEntryId,
    payment: {
      kind: 'mercenary_bankroll',
      sourceSlotIndex: source.slotIndex,
    },
  });
  const weapon = GRID9_WEAPON_CATALOG[decision.weaponId];
  const operationHash = grid9CanonicalOperationHash({
    matchId: state.matchId,
    operationId,
    kind: 'proxy_purchase',
    payload: decision,
  });
  const ledger: Grid9LedgerEntry = {
    schemaVersion: 1,
    entryId: ledgerEntryId,
    intentId: null,
    matchId: state.matchId,
    kind: 'weapon_purchase',
    actorUserId: null,
    beneficiaryUserId: source.kind === 'human' ? source.userId : null,
    sourceSlotIndex: source.slotIndex,
    targetSlotIndex: decision.targetSlotIndex,
    itemId: decision.weaponId,
    fundingSource: 'mercenary_bankroll',
    fundingBreakdown: {
      platformReservationCoins: 0,
      microDropCoins: 0,
      mercenaryBankrollCoins: weapon.costCoins,
      jackpotPoolCoins: 0,
    },
    serverOperationId: operationId,
    canonicalPayloadHash: operationHash,
    debitCoins: weapon.costCoins,
    creditCoins: 0,
    jackpotDeltaCoins: weapon.jackpotContributionCoins,
    escrowBalanceBefore: null,
    escrowBalanceAfter: null,
    stateVersionBefore: state.authority.stateVersion,
    stateVersionAfter: resolution.state.authority.stateVersion,
    createdAt: resolution.state.lastAction!.committedAt,
  };
  const receipt: Grid9PublicPurchaseReceipt = {
    entryId: ledgerEntryId,
    intentId: null,
    serverOperationId: operationId,
    itemId: decision.weaponId,
    debitCoins: weapon.costCoins,
    jackpotContributionCoins: weapon.jackpotContributionCoins,
    stateVersion: resolution.state.authority.stateVersion,
    committedAt: resolution.state.lastAction!.committedAt,
  };
  const event = createGrid9RoomEvent({
    type: 'WEAPON_RESOLVED',
    matchId: state.matchId,
    sequence: state.authority.eventSequence + 1,
    stateVersion: resolution.state.authority.stateVersion,
    causationIntentId: null,
    payload: {
      actor: resolution.state.lastAction!.actor,
      sourceSlotIndex: source.slotIndex,
      targetSlotIndex: decision.targetSlotIndex,
      weaponId: decision.weaponId,
      damage: resolution.damage,
      receipt,
      jackpotCoins: resolution.state.jackpot.currentCoins,
      inventoryAfter: resolution.inventoryAfter,
    },
  });
  const committed = await commitGrid9ServerMutation({
    currentState: state,
    nextState: resolution.state,
    operationReceipt: newGrid9ServerOperationReceipt({
      matchId: state.matchId,
      operationId,
      kind: 'proxy_purchase',
      canonicalOperationHash: operationHash,
      stateVersion: resolution.state.authority.stateVersion,
      ledgerEntryId,
      result: event.payload,
      recordedAt: event.sentAt,
    }),
    ledger,
    timerOutbox: timerOutboxForState(resolution.state),
  });
  if (committed.status === 'committed') {
    emitGrid9Room(io, state.matchId, event);
    if (resolution.state.outcome) {
      emitGrid9Room(
        io,
        state.matchId,
        completionEvent(
          resolution.state,
          resolution.state.authority.eventSequence,
        ),
      );
    }
    await scheduleGrid9Timers(resolution.state);
  }
  return resolution.state;
}

async function processTurnEnd(io: Server, initial: Grid9GameState): Promise<void> {
  if (initial.phase !== 'combat' || !initial.turn) return;
  let state = initial;
  try {
    state = await processAutomatedPurchase(io, initial);
  } catch (error: any) {
    logger.warn(
      {
        matchId: initial.matchId,
        err: error?.message || String(error),
      },
      '[grid9] automated purchase failed; forcing turn advance',
    );
    state = await readGrid9State(initial.matchId);
  }
  if (state.phase === 'completed') {
    await settleGrid9Match(io, state);
    return;
  }
  state = await readGrid9State(state.matchId);
  if (state.phase !== 'combat' || !state.turn) {
    // Never leave a claimed turn_end empty-handed if combat is still live.
    if (state.phase === 'combat') {
      await scheduleGrid9Timers(state);
    }
    return;
  }
  const previousTurn = state.turn.turnNumber;
  // CRITICAL: advance with wall-clock now — never turn.endsAt. Using endsAt
  // (often ~30s ahead) pushed roulette_end into the future and stalled the loop.
  const next = advanceGrid9Turn(state, Date.now());
  const event = next.outcome
    ? completionEvent(next, next.authority.eventSequence)
    : next.phase === 'roulette' && next.roulette
      ? createGrid9RoomEvent({
          type: 'ROULETTE_START',
          matchId: state.matchId,
          sequence: next.authority.eventSequence,
          stateVersion: next.authority.stateVersion,
          causationIntentId: null,
          payload: {
            turnNumber: next.roulette.turnNumber,
            candidateSlotIndices: next.roulette.candidateSlotIndices,
            selectedSlotIndex: next.roulette.selectedSlotIndex,
            endsAt: next.roulette.endsAt,
            entropyDigest: next.roulette.entropyDigest,
          },
        })
      : createGrid9RoomEvent({
          type: 'TURN_ADVANCED',
          matchId: state.matchId,
          sequence: next.authority.eventSequence,
          stateVersion: next.authority.stateVersion,
          causationIntentId: null,
          payload: {
            previousTurnNumber: previousTurn,
            turn: next.turn!,
          },
        });
  await commitSimpleStateEvent({
    io,
    current: state,
    next,
    operationId: `turn-${state.matchId}-${previousTurn}`,
    kind: 'turn_advance',
    roomEvent: event,
  });
  if (next.phase === 'completed') {
    await settleGrid9Match(io, next);
  }
}

/** After disconnect grace or kick of the spotlight seat: auto-shield/pass and continue. */
export async function forceGrid9DisconnectedTurnEnd(
  io: Server,
  matchId: string,
): Promise<void> {
  const state = await readGrid9State(matchId);
  if (state.phase !== 'combat' || !state.turn) return;
  await processTurnEnd(io, state);
}

async function processTimerMember(io: Server, member: string): Promise<void> {
  const [matchId, reason, versionText] = member.split('|');
  if (!matchId || !reason || !versionText) return;
  const state = await readGrid9State(matchId);
  if (state.authority.stateVersion !== Number(versionText)) {
    await scheduleGrid9Timers(state);
    return;
  }
  if (
    reason === 'countdown_end' ||
    reason === 'lobby_waiting_end'
  ) {
    await processLobbyWaiting(io, state);
  } else if (reason === 'roulette_end') {
    await processRouletteEnd(io, state);
  } else if (reason === 'micro_drop') {
    await processMicroDrop(io, state);
  } else if (reason === 'turn_end' || reason === 'match_deadline') {
    await processTurnEnd(io, state);
  }
}

async function pollGrid9Timers(io: Server): Promise<void> {
  await processGrid9PresenceTimeouts(io);
  const now = Date.now();
  const members = await redis().zrangebyscore(
    grid9RedisKeys.timersProjection(),
    '-inf',
    now,
    'LIMIT',
    0,
    BATCH_SIZE,
  );
  for (const member of members) {
    const claimed = await redis().zrem(
      grid9RedisKeys.timersProjection(),
      member,
    );
    if (claimed !== 1) continue;
    try {
      await processTimerMember(io, member);
    } catch (error: any) {
      if (error instanceof Grid9Error && error.code === 'MATCH_NOT_FOUND') {
        continue;
      }
      logger.warn(
        { member, err: error?.message || String(error) },
        '[grid9] timer operation failed',
      );
      await redis().zadd(
        grid9RedisKeys.timersProjection(),
        Date.now() + 1_000,
        member,
      );
    }
  }
}

async function repairGrid9Timers(io: Server): Promise<void> {
  let cursor = '0';
  do {
    const [nextCursor, matchIds] = await redis().sscan(
      grid9RedisKeys.activeMatches(),
      cursor,
      'COUNT',
      200,
    );
    cursor = nextCursor;
    for (const matchId of matchIds) {
      try {
        const state = await readGrid9State(matchId);
        if (state.phase === 'initializing') {
          const recovered = await recoverGrid9InitializingMatch(state);
          if (recovered) await scheduleGrid9Timers(recovered);
        } else if (
          (state.phase === 'completed' || state.phase === 'cancelled') &&
          state.settlement.status !== 'completed'
        ) {
          await settleGrid9Match(io, state);
        } else if (
          state.phase === 'completed' ||
          state.phase === 'cancelled'
        ) {
          await removeGrid9ActiveMatch(matchId);
        } else if (
          Date.parse(state.authority.matchDeadlineAt) > 0 &&
          Date.now() > Date.parse(state.authority.matchDeadlineAt)
        ) {
          // Past hard deadline — force turn-end / settle so zombies leave the list.
          await processTurnEnd(io, state);
        } else if (state.phase === 'combat' && state.turn) {
          const dueMs = grid9CombatTimerDueAtMs(state);
          const acted =
            state.turn.attacksUsedThisTurn >= 1 ||
            state.turn.defensesUsedThisTurn >= 1 ||
            state.turn.autoResolved;
          if (
            acted ||
            (dueMs != null && dueMs <= Date.now())
          ) {
            await processTurnEnd(io, state);
          } else {
            await scheduleGrid9Timers(state);
          }
          for (const player of state.players) {
            if (player.kind !== 'human') continue;
            await repairGrid9PresenceTimeouts(
              matchId,
              player.userId,
              player.connectionState,
            );
          }
        } else {
          await scheduleGrid9Timers(state);
          for (const player of state.players) {
            if (player.kind !== 'human') continue;
            await repairGrid9PresenceTimeouts(
              matchId,
              player.userId,
              player.connectionState,
            );
          }
        }
      } catch (error) {
        if (error instanceof Grid9Error && error.code === 'MATCH_NOT_FOUND') {
          await removeGrid9ActiveMatch(matchId);
        } else {
          logger.warn(
            { matchId, err: (error as any)?.message || String(error) },
            '[grid9] timer repair failed',
          );
        }
      }
    }
  } while (cursor !== '0');
}

export function startGrid9GameLoop(io: Server): () => void {
  let polling = false;
  let repairing = false;
  const poll = setInterval(() => {
    if (polling) return;
    polling = true;
    void pollGrid9Timers(io)
      .catch((error: any) => {
        logger.warn(
          { err: error?.message || String(error) },
          '[grid9] timer poll failed',
        );
      })
      .finally(() => {
        polling = false;
      });
  }, POLL_MS);
  const repair = setInterval(() => {
    if (repairing) return;
    repairing = true;
    void repairGrid9Timers(io)
      .catch((error: any) => {
        logger.warn(
          { err: error?.message || String(error) },
          '[grid9] timer repair cycle failed',
        );
      })
      .finally(() => {
        repairing = false;
      });
  }, REPAIR_MS);
  poll.unref?.();
  repair.unref?.();
  return () => {
    clearInterval(poll);
    clearInterval(repair);
  };
}
