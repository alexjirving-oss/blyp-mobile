import {
  GRID9_MAX_ESCROW_RESERVE_COINS,
  GRID9_MAX_MERCENARY_FUND_COINS,
  GRID9_MIN_ESCROW_RESERVE_COINS,
  GRID9_MIN_MERCENARY_FUND_COINS,
  GRID9_PROTOCOL,
  GRID9_PROTOCOL_VERSION,
  isGrid9SlotIndex,
  type Grid9ShieldId,
  type Grid9SlotIndex,
  type Grid9WeaponId,
} from './constants';
import { createGrid9ClientNonce, createGrid9Id, isGrid9NonceEncoding } from './nonce';
import type {
  Grid9BuyInventoryItemIntent,
  Grid9ClientIntent,
  Grid9FireWeaponIntent,
  Grid9FundMercenaryIntent,
  Grid9MatchJoinIntent,
  Grid9PingIntent,
  Grid9PrivateRoomCreateIntent,
  Grid9PrivateRoomJoinIntent,
  Grid9PurchaseShieldIntent,
  Grid9QueueJoinIntent,
  Grid9QueueLeaveIntent,
  Grid9RequestSnapshotIntent,
  Grid9ReserveCoinsIntent,
  Grid9SendArsenalGiftIntent,
  Grid9StartPrivateMatchIntent,
} from './protocol';

export interface Grid9IntentSessionFields {
  connectionSessionId: string;
}

function envelopeBase(session: Grid9IntentSessionFields) {
  const nonce = createGrid9ClientNonce();
  if (!isGrid9NonceEncoding(nonce)) {
    throw new Error('Grid 9 failed to mint a valid client nonce');
  }
  return {
    protocol: GRID9_PROTOCOL,
    protocolVersion: GRID9_PROTOCOL_VERSION,
    direction: 'client_to_server' as const,
    connectionSessionId: session.connectionSessionId,
    messageId: createGrid9Id(),
    intentId: createGrid9Id(),
    nonce,
    sentAt: new Date().toISOString(),
  };
}

export function buildQueueJoinIntent(
  session: Grid9IntentSessionFields,
  payload: { region: string; sponsorPassId?: string | null },
): Grid9QueueJoinIntent {
  return {
    ...envelopeBase(session),
    type: 'QUEUE_JOIN',
    matchId: null,
    expectedStateVersion: null,
    payload: {
      region: payload.region,
      sponsorPassId: payload.sponsorPassId ?? null,
    },
  };
}

export function buildQueueLeaveIntent(
  session: Grid9IntentSessionFields,
  payload: { region: string; ticketId: string },
): Grid9QueueLeaveIntent {
  return {
    ...envelopeBase(session),
    type: 'QUEUE_LEAVE',
    matchId: null,
    expectedStateVersion: null,
    payload,
  };
}

export function buildMatchLeaveIntent(
  session: Grid9IntentSessionFields,
  input: {
    matchId: string;
    expectedStateVersion: number | null;
    reason?: 'user' | 'navigation' | null;
  },
): import('./protocol').Grid9MatchLeaveIntent {
  return {
    ...envelopeBase(session),
    type: 'MATCH_LEAVE',
    matchId: input.matchId,
    expectedStateVersion: input.expectedStateVersion,
    payload: { reason: input.reason ?? 'user' },
  };
}

export function buildMatchJoinIntent(
  session: Grid9IntentSessionFields,
  payload: { matchId: string; region: string; assignmentId: string; assignmentToken: string },
): Grid9MatchJoinIntent {
  return {
    ...envelopeBase(session),
    type: 'MATCH_JOIN',
    matchId: payload.matchId,
    expectedStateVersion: null,
    payload: {
      region: payload.region,
      assignmentId: payload.assignmentId,
      assignmentToken: payload.assignmentToken,
    },
  };
}

export function buildReserveCoinsIntent(
  session: Grid9IntentSessionFields,
  payload: { matchId: string; expectedStateVersion: number; amountCoins: number },
): Grid9ReserveCoinsIntent {
  if (
    !Number.isInteger(payload.amountCoins) ||
    payload.amountCoins < GRID9_MIN_ESCROW_RESERVE_COINS ||
    payload.amountCoins > GRID9_MAX_ESCROW_RESERVE_COINS
  ) {
    throw new Error(
      `Reserve ${GRID9_MIN_ESCROW_RESERVE_COINS}-${GRID9_MAX_ESCROW_RESERVE_COINS} whole coins`,
    );
  }
  return {
    ...envelopeBase(session),
    type: 'RESERVE_COINS',
    matchId: payload.matchId,
    expectedStateVersion: payload.expectedStateVersion,
    payload: { amountCoins: payload.amountCoins },
  };
}

export function buildFireWeaponIntent(
  session: Grid9IntentSessionFields,
  payload: {
    matchId: string;
    expectedStateVersion: number;
    weaponId: Grid9WeaponId;
    targetSlotIndex: Grid9SlotIndex | number;
  },
): Grid9FireWeaponIntent {
  if (!isGrid9SlotIndex(payload.targetSlotIndex)) {
    throw new Error('Grid 9 target slot is out of range');
  }
  return {
    ...envelopeBase(session),
    type: 'FIRE_WEAPON',
    matchId: payload.matchId,
    expectedStateVersion: payload.expectedStateVersion,
    payload: {
      weaponId: payload.weaponId,
      targetSlotIndex: payload.targetSlotIndex,
    },
  };
}

export function buildPurchaseShieldIntent(
  session: Grid9IntentSessionFields,
  payload: {
    matchId: string;
    expectedStateVersion: number;
    shieldId?: Grid9ShieldId;
    beneficiarySlotIndex: Grid9SlotIndex | number;
  },
): Grid9PurchaseShieldIntent {
  if (!isGrid9SlotIndex(payload.beneficiarySlotIndex)) {
    throw new Error('Grid 9 beneficiary slot is out of range');
  }
  return {
    ...envelopeBase(session),
    type: 'PURCHASE_SHIELD',
    matchId: payload.matchId,
    expectedStateVersion: payload.expectedStateVersion,
    payload: {
      shieldId: payload.shieldId ?? 'basic_shield',
      beneficiarySlotIndex: payload.beneficiarySlotIndex,
    },
  };
}

export function buildFundMercenaryIntent(
  session: Grid9IntentSessionFields,
  payload: {
    matchId: string;
    expectedStateVersion: number;
    beneficiarySlotIndex: Grid9SlotIndex | number;
    amountCoins: number;
  },
): Grid9FundMercenaryIntent {
  if (!isGrid9SlotIndex(payload.beneficiarySlotIndex)) {
    throw new Error('Grid 9 beneficiary slot is out of range');
  }
  if (
    !Number.isInteger(payload.amountCoins) ||
    payload.amountCoins < GRID9_MIN_MERCENARY_FUND_COINS ||
    payload.amountCoins > GRID9_MAX_MERCENARY_FUND_COINS
  ) {
    throw new Error(
      `Fund ${GRID9_MIN_MERCENARY_FUND_COINS}-${GRID9_MAX_MERCENARY_FUND_COINS} whole coins`,
    );
  }
  return {
    ...envelopeBase(session),
    type: 'FUND_MERCENARY',
    matchId: payload.matchId,
    expectedStateVersion: payload.expectedStateVersion,
    payload: {
      beneficiarySlotIndex: payload.beneficiarySlotIndex,
      amountCoins: payload.amountCoins,
    },
  };
}

export function buildRequestSnapshotIntent(
  session: Grid9IntentSessionFields,
  payload: {
    matchId: string;
    lastSeenStateVersion: number | null;
    lastSeenSequence: number | null;
  },
): Grid9RequestSnapshotIntent {
  return {
    ...envelopeBase(session),
    type: 'REQUEST_SNAPSHOT',
    matchId: payload.matchId,
    expectedStateVersion: null,
    payload: {
      lastSeenStateVersion: payload.lastSeenStateVersion,
      lastSeenSequence: payload.lastSeenSequence,
    },
  };
}

export function buildPingIntent(session: Grid9IntentSessionFields): Grid9PingIntent {
  return {
    ...envelopeBase(session),
    type: 'PING',
    matchId: null,
    expectedStateVersion: null,
    payload: { clientTime: new Date().toISOString() },
  };
}

export function buildPrivateRoomCreateIntent(
  session: Grid9IntentSessionFields,
  payload: { region: string; displayName?: string },
): Grid9PrivateRoomCreateIntent {
  return {
    ...envelopeBase(session),
    type: 'PRIVATE_ROOM_CREATE',
    matchId: null,
    expectedStateVersion: null,
    payload: {
      region: payload.region,
      ...(payload.displayName ? { displayName: payload.displayName } : {}),
    },
  };
}

export function buildPrivateRoomJoinIntent(
  session: Grid9IntentSessionFields,
  payload: { region: string; roomCode: string },
): Grid9PrivateRoomJoinIntent {
  return {
    ...envelopeBase(session),
    type: 'PRIVATE_ROOM_JOIN',
    matchId: null,
    expectedStateVersion: null,
    payload: {
      region: payload.region,
      roomCode: payload.roomCode.trim().toUpperCase(),
    },
  };
}

export function buildStartPrivateMatchIntent(
  session: Grid9IntentSessionFields,
  payload: { matchId: string; expectedStateVersion: number },
): Grid9StartPrivateMatchIntent {
  return {
    ...envelopeBase(session),
    type: 'START_PRIVATE_MATCH',
    matchId: payload.matchId,
    expectedStateVersion: payload.expectedStateVersion,
    payload: { confirm: true },
  };
}

export function buildSendArsenalGiftIntent(
  session: Grid9IntentSessionFields,
  payload: {
    matchId: string;
    expectedStateVersion: number;
    itemId: Grid9WeaponId | Grid9ShieldId;
    recipientSlotIndex: Grid9SlotIndex;
  },
): Grid9SendArsenalGiftIntent {
  if (!isGrid9SlotIndex(payload.recipientSlotIndex)) {
    throw new Error('Invalid Grid 9 gift recipient slot');
  }
  return {
    ...envelopeBase(session),
    type: 'SEND_ARSENAL_GIFT',
    matchId: payload.matchId,
    expectedStateVersion: payload.expectedStateVersion,
    payload: {
      itemId: payload.itemId,
      recipientSlotIndex: payload.recipientSlotIndex,
    },
  };
}

export function buildBuyInventoryItemIntent(
  session: Grid9IntentSessionFields,
  payload: {
    matchId: string;
    expectedStateVersion: number;
    itemId: Grid9WeaponId | Grid9ShieldId;
  },
): Grid9BuyInventoryItemIntent {
  return {
    ...envelopeBase(session),
    type: 'BUY_INVENTORY_ITEM',
    matchId: payload.matchId,
    expectedStateVersion: payload.expectedStateVersion,
    payload: { itemId: payload.itemId },
  };
}

export function assertGrid9ClientIntent(intent: Grid9ClientIntent): Grid9ClientIntent {
  if (!isGrid9NonceEncoding(intent.nonce)) {
    throw new Error('Grid 9 intent nonce is not 128-bit base64url');
  }
  return intent;
}
