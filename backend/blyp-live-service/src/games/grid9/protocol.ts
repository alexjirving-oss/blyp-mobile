import type { Grid9ShieldId, Grid9WeaponId } from './catalog';
import type { Grid9SlotIndex } from './constants';
import type {
  Grid9EscrowWallet,
  Grid9LedgerReceipt,
  Grid9PublicPurchaseReceipt,
  Grid9WalletReservationRecord,
} from './ledger';
import type {
  Grid9MicroDropResult,
  Grid9PublicGameState,
  Grid9PublicJackpotState,
  Grid9PublicMatchOutcome,
  Grid9QueueEntry,
  Grid9TurnState,
} from './state';
import type { Grid9PublicActionActor, Grid9PublicPlayer } from './players';

export type Grid9ClientIntentType =
  | 'QUEUE_JOIN'
  | 'QUEUE_LEAVE'
  | 'MATCH_JOIN'
  | 'PRIVATE_ROOM_CREATE'
  | 'PRIVATE_ROOM_JOIN'
  | 'START_PRIVATE_MATCH'
  | 'KICK_PLAYER'
  | 'CHANGE_SETTINGS'
  | 'RESERVE_COINS'
  | 'FIRE_WEAPON'
  | 'PURCHASE_SHIELD'
  | 'FUND_MERCENARY'
  | 'SEND_ARSENAL_GIFT'
  | 'BUY_INVENTORY_ITEM'
  | 'REQUEST_SNAPSHOT'
  | 'MATCH_LEAVE'
  | 'PING';

export type Grid9ServerEventType =
  | 'WELCOME'
  | 'QUEUE_STATUS'
  | 'MATCH_ASSIGNED'
  | 'PRIVATE_ROOM_STATUS'
  | 'STATE_SNAPSHOT'
  | 'ESCROW_UPDATED'
  | 'INTENT_COMMITTED'
  | 'WEAPON_RESOLVED'
  | 'SHIELD_RESOLVED'
  | 'MERCENARY_FUNDED'
  | 'ARSENAL_GRANTED'
  | 'TURN_ADVANCED'
  | 'TURN_TICK'
  | 'ROULETTE_START'
  | 'ROULETTE_LAND'
  | 'MICRO_DROP_RESOLVED'
  | 'PLAYER_CONNECTION_CHANGED'
  | 'PLAYER_ELIMINATED'
  | 'JACKPOT_CHANGED'
  | 'MATCH_COMPLETED'
  | 'INTENT_REJECTED'
  | 'RESYNC_REQUIRED'
  | 'PONG';

export interface Grid9WireEnvelopeBase {
  protocol: 'grid9.ws';
  protocolVersion: 2;
  messageId: string;
  /**
   * Base64url CSPRNG output with at least 128 bits of entropy. The receiver
   * consumes it once; reuse is a replay and must be rejected.
   */
  nonce: string;
  sentAt: string;
}

export interface Grid9ConnectionIntentEnvelope<
  TType extends Grid9ClientIntentType,
  TPayload,
> extends Grid9WireEnvelopeBase {
  direction: 'client_to_server';
  connectionSessionId: string;
  type: TType;
  matchId: null;
  intentId: string;
  expectedStateVersion: null;
  payload: TPayload;
}

export interface Grid9MatchAdmissionIntentEnvelope<
  TType extends Grid9ClientIntentType,
  TPayload,
> extends Grid9WireEnvelopeBase {
  direction: 'client_to_server';
  connectionSessionId: string;
  type: TType;
  matchId: string;
  intentId: string;
  expectedStateVersion: null;
  payload: TPayload;
}

export interface Grid9MatchCommandEnvelope<
  TType extends Grid9ClientIntentType,
  TPayload,
> extends Grid9WireEnvelopeBase {
  direction: 'client_to_server';
  connectionSessionId: string;
  type: TType;
  matchId: string;
  intentId: string;
  expectedStateVersion: number;
  payload: TPayload;
}

export interface Grid9PrivateServerEventEnvelope<
  TType extends Grid9ServerEventType,
  TPayload,
> extends Grid9WireEnvelopeBase {
  direction: 'server_to_client';
  routing: 'private';
  connectionSessionId: string;
  type: TType;
  matchId: string | null;
  sequence: null;
  stateVersion: number | null;
  causationIntentId: string | null;
  payload: TPayload;
}

export interface Grid9RoomServerEventEnvelope<
  TType extends Grid9ServerEventType,
  TPayload,
> extends Grid9WireEnvelopeBase {
  direction: 'server_to_client';
  routing: 'room';
  serverSessionId: string;
  type: TType;
  matchId: string;
  sequence: number;
  stateVersion: number;
  causationIntentId: string | null;
  payload: TPayload;
}

export interface Grid9QueueJoinPayload {
  region: string;
  sponsorPassId: string | null;
}

export interface Grid9QueueLeavePayload {
  region: string;
  ticketId: string;
}

export interface Grid9MatchJoinPayload {
  region: string;
  assignmentId: string;
  assignmentToken: string;
}

export interface Grid9ReserveCoinsPayload {
  amountCoins: number;
}

export interface Grid9FireWeaponPayload {
  weaponId: Grid9WeaponId;
  targetSlotIndex: Grid9SlotIndex;
}

export interface Grid9PurchaseShieldPayload {
  shieldId: Grid9ShieldId;
  beneficiarySlotIndex: Grid9SlotIndex;
}

export interface Grid9FundMercenaryPayload {
  beneficiarySlotIndex: Grid9SlotIndex;
  amountCoins: number;
}

export interface Grid9SendArsenalGiftPayload {
  itemId: Grid9WeaponId | Grid9ShieldId;
  recipientSlotIndex: Grid9SlotIndex;
}

export interface Grid9BuyInventoryItemPayload {
  itemId: Grid9WeaponId | Grid9ShieldId;
}

export interface Grid9RequestSnapshotPayload {
  lastSeenStateVersion: number | null;
  lastSeenSequence: number | null;
}

export interface Grid9PingPayload {
  clientTime: string;
}

export interface Grid9PrivateRoomCreatePayload {
  region: string;
  displayName?: string;
}

export interface Grid9PrivateRoomJoinPayload {
  region: string;
  roomCode: string;
}

export interface Grid9StartPrivateMatchPayload {
  confirm: true;
}

export interface Grid9KickPlayerPayload {
  targetUserId: string;
}

export interface Grid9ChangeSettingsPayload {
  settings: Record<string, unknown>;
}

export interface Grid9MatchLeavePayload {
  reason?: 'user' | 'navigation' | null;
}

export type Grid9QueueJoinIntent = Grid9ConnectionIntentEnvelope<
  'QUEUE_JOIN',
  Grid9QueueJoinPayload
>;
export type Grid9QueueLeaveIntent = Grid9ConnectionIntentEnvelope<
  'QUEUE_LEAVE',
  Grid9QueueLeavePayload
>;
export type Grid9MatchJoinIntent = Grid9MatchAdmissionIntentEnvelope<
  'MATCH_JOIN',
  Grid9MatchJoinPayload
>;
export type Grid9MatchLeaveIntent = {
  protocol: 'grid9.ws';
  protocolVersion: 2;
  direction: 'client_to_server';
  connectionSessionId: string;
  messageId: string;
  intentId: string;
  nonce: string;
  sentAt: string;
  type: 'MATCH_LEAVE';
  matchId: string;
  expectedStateVersion: number | null;
  payload: Grid9MatchLeavePayload;
};
export type Grid9ReserveCoinsIntent = Grid9MatchCommandEnvelope<
  'RESERVE_COINS',
  Grid9ReserveCoinsPayload
>;
export type Grid9FireWeaponIntent = Grid9MatchCommandEnvelope<
  'FIRE_WEAPON',
  Grid9FireWeaponPayload
>;
export type Grid9PurchaseShieldIntent = Grid9MatchCommandEnvelope<
  'PURCHASE_SHIELD',
  Grid9PurchaseShieldPayload
>;
export type Grid9FundMercenaryIntent = Grid9MatchCommandEnvelope<
  'FUND_MERCENARY',
  Grid9FundMercenaryPayload
>;
export type Grid9SendArsenalGiftIntent = Grid9MatchCommandEnvelope<
  'SEND_ARSENAL_GIFT',
  Grid9SendArsenalGiftPayload
>;
export type Grid9BuyInventoryItemIntent = Grid9MatchCommandEnvelope<
  'BUY_INVENTORY_ITEM',
  Grid9BuyInventoryItemPayload
>;
export type Grid9RequestSnapshotIntent = Grid9MatchAdmissionIntentEnvelope<
  'REQUEST_SNAPSHOT',
  Grid9RequestSnapshotPayload
>;
export type Grid9PingIntent = Grid9ConnectionIntentEnvelope<'PING', Grid9PingPayload>;
export type Grid9PrivateRoomCreateIntent = Grid9ConnectionIntentEnvelope<
  'PRIVATE_ROOM_CREATE',
  Grid9PrivateRoomCreatePayload
>;
export type Grid9PrivateRoomJoinIntent = Grid9ConnectionIntentEnvelope<
  'PRIVATE_ROOM_JOIN',
  Grid9PrivateRoomJoinPayload
>;
export type Grid9StartPrivateMatchIntent = Grid9MatchCommandEnvelope<
  'START_PRIVATE_MATCH',
  Grid9StartPrivateMatchPayload
>;
export type Grid9KickPlayerIntent = Grid9MatchCommandEnvelope<
  'KICK_PLAYER',
  Grid9KickPlayerPayload
>;
export type Grid9ChangeSettingsIntent = Grid9MatchCommandEnvelope<
  'CHANGE_SETTINGS',
  Grid9ChangeSettingsPayload
>;

export type Grid9ClientIntent =
  | Grid9QueueJoinIntent
  | Grid9QueueLeaveIntent
  | Grid9MatchJoinIntent
  | Grid9MatchLeaveIntent
  | Grid9PrivateRoomCreateIntent
  | Grid9PrivateRoomJoinIntent
  | Grid9StartPrivateMatchIntent
  | Grid9KickPlayerIntent
  | Grid9ChangeSettingsIntent
  | Grid9ReserveCoinsIntent
  | Grid9FireWeaponIntent
  | Grid9PurchaseShieldIntent
  | Grid9FundMercenaryIntent
  | Grid9SendArsenalGiftIntent
  | Grid9BuyInventoryItemIntent
  | Grid9RequestSnapshotIntent
  | Grid9PingIntent;

export interface Grid9WelcomePayload {
  connectionId: string;
  connectionSessionId: string;
  serverTime: string;
  minimumProtocolVersion: 2;
  nonceTtlSeconds: number;
}

export interface Grid9PrivateRoomStatusPayload {
  status: 'created' | 'joined' | 'started' | 'kicked' | 'closed' | 'left';
  matchId: string;
  roomCode: string;
  ownerUserId: string;
  slotIndex: number | null;
}

export interface Grid9QueueStatusPayload {
  status: 'queued' | 'matching' | 'assigned' | 'left' | 'expired';
  entry: Grid9QueueEntry | null;
  position: number | null;
  estimatedWaitMs: number | null;
}

export interface Grid9MatchAssignedPayload {
  assignmentId: string;
  matchId: string;
  liveSessionId: string;
  slotIndex: Grid9SlotIndex;
  assignmentToken: string;
  assignmentExpiresAt: string;
}

export interface Grid9StateSnapshotPayload {
  state: Grid9PublicGameState;
  reason: 'join' | 'reconnect' | 'requested' | 'version_gap' | 'periodic';
  /** Private match escrow for the requesting user (null for audience / missing). */
  escrow?: Grid9EscrowWallet | null;
}

export interface Grid9IntentCommittedPayload {
  receipt: Grid9LedgerReceipt;
}

export interface Grid9EscrowUpdatedPayload {
  wallet: Grid9EscrowWallet;
  reservation: Grid9WalletReservationRecord | null;
}

export interface Grid9DamageResult {
  slotIndex: Grid9SlotIndex;
  healthBefore: number;
  healthAfter: number;
  shieldBefore: number;
  shieldAfter: number;
  shieldDamage: number;
  healthDamage: number;
  eliminated: boolean;
  lastStandApplied: boolean;
}

export interface Grid9WeaponResolvedPayload {
  actor: Grid9PublicActionActor;
  sourceSlotIndex: Grid9SlotIndex | null;
  targetSlotIndex: Grid9SlotIndex;
  weaponId: Grid9WeaponId;
  damage: Grid9DamageResult[];
  receipt: Grid9PublicPurchaseReceipt;
  jackpotCoins: number;
  /** Source inventory after consume/fire so clients patch without waiting for snapshot. */
  inventoryAfter: Array<Grid9WeaponId | Grid9ShieldId>;
}

export interface Grid9ShieldResolvedPayload {
  actor: Grid9PublicActionActor;
  sourceSlotIndex: Grid9SlotIndex | null;
  beneficiarySlotIndex: Grid9SlotIndex;
  shieldId: Grid9ShieldId;
  shieldBefore: number;
  shieldAfter: number;
  receipt: Grid9PublicPurchaseReceipt;
  jackpotCoins: number;
  /** Source inventory after consume/purchase so clients patch without waiting for snapshot. */
  inventoryAfter: Array<Grid9WeaponId | Grid9ShieldId>;
}

export interface Grid9MercenaryFundedPayload {
  sponsorPublicProfileId: string;
  sponsorDisplayName: string;
  beneficiarySlotIndex: Grid9SlotIndex;
  amountCoins: number;
  bankrollBefore: number;
  bankrollAfter: number;
  receipt: Grid9PublicPurchaseReceipt;
}

export interface Grid9ArsenalGrantedPayload {
  senderPublicProfileId: string;
  senderDisplayName: string;
  recipientSlotIndex: Grid9SlotIndex;
  itemId: Grid9WeaponId | Grid9ShieldId;
  costCoins: number;
  seatCoins: number;
  jackpotCoins: number;
  selfBuy: boolean;
  droppedItemId: Grid9WeaponId | Grid9ShieldId | null;
  inventoryAfter: Array<Grid9WeaponId | Grid9ShieldId>;
  receipt: Grid9PublicPurchaseReceipt;
  jackpotTotalCoins: number;
}

export interface Grid9TurnAdvancedPayload {
  previousTurnNumber: number;
  turn: Grid9TurnState;
}

export interface Grid9TurnTickPayload {
  turn: Grid9TurnState;
  remainingMs: number;
}

export interface Grid9RouletteStartPayload {
  turnNumber: number;
  candidateSlotIndices: number[];
  selectedSlotIndex: number;
  endsAt: string;
  entropyDigest: string;
}

export interface Grid9RouletteLandPayload {
  turn: Grid9TurnState;
  freeDropItemId: string | null;
  freeDropEquipped: boolean;
}

export interface Grid9MicroDropResolvedPayload {
  result: Grid9MicroDropResult;
}

export interface Grid9PlayerEliminatedPayload {
  slotIndex: Grid9SlotIndex;
  playerKind: 'human' | 'sentinel';
  eliminatedBy: Grid9PublicActionActor | null;
  eliminatedAt: string;
  humanEnteredSabotageMode: boolean;
}

export interface Grid9PlayerConnectionChangedPayload {
  slotIndex: Grid9SlotIndex;
  connectionState: 'connected' | 'reconnecting' | 'disconnected';
  /** Present on host kick: seat is replaced (Sentinel) so the 9-box stays full. */
  replacementPlayer?: Grid9PublicPlayer;
  audienceCount?: number;
}

export interface Grid9JackpotChangedPayload {
  jackpot: Grid9PublicJackpotState;
  deltaCoins: number;
  reason: 'purchase' | 'opening_rollover' | 'payout' | 'rollover';
}

export interface Grid9MatchCompletedPayload {
  outcome: Grid9PublicMatchOutcome;
  finalState: Grid9PublicGameState;
}

export type Grid9ErrorCode =
  | 'AUTH_REQUIRED'
  | 'BAD_PROTOCOL_VERSION'
  | 'INVALID_PAYLOAD'
  | 'INVALID_NONCE'
  | 'NONCE_REPLAY'
  | 'INTENT_CONFLICT'
  | 'STALE_STATE'
  | 'RATE_LIMITED'
  | 'QUEUE_ENTRY_NOT_FOUND'
  | 'MATCH_NOT_FOUND'
  | 'MATCH_NOT_ACTIVE'
  | 'PLAYER_NOT_FOUND'
  | 'NOT_ELIGIBLE'
  | 'TARGET_NOT_ALIVE'
  | 'TARGET_SELF'
  | 'ITEM_NOT_FOUND'
  | 'COOLDOWN_ACTIVE'
  | 'INSUFFICIENT_FUNDS'
  | 'INVALID_RESERVE_AMOUNT'
  | 'WALLET_RESERVATION_FAILED'
  | 'ESCROW_FROZEN'
  | 'INVALID_FUND_AMOUNT'
  | 'SETTLEMENT_IN_PROGRESS'
  | 'INTERNAL_ERROR';

export interface Grid9IntentRejectedPayload {
  intentId: string;
  code: Grid9ErrorCode;
  retryable: boolean;
  message: string;
  authoritativeStateVersion: number | null;
}

export interface Grid9ResyncRequiredPayload {
  reason: 'version_gap' | 'sequence_gap' | 'state_expired';
  authoritativeStateVersion: number | null;
  authoritativeSequence: number | null;
}

export interface Grid9PongPayload {
  clientTime: string;
  serverTime: string;
}

export type Grid9WelcomeEvent = Grid9PrivateServerEventEnvelope<
  'WELCOME',
  Grid9WelcomePayload
>;
export type Grid9QueueStatusEvent = Grid9PrivateServerEventEnvelope<
  'QUEUE_STATUS',
  Grid9QueueStatusPayload
>;
export type Grid9MatchAssignedEvent = Grid9PrivateServerEventEnvelope<
  'MATCH_ASSIGNED',
  Grid9MatchAssignedPayload
>;
export type Grid9PrivateRoomStatusEvent = Grid9PrivateServerEventEnvelope<
  'PRIVATE_ROOM_STATUS',
  Grid9PrivateRoomStatusPayload
>;
export type Grid9StateSnapshotEvent = Grid9PrivateServerEventEnvelope<
  'STATE_SNAPSHOT',
  Grid9StateSnapshotPayload
>;
export type Grid9EscrowUpdatedEvent = Grid9PrivateServerEventEnvelope<
  'ESCROW_UPDATED',
  Grid9EscrowUpdatedPayload
>;
export type Grid9IntentCommittedEvent = Grid9PrivateServerEventEnvelope<
  'INTENT_COMMITTED',
  Grid9IntentCommittedPayload
>;
export type Grid9WeaponResolvedEvent = Grid9RoomServerEventEnvelope<
  'WEAPON_RESOLVED',
  Grid9WeaponResolvedPayload
>;
export type Grid9ShieldResolvedEvent = Grid9RoomServerEventEnvelope<
  'SHIELD_RESOLVED',
  Grid9ShieldResolvedPayload
>;
export type Grid9MercenaryFundedEvent = Grid9RoomServerEventEnvelope<
  'MERCENARY_FUNDED',
  Grid9MercenaryFundedPayload
>;
export type Grid9ArsenalGrantedEvent = Grid9RoomServerEventEnvelope<
  'ARSENAL_GRANTED',
  Grid9ArsenalGrantedPayload
>;
export type Grid9TurnAdvancedEvent = Grid9RoomServerEventEnvelope<
  'TURN_ADVANCED',
  Grid9TurnAdvancedPayload
>;
export type Grid9TurnTickEvent = Grid9RoomServerEventEnvelope<
  'TURN_TICK',
  Grid9TurnTickPayload
>;
export type Grid9RouletteStartEvent = Grid9RoomServerEventEnvelope<
  'ROULETTE_START',
  Grid9RouletteStartPayload
>;
export type Grid9RouletteLandEvent = Grid9RoomServerEventEnvelope<
  'ROULETTE_LAND',
  Grid9RouletteLandPayload
>;
export type Grid9MicroDropResolvedEvent = Grid9RoomServerEventEnvelope<
  'MICRO_DROP_RESOLVED',
  Grid9MicroDropResolvedPayload
>;
export type Grid9PlayerEliminatedEvent = Grid9RoomServerEventEnvelope<
  'PLAYER_ELIMINATED',
  Grid9PlayerEliminatedPayload
>;
export type Grid9PlayerConnectionChangedEvent =
  Grid9RoomServerEventEnvelope<
    'PLAYER_CONNECTION_CHANGED',
    Grid9PlayerConnectionChangedPayload
  >;
export type Grid9JackpotChangedEvent = Grid9RoomServerEventEnvelope<
  'JACKPOT_CHANGED',
  Grid9JackpotChangedPayload
>;
export type Grid9MatchCompletedEvent = Grid9RoomServerEventEnvelope<
  'MATCH_COMPLETED',
  Grid9MatchCompletedPayload
>;
export type Grid9IntentRejectedEvent = Grid9PrivateServerEventEnvelope<
  'INTENT_REJECTED',
  Grid9IntentRejectedPayload
>;
export type Grid9ResyncRequiredEvent = Grid9PrivateServerEventEnvelope<
  'RESYNC_REQUIRED',
  Grid9ResyncRequiredPayload
>;
export type Grid9PongEvent = Grid9PrivateServerEventEnvelope<
  'PONG',
  Grid9PongPayload
>;

export type Grid9PrivateServerEvent =
  | Grid9WelcomeEvent
  | Grid9QueueStatusEvent
  | Grid9MatchAssignedEvent
  | Grid9PrivateRoomStatusEvent
  | Grid9StateSnapshotEvent
  | Grid9EscrowUpdatedEvent
  | Grid9IntentCommittedEvent
  | Grid9IntentRejectedEvent
  | Grid9ResyncRequiredEvent
  | Grid9PongEvent;

export type Grid9RoomServerEvent =
  | Grid9WeaponResolvedEvent
  | Grid9ShieldResolvedEvent
  | Grid9MercenaryFundedEvent
  | Grid9ArsenalGrantedEvent
  | Grid9TurnAdvancedEvent
  | Grid9TurnTickEvent
  | Grid9RouletteStartEvent
  | Grid9RouletteLandEvent
  | Grid9MicroDropResolvedEvent
  | Grid9PlayerConnectionChangedEvent
  | Grid9PlayerEliminatedEvent
  | Grid9JackpotChangedEvent
  | Grid9MatchCompletedEvent;

export type Grid9ServerEvent =
  | Grid9PrivateServerEvent
  | Grid9RoomServerEvent;

export type Grid9WireMessage = Grid9ClientIntent | Grid9ServerEvent;
