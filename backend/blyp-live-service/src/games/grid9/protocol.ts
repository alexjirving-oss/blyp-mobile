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
import type { Grid9PublicActionActor } from './players';

export type Grid9ClientIntentType =
  | 'QUEUE_JOIN'
  | 'QUEUE_LEAVE'
  | 'MATCH_JOIN'
  | 'RESERVE_COINS'
  | 'FIRE_WEAPON'
  | 'PURCHASE_SHIELD'
  | 'FUND_MERCENARY'
  | 'REQUEST_SNAPSHOT'
  | 'PING';

export type Grid9ServerEventType =
  | 'WELCOME'
  | 'QUEUE_STATUS'
  | 'MATCH_ASSIGNED'
  | 'STATE_SNAPSHOT'
  | 'ESCROW_UPDATED'
  | 'INTENT_COMMITTED'
  | 'WEAPON_RESOLVED'
  | 'SHIELD_RESOLVED'
  | 'MERCENARY_FUNDED'
  | 'TURN_ADVANCED'
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
  protocolVersion: 1;
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

export interface Grid9RequestSnapshotPayload {
  lastSeenStateVersion: number | null;
  lastSeenSequence: number | null;
}

export interface Grid9PingPayload {
  clientTime: string;
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
export type Grid9RequestSnapshotIntent = Grid9MatchAdmissionIntentEnvelope<
  'REQUEST_SNAPSHOT',
  Grid9RequestSnapshotPayload
>;
export type Grid9PingIntent = Grid9ConnectionIntentEnvelope<'PING', Grid9PingPayload>;

export type Grid9ClientIntent =
  | Grid9QueueJoinIntent
  | Grid9QueueLeaveIntent
  | Grid9MatchJoinIntent
  | Grid9ReserveCoinsIntent
  | Grid9FireWeaponIntent
  | Grid9PurchaseShieldIntent
  | Grid9FundMercenaryIntent
  | Grid9RequestSnapshotIntent
  | Grid9PingIntent;

export interface Grid9WelcomePayload {
  connectionId: string;
  connectionSessionId: string;
  serverTime: string;
  minimumProtocolVersion: 1;
  nonceTtlSeconds: number;
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
}

export interface Grid9ShieldResolvedPayload {
  actor: Grid9PublicActionActor;
  beneficiarySlotIndex: Grid9SlotIndex;
  shieldId: Grid9ShieldId;
  shieldBefore: number;
  shieldAfter: number;
  receipt: Grid9PublicPurchaseReceipt;
  jackpotCoins: number;
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

export interface Grid9TurnAdvancedPayload {
  previousTurnNumber: number;
  turn: Grid9TurnState;
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
export type Grid9TurnAdvancedEvent = Grid9RoomServerEventEnvelope<
  'TURN_ADVANCED',
  Grid9TurnAdvancedPayload
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
  | Grid9TurnAdvancedEvent
  | Grid9MicroDropResolvedEvent
  | Grid9PlayerConnectionChangedEvent
  | Grid9PlayerEliminatedEvent
  | Grid9JackpotChangedEvent
  | Grid9MatchCompletedEvent;

export type Grid9ServerEvent =
  | Grid9PrivateServerEvent
  | Grid9RoomServerEvent;

export type Grid9WireMessage = Grid9ClientIntent | Grid9ServerEvent;
