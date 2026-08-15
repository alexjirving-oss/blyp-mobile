import type { Grid9ShieldId, Grid9WeaponId } from './catalog';
import type { Grid9SlotIndex } from './constants';
import type { Grid9SettlementState } from './ledger';
import type {
  Grid9ActionActor,
  Grid9Player,
  Grid9PublicActionActor,
  Grid9PublicPlayer,
} from './players';

export type Grid9MatchPhase =
  | 'initializing'
  | 'lobby'
  | 'countdown'
  | 'combat'
  | 'settling'
  | 'completed'
  | 'cancelled';

export type Grid9MatchEndReason =
  | 'last_box_standing'
  | 'max_duration_health_tiebreak'
  | 'operator_cancelled'
  | 'system_cancelled';

export type Grid9PlayerSlots = [
  Grid9Player,
  Grid9Player,
  Grid9Player,
  Grid9Player,
  Grid9Player,
  Grid9Player,
  Grid9Player,
  Grid9Player,
  Grid9Player,
];

export type Grid9PublicPlayerSlots = [
  Grid9PublicPlayer,
  Grid9PublicPlayer,
  Grid9PublicPlayer,
  Grid9PublicPlayer,
  Grid9PublicPlayer,
  Grid9PublicPlayer,
  Grid9PublicPlayer,
  Grid9PublicPlayer,
  Grid9PublicPlayer,
];

export type Grid9MicroDropReward =
  | {
      kind: 'coins';
      amountCoins: number;
      ledgerEntryId: string;
    }
  | {
      kind: 'shield';
      shieldPoints: number;
    };

export interface Grid9MicroDropResult {
  dropId: string;
  turnNumber: number;
  recipientSlotIndex: Grid9SlotIndex;
  reward: Grid9MicroDropReward;
  entropyDigest: string;
  awardedAt: string;
}

export interface Grid9TurnState {
  turnNumber: number;
  spotlightSlotIndex: Grid9SlotIndex;
  startedAt: string;
  spotlightEndsAt: string;
  endsAt: string;
  microDropAwarded: boolean;
}

export interface Grid9JackpotState {
  currency: 'coins';
  openingRolloverCoins: number;
  openingRolloverClaimId: string | null;
  openingRolloverFenceToken: number | null;
  openingRolloverClaimStatus: 'none' | 'reserved' | 'consumed';
  purchaseContributionCoins: number;
  currentCoins: number;
  status: 'growing' | 'payout_pending' | 'paid' | 'rollover_pending' | 'rolled_over';
  rolloverSourceMatchId: string | null;
  rolloverDestinationMatchId: string | null;
  winnerSlotIndex: Grid9SlotIndex | null;
  winnerUserId: string | null;
  winnerSentinelId: string | null;
  sponsorPassRecipientUserId: string | null;
}

export interface Grid9PublicJackpotState {
  currency: 'coins';
  openingRolloverCoins: number;
  purchaseContributionCoins: number;
  currentCoins: number;
  status: Grid9JackpotState['status'];
  rolloverSourceMatchId: string | null;
  rolloverDestinationMatchId: string | null;
  winnerSlotIndex: Grid9SlotIndex | null;
  winnerPublicProfileId: string | null;
  winnerSentinelId: string | null;
  sponsorPassRecipientPublicProfileId: string | null;
}

export interface Grid9SponsorPassAward {
  passId: string;
  userId: string;
  publicProfileId: string;
  displayName: string;
  region: string;
  sourceMatchId: string;
  sponsoredSentinelId: string;
  contributedCoins: number;
  issuedAt: string;
  expiresAt: string;
}

export type Grid9PublicSponsorPassAward = Omit<
  Grid9SponsorPassAward,
  'passId' | 'userId'
>;

export interface Grid9MatchOutcome {
  reason: Grid9MatchEndReason;
  winnerSlotIndex: Grid9SlotIndex | null;
  winnerKind: 'human' | 'sentinel' | null;
  winnerUserId: string | null;
  winnerSentinelId: string | null;
  jackpotCoins: number;
  sponsorPass: Grid9SponsorPassAward | null;
  entropyReveal: string;
  concludedAt: string;
}

export interface Grid9PublicMatchOutcome {
  reason: Grid9MatchEndReason;
  winnerSlotIndex: Grid9SlotIndex | null;
  winnerKind: 'human' | 'sentinel' | null;
  winnerPublicProfileId: string | null;
  winnerDisplayName: string | null;
  winnerSentinelId: string | null;
  jackpotCoins: number;
  sponsorPass: Grid9PublicSponsorPassAward | null;
  entropyReveal: string;
  concludedAt: string;
}

export interface Grid9ActionSummary {
  intentId: string | null;
  serverOperationId: string | null;
  actor: Grid9PublicActionActor;
  kind: 'weapon' | 'shield' | 'mercenary_funding';
  weaponId: Grid9WeaponId | null;
  shieldId: Grid9ShieldId | null;
  targetSlotIndex: Grid9SlotIndex;
  affectedSlotIndices: Grid9SlotIndex[];
  ledgerEntryId: string;
  committedAt: string;
}

export interface Grid9RulesSnapshot {
  rulesVersion: string;
  slotCount: 9;
  maxHealth: number;
  maxShieldPoints: number;
  sentinelFillDelayMs: number;
  countdownMs: number;
  turnDurationMs: number;
  spotlightDurationMs: number;
  maxMatchDurationMs: number;
  microDropCoinReward: number;
  microDropShieldReward: number;
  minEscrowReserveCoins: number;
  maxEscrowReserveCoins: number;
  minMercenaryFundCoins: number;
  maxMercenaryFundCoins: number;
}

export interface Grid9ActionCooldown {
  actorKey: string;
  actor: Grid9ActionActor;
  itemId: Grid9WeaponId | Grid9ShieldId;
  readyAt: string;
}

export interface Grid9AuthorityState {
  stateVersion: number;
  eventSequence: number;
  entropySeed: string;
  entropyCommitment: string;
  nextTurnAt: string | null;
  matchDeadlineAt: string;
  cooldowns: Record<string, Grid9ActionCooldown>;
  proxyNextActionAt: Record<string, string>;
  mutationCount: number;
  lastMutationAt: string;
}

export interface Grid9GameState {
  schemaVersion: 1;
  game: 'grid9';
  matchId: string;
  liveSessionId: string;
  region: string;
  phase: Grid9MatchPhase;
  phaseStartedAt: string;
  phaseEndsAt: string | null;
  players: Grid9PlayerSlots;
  audienceCount: number;
  turn: Grid9TurnState | null;
  lastMicroDrop: Grid9MicroDropResult | null;
  lastAction: Grid9ActionSummary | null;
  jackpot: Grid9JackpotState;
  outcome: Grid9MatchOutcome | null;
  settlement: Grid9SettlementState;
  rules: Grid9RulesSnapshot;
  authority: Grid9AuthorityState;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface Grid9PublicGameState {
  schemaVersion: 1;
  game: 'grid9';
  matchId: string;
  liveSessionId: string;
  phase: Grid9MatchPhase;
  phaseStartedAt: string;
  phaseEndsAt: string | null;
  stateVersion: number;
  eventSequence: number;
  entropyCommitment: string;
  players: Grid9PublicPlayerSlots;
  audienceCount: number;
  turn: Grid9TurnState | null;
  lastMicroDrop: Grid9MicroDropResult | null;
  lastAction: Grid9ActionSummary | null;
  jackpot: Grid9PublicJackpotState;
  outcome: Grid9PublicMatchOutcome | null;
  rules: Grid9RulesSnapshot;
  serverTime: string;
}

export interface Grid9QueueEntry {
  schemaVersion: 1;
  ticketId: string;
  userId: string;
  publicProfileId: string;
  displayName: string;
  avatarUrl: string | null;
  connectionSessionId: string;
  region: string;
  sponsorPassId: string | null;
  priority: 'sponsor_pass' | 'standard';
  enqueuedAt: string;
  expiresAt: string;
}

export interface Grid9SponsorPass {
  schemaVersion: 1;
  passId: string;
  userId: string;
  region: string;
  sourceMatchId: string;
  sponsoredSentinelId: string;
  status: 'available' | 'reserved' | 'consumed' | 'expired';
  issuedAt: string;
  expiresAt: string;
  reservedForTicketId: string | null;
  consumedByMatchId: string | null;
}

export interface Grid9RolloverPool {
  schemaVersion: 1;
  region: string;
  availableCoins: number;
  reservedCoins: number;
  sourceMatchId: string;
  status: 'available' | 'reserved';
  reservedByClaimId: string | null;
  reservedForMatchId: string | null;
  reservedAt: string | null;
  version: number;
  updatedAt: string;
}

export interface Grid9RolloverClaim {
  schemaVersion: 1;
  claimId: string;
  idempotencyKey: string;
  region: string;
  sourceMatchId: string;
  targetMatchId: string;
  coins: number;
  fenceToken: number;
  leaseExpiresAt: string;
  status: 'reserved' | 'consumed' | 'released';
  reservedAt: string;
  consumedAt: string | null;
  releasedAt: string | null;
}
