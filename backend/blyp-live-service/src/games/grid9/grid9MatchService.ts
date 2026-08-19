import { randomUUID } from 'crypto';
import type { Server } from 'socket.io';
import {
  GRID9_ARSENAL_CATALOG,
  GRID9_SHIELD_CATALOG,
  GRID9_WEAPON_CATALOG,
} from './catalog';
import { GRID9_BUYBACK_COST_COINS, splitGrid9AudienceGiftCoins } from './constants';
import { grid9CanonicalIntentHash, grid9CanonicalOperationHash } from './canonical';
import {
  applyGrid9ArsenalGift,
  applyGrid9Buyback,
  applyGrid9InventoryBuy,
  applyGrid9MercenaryFunding,
  applyGrid9SelectTarget,
  applyGrid9Shield,
  applyGrid9Weapon,
  resolveGrid9Actor,
  resolveGrid9ItemFunding,
  type Grid9Identity,
} from './grid9Engine';
import { grid9CombatTimerDueAtMs } from './grid9Sentinels';
import {
  commitGrid9PaidMutation,
  commitGrid9ServerMutation,
  consumeGrid9ReplayNonce,
  emptyGrid9Escrow,
  newGrid9ServerOperationReceipt,
  readGrid9Aggregate,
  readGrid9IntentReceipt,
  readGrid9State,
} from './grid9AggregateStore';
import { Grid9Error } from './grid9Errors';
import {
  allocateGrid9EscrowSpend,
  type Grid9EscrowWallet,
  type Grid9LedgerEntry,
  type Grid9LedgerReceipt,
  type Grid9PublicPurchaseReceipt,
} from './ledger';
import {
  createGrid9RoomEvent,
  emitGrid9Room,
} from './grid9Broadcast';
import type {
  Grid9BuybackIntent,
  Grid9BuyInventoryItemIntent,
  Grid9ClientIntent,
  Grid9FireWeaponIntent,
  Grid9FundMercenaryIntent,
  Grid9PurchaseShieldIntent,
  Grid9RoomServerEvent,
  Grid9SelectTargetIntent,
  Grid9SendArsenalGiftIntent,
} from './protocol';
import type { Grid9TimerOutboxRecord } from './redisKeys';
import { toGrid9PublicGameState } from './grid9Projection';
import type { Grid9GameState } from './state';

export type Grid9CommittedAction = {
  status: 'committed' | 'replay';
  privateReceipt: Grid9LedgerReceipt;
  roomEvents: Grid9RoomServerEvent[];
  state: Grid9GameState;
};

async function replayCommittedAction(args: {
  intent: Grid9ClientIntent;
  userId: string;
  canonicalIntentHash: string;
}): Promise<Grid9CommittedAction | null> {
  const receipt = await readGrid9IntentReceipt(
    args.intent.matchId as string,
    args.userId,
    args.intent.intentId,
  );
  if (!receipt) return null;
  if (
    receipt.canonicalIntentHash !== args.canonicalIntentHash ||
    receipt.userId !== args.userId ||
    receipt.matchId !== args.intent.matchId
  ) {
    throw new Grid9Error('INTENT_CONFLICT', 'Grid 9 intent changed');
  }
  if (!receipt.privateReceipt) {
    throw new Grid9Error(
      'INTERNAL_ERROR',
      'Grid 9 committed intent is missing its receipt',
      { retryable: true },
    );
  }
  await consumeGrid9ReplayNonce({
    matchId: args.intent.matchId as string,
    userId: args.userId,
    intentId: args.intent.intentId,
    connectionSessionId: args.intent.connectionSessionId,
    nonce: args.intent.nonce,
    canonicalIntentHash: args.canonicalIntentHash,
  });
  return {
    status: 'replay',
    privateReceipt: receipt.privateReceipt,
    roomEvents: [],
    state: await readGrid9State(args.intent.matchId as string),
  };
}

function requireExpectedVersion(
  state: Grid9GameState,
  expectedStateVersion: number,
): void {
  if (state.authority.stateVersion !== expectedStateVersion) {
    throw new Grid9Error(
      'STALE_STATE',
      'Grid 9 state changed; resync required',
      {
        retryable: true,
        stateVersion: state.authority.stateVersion,
      },
    );
  }
}

function spendEscrow(
  current: Grid9EscrowWallet | null,
  costCoins: number,
  now: string,
): {
  wallet: Grid9EscrowWallet;
  platformCoins: number;
  microDropCoins: number;
} {
  if (!current) {
    throw new Grid9Error(
      'INSUFFICIENT_FUNDS',
      'Reserve coins before buying a Grid 9 item',
    );
  }
  const allocation = allocateGrid9EscrowSpend(current, costCoins);
  return {
    wallet: {
      ...current,
      availableCoins: current.availableCoins - costCoins,
      spentCoins: current.spentCoins + costCoins,
      spentPlatformCoins:
        current.spentPlatformCoins +
        allocation.platformReservationCoins,
      spentMicroDropCoins:
        current.spentMicroDropCoins + allocation.microDropCoins,
      version: current.version + 1,
      updatedAt: now,
    },
    platformCoins: allocation.platformReservationCoins,
    microDropCoins: allocation.microDropCoins,
  };
}

export function timerOutboxForState(
  state: Grid9GameState,
): Grid9TimerOutboxRecord | null {
  if (
    (state.phase === 'lobby_waiting' || state.phase === 'countdown') &&
    state.phaseEndsAt
  ) {
    return {
      schemaVersion: 1,
      matchId: state.matchId,
      stateVersion: state.authority.stateVersion,
      dueAt: state.phaseEndsAt,
      reason: 'lobby_waiting_end',
      projectedAt: null,
    };
  }
  if (state.phase === 'roulette' && state.roulette) {
    return {
      schemaVersion: 1,
      matchId: state.matchId,
      stateVersion: state.authority.stateVersion,
      dueAt: state.roulette.endsAt,
      reason: 'roulette_end',
      projectedAt: null,
    };
  }
  if (state.phase === 'combat' && state.turn) {
    const dueMs =
      grid9CombatTimerDueAtMs(state) ?? Date.parse(state.turn.endsAt);
    return {
      schemaVersion: 1,
      matchId: state.matchId,
      stateVersion: state.authority.stateVersion,
      dueAt: new Date(dueMs).toISOString(),
      reason: 'turn_end',
      projectedAt: null,
    };
  }
  return null;
}

function publicReceipt(args: {
  ledgerEntryId: string;
  intentId: string;
  itemId: Grid9PublicPurchaseReceipt['itemId'];
  debitCoins: number;
  jackpotContributionCoins: number;
  stateVersion: number;
  committedAt: string;
}): Grid9PublicPurchaseReceipt {
  return {
    entryId: args.ledgerEntryId,
    intentId: args.intentId,
    serverOperationId: null,
    itemId: args.itemId,
    debitCoins: args.debitCoins,
    jackpotContributionCoins: args.jackpotContributionCoins,
    stateVersion: args.stateVersion,
    committedAt: args.committedAt,
  };
}

function completionEvent(
  state: Grid9GameState,
  causationIntentId: string,
): Grid9RoomServerEvent | null {
  if (!state.outcome) return null;
  const publicState = toGrid9PublicGameState(state);
  return createGrid9RoomEvent({
    type: 'MATCH_COMPLETED',
    matchId: state.matchId,
    sequence: state.authority.eventSequence,
    stateVersion: state.authority.stateVersion,
    causationIntentId,
    payload: {
      outcome: publicState.outcome!,
      finalState: publicState,
    },
  });
}

export async function fireGrid9Weapon(args: {
  intent: Grid9FireWeaponIntent;
  identity: Grid9Identity;
}): Promise<Grid9CommittedAction> {
  const canonicalIntentHash = grid9CanonicalIntentHash({
    authenticatedUserId: args.identity.userId,
    matchId: args.intent.matchId,
    type: args.intent.type,
    payload: args.intent.payload,
  });
  const replay = await replayCommittedAction({
    intent: args.intent,
    userId: args.identity.userId,
    canonicalIntentHash,
  });
  if (replay) return replay;
  const snapshot = await readGrid9Aggregate(
    args.intent.matchId,
    args.identity.userId,
  );
  requireExpectedVersion(
    snapshot.state,
    args.intent.expectedStateVersion,
  );
  const weapon = GRID9_WEAPON_CATALOG[args.intent.payload.weaponId];
  if (!weapon) throw new Grid9Error('ITEM_NOT_FOUND', 'Unknown Grid 9 weapon');
  const now = new Date().toISOString();
  const { actor, sourceSlotIndex } = resolveGrid9Actor(
    snapshot.state,
    args.identity,
  );
  const payment = resolveGrid9ItemFunding({
    state: snapshot.state,
    sourceSlotIndex,
    itemId: weapon.id,
  });
  const isFree = payment.kind === 'inventory' || payment.kind === 'free_drop';
  const spent = isFree
    ? {
        wallet:
          snapshot.escrow ??
          emptyGrid9Escrow(args.intent.matchId, args.identity.userId, now),
        platformCoins: 0,
        microDropCoins: 0,
      }
    : spendEscrow(snapshot.escrow, weapon.costCoins, now);
  const debitCoins = isFree ? 0 : weapon.costCoins;
  const jackpotContributionCoins = isFree
    ? 0
    : splitGrid9AudienceGiftCoins(weapon.costCoins).jackpotCoins;
  const fundingSource =
    payment.kind === 'inventory'
      ? ('inventory' as const)
      : payment.kind === 'free_drop'
        ? ('free_drop' as const)
        : ('actor_escrow' as const);
  const ledgerEntryId = randomUUID();
  const resolution = applyGrid9Weapon({
    state: snapshot.state,
    actor,
    sourceSlotIndex,
    weaponId: weapon.id,
    targetSlotIndex: args.intent.payload.targetSlotIndex,
    intentId: args.intent.intentId,
    serverOperationId: null,
    ledgerEntryId,
    payment,
    nowMs: Date.parse(now),
  });
  const receipt: Grid9LedgerReceipt = {
    entryId: ledgerEntryId,
    intentId: args.intent.intentId,
    kind: 'weapon_purchase',
    debitCoins,
    creditCoins: 0,
    jackpotContributionCoins,
    availableCoinsAfter: spent.wallet.availableCoins,
    stateVersion: resolution.state.authority.stateVersion,
    committedAt: now,
  };
  const ledger: Grid9LedgerEntry = {
    schemaVersion: 1,
    entryId: ledgerEntryId,
    intentId: args.intent.intentId,
    matchId: args.intent.matchId,
    kind: 'weapon_purchase',
    actorUserId: args.identity.userId,
    beneficiaryUserId: null,
    sourceSlotIndex,
    targetSlotIndex: args.intent.payload.targetSlotIndex,
    itemId: weapon.id,
    fundingSource,
    fundingBreakdown: {
      platformReservationCoins: spent.platformCoins,
      microDropCoins: spent.microDropCoins,
      mercenaryBankrollCoins: 0,
      jackpotPoolCoins: 0,
    },
    serverOperationId: null,
    canonicalPayloadHash: canonicalIntentHash,
    debitCoins,
    creditCoins: 0,
    jackpotDeltaCoins: jackpotContributionCoins,
    // Inventory/free-drop fires may have no prior escrow (gifted arsenal only).
    escrowBalanceBefore: snapshot.escrow?.availableCoins ?? 0,
    escrowBalanceAfter: spent.wallet.availableCoins,
    stateVersionBefore: snapshot.state.authority.stateVersion,
    stateVersionAfter: resolution.state.authority.stateVersion,
    createdAt: now,
  };
  const actionSequence =
    snapshot.state.authority.eventSequence + 1;
  const actionEvent = createGrid9RoomEvent({
    type: 'WEAPON_RESOLVED',
    matchId: args.intent.matchId,
    sequence: actionSequence,
    stateVersion: resolution.state.authority.stateVersion,
    causationIntentId: args.intent.intentId,
    payload: {
      actor: resolution.state.lastAction!.actor,
      sourceSlotIndex,
      targetSlotIndex: args.intent.payload.targetSlotIndex,
      weaponId: weapon.id,
      damage: resolution.damage,
      receipt: publicReceipt({
        ledgerEntryId,
        intentId: args.intent.intentId,
        itemId: weapon.id,
        debitCoins,
        jackpotContributionCoins,
        stateVersion: resolution.state.authority.stateVersion,
        committedAt: now,
      }),
      jackpotCoins: resolution.state.jackpot.currentCoins,
      inventoryAfter: resolution.inventoryAfter,
    },
  });
  const timer = timerOutboxForState(resolution.state);
  const committed = await commitGrid9PaidMutation({
    snapshot,
    nextState: resolution.state,
    nextEscrow: spent.wallet,
    intent: args.intent,
    authenticatedUserId: args.identity.userId,
    canonicalIntentHash,
    ledger,
    privateReceipt: receipt,
    roomEvent: actionEvent,
    timerOutbox: timer,
    fundingSource,
  });
  const completedEvent = completionEvent(
    resolution.state,
    args.intent.intentId,
  );
  const roomEvents =
    committed.status === 'committed'
      ? [
          actionEvent,
          ...(completedEvent ? [completedEvent] : []),
        ]
      : [];
  return {
    status: committed.status,
    privateReceipt: committed.receipt.privateReceipt ?? receipt,
    roomEvents,
    state: resolution.state,
  };
}

export async function fundGrid9Mercenary(args: {
  intent: Grid9FundMercenaryIntent;
  identity: Grid9Identity;
}): Promise<Grid9CommittedAction> {
  const canonicalIntentHash = grid9CanonicalIntentHash({
    authenticatedUserId: args.identity.userId,
    matchId: args.intent.matchId,
    type: args.intent.type,
    payload: args.intent.payload,
  });
  const replay = await replayCommittedAction({
    intent: args.intent,
    userId: args.identity.userId,
    canonicalIntentHash,
  });
  if (replay) return replay;
  const snapshot = await readGrid9Aggregate(
    args.intent.matchId,
    args.identity.userId,
  );
  requireExpectedVersion(
    snapshot.state,
    args.intent.expectedStateVersion,
  );
  const now = new Date().toISOString();
  const spent = spendEscrow(
    snapshot.escrow,
    args.intent.payload.amountCoins,
    now,
  );
  const ledgerEntryId = randomUUID();
  const resolution = applyGrid9MercenaryFunding({
    state: snapshot.state,
    sponsor: args.identity,
    beneficiarySlotIndex: args.intent.payload.beneficiarySlotIndex,
    amountCoins: args.intent.payload.amountCoins,
    intentId: args.intent.intentId,
    ledgerEntryId,
    nowMs: Date.parse(now),
  });
  const receipt: Grid9LedgerReceipt = {
    entryId: ledgerEntryId,
    intentId: args.intent.intentId,
    kind: 'mercenary_funding',
    debitCoins: args.intent.payload.amountCoins,
    creditCoins: args.intent.payload.amountCoins,
    jackpotContributionCoins: 0,
    availableCoinsAfter: spent.wallet.availableCoins,
    stateVersion: resolution.state.authority.stateVersion,
    committedAt: now,
  };
  const ledger: Grid9LedgerEntry = {
    schemaVersion: 1,
    entryId: ledgerEntryId,
    intentId: args.intent.intentId,
    matchId: args.intent.matchId,
    kind: 'mercenary_funding',
    actorUserId: args.identity.userId,
    beneficiaryUserId: (() => {
      const beneficiary =
        resolution.state.players[
          args.intent.payload.beneficiarySlotIndex
        ];
      return beneficiary.kind === 'human' ? beneficiary.userId : null;
    })(),
    sourceSlotIndex: resolution.sponsorSlotIndex,
    targetSlotIndex: args.intent.payload.beneficiarySlotIndex,
    itemId: null,
    fundingSource: 'actor_escrow',
    fundingBreakdown: {
      platformReservationCoins: spent.platformCoins,
      microDropCoins: spent.microDropCoins,
      mercenaryBankrollCoins: 0,
      jackpotPoolCoins: 0,
    },
    serverOperationId: null,
    canonicalPayloadHash: canonicalIntentHash,
    debitCoins: args.intent.payload.amountCoins,
    creditCoins: args.intent.payload.amountCoins,
    jackpotDeltaCoins: 0,
    escrowBalanceBefore: snapshot.escrow!.availableCoins,
    escrowBalanceAfter: spent.wallet.availableCoins,
    stateVersionBefore: snapshot.state.authority.stateVersion,
    stateVersionAfter: resolution.state.authority.stateVersion,
    createdAt: now,
  };
  const actionEvent = createGrid9RoomEvent({
    type: 'MERCENARY_FUNDED',
    matchId: args.intent.matchId,
    sequence: resolution.state.authority.eventSequence,
    stateVersion: resolution.state.authority.stateVersion,
    causationIntentId: args.intent.intentId,
    payload: {
      sponsorPublicProfileId: args.identity.publicProfileId,
      sponsorDisplayName: args.identity.displayName,
      beneficiarySlotIndex: args.intent.payload.beneficiarySlotIndex,
      amountCoins: args.intent.payload.amountCoins,
      bankrollBefore: resolution.bankrollBefore,
      bankrollAfter: resolution.bankrollAfter,
      receipt: publicReceipt({
        ledgerEntryId,
        intentId: args.intent.intentId,
        itemId: null,
        debitCoins: args.intent.payload.amountCoins,
        jackpotContributionCoins: 0,
        stateVersion: resolution.state.authority.stateVersion,
        committedAt: now,
      }),
    },
  });
  const committed = await commitGrid9PaidMutation({
    snapshot,
    nextState: resolution.state,
    nextEscrow: spent.wallet,
    intent: args.intent,
    authenticatedUserId: args.identity.userId,
    canonicalIntentHash,
    ledger,
    privateReceipt: receipt,
    roomEvent: actionEvent,
    timerOutbox: timerOutboxForState(resolution.state),
  });
  return {
    status: committed.status,
    privateReceipt: committed.receipt.privateReceipt ?? receipt,
    roomEvents: committed.status === 'committed' ? [actionEvent] : [],
    state: resolution.state,
  };
}

export async function purchaseGrid9Shield(args: {
  intent: Grid9PurchaseShieldIntent;
  identity: Grid9Identity;
}): Promise<Grid9CommittedAction> {
  const canonicalIntentHash = grid9CanonicalIntentHash({
    authenticatedUserId: args.identity.userId,
    matchId: args.intent.matchId,
    type: args.intent.type,
    payload: args.intent.payload,
  });
  const replay = await replayCommittedAction({
    intent: args.intent,
    userId: args.identity.userId,
    canonicalIntentHash,
  });
  if (replay) return replay;
  const snapshot = await readGrid9Aggregate(
    args.intent.matchId,
    args.identity.userId,
  );
  requireExpectedVersion(
    snapshot.state,
    args.intent.expectedStateVersion,
  );
  const shield = GRID9_SHIELD_CATALOG[args.intent.payload.shieldId];
  const now = new Date().toISOString();
  const { actor, sourceSlotIndex } = resolveGrid9Actor(
    snapshot.state,
    args.identity,
  );
  const payment = resolveGrid9ItemFunding({
    state: snapshot.state,
    sourceSlotIndex,
    itemId: shield.id,
  });
  const isFree = payment.kind === 'inventory' || payment.kind === 'free_drop';
  const spent = isFree
    ? {
        wallet:
          snapshot.escrow ??
          emptyGrid9Escrow(args.intent.matchId, args.identity.userId, now),
        platformCoins: 0,
        microDropCoins: 0,
      }
    : spendEscrow(snapshot.escrow, shield.costCoins, now);
  const debitCoins = isFree ? 0 : shield.costCoins;
  const jackpotContributionCoins = isFree
    ? 0
    : splitGrid9AudienceGiftCoins(shield.costCoins).jackpotCoins;
  const fundingSource =
    payment.kind === 'inventory'
      ? ('inventory' as const)
      : payment.kind === 'free_drop'
        ? ('free_drop' as const)
        : ('actor_escrow' as const);
  const ledgerEntryId = randomUUID();
  const resolution = applyGrid9Shield({
    state: snapshot.state,
    actor,
    sourceSlotIndex,
    shieldId: shield.id,
    beneficiarySlotIndex: args.intent.payload.beneficiarySlotIndex,
    intentId: args.intent.intentId,
    serverOperationId: null,
    ledgerEntryId,
    payment,
    nowMs: Date.parse(now),
  });
  const receipt: Grid9LedgerReceipt = {
    entryId: ledgerEntryId,
    intentId: args.intent.intentId,
    kind: 'shield_purchase',
    debitCoins,
    creditCoins: 0,
    jackpotContributionCoins,
    availableCoinsAfter: spent.wallet.availableCoins,
    stateVersion: resolution.state.authority.stateVersion,
    committedAt: now,
  };
  const ledger: Grid9LedgerEntry = {
    schemaVersion: 1,
    entryId: ledgerEntryId,
    intentId: args.intent.intentId,
    matchId: args.intent.matchId,
    kind: 'shield_purchase',
    actorUserId: args.identity.userId,
    beneficiaryUserId: null,
    sourceSlotIndex,
    targetSlotIndex: args.intent.payload.beneficiarySlotIndex,
    itemId: shield.id,
    fundingSource,
    fundingBreakdown: {
      platformReservationCoins: spent.platformCoins,
      microDropCoins: spent.microDropCoins,
      mercenaryBankrollCoins: 0,
      jackpotPoolCoins: 0,
    },
    serverOperationId: null,
    canonicalPayloadHash: canonicalIntentHash,
    debitCoins,
    creditCoins: 0,
    jackpotDeltaCoins: jackpotContributionCoins,
    escrowBalanceBefore: snapshot.escrow?.availableCoins ?? 0,
    escrowBalanceAfter: spent.wallet.availableCoins,
    stateVersionBefore: snapshot.state.authority.stateVersion,
    stateVersionAfter: resolution.state.authority.stateVersion,
    createdAt: now,
  };
  const actionEvent = createGrid9RoomEvent({
    type: 'SHIELD_RESOLVED',
    matchId: args.intent.matchId,
    sequence: resolution.state.authority.eventSequence,
    stateVersion: resolution.state.authority.stateVersion,
    causationIntentId: args.intent.intentId,
    payload: {
      actor: resolution.state.lastAction!.actor,
      sourceSlotIndex: resolution.sourceSlotIndex,
      beneficiarySlotIndex: args.intent.payload.beneficiarySlotIndex,
      shieldId: shield.id,
      shieldBefore: resolution.shieldBefore,
      shieldAfter: resolution.shieldAfter,
      receipt: publicReceipt({
        ledgerEntryId,
        intentId: args.intent.intentId,
        itemId: shield.id,
        debitCoins,
        jackpotContributionCoins,
        stateVersion: resolution.state.authority.stateVersion,
        committedAt: now,
      }),
      jackpotCoins: resolution.state.jackpot.currentCoins,
      inventoryAfter: resolution.inventoryAfter,
    },
  });
  const committed = await commitGrid9PaidMutation({
    snapshot,
    nextState: resolution.state,
    nextEscrow: spent.wallet,
    intent: args.intent,
    authenticatedUserId: args.identity.userId,
    canonicalIntentHash,
    ledger,
    privateReceipt: receipt,
    roomEvent: actionEvent,
    timerOutbox: timerOutboxForState(resolution.state),
    fundingSource,
  });
  return {
    status: committed.status,
    privateReceipt: committed.receipt.privateReceipt ?? receipt,
    roomEvents: committed.status === 'committed' ? [actionEvent] : [],
    state: resolution.state,
  };
}

export async function sendGrid9ArsenalGift(args: {
  intent: Grid9SendArsenalGiftIntent;
  identity: Grid9Identity;
}): Promise<Grid9CommittedAction> {
  const canonicalIntentHash = grid9CanonicalIntentHash({
    authenticatedUserId: args.identity.userId,
    matchId: args.intent.matchId,
    type: args.intent.type,
    payload: args.intent.payload,
  });
  const replay = await replayCommittedAction({
    intent: args.intent,
    userId: args.identity.userId,
    canonicalIntentHash,
  });
  if (replay) return replay;
  const snapshot = await readGrid9Aggregate(
    args.intent.matchId,
    args.identity.userId,
  );
  requireExpectedVersion(snapshot.state, args.intent.expectedStateVersion);
  const item = GRID9_ARSENAL_CATALOG[args.intent.payload.itemId];
  if (!item) throw new Grid9Error('ITEM_NOT_FOUND', 'Unknown arsenal gift item');
  const now = new Date().toISOString();
  const spent = spendEscrow(snapshot.escrow, item.costCoins, now);
  const ledgerEntryId = randomUUID();
  const resolution = applyGrid9ArsenalGift({
    state: snapshot.state,
    sender: args.identity,
    recipientSlotIndex: args.intent.payload.recipientSlotIndex,
    itemId: args.intent.payload.itemId,
    intentId: args.intent.intentId,
    ledgerEntryId,
    nowMs: Date.parse(now),
  });
  const receipt: Grid9LedgerReceipt = {
    entryId: ledgerEntryId,
    intentId: args.intent.intentId,
    kind: 'arsenal_gift',
    debitCoins: resolution.costCoins,
    creditCoins: resolution.seatCoins,
    jackpotContributionCoins: resolution.jackpotCoins,
    availableCoinsAfter: spent.wallet.availableCoins,
    stateVersion: resolution.state.authority.stateVersion,
    committedAt: now,
  };
  const ledger: Grid9LedgerEntry = {
    schemaVersion: 1,
    entryId: ledgerEntryId,
    intentId: args.intent.intentId,
    matchId: args.intent.matchId,
    kind: 'arsenal_gift',
    actorUserId: args.identity.userId,
    beneficiaryUserId: (() => {
      const beneficiary =
        resolution.state.players[args.intent.payload.recipientSlotIndex];
      return beneficiary.kind === 'human' ? beneficiary.userId : null;
    })(),
    sourceSlotIndex: null,
    targetSlotIndex: args.intent.payload.recipientSlotIndex,
    itemId: args.intent.payload.itemId,
    fundingSource: 'actor_escrow',
    fundingBreakdown: {
      platformReservationCoins: spent.platformCoins,
      microDropCoins: spent.microDropCoins,
      mercenaryBankrollCoins: 0,
      jackpotPoolCoins: resolution.jackpotCoins,
    },
    serverOperationId: null,
    canonicalPayloadHash: canonicalIntentHash,
    debitCoins: resolution.costCoins,
    creditCoins: resolution.seatCoins,
    jackpotDeltaCoins: resolution.jackpotCoins,
    escrowBalanceBefore: snapshot.escrow!.availableCoins,
    escrowBalanceAfter: spent.wallet.availableCoins,
    stateVersionBefore: snapshot.state.authority.stateVersion,
    stateVersionAfter: resolution.state.authority.stateVersion,
    createdAt: now,
  };
  const actionEvent = createGrid9RoomEvent({
    type: 'ARSENAL_GRANTED',
    matchId: args.intent.matchId,
    sequence: resolution.state.authority.eventSequence,
    stateVersion: resolution.state.authority.stateVersion,
    causationIntentId: args.intent.intentId,
    payload: {
      senderPublicProfileId: args.identity.publicProfileId,
      senderDisplayName: args.identity.displayName,
      recipientSlotIndex: resolution.recipientSlotIndex,
      itemId: resolution.itemId,
      costCoins: resolution.costCoins,
      seatCoins: resolution.seatCoins,
      jackpotCoins: resolution.jackpotCoins,
      selfBuy: false,
      droppedItemId: resolution.droppedItemId,
      inventoryAfter: resolution.inventoryAfter,
      receipt: publicReceipt({
        ledgerEntryId,
        intentId: args.intent.intentId,
        itemId: resolution.itemId,
        debitCoins: resolution.costCoins,
        jackpotContributionCoins: resolution.jackpotCoins,
        stateVersion: resolution.state.authority.stateVersion,
        committedAt: now,
      }),
      jackpotTotalCoins: resolution.state.jackpot.currentCoins,
      healthBefore: resolution.healthBefore,
      healthAfter: resolution.healthAfter,
      eliminated: resolution.eliminated,
      knockoutTokens: resolution.knockoutTokens,
    },
  });
  const completedGiftEvent = resolution.completed
    ? completionEvent(resolution.state, args.intent.intentId)
    : null;
  const committed = await commitGrid9PaidMutation({
    snapshot,
    nextState: resolution.state,
    nextEscrow: spent.wallet,
    intent: args.intent,
    authenticatedUserId: args.identity.userId,
    canonicalIntentHash,
    ledger,
    privateReceipt: receipt,
    roomEvent: actionEvent,
    timerOutbox: timerOutboxForState(resolution.state),
  });
  return {
    status: committed.status,
    privateReceipt: committed.receipt.privateReceipt ?? receipt,
    roomEvents:
      committed.status === 'committed'
        ? [
            actionEvent,
            ...(completedGiftEvent ? [completedGiftEvent] : []),
          ]
        : [],
    state: resolution.state,
  };
}

export async function buyGrid9InventoryItem(args: {
  intent: Grid9BuyInventoryItemIntent;
  identity: Grid9Identity;
}): Promise<Grid9CommittedAction> {
  const canonicalIntentHash = grid9CanonicalIntentHash({
    authenticatedUserId: args.identity.userId,
    matchId: args.intent.matchId,
    type: args.intent.type,
    payload: args.intent.payload,
  });
  const replay = await replayCommittedAction({
    intent: args.intent,
    userId: args.identity.userId,
    canonicalIntentHash,
  });
  if (replay) return replay;
  const snapshot = await readGrid9Aggregate(
    args.intent.matchId,
    args.identity.userId,
  );
  requireExpectedVersion(snapshot.state, args.intent.expectedStateVersion);
  const item = GRID9_ARSENAL_CATALOG[args.intent.payload.itemId];
  if (!item) throw new Grid9Error('ITEM_NOT_FOUND', 'Unknown inventory item');
  const now = new Date().toISOString();
  const spent = spendEscrow(snapshot.escrow, item.costCoins, now);
  const ledgerEntryId = randomUUID();
  const resolution = applyGrid9InventoryBuy({
    state: snapshot.state,
    buyer: args.identity,
    itemId: args.intent.payload.itemId,
    intentId: args.intent.intentId,
    ledgerEntryId,
    nowMs: Date.parse(now),
  });
  const receipt: Grid9LedgerReceipt = {
    entryId: ledgerEntryId,
    intentId: args.intent.intentId,
    kind: 'inventory_buy',
    debitCoins: resolution.costCoins,
    creditCoins: resolution.seatCoins,
    jackpotContributionCoins: resolution.jackpotCoins,
    availableCoinsAfter: spent.wallet.availableCoins,
    stateVersion: resolution.state.authority.stateVersion,
    committedAt: now,
  };
  const ledger: Grid9LedgerEntry = {
    schemaVersion: 1,
    entryId: ledgerEntryId,
    intentId: args.intent.intentId,
    matchId: args.intent.matchId,
    kind: 'inventory_buy',
    actorUserId: args.identity.userId,
    beneficiaryUserId: args.identity.userId,
    sourceSlotIndex: resolution.recipientSlotIndex,
    targetSlotIndex: resolution.recipientSlotIndex,
    itemId: args.intent.payload.itemId,
    fundingSource: 'actor_escrow',
    fundingBreakdown: {
      platformReservationCoins: spent.platformCoins,
      microDropCoins: spent.microDropCoins,
      mercenaryBankrollCoins: 0,
      jackpotPoolCoins: resolution.jackpotCoins,
    },
    serverOperationId: null,
    canonicalPayloadHash: canonicalIntentHash,
    debitCoins: resolution.costCoins,
    creditCoins: resolution.seatCoins,
    jackpotDeltaCoins: resolution.jackpotCoins,
    escrowBalanceBefore: snapshot.escrow!.availableCoins,
    escrowBalanceAfter: spent.wallet.availableCoins,
    stateVersionBefore: snapshot.state.authority.stateVersion,
    stateVersionAfter: resolution.state.authority.stateVersion,
    createdAt: now,
  };
  const actionEvent = createGrid9RoomEvent({
    type: 'ARSENAL_GRANTED',
    matchId: args.intent.matchId,
    sequence: resolution.state.authority.eventSequence,
    stateVersion: resolution.state.authority.stateVersion,
    causationIntentId: args.intent.intentId,
    payload: {
      senderPublicProfileId: args.identity.publicProfileId,
      senderDisplayName: args.identity.displayName,
      recipientSlotIndex: resolution.recipientSlotIndex,
      itemId: resolution.itemId,
      costCoins: resolution.costCoins,
      seatCoins: resolution.seatCoins,
      jackpotCoins: resolution.jackpotCoins,
      selfBuy: true,
      droppedItemId: resolution.droppedItemId,
      inventoryAfter: resolution.inventoryAfter,
      receipt: publicReceipt({
        ledgerEntryId,
        intentId: args.intent.intentId,
        itemId: resolution.itemId,
        debitCoins: resolution.costCoins,
        jackpotContributionCoins: resolution.jackpotCoins,
        stateVersion: resolution.state.authority.stateVersion,
        committedAt: now,
      }),
      jackpotTotalCoins: resolution.state.jackpot.currentCoins,
      healthBefore: resolution.healthBefore,
      healthAfter: resolution.healthAfter,
      eliminated: resolution.eliminated,
      knockoutTokens: resolution.knockoutTokens,
    },
  });
  const committed = await commitGrid9PaidMutation({
    snapshot,
    nextState: resolution.state,
    nextEscrow: spent.wallet,
    intent: args.intent,
    authenticatedUserId: args.identity.userId,
    canonicalIntentHash,
    ledger,
    privateReceipt: receipt,
    roomEvent: actionEvent,
    timerOutbox: timerOutboxForState(resolution.state),
  });
  return {
    status: committed.status,
    privateReceipt: committed.receipt.privateReceipt ?? receipt,
    roomEvents: committed.status === 'committed' ? [actionEvent] : [],
    state: resolution.state,
  };
}

export async function buybackGrid9Seat(args: {
  intent: Grid9BuybackIntent;
  identity: Grid9Identity;
}): Promise<Grid9CommittedAction> {
  const canonicalIntentHash = grid9CanonicalIntentHash({
    authenticatedUserId: args.identity.userId,
    matchId: args.intent.matchId,
    type: args.intent.type,
    payload: args.intent.payload,
  });
  const replay = await replayCommittedAction({
    intent: args.intent,
    userId: args.identity.userId,
    canonicalIntentHash,
  });
  if (replay) return replay;
  const snapshot = await readGrid9Aggregate(
    args.intent.matchId,
    args.identity.userId,
  );
  requireExpectedVersion(snapshot.state, args.intent.expectedStateVersion);
  const now = new Date().toISOString();
  const spent = spendEscrow(snapshot.escrow, GRID9_BUYBACK_COST_COINS, now);
  const ledgerEntryId = randomUUID();
  const resolution = applyGrid9Buyback({
    state: snapshot.state,
    userId: args.identity.userId,
    intentId: args.intent.intentId,
    ledgerEntryId,
    nowMs: Date.parse(now),
  });
  const receipt: Grid9LedgerReceipt = {
    entryId: ledgerEntryId,
    intentId: args.intent.intentId,
    kind: 'buyback',
    debitCoins: resolution.costCoins,
    creditCoins: 0,
    jackpotContributionCoins: resolution.jackpotCoins,
    availableCoinsAfter: spent.wallet.availableCoins,
    stateVersion: resolution.state.authority.stateVersion,
    committedAt: now,
  };
  const ledger: Grid9LedgerEntry = {
    schemaVersion: 1,
    entryId: ledgerEntryId,
    intentId: args.intent.intentId,
    matchId: args.intent.matchId,
    kind: 'buyback',
    actorUserId: args.identity.userId,
    beneficiaryUserId: args.identity.userId,
    sourceSlotIndex: resolution.slotIndex,
    targetSlotIndex: resolution.slotIndex,
    itemId: null,
    fundingSource: 'actor_escrow',
    fundingBreakdown: {
      platformReservationCoins: spent.platformCoins,
      microDropCoins: spent.microDropCoins,
      mercenaryBankrollCoins: 0,
      jackpotPoolCoins: resolution.jackpotCoins,
    },
    serverOperationId: null,
    canonicalPayloadHash: canonicalIntentHash,
    debitCoins: resolution.costCoins,
    creditCoins: 0,
    jackpotDeltaCoins: resolution.jackpotCoins,
    escrowBalanceBefore: snapshot.escrow!.availableCoins,
    escrowBalanceAfter: spent.wallet.availableCoins,
    stateVersionBefore: snapshot.state.authority.stateVersion,
    stateVersionAfter: resolution.state.authority.stateVersion,
    createdAt: now,
  };
  const buybackEvent = createGrid9RoomEvent({
    type: 'PLAYER_BUYBACK',
    matchId: args.intent.matchId,
    sequence: resolution.state.authority.eventSequence,
    stateVersion: resolution.state.authority.stateVersion,
    causationIntentId: args.intent.intentId,
    payload: {
      slotIndex: resolution.slotIndex,
      userPublicProfileId: args.identity.publicProfileId,
      displayName: args.identity.displayName,
      costCoins: resolution.costCoins,
      jackpotCoins: resolution.jackpotCoins,
      jackpotTotalCoins: resolution.state.jackpot.currentCoins,
      healthAfter: resolution.healthAfter,
    },
  });
  const committed = await commitGrid9PaidMutation({
    snapshot,
    nextState: resolution.state,
    nextEscrow: spent.wallet,
    intent: args.intent,
    authenticatedUserId: args.identity.userId,
    canonicalIntentHash,
    ledger,
    privateReceipt: receipt,
    roomEvent: buybackEvent,
    timerOutbox: timerOutboxForState(resolution.state),
  });
  return {
    status: committed.status,
    privateReceipt: committed.receipt.privateReceipt ?? receipt,
    roomEvents: committed.status === 'committed' ? [buybackEvent] : [],
    state: resolution.state,
  };
}

/** Spotlight combatant locks a seat; room overlay follows TURN_TICK.turn. */
export async function selectGrid9Target(args: {
  io: Server;
  identity: Grid9Identity;
  intent: Grid9SelectTargetIntent;
}): Promise<void> {
  const state = await readGrid9State(args.intent.matchId);
  requireExpectedVersion(state, args.intent.expectedStateVersion);
  const { actor, sourceSlotIndex } = resolveGrid9Actor(state, args.identity);
  const next = applyGrid9SelectTarget({
    state,
    actor,
    sourceSlotIndex,
    targetSlotIndex: args.intent.payload.targetSlotIndex,
  });
  if (next.authority.stateVersion === state.authority.stateVersion) {
    return;
  }
  const publicState = toGrid9PublicGameState(next);
  const remainingMs = Math.max(
    0,
    Date.parse(next.turn?.endsAt ?? '') - Date.now(),
  );
  const roomEvent = createGrid9RoomEvent({
    type: 'TURN_TICK',
    matchId: state.matchId,
    sequence: next.authority.eventSequence,
    stateVersion: next.authority.stateVersion,
    causationIntentId: args.intent.intentId,
    payload: {
      turn: publicState.turn!,
      remainingMs: Number.isFinite(remainingMs) ? remainingMs : 0,
    },
  });
  const operationId = `select-target-${args.intent.intentId}`;
  const result = await commitGrid9ServerMutation({
    currentState: state,
    nextState: next,
    operationReceipt: newGrid9ServerOperationReceipt({
      matchId: state.matchId,
      operationId,
      kind: 'turn_advance',
      canonicalOperationHash: grid9CanonicalOperationHash({
        matchId: state.matchId,
        operationId,
        kind: 'turn_advance',
        payload: {
          intentId: args.intent.intentId,
          intent: 'SELECT_TARGET',
          targetSlotIndex: args.intent.payload.targetSlotIndex,
        },
      }),
      stateVersion: next.authority.stateVersion,
      result: roomEvent.payload,
      recordedAt: roomEvent.sentAt,
    }),
    timerOutbox: timerOutboxForState(next),
  });
  if (result.status === 'committed') {
    emitGrid9Room(args.io, state.matchId, roomEvent);
  }
}
