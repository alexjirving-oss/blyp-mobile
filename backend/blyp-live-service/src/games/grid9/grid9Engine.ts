import { randomBytes, randomUUID } from 'crypto';
import {
  GRID9_COUNTDOWN_MS,
  GRID9_HOUSE_SEED_COINS,
  GRID9_INVENTORY_CAPACITY,
  GRID9_MATCH_TTL_SECONDS,
  GRID9_MAX_HEALTH,
  GRID9_MAX_MATCH_DURATION_MS,
  GRID9_MAX_MERCENARY_FUND_COINS,
  GRID9_MAX_SHIELD_POINTS,
  GRID9_MICRO_DROP_COIN_REWARD,
  GRID9_MICRO_DROP_SHIELD_REWARD,
  GRID9_MIN_MERCENARY_FUND_COINS,
  GRID9_PUBLIC_LOBBY_MS,
  GRID9_ROULETTE_DURATION_MS,
  GRID9_RULES_VERSION,
  GRID9_SENTINEL_FILL_DELAY_MS,
  GRID9_SLOT_INDICES,
  GRID9_SPONSOR_PASS_TTL_SECONDS,
  GRID9_SPOTLIGHT_DURATION_MS,
  GRID9_TOP_SUPPORTERS_PER_SLOT,
  GRID9_TURN_DURATION_MS,
  grid9EntropyCommitment,
  splitGrid9AudienceGiftCoins,
  type Grid9SlotIndex,
} from './constants';
import {
  GRID9_MAX_ESCROW_RESERVE_COINS,
  GRID9_MIN_ESCROW_RESERVE_COINS,
} from './constants';
import {
  GRID9_ARSENAL_CATALOG,
  GRID9_SHIELD_CATALOG,
  GRID9_WEAPON_CATALOG,
  type Grid9ArsenalItemId,
  type Grid9ShieldId,
  type Grid9Weapon,
  type Grid9WeaponId,
} from './catalog';
import {
  allocateGrid9Damage,
  grid9AllAdjacentNeighbors,
  grid9OrthogonalNeighbors,
} from './gridMath';
import {
  allocateGrid9MercenarySpend,
  type Grid9MercenarySpendAllocation,
} from './ledger';
import { deriveGrid9FreeDrop, deriveGrid9MicroDrop, deriveGrid9RouletteSlot } from './entropy';
import { Grid9Error } from './grid9Errors';
import { createGrid9Sentinel } from './grid9Sentinels';
import {
  grid9ActionActorKey,
  type Grid9ActionActor,
  type Grid9Eliminator,
  type Grid9HumanPlayer,
  type Grid9Player,
  type Grid9PublicActionActor,
  type Grid9SupporterSummary,
} from './players';
import { parseGrid9GameState } from './schemas';
import type {
  Grid9ActionSummary,
  Grid9GameState,
  Grid9MatchEndReason,
  Grid9MatchOutcome,
  Grid9PlayerSlots,
  Grid9RoomMode,
  Grid9SponsorPassAward,
  Grid9TurnState,
} from './state';
import type { Grid9DamageResult } from './protocol';

export interface Grid9Identity {
  userId: string;
  publicProfileId: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface Grid9HumanSeed extends Grid9Identity {
  queueTicketId: string;
  sponsorPassId: string | null;
}

export interface Grid9OpeningRollover {
  coins: number;
  claimId: string;
  fenceToken: number;
  sourceMatchId: string;
  claimStatus?: 'reserved' | 'consumed';
}

export interface Grid9WeaponResolution {
  state: Grid9GameState;
  damage: Grid9DamageResult[];
  sourceSlotIndex: Grid9SlotIndex | null;
  eliminatedSlotIndices: Grid9SlotIndex[];
  mercenarySpend: Grid9MercenarySpendAllocation | null;
  completed: boolean;
  /** Authoritative source inventory after inventory/free/escrow fire (clients patch without snapshot). */
  inventoryAfter: Grid9ArsenalItemId[];
}

export interface Grid9FundingResolution {
  state: Grid9GameState;
  sponsorSlotIndex: Grid9SlotIndex;
  bankrollBefore: number;
  bankrollAfter: number;
}

export interface Grid9ShieldResolution {
  state: Grid9GameState;
  beneficiarySlotIndex: Grid9SlotIndex;
  sourceSlotIndex: Grid9SlotIndex | null;
  shieldBefore: number;
  shieldAfter: number;
  completed: boolean;
  /** Authoritative source inventory after inventory/free/escrow shield (clients patch without snapshot). */
  inventoryAfter: Grid9ArsenalItemId[];
}

export interface Grid9MicroDropResolution {
  state: Grid9GameState;
  humanCoinCredit:
    | { userId: string; amountCoins: number; ledgerEntryId: string }
    | null;
}

export interface Grid9ArsenalGrantResolution {
  state: Grid9GameState;
  recipientSlotIndex: Grid9SlotIndex;
  itemId: Grid9ArsenalItemId;
  costCoins: number;
  seatCoins: number;
  jackpotCoins: number;
  inventoryAfter: Grid9ArsenalItemId[];
  droppedItemId: Grid9ArsenalItemId | null;
  selfBuy: boolean;
}

export interface Grid9KickResolution {
  state: Grid9GameState;
  kickedSlotIndex: Grid9SlotIndex;
  targetUserId: string;
  wasSpotlight: boolean;
}

type WeaponPayment =
  | { kind: 'actor_escrow' }
  | { kind: 'mercenary_bankroll'; sourceSlotIndex: Grid9SlotIndex }
  | { kind: 'inventory' }
  | { kind: 'free_drop' };

function requireActiveCombatantTurn(
  state: Grid9GameState,
  actor: Grid9ActionActor,
  sourceSlotIndex: Grid9SlotIndex | null,
): void {
  if (actor.kind === 'audience') {
    throw new Grid9Error(
      'NOT_ELIGIBLE',
      'Audience cannot fire arsenal; send weapon gifts instead',
      { stateVersion: state.authority.stateVersion },
    );
  }
  if (actor.kind !== 'human_player') return;
  if (
    !state.turn ||
    sourceSlotIndex === null ||
    sourceSlotIndex !== state.turn.spotlightSlotIndex
  ) {
    throw new Grid9Error('NOT_ELIGIBLE', 'Only the active combatant may act', {
      stateVersion: state.authority.stateVersion,
    });
  }
}

/**
 * Inventory overflow policy (locked): FIFO drop oldest when at capacity.
 * Gifted/bought items always land; oldest stock is discarded.
 */
export function grantGrid9InventoryItem(
  inventory: readonly Grid9ArsenalItemId[],
  itemId: Grid9ArsenalItemId,
  capacity = GRID9_INVENTORY_CAPACITY,
): { inventory: Grid9ArsenalItemId[]; droppedItemId: Grid9ArsenalItemId | null } {
  const next = [...inventory, itemId];
  if (next.length <= capacity) {
    return { inventory: next, droppedItemId: null };
  }
  return {
    inventory: next.slice(next.length - capacity),
    droppedItemId: next[0] ?? null,
  };
}

function requireGiftMatchActive(state: Grid9GameState): void {
  if (
    state.phase === 'initializing' ||
    state.phase === 'settling' ||
    state.phase === 'completed' ||
    state.phase === 'cancelled'
  ) {
    throw new Grid9Error('MATCH_NOT_ACTIVE', 'Match is not open for arsenal gifts', {
      stateVersion: state.authority.stateVersion,
    });
  }
}

function creditSeatBankrollAndSupporters(args: {
  beneficiary: Grid9Player;
  seatCoins: number;
  sponsor: Grid9Identity;
  now: string;
}): void {
  if (args.seatCoins <= 0) return;
  args.beneficiary.mercenarySponsorCoins += args.seatCoins;
  args.beneficiary.mercenaryBankrollCoins += args.seatCoins;
  args.beneficiary.supporterTotalCoins += args.seatCoins;
  args.beneficiary.stats.mercenaryCoinsReceived += args.seatCoins;
  const existing = args.beneficiary.topSupporters.find(
    (supporter) => supporter.userId === args.sponsor.userId,
  );
  if (existing) {
    existing.contributedCoins += args.seatCoins;
    existing.lastFundedAt = args.now;
  } else {
    args.beneficiary.topSupporters.push({
      userId: args.sponsor.userId,
      publicProfileId: args.sponsor.publicProfileId,
      displayName: args.sponsor.displayName,
      contributedCoins: args.seatCoins,
      firstFundedAt: args.now,
      lastFundedAt: args.now,
    });
  }
  args.beneficiary.topSupporters = args.beneficiary.topSupporters
    .sort(
      (left, right) =>
        right.contributedCoins - left.contributedCoins ||
        left.firstFundedAt.localeCompare(right.firstFundedAt) ||
        left.userId.localeCompare(right.userId),
    )
    .slice(0, GRID9_TOP_SUPPORTERS_PER_SLOT);
}

export function resolveGrid9ItemFunding(args: {
  state: Grid9GameState;
  sourceSlotIndex: Grid9SlotIndex | null;
  itemId: string;
}): WeaponPayment {
  if (args.sourceSlotIndex === null || !args.state.turn) {
    return { kind: 'actor_escrow' };
  }
  const player = args.state.players[args.sourceSlotIndex];
  if (!player) return { kind: 'actor_escrow' };
  if (player.inventory.includes(args.itemId as never)) {
    return { kind: 'inventory' };
  }
  if (
    args.state.turn.freeDropEquipped &&
    args.state.turn.freeDropItemId === args.itemId
  ) {
    return { kind: 'free_drop' };
  }
  return { kind: 'actor_escrow' };
}

function cloneState(state: Grid9GameState): Grid9GameState {
  return JSON.parse(JSON.stringify(state)) as Grid9GameState;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function emptyStats() {
  return {
    attacksPurchased: 0,
    shieldsPurchased: 0,
    damageDealt: 0,
    damageReceived: 0,
    coinsSpent: 0,
    mercenaryCoinsReceived: 0,
    microDropsReceived: 0,
  };
}

function createHuman(
  matchId: string,
  liveSessionId: string,
  seed: Grid9HumanSeed,
  slotIndex: Grid9SlotIndex,
  joinedAt: string,
): Grid9HumanPlayer {
  return {
    slotId: randomUUID(),
    slotIndex,
    kind: 'human',
    userId: seed.userId,
    publicProfileId: seed.publicProfileId,
    displayName: seed.displayName,
    avatarUrl: seed.avatarUrl,
    feed: {
      kind: 'human_live',
      provider: 'livekit',
      streamId: liveSessionId || matchId,
      participantId: seed.userId,
    },
    status: 'alive',
    mode: 'combatant',
    connectionState: 'reconnecting',
    health: GRID9_MAX_HEALTH,
    maxHealth: GRID9_MAX_HEALTH,
    shieldPoints: 0,
    maxShieldPoints: GRID9_MAX_SHIELD_POINTS,
    inventory: [],
    mercenaryBankrollCoins: 0,
    mercenarySponsorCoins: 0,
    mercenaryMicroDropCoins: 0,
    supporterTotalCoins: 0,
    topSupporters: [],
    stats: emptyStats(),
    joinedAt,
    eliminatedAt: null,
    eliminatedBy: null,
    lastDamagedAt: null,
    queueTicketId: seed.queueTicketId,
    sponsorPassId: seed.sponsorPassId,
  };
}

export function createGrid9Match(args: {
  matchId?: string;
  liveSessionId?: string;
  region: string;
  humans: Grid9HumanSeed[];
  openingRollover?: Grid9OpeningRollover | null;
  roomMode?: Grid9RoomMode;
  ownerUserId?: string | null;
  roomCode?: string | null;
  houseSeedCoins?: number;
  nowMs?: number;
}): Grid9GameState {
  if (args.humans.length < 1 || args.humans.length > 9) {
    throw new RangeError('Grid 9 match creation requires 1 to 9 humans');
  }
  const uniqueUsers = new Set(args.humans.map((human) => human.userId));
  if (uniqueUsers.size !== args.humans.length) {
    throw new RangeError('Grid 9 match humans must be unique');
  }
  const nowMs = args.nowMs ?? Date.now();
  const now = iso(nowMs);
  const matchId = args.matchId ?? randomUUID();
  const liveSessionId = args.liveSessionId ?? matchId;
  const roomMode: Grid9RoomMode = args.roomMode ?? 'public';
  const houseSeedCoins =
    args.houseSeedCoins ??
    (roomMode === 'public' ? GRID9_HOUSE_SEED_COINS : 0);
  const players = GRID9_SLOT_INDICES.map((slotIndex) => {
    const human = args.humans[slotIndex];
    return human
      ? createHuman(matchId, liveSessionId, human, slotIndex, now)
      : createGrid9Sentinel(matchId, slotIndex, now);
  }) as Grid9PlayerSlots;
  const entropySeed = randomBytes(32).toString('base64url');
  const lobbyEndsMs = nowMs + GRID9_PUBLIC_LOBBY_MS;
  const rollover = args.openingRollover ?? null;
  const initializing = rollover?.claimStatus === 'reserved';
  const openingRolloverCoins = rollover?.coins ?? 0;
  const ownerUserId =
    args.ownerUserId ??
    (roomMode === 'private' ? args.humans[0]?.userId ?? null : null);
  const phase = initializing
    ? 'initializing'
    : roomMode === 'private'
      ? 'private_lobby'
      : 'lobby_waiting';
  const phaseEndsAt =
    initializing || roomMode === 'private' ? null : iso(lobbyEndsMs);
  const state: Grid9GameState = {
    schemaVersion: 1,
    game: 'grid9',
    matchId,
    liveSessionId,
    region: args.region,
    roomMode,
    ownerUserId,
    roomCode: args.roomCode ?? null,
    phase,
    phaseStartedAt: now,
    phaseEndsAt,
    players,
    audienceCount: 0,
    turn: null,
    roulette: null,
    lastMicroDrop: null,
    lastAction: null,
    jackpot: {
      currency: 'coins',
      openingRolloverCoins,
      houseSeedCoins,
      openingRolloverClaimId: rollover?.claimId ?? null,
      openingRolloverFenceToken: rollover?.fenceToken ?? null,
      openingRolloverClaimStatus: rollover
        ? rollover.claimStatus ?? 'consumed'
        : 'none',
      purchaseContributionCoins: 0,
      currentCoins: openingRolloverCoins + houseSeedCoins,
      status: 'growing',
      rolloverSourceMatchId: rollover?.sourceMatchId ?? null,
      rolloverDestinationMatchId: null,
      winnerSlotIndex: null,
      winnerUserId: null,
      winnerSentinelId: null,
      sponsorPassRecipientUserId: null,
    },
    outcome: null,
    settlement: {
      status: 'not_started',
      settlementId: null,
      winnerPayoutCoins: 0,
      rolloverCoins: 0,
      escrowReleaseCoins: 0,
      attemptCount: 0,
      lastAttemptAt: null,
      completedAt: null,
      errorCode: null,
    },
    rules: {
      rulesVersion: GRID9_RULES_VERSION,
      slotCount: 9,
      maxHealth: GRID9_MAX_HEALTH,
      maxShieldPoints: GRID9_MAX_SHIELD_POINTS,
      sentinelFillDelayMs: GRID9_SENTINEL_FILL_DELAY_MS,
      countdownMs: GRID9_COUNTDOWN_MS,
      publicLobbyMs: GRID9_PUBLIC_LOBBY_MS,
      rouletteDurationMs: GRID9_ROULETTE_DURATION_MS,
      turnDurationMs: GRID9_TURN_DURATION_MS,
      spotlightDurationMs: GRID9_SPOTLIGHT_DURATION_MS,
      maxMatchDurationMs: GRID9_MAX_MATCH_DURATION_MS,
      houseSeedCoins,
      inventoryCapacity: GRID9_INVENTORY_CAPACITY,
      microDropCoinReward: GRID9_MICRO_DROP_COIN_REWARD,
      microDropShieldReward: GRID9_MICRO_DROP_SHIELD_REWARD,
      minEscrowReserveCoins: GRID9_MIN_ESCROW_RESERVE_COINS,
      maxEscrowReserveCoins: GRID9_MAX_ESCROW_RESERVE_COINS,
      minMercenaryFundCoins: GRID9_MIN_MERCENARY_FUND_COINS,
      maxMercenaryFundCoins: GRID9_MAX_MERCENARY_FUND_COINS,
    },
    authority: {
      stateVersion: 1,
      eventSequence: 0,
      entropySeed,
      entropyCommitment: grid9EntropyCommitment(matchId, entropySeed),
      nextTurnAt: phaseEndsAt,
      matchDeadlineAt: iso(
        (phaseEndsAt ? lobbyEndsMs : nowMs) + GRID9_MAX_MATCH_DURATION_MS,
      ),
      cooldowns: {},
      proxyNextActionAt: {},
      mutationCount: 0,
      lastMutationAt: now,
    },
    createdAt: now,
    updatedAt: now,
    expiresAt: iso(nowMs + GRID9_MATCH_TTL_SECONDS * 1000),
  };
  return parseGrid9GameState(state);
}

function survivingPlayers(state: Grid9GameState): Grid9Player[] {
  return state.players.filter((player) => player.status === 'alive');
}

function nextSurvivingSlot(
  state: Grid9GameState,
  afterSlot: Grid9SlotIndex,
): Grid9SlotIndex {
  for (let offset = 1; offset <= 9; offset += 1) {
    const slotIndex = ((afterSlot + offset) % 9) as Grid9SlotIndex;
    if (state.players[slotIndex].status === 'alive') return slotIndex;
  }
  return afterSlot;
}

function publicActor(actor: Grid9ActionActor): Grid9PublicActionActor {
  if (actor.kind === 'sentinel') {
    return {
      kind: 'sentinel',
      sentinelId: actor.sentinelId,
      displayName: actor.displayName,
    };
  }
  if (actor.kind === 'mercenary_proxy') {
    return {
      kind: 'mercenary_proxy',
      sourceSlotIndex: actor.sourceSlotIndex,
      displayName: actor.displayName,
    };
  }
  return {
    kind: actor.kind,
    publicProfileId: actor.publicProfileId,
    displayName: actor.displayName,
  };
}

function eliminatorForActor(
  state: Grid9GameState,
  actor: Grid9ActionActor,
): Grid9Eliminator | null {
  if (actor.kind === 'human_player' || actor.kind === 'audience') {
    return {
      kind: 'human',
      userId: actor.userId,
      publicProfileId: actor.publicProfileId,
      displayName: actor.displayName,
    };
  }
  if (actor.kind === 'sentinel') {
    return {
      kind: 'sentinel',
      sentinelId: actor.sentinelId,
      displayName: actor.displayName,
    };
  }
  const source = state.players[actor.sourceSlotIndex];
  if (source.kind === 'sentinel') {
    return {
      kind: 'sentinel',
      sentinelId: source.sentinelId,
      displayName: source.displayName,
    };
  }
  return {
    kind: 'human',
    userId: source.userId,
    publicProfileId: source.publicProfileId,
    displayName: source.displayName,
  };
}

export function resolveGrid9Actor(
  state: Grid9GameState,
  identity: Grid9Identity,
): { actor: Grid9ActionActor; sourceSlotIndex: Grid9SlotIndex | null } {
  const human = state.players.find(
    (player): player is Grid9HumanPlayer =>
      player.kind === 'human' && player.userId === identity.userId,
  );
  if (!human) {
    return {
      actor: {
        kind: 'audience',
        userId: identity.userId,
        publicProfileId: identity.publicProfileId,
        displayName: identity.displayName,
      },
      sourceSlotIndex: null,
    };
  }
  return {
    actor: {
      kind: 'human_player',
      userId: human.userId,
      publicProfileId: human.publicProfileId,
      displayName: human.displayName,
    },
    sourceSlotIndex: human.slotIndex,
  };
}

function requireCombat(state: Grid9GameState): void {
  if (state.phase !== 'combat') {
    throw new Grid9Error('MATCH_NOT_ACTIVE', 'Grid 9 match is not in combat', {
      stateVersion: state.authority.stateVersion,
    });
  }
}

function requireActorEligible(
  state: Grid9GameState,
  actor: Grid9ActionActor,
): void {
  if (actor.kind !== 'human_player') return;
  const player = state.players.find(
    (candidate) =>
      candidate.kind === 'human' && candidate.userId === actor.userId,
  );
  if (!player || player.status !== 'alive' || player.mode !== 'combatant') {
    throw new Grid9Error(
      'NOT_ELIGIBLE',
      'Eliminated players must use Sabotage funding',
      { stateVersion: state.authority.stateVersion },
    );
  }
}

function affectedSlots(
  state: Grid9GameState,
  weapon: Grid9Weapon,
  targetSlotIndex: Grid9SlotIndex,
): Array<{ slotIndex: Grid9SlotIndex; rawDamage: number }> {
  const slots: Array<{ slotIndex: Grid9SlotIndex; rawDamage: number }> = [
    { slotIndex: targetSlotIndex, rawDamage: weapon.directDamage },
  ];
  const neighbors =
    weapon.splashPattern === 'orthogonal'
      ? grid9OrthogonalNeighbors(targetSlotIndex)
      : weapon.splashPattern === 'all_adjacent'
        ? grid9AllAdjacentNeighbors(targetSlotIndex)
        : [];
  for (const slotIndex of neighbors) {
    if (state.players[slotIndex].status === 'alive') {
      slots.push({ slotIndex, rawDamage: weapon.adjacentDamage });
    }
  }
  return slots;
}

function lastStandCandidate(state: Grid9GameState): Grid9Player {
  return survivingPlayers(state)
    .slice()
    .sort(
      (left, right) =>
        right.health +
          right.shieldPoints -
          (left.health + left.shieldPoints) ||
        right.health - left.health ||
        right.stats.damageDealt - left.stats.damageDealt ||
        left.slotIndex - right.slotIndex,
    )[0];
}

function mutationDone(
  state: Grid9GameState,
  previous: Grid9GameState,
  now: string,
  roomEventCount: number,
): Grid9GameState {
  state.authority.stateVersion = previous.authority.stateVersion + 1;
  state.authority.eventSequence =
    previous.authority.eventSequence + roomEventCount;
  state.authority.mutationCount = previous.authority.mutationCount + 1;
  state.authority.lastMutationAt = now;
  state.updatedAt = now;
  return parseGrid9GameState(state);
}

function winnerAtDeadline(state: Grid9GameState): Grid9Player | null {
  return survivingPlayers(state)
    .slice()
    .sort(
      (left, right) =>
        right.health +
          right.shieldPoints -
          (left.health + left.shieldPoints) ||
        right.health - left.health ||
        right.stats.damageDealt - left.stats.damageDealt ||
        left.slotIndex - right.slotIndex,
    )[0] ?? null;
}

function completeMatchInPlace(
  state: Grid9GameState,
  winner: Grid9Player | null,
  reason: Grid9MatchEndReason,
  nowMs: number,
): Grid9MatchOutcome {
  const concludedAt = iso(nowMs);
  let sponsorPass: Grid9SponsorPassAward | null = null;
  if (winner?.kind === 'sentinel' && winner.topSupporters.length > 0) {
    const supporter = winner.topSupporters
      .slice()
      .sort(
        (left, right) =>
          right.contributedCoins - left.contributedCoins ||
          left.firstFundedAt.localeCompare(right.firstFundedAt) ||
          left.userId.localeCompare(right.userId),
      )[0];
    sponsorPass = {
      passId: randomUUID(),
      userId: supporter.userId,
      publicProfileId: supporter.publicProfileId,
      displayName: supporter.displayName,
      region: state.region,
      sourceMatchId: state.matchId,
      sponsoredSentinelId: winner.sentinelId,
      contributedCoins: supporter.contributedCoins,
      issuedAt: concludedAt,
      expiresAt: iso(nowMs + GRID9_SPONSOR_PASS_TTL_SECONDS * 1000),
    };
  }
  const outcome: Grid9MatchOutcome = {
    reason,
    winnerSlotIndex: winner?.slotIndex ?? null,
    winnerKind: winner?.kind ?? null,
    winnerUserId: winner?.kind === 'human' ? winner.userId : null,
    winnerSentinelId:
      winner?.kind === 'sentinel' ? winner.sentinelId : null,
    jackpotCoins: state.jackpot.currentCoins,
    sponsorPass,
    entropyReveal: state.authority.entropySeed,
    concludedAt,
  };
  state.phase = 'completed';
  state.phaseStartedAt = concludedAt;
  state.phaseEndsAt = null;
  state.turn = null;
  state.roulette = null;
  state.outcome = outcome;
  state.authority.nextTurnAt = null;
  state.jackpot.winnerSlotIndex = winner?.slotIndex ?? null;
  state.jackpot.winnerUserId =
    winner?.kind === 'human' ? winner.userId : null;
  state.jackpot.winnerSentinelId =
    winner?.kind === 'sentinel' ? winner.sentinelId : null;
  state.jackpot.sponsorPassRecipientUserId = sponsorPass?.userId ?? null;
  state.jackpot.status =
    winner?.kind === 'human' ? 'payout_pending' : 'rollover_pending';
  state.settlement.status = 'pending';
  state.settlement.settlementId = randomUUID();
  state.settlement.winnerPayoutCoins =
    winner?.kind === 'human' ? state.jackpot.currentCoins : 0;
  state.settlement.rolloverCoins =
    winner?.kind === 'sentinel' || winner === null
      ? state.jackpot.currentCoins
      : 0;
  return outcome;
}

function maybeCompleteAfterDamage(
  state: Grid9GameState,
  nowMs: number,
): boolean {
  const survivors = survivingPlayers(state);
  if (survivors.length !== 1) return false;
  completeMatchInPlace(
    state,
    survivors[0],
    'last_box_standing',
    nowMs,
  );
  return true;
}

export function activateGrid9InitializedMatch(
  current: Grid9GameState,
  nowMs = Date.now(),
): Grid9GameState {
  if (current.phase !== 'initializing') {
    throw new Grid9Error(
      'INTENT_CONFLICT',
      'Grid 9 match is not awaiting rollover activation',
    );
  }
  const state = cloneState(current);
  const now = iso(nowMs);
  if (state.roomMode === 'private') {
    state.phase = 'private_lobby';
    state.phaseEndsAt = null;
    state.authority.nextTurnAt = null;
  } else {
    state.phase = 'lobby_waiting';
    state.phaseEndsAt = iso(nowMs + GRID9_PUBLIC_LOBBY_MS);
    state.authority.nextTurnAt = state.phaseEndsAt;
  }
  state.phaseStartedAt = now;
  if (state.jackpot.openingRolloverClaimStatus === 'reserved') {
    state.jackpot.openingRolloverClaimStatus = 'consumed';
  }
  return mutationDone(state, current, now, 0);
}

/** @deprecated Prefer startGrid9Roulette after lobby — kept for test helpers. */
export function beginGrid9Combat(
  current: Grid9GameState,
  nowMs = Date.now(),
): Grid9GameState {
  const fromLobby =
    current.phase === 'lobby_waiting' ||
    current.phase === 'countdown' ||
    current.phase === 'private_lobby';
  if (!fromLobby) {
    throw new Grid9Error('MATCH_NOT_ACTIVE', 'Grid 9 lobby is not active');
  }
  return landGrid9Roulette(startGrid9Roulette(current, nowMs), nowMs + GRID9_ROULETTE_DURATION_MS);
}

export function startGrid9Roulette(
  current: Grid9GameState,
  nowMs = Date.now(),
): Grid9GameState {
  const allowed =
    current.phase === 'lobby_waiting' ||
    current.phase === 'countdown' ||
    current.phase === 'private_lobby' ||
    current.phase === 'combat' ||
    current.phase === 'roulette';
  if (!allowed) {
    throw new Grid9Error('MATCH_NOT_ACTIVE', 'Grid 9 cannot start roulette');
  }
  const state = cloneState(current);
  const now = iso(nowMs);
  if (nowMs >= Date.parse(state.authority.matchDeadlineAt)) {
    completeMatchInPlace(
      state,
      winnerAtDeadline(state),
      'max_duration_health_tiebreak',
      nowMs,
    );
    return mutationDone(state, current, now, 1);
  }
  const survivors = survivingPlayers(state);
  if (survivors.length <= 1) {
    completeMatchInPlace(
      state,
      survivors[0] ?? null,
      'last_box_standing',
      nowMs,
    );
    return mutationDone(state, current, now, 1);
  }
  const turnNumber = (state.turn?.turnNumber ?? 0) + 1;
  const candidateSlotIndices = survivors.map(
    (player) => player.slotIndex,
  ) as Grid9SlotIndex[];
  const pick = deriveGrid9RouletteSlot({
    entropySeed: state.authority.entropySeed,
    matchId: state.matchId,
    turnNumber,
    candidateSlotIndices,
  });
  state.phase = 'roulette';
  state.phaseStartedAt = now;
  state.phaseEndsAt = iso(nowMs + GRID9_ROULETTE_DURATION_MS);
  state.turn = null;
  state.roulette = {
    turnNumber,
    candidateSlotIndices,
    selectedSlotIndex: pick.selectedSlotIndex,
    startedAt: now,
    endsAt: state.phaseEndsAt,
    entropyDigest: pick.digest,
  };
  state.authority.nextTurnAt = state.phaseEndsAt;
  if (!state.phaseEndsAt || Date.parse(state.authority.matchDeadlineAt) < nowMs) {
    state.authority.matchDeadlineAt = iso(nowMs + GRID9_MAX_MATCH_DURATION_MS);
  }
  return mutationDone(state, current, now, 1);
}

export function landGrid9Roulette(
  current: Grid9GameState,
  nowMs = Date.now(),
): Grid9GameState {
  if (current.phase !== 'roulette' || !current.roulette) {
    throw new Grid9Error('MATCH_NOT_ACTIVE', 'Grid 9 roulette is not active');
  }
  const state = cloneState(current);
  const now = iso(nowMs);
  const roulette = state.roulette!;
  const selected = state.players[roulette.selectedSlotIndex];
  if (!selected || selected.status !== 'alive') {
    return startGrid9Roulette(current, nowMs);
  }
  const drop = deriveGrid9FreeDrop({
    entropySeed: state.authority.entropySeed,
    matchId: state.matchId,
    turnNumber: roulette.turnNumber,
    slotIndex: roulette.selectedSlotIndex,
  });
  let freeDropEquipped = false;
  if (selected.inventory.length < GRID9_INVENTORY_CAPACITY) {
    selected.inventory = [...selected.inventory, drop.itemId];
  } else {
    freeDropEquipped = true;
  }
  state.phase = 'combat';
  state.phaseStartedAt = now;
  state.phaseEndsAt = state.authority.matchDeadlineAt;
  state.roulette = null;
  state.turn = {
    turnNumber: roulette.turnNumber,
    spotlightSlotIndex: roulette.selectedSlotIndex,
    startedAt: now,
    spotlightEndsAt: iso(nowMs + GRID9_TURN_DURATION_MS),
    endsAt: iso(nowMs + GRID9_TURN_DURATION_MS),
    microDropAwarded: true,
    attacksUsedThisTurn: 0,
    defensesUsedThisTurn: 0,
    freeDropItemId: drop.itemId,
    freeDropEquipped,
    autoResolved: false,
  };
  state.authority.nextTurnAt = state.turn.endsAt;
  return mutationDone(state, current, now, 1);
}

export function autoResolveGrid9Turn(
  current: Grid9GameState,
  nowMs = Date.now(),
): Grid9GameState {
  requireCombat(current);
  if (!current.turn) {
    throw new Grid9Error('INTERNAL_ERROR', 'Grid 9 turn is missing');
  }
  const state = cloneState(current);
  const turn = state.turn!;
  const actor = state.players[turn.spotlightSlotIndex];
  if (
    actor &&
    actor.status === 'alive' &&
    turn.defensesUsedThisTurn < 1
  ) {
    const before = actor.shieldPoints;
    actor.shieldPoints = Math.min(
      actor.maxShieldPoints,
      actor.shieldPoints + GRID9_SHIELD_CATALOG.basic_shield.shieldPoints,
    );
    turn.defensesUsedThisTurn = 1;
    if (actor.shieldPoints !== before) {
      actor.stats.shieldsPurchased += 1;
    }
  }
  turn.autoResolved = true;
  state.authority.nextTurnAt = iso(nowMs);
  return mutationDone(state, current, iso(nowMs), 0);
}

export function startPrivateMatchFromLobby(
  current: Grid9GameState,
  hostUserId: string,
  nowMs = Date.now(),
): Grid9GameState {
  if (current.phase !== 'private_lobby') {
    throw new Grid9Error('MATCH_NOT_ACTIVE', 'Private lobby is not active');
  }
  if (!current.ownerUserId || current.ownerUserId !== hostUserId) {
    throw new Grid9Error('NOT_ELIGIBLE', 'Only the room host can start');
  }
  return startGrid9Roulette(current, nowMs);
}

export function applyGrid9Weapon(args: {
  state: Grid9GameState;
  actor: Grid9ActionActor;
  sourceSlotIndex: Grid9SlotIndex | null;
  weaponId: Grid9WeaponId;
  targetSlotIndex: Grid9SlotIndex;
  intentId: string | null;
  serverOperationId: string | null;
  ledgerEntryId: string;
  payment: WeaponPayment;
  nowMs?: number;
}): Grid9WeaponResolution {
  const nowMs = args.nowMs ?? Date.now();
  const now = iso(nowMs);
  requireCombat(args.state);
  requireActorEligible(args.state, args.actor);
  requireActiveCombatantTurn(args.state, args.actor, args.sourceSlotIndex);
  const weapon = GRID9_WEAPON_CATALOG[args.weaponId];
  if (!weapon) throw new Grid9Error('ITEM_NOT_FOUND', 'Unknown Grid 9 weapon');
  const target = args.state.players[args.targetSlotIndex];
  if (!target || target.status !== 'alive') {
    throw new Grid9Error('TARGET_NOT_ALIVE', 'Target box is eliminated', {
      stateVersion: args.state.authority.stateVersion,
    });
  }
  if (
    args.sourceSlotIndex !== null &&
    args.sourceSlotIndex === args.targetSlotIndex
  ) {
    throw new Grid9Error('TARGET_SELF', 'A box cannot attack itself', {
      stateVersion: args.state.authority.stateVersion,
    });
  }
  const actorKey = grid9ActionActorKey(args.actor);
  const cooldownKey = `${actorKey}:${weapon.id}`;
  const cooldown = args.state.authority.cooldowns[cooldownKey];
  if (cooldown && Date.parse(cooldown.readyAt) > nowMs) {
    throw new Grid9Error('COOLDOWN_ACTIVE', 'Weapon is cooling down', {
      stateVersion: args.state.authority.stateVersion,
    });
  }
  if (
    (args.actor.kind === 'human_player' || args.actor.kind === 'sentinel') &&
    args.state.turn &&
    args.sourceSlotIndex === args.state.turn.spotlightSlotIndex &&
    args.state.turn.attacksUsedThisTurn >= 1
  ) {
    throw new Grid9Error('RATE_LIMITED', 'Only one attack per turn', {
      stateVersion: args.state.authority.stateVersion,
    });
  }

  const state = cloneState(args.state);
  let mercenarySpend: Grid9MercenarySpendAllocation | null = null;
  const isFree =
    args.payment.kind === 'inventory' || args.payment.kind === 'free_drop';
  if (args.payment.kind === 'mercenary_bankroll') {
    const payer = state.players[args.payment.sourceSlotIndex];
    mercenarySpend = allocateGrid9MercenarySpend({
      sponsorCoins: payer.mercenarySponsorCoins,
      microDropCoins: payer.mercenaryMicroDropCoins,
      amountCoins: weapon.costCoins,
    });
    payer.mercenaryMicroDropCoins -= mercenarySpend.microDropCoins;
    payer.mercenarySponsorCoins -= mercenarySpend.sponsorCoins;
    payer.mercenaryBankrollCoins -= weapon.costCoins;
  } else if (args.payment.kind === 'inventory') {
    if (args.sourceSlotIndex === null) {
      throw new Grid9Error('NOT_ELIGIBLE', 'Inventory requires a combat seat', {
        stateVersion: args.state.authority.stateVersion,
      });
    }
    const source = state.players[args.sourceSlotIndex];
    const invIndex = source.inventory.indexOf(weapon.id);
    if (invIndex < 0) {
      throw new Grid9Error('ITEM_NOT_FOUND', 'Item not in inventory', {
        stateVersion: args.state.authority.stateVersion,
      });
    }
    source.inventory = [
      ...source.inventory.slice(0, invIndex),
      ...source.inventory.slice(invIndex + 1),
    ];
  } else if (args.payment.kind === 'free_drop') {
    if (
      !state.turn?.freeDropEquipped ||
      state.turn.freeDropItemId !== weapon.id
    ) {
      throw new Grid9Error('ITEM_NOT_FOUND', 'Free drop is not equipped', {
        stateVersion: args.state.authority.stateVersion,
      });
    }
    state.turn.freeDropEquipped = false;
  }

  const rawTargets = affectedSlots(args.state, weapon, args.targetSlotIndex);
  const damage = rawTargets.map<Grid9DamageResult>(
    ({ slotIndex, rawDamage }) => {
    const player = args.state.players[slotIndex];
    const allocation = allocateGrid9Damage({
      rawDamage,
      shieldBefore: player.shieldPoints,
      shieldPierceBps: weapon.shieldPierceBps,
    });
    const healthDamage = Math.min(player.health, allocation.healthDamage);
    return {
      slotIndex,
      healthBefore: player.health,
      healthAfter: Math.max(0, player.health - healthDamage),
      shieldBefore: player.shieldPoints,
      shieldAfter: allocation.shieldAfter,
      shieldDamage: allocation.shieldDamage,
      healthDamage,
      eliminated: player.health - healthDamage <= 0,
      lastStandApplied: false,
      };
    },
  );

  const predictedAlive = args.state.players.filter((player) => {
    const result = damage.find((item) => item.slotIndex === player.slotIndex);
    return player.status === 'alive' && (!result || result.healthAfter > 0);
  });
  if (predictedAlive.length === 0) {
    const lastStand = lastStandCandidate(args.state);
    const result = damage.find(
      (item) => item.slotIndex === lastStand.slotIndex,
    );
    if (result) {
      result.healthAfter = 1;
      result.healthDamage = Math.max(0, result.healthBefore - 1);
      result.eliminated = false;
      result.lastStandApplied = true;
    }
  }

  const eliminator = eliminatorForActor(args.state, args.actor);
  const eliminatedSlotIndices: Grid9SlotIndex[] = [];
  for (const result of damage) {
    const player = state.players[result.slotIndex];
    player.health = result.healthAfter;
    player.shieldPoints = result.shieldAfter;
    player.stats.damageReceived +=
      result.healthDamage + result.shieldDamage;
    player.lastDamagedAt = now;
    if (result.eliminated) {
      player.status = 'eliminated';
      player.mode = player.kind === 'human' ? 'sabotage' : 'inactive';
      player.eliminatedAt = now;
      player.eliminatedBy = eliminator;
      eliminatedSlotIndices.push(player.slotIndex);
    }
  }

  const totalDamage = damage.reduce(
    (sum, result) => sum + result.healthDamage + result.shieldDamage,
    0,
  );
  if (args.sourceSlotIndex !== null) {
    const source = state.players[args.sourceSlotIndex];
    source.stats.attacksPurchased += 1;
    source.stats.damageDealt += totalDamage;
    if (!isFree) source.stats.coinsSpent += weapon.costCoins;
  }
  if (
    state.turn &&
    args.sourceSlotIndex === state.turn.spotlightSlotIndex &&
    (args.actor.kind === 'human_player' || args.actor.kind === 'sentinel')
  ) {
    state.turn.attacksUsedThisTurn += 1;
  }
  if (!isFree) {
    state.jackpot.purchaseContributionCoins +=
      weapon.jackpotContributionCoins;
    state.jackpot.currentCoins += weapon.jackpotContributionCoins;
  }
  state.authority.cooldowns[cooldownKey] = {
    actorKey,
    actor: args.actor,
    itemId: weapon.id,
    readyAt: iso(nowMs + weapon.cooldownMs),
  };
  state.lastAction = {
    intentId: args.intentId,
    serverOperationId: args.serverOperationId,
    actor: publicActor(args.actor),
    kind: 'weapon',
    weaponId: weapon.id,
    shieldId: null,
    targetSlotIndex: args.targetSlotIndex,
    affectedSlotIndices: damage.map((item) => item.slotIndex),
    ledgerEntryId: args.ledgerEntryId,
    committedAt: now,
  };
  const completed = maybeCompleteAfterDamage(state, nowMs);
  const done = mutationDone(state, args.state, now, completed ? 2 : 1);
  const inventoryAfter: Grid9ArsenalItemId[] =
    args.sourceSlotIndex === null
      ? []
      : [...done.players[args.sourceSlotIndex].inventory];
  return {
    state: done,
    damage,
    sourceSlotIndex: args.sourceSlotIndex,
    eliminatedSlotIndices,
    mercenarySpend,
    completed,
    inventoryAfter,
  };
}

export function applyGrid9MercenaryFunding(args: {
  state: Grid9GameState;
  sponsor: Grid9Identity;
  beneficiarySlotIndex: Grid9SlotIndex;
  amountCoins: number;
  intentId: string;
  ledgerEntryId: string;
  nowMs?: number;
}): Grid9FundingResolution {
  const nowMs = args.nowMs ?? Date.now();
  const now = iso(nowMs);
  requireCombat(args.state);
  if (
    !Number.isSafeInteger(args.amountCoins) ||
    args.amountCoins < args.state.rules.minMercenaryFundCoins ||
    args.amountCoins > args.state.rules.maxMercenaryFundCoins
  ) {
    throw new Grid9Error(
      'INVALID_FUND_AMOUNT',
      `Funding must be ${args.state.rules.minMercenaryFundCoins}-${args.state.rules.maxMercenaryFundCoins} coins`,
      { stateVersion: args.state.authority.stateVersion },
    );
  }
  const sponsorPlayer = args.state.players.find(
    (player): player is Grid9HumanPlayer =>
      player.kind === 'human' && player.userId === args.sponsor.userId,
  );
  if (
    !sponsorPlayer ||
    sponsorPlayer.status !== 'eliminated' ||
    sponsorPlayer.mode !== 'sabotage'
  ) {
    throw new Grid9Error(
      'NOT_ELIGIBLE',
      'Only eliminated players can fund a mercenary',
      { stateVersion: args.state.authority.stateVersion },
    );
  }
  const beneficiary = args.state.players[args.beneficiarySlotIndex];
  if (!beneficiary || beneficiary.status !== 'alive') {
    throw new Grid9Error('TARGET_NOT_ALIVE', 'Mercenary box is eliminated', {
      stateVersion: args.state.authority.stateVersion,
    });
  }

  const state = cloneState(args.state);
  const nextSponsor = state.players[
    sponsorPlayer.slotIndex
  ] as Grid9HumanPlayer;
  const nextBeneficiary = state.players[args.beneficiarySlotIndex];
  const bankrollBefore = nextBeneficiary.mercenaryBankrollCoins;
  nextBeneficiary.mercenarySponsorCoins += args.amountCoins;
  nextBeneficiary.mercenaryBankrollCoins += args.amountCoins;
  nextBeneficiary.supporterTotalCoins += args.amountCoins;
  nextBeneficiary.stats.mercenaryCoinsReceived += args.amountCoins;
  nextSponsor.stats.coinsSpent += args.amountCoins;

  const existing = nextBeneficiary.topSupporters.find(
    (supporter) => supporter.userId === args.sponsor.userId,
  );
  if (existing) {
    existing.contributedCoins += args.amountCoins;
    existing.lastFundedAt = now;
  } else {
    const supporter: Grid9SupporterSummary = {
      userId: args.sponsor.userId,
      publicProfileId: args.sponsor.publicProfileId,
      displayName: args.sponsor.displayName,
      contributedCoins: args.amountCoins,
      firstFundedAt: now,
      lastFundedAt: now,
    };
    nextBeneficiary.topSupporters.push(supporter);
  }
  nextBeneficiary.topSupporters = nextBeneficiary.topSupporters
    .sort(
      (left, right) =>
        right.contributedCoins - left.contributedCoins ||
        left.firstFundedAt.localeCompare(right.firstFundedAt) ||
        left.userId.localeCompare(right.userId),
    )
    .slice(0, GRID9_TOP_SUPPORTERS_PER_SLOT);
  state.lastAction = {
    intentId: args.intentId,
    serverOperationId: null,
    actor: {
      kind: 'human_player',
      publicProfileId: args.sponsor.publicProfileId,
      displayName: args.sponsor.displayName,
    },
    kind: 'mercenary_funding',
    weaponId: null,
    shieldId: null,
    targetSlotIndex: args.beneficiarySlotIndex,
    affectedSlotIndices: [args.beneficiarySlotIndex],
    ledgerEntryId: args.ledgerEntryId,
    committedAt: now,
  };
  return {
    state: mutationDone(state, args.state, now, 1),
    sponsorSlotIndex: sponsorPlayer.slotIndex,
    bankrollBefore,
    bankrollAfter: nextBeneficiary.mercenaryBankrollCoins,
  };
}

export function applyGrid9Shield(args: {
  state: Grid9GameState;
  actor: Grid9ActionActor;
  sourceSlotIndex: Grid9SlotIndex | null;
  shieldId: Grid9ShieldId;
  beneficiarySlotIndex: Grid9SlotIndex;
  intentId: string | null;
  serverOperationId: string | null;
  ledgerEntryId: string;
  payment: WeaponPayment;
  nowMs?: number;
}): Grid9ShieldResolution {
  const nowMs = args.nowMs ?? Date.now();
  const now = iso(nowMs);
  requireCombat(args.state);
  requireActorEligible(args.state, args.actor);
  requireActiveCombatantTurn(args.state, args.actor, args.sourceSlotIndex);
  const shield = GRID9_SHIELD_CATALOG[args.shieldId];
  if (!shield) throw new Grid9Error('ITEM_NOT_FOUND', 'Unknown Grid 9 shield');
  const beneficiary = args.state.players[args.beneficiarySlotIndex];
  if (!beneficiary || beneficiary.status !== 'alive') {
    throw new Grid9Error('TARGET_NOT_ALIVE', 'Shield target is eliminated');
  }
  const actorKey = grid9ActionActorKey(args.actor);
  const cooldownKey = `${actorKey}:${shield.id}`;
  const cooldown = args.state.authority.cooldowns[cooldownKey];
  if (cooldown && Date.parse(cooldown.readyAt) > nowMs) {
    throw new Grid9Error('COOLDOWN_ACTIVE', 'Shield is cooling down');
  }
  if (
    (args.actor.kind === 'human_player' || args.actor.kind === 'sentinel') &&
    args.state.turn &&
    args.sourceSlotIndex === args.state.turn.spotlightSlotIndex &&
    args.state.turn.defensesUsedThisTurn >= 1
  ) {
    throw new Grid9Error('RATE_LIMITED', 'Only one defense per turn', {
      stateVersion: args.state.authority.stateVersion,
    });
  }
  const state = cloneState(args.state);
  const isFree =
    args.payment.kind === 'inventory' || args.payment.kind === 'free_drop';
  if (args.payment.kind === 'mercenary_bankroll') {
    const payer = state.players[args.payment.sourceSlotIndex];
    const allocation = allocateGrid9MercenarySpend({
      sponsorCoins: payer.mercenarySponsorCoins,
      microDropCoins: payer.mercenaryMicroDropCoins,
      amountCoins: shield.costCoins,
    });
    payer.mercenaryMicroDropCoins -= allocation.microDropCoins;
    payer.mercenarySponsorCoins -= allocation.sponsorCoins;
    payer.mercenaryBankrollCoins -= shield.costCoins;
  } else if (args.payment.kind === 'inventory') {
    if (args.sourceSlotIndex === null) {
      throw new Grid9Error('NOT_ELIGIBLE', 'Inventory requires a combat seat', {
        stateVersion: args.state.authority.stateVersion,
      });
    }
    const source = state.players[args.sourceSlotIndex];
    const invIndex = source.inventory.indexOf(shield.id);
    if (invIndex < 0) {
      throw new Grid9Error('ITEM_NOT_FOUND', 'Shield not in inventory', {
        stateVersion: args.state.authority.stateVersion,
      });
    }
    source.inventory = [
      ...source.inventory.slice(0, invIndex),
      ...source.inventory.slice(invIndex + 1),
    ];
  } else if (args.payment.kind === 'free_drop') {
    if (
      !state.turn?.freeDropEquipped ||
      state.turn.freeDropItemId !== shield.id
    ) {
      throw new Grid9Error('ITEM_NOT_FOUND', 'Free drop is not equipped', {
        stateVersion: args.state.authority.stateVersion,
      });
    }
    state.turn.freeDropEquipped = false;
  }
  const nextBeneficiary = state.players[args.beneficiarySlotIndex];
  const shieldBefore = nextBeneficiary.shieldPoints;
  nextBeneficiary.shieldPoints = Math.min(
    nextBeneficiary.maxShieldPoints,
    nextBeneficiary.shieldPoints + shield.shieldPoints,
  );
  if (args.sourceSlotIndex !== null) {
    const source = state.players[args.sourceSlotIndex];
    source.stats.shieldsPurchased += 1;
    if (!isFree) source.stats.coinsSpent += shield.costCoins;
  }
  if (
    state.turn &&
    args.sourceSlotIndex === state.turn.spotlightSlotIndex &&
    (args.actor.kind === 'human_player' || args.actor.kind === 'sentinel')
  ) {
    state.turn.defensesUsedThisTurn += 1;
  }
  if (!isFree) {
    state.jackpot.purchaseContributionCoins +=
      shield.jackpotContributionCoins;
    state.jackpot.currentCoins += shield.jackpotContributionCoins;
  }
  state.authority.cooldowns[cooldownKey] = {
    actorKey,
    actor: args.actor,
    itemId: shield.id,
    readyAt: iso(nowMs + shield.cooldownMs),
  };
  state.lastAction = {
    intentId: args.intentId,
    serverOperationId: args.serverOperationId,
    actor: publicActor(args.actor),
    kind: 'shield',
    weaponId: null,
    shieldId: shield.id,
    targetSlotIndex: args.beneficiarySlotIndex,
    affectedSlotIndices: [args.beneficiarySlotIndex],
    ledgerEntryId: args.ledgerEntryId,
    committedAt: now,
  };
  return {
    state: mutationDone(state, args.state, now, 1),
    beneficiarySlotIndex: args.beneficiarySlotIndex,
    sourceSlotIndex: args.sourceSlotIndex,
    shieldBefore,
    shieldAfter: nextBeneficiary.shieldPoints,
    completed: false,
    inventoryAfter:
      args.sourceSlotIndex === null
        ? []
        : [...state.players[args.sourceSlotIndex].inventory],
  };
}

export function applyGrid9MicroDrop(args: {
  state: Grid9GameState;
  operationId: string;
  ledgerEntryId: string;
  nowMs?: number;
}): Grid9MicroDropResolution {
  const nowMs = args.nowMs ?? Date.now();
  const now = iso(nowMs);
  requireCombat(args.state);
  if (!args.state.turn) {
    throw new Grid9Error('INTERNAL_ERROR', 'Grid 9 turn is missing');
  }
  if (args.state.turn.microDropAwarded) {
    throw new Grid9Error('INTENT_CONFLICT', 'Micro-drop already awarded');
  }
  const state = cloneState(args.state);
  const turn = state.turn as Grid9TurnState;
  if (state.players[turn.spotlightSlotIndex].status !== 'alive') {
    turn.spotlightSlotIndex = nextSurvivingSlot(
      state,
      turn.spotlightSlotIndex,
    );
  }
  const recipient = state.players[turn.spotlightSlotIndex];
  const proof = deriveGrid9MicroDrop({
    entropySeed: state.authority.entropySeed,
    matchId: state.matchId,
    turnNumber: turn.turnNumber,
    slotIndex: turn.spotlightSlotIndex,
  });
  let humanCoinCredit: Grid9MicroDropResolution['humanCoinCredit'] = null;
  if (proof.rewardKind === 'shield') {
    recipient.shieldPoints = Math.min(
      recipient.maxShieldPoints,
      recipient.shieldPoints + GRID9_MICRO_DROP_SHIELD_REWARD,
    );
    state.lastMicroDrop = {
      dropId: args.operationId,
      turnNumber: turn.turnNumber,
      recipientSlotIndex: recipient.slotIndex,
      reward: {
        kind: 'shield',
        shieldPoints: GRID9_MICRO_DROP_SHIELD_REWARD,
      },
      entropyDigest: proof.digest,
      awardedAt: now,
    };
  } else {
    if (recipient.kind === 'sentinel') {
      recipient.mercenaryMicroDropCoins +=
        GRID9_MICRO_DROP_COIN_REWARD;
      recipient.mercenaryBankrollCoins +=
        GRID9_MICRO_DROP_COIN_REWARD;
    } else {
      humanCoinCredit = {
        userId: recipient.userId,
        amountCoins: GRID9_MICRO_DROP_COIN_REWARD,
        ledgerEntryId: args.ledgerEntryId,
      };
    }
    state.lastMicroDrop = {
      dropId: args.operationId,
      turnNumber: turn.turnNumber,
      recipientSlotIndex: recipient.slotIndex,
      reward: {
        kind: 'coins',
        amountCoins: GRID9_MICRO_DROP_COIN_REWARD,
        ledgerEntryId: args.ledgerEntryId,
      },
      entropyDigest: proof.digest,
      awardedAt: now,
    };
  }
  recipient.stats.microDropsReceived += 1;
  turn.microDropAwarded = true;
  state.authority.nextTurnAt = turn.endsAt;
  return {
    state: mutationDone(state, args.state, now, 1),
    humanCoinCredit,
  };
}

export function advanceGrid9Turn(
  current: Grid9GameState,
  nowMs = Date.now(),
): Grid9GameState {
  requireCombat(current);
  if (!current.turn) {
    throw new Grid9Error('INTERNAL_ERROR', 'Grid 9 turn is missing');
  }
  const resolved =
    current.turn.autoResolved ||
    (current.turn.attacksUsedThisTurn >= 1 &&
      current.turn.defensesUsedThisTurn >= 1)
      ? current
      : autoResolveGrid9Turn(current, nowMs);
  return startGrid9Roulette(resolved, nowMs);
}

export function markGrid9Connection(
  current: Grid9GameState,
  userId: string,
  connectionState: 'connected' | 'reconnecting' | 'disconnected',
  audienceDelta: number,
  nowMs = Date.now(),
): Grid9GameState {
  const state = cloneState(current);
  const human = state.players.find(
    (player): player is Grid9HumanPlayer =>
      player.kind === 'human' && player.userId === userId,
  );
  if (!human && audienceDelta === 0) return current;
  if (human) human.connectionState = connectionState;
  state.audienceCount = Math.max(0, state.audienceCount + audienceDelta);
  return mutationDone(state, current, iso(nowMs), human ? 1 : 0);
}

/**
 * Audience (or any non-arsenal path) gifts a catalog arsenal item into a living seat.
 * Debit face cost externally; here: 70% seat bankroll, 30% jackpot, item → inventory (FIFO overflow).
 * Does not remote-detonate — recipient fires on their next active turn from inventory.
 */
export function applyGrid9ArsenalGift(args: {
  state: Grid9GameState;
  sender: Grid9Identity;
  recipientSlotIndex: Grid9SlotIndex;
  itemId: Grid9ArsenalItemId;
  intentId: string;
  ledgerEntryId: string;
  nowMs?: number;
}): Grid9ArsenalGrantResolution {
  const nowMs = args.nowMs ?? Date.now();
  const now = iso(nowMs);
  requireGiftMatchActive(args.state);
  const item = GRID9_ARSENAL_CATALOG[args.itemId];
  if (!item) throw new Grid9Error('ITEM_NOT_FOUND', 'Unknown Grid 9 arsenal item');
  const recipient = args.state.players[args.recipientSlotIndex];
  if (!recipient || recipient.status !== 'alive') {
    throw new Grid9Error('TARGET_NOT_ALIVE', 'Gift target seat is eliminated', {
      stateVersion: args.state.authority.stateVersion,
    });
  }
  const { seatCoins, jackpotCoins } = splitGrid9AudienceGiftCoins(item.costCoins);
  const state = cloneState(args.state);
  const nextRecipient = state.players[args.recipientSlotIndex];
  const granted = grantGrid9InventoryItem(nextRecipient.inventory, args.itemId);
  nextRecipient.inventory = granted.inventory;
  creditSeatBankrollAndSupporters({
    beneficiary: nextRecipient,
    seatCoins,
    sponsor: args.sender,
    now,
  });
  state.jackpot.currentCoins += jackpotCoins;
  state.jackpot.purchaseContributionCoins += jackpotCoins;
  const seatedSender = state.players.find(
    (player): player is Grid9HumanPlayer =>
      player.kind === 'human' && player.userId === args.sender.userId,
  );
  if (seatedSender) seatedSender.stats.coinsSpent += item.costCoins;
  const isWeapon = item.kind === 'weapon';
  state.lastAction = {
    intentId: args.intentId,
    serverOperationId: null,
    actor: {
      kind: 'audience',
      publicProfileId: args.sender.publicProfileId,
      displayName: args.sender.displayName,
    },
    kind: 'arsenal_gift',
    weaponId: isWeapon ? (args.itemId as Grid9WeaponId) : null,
    shieldId: isWeapon ? null : (args.itemId as Grid9ShieldId),
    targetSlotIndex: args.recipientSlotIndex,
    affectedSlotIndices: [args.recipientSlotIndex],
    ledgerEntryId: args.ledgerEntryId,
    committedAt: now,
  };
  return {
    state: mutationDone(state, args.state, now, 1),
    recipientSlotIndex: args.recipientSlotIndex,
    itemId: args.itemId,
    costCoins: item.costCoins,
    seatCoins,
    jackpotCoins,
    inventoryAfter: granted.inventory,
    droppedItemId: granted.droppedItemId,
    selfBuy: false,
  };
}

/**
 * Combatant self-buy into inventory (not instant fire).
 * Same 70/30 as gifts: 70% stays on own bankroll, 30% jackpot, item stocked for a later turn.
 */
export function applyGrid9InventoryBuy(args: {
  state: Grid9GameState;
  buyer: Grid9Identity;
  itemId: Grid9ArsenalItemId;
  intentId: string;
  ledgerEntryId: string;
  nowMs?: number;
}): Grid9ArsenalGrantResolution {
  const nowMs = args.nowMs ?? Date.now();
  const now = iso(nowMs);
  requireGiftMatchActive(args.state);
  const item = GRID9_ARSENAL_CATALOG[args.itemId];
  if (!item) throw new Grid9Error('ITEM_NOT_FOUND', 'Unknown Grid 9 arsenal item');
  const buyerSeat = args.state.players.find(
    (player): player is Grid9HumanPlayer =>
      player.kind === 'human' &&
      player.userId === args.buyer.userId &&
      player.status === 'alive' &&
      player.mode === 'combatant',
  );
  if (!buyerSeat) {
    throw new Grid9Error(
      'NOT_ELIGIBLE',
      'Only living combatants can buy inventory stock',
      { stateVersion: args.state.authority.stateVersion },
    );
  }
  const { seatCoins, jackpotCoins } = splitGrid9AudienceGiftCoins(item.costCoins);
  const state = cloneState(args.state);
  const nextBuyer = state.players[buyerSeat.slotIndex] as Grid9HumanPlayer;
  const granted = grantGrid9InventoryItem(nextBuyer.inventory, args.itemId);
  nextBuyer.inventory = granted.inventory;
  creditSeatBankrollAndSupporters({
    beneficiary: nextBuyer,
    seatCoins,
    sponsor: args.buyer,
    now,
  });
  nextBuyer.stats.coinsSpent += item.costCoins;
  state.jackpot.currentCoins += jackpotCoins;
  state.jackpot.purchaseContributionCoins += jackpotCoins;
  const isWeapon = item.kind === 'weapon';
  state.lastAction = {
    intentId: args.intentId,
    serverOperationId: null,
    actor: {
      kind: 'human_player',
      publicProfileId: args.buyer.publicProfileId,
      displayName: args.buyer.displayName,
    },
    kind: 'inventory_buy',
    weaponId: isWeapon ? (args.itemId as Grid9WeaponId) : null,
    shieldId: isWeapon ? null : (args.itemId as Grid9ShieldId),
    targetSlotIndex: buyerSeat.slotIndex,
    affectedSlotIndices: [buyerSeat.slotIndex],
    ledgerEntryId: args.ledgerEntryId,
    committedAt: now,
  };
  return {
    state: mutationDone(state, args.state, now, 1),
    recipientSlotIndex: buyerSeat.slotIndex,
    itemId: args.itemId,
    costCoins: item.costCoins,
    seatCoins,
    jackpotCoins,
    inventoryAfter: granted.inventory,
    droppedItemId: granted.droppedItemId,
    selfBuy: true,
  };
}

/** Host kick: seat → audience, Sentinel fill so the 9-box stays full. */
export function kickGrid9SeatToAudience(
  current: Grid9GameState,
  hostUserId: string,
  targetUserId: string,
  nowMs = Date.now(),
): Grid9KickResolution {
  if (!current.ownerUserId || current.ownerUserId !== hostUserId) {
    throw new Grid9Error('NOT_ELIGIBLE', 'Only the room host can kick');
  }
  if (targetUserId === hostUserId || targetUserId === current.ownerUserId) {
    throw new Grid9Error('NOT_ELIGIBLE', 'Cannot kick the host');
  }
  if (
    current.phase === 'initializing' ||
    current.phase === 'settling' ||
    current.phase === 'completed' ||
    current.phase === 'cancelled'
  ) {
    throw new Grid9Error('MATCH_NOT_ACTIVE', 'Cannot kick in this phase');
  }
  return leaveGrid9SeatAsCombatant(current, targetUserId, nowMs, {
    bumpAudience: true,
  });
}

/**
 * Self-leave (or host kick after auth): replace seated human with Sentinel.
 * Self-leave does not bump audience — leaver exits the match entirely.
 * Host kick sets bumpAudience so the kicked user becomes audience.
 */
export function leaveGrid9SeatAsCombatant(
  current: Grid9GameState,
  userId: string,
  nowMs = Date.now(),
  options?: { bumpAudience?: boolean },
): Grid9KickResolution {
  if (
    current.phase === 'initializing' ||
    current.phase === 'settling' ||
    current.phase === 'completed' ||
    current.phase === 'cancelled'
  ) {
    throw new Grid9Error('MATCH_NOT_ACTIVE', 'Cannot leave seat in this phase');
  }
  const human = current.players.find(
    (player): player is Grid9HumanPlayer =>
      player.kind === 'human' && player.userId === userId,
  );
  if (!human) {
    throw new Grid9Error('NOT_ELIGIBLE', 'Not a seated combatant', {
      stateVersion: current.authority.stateVersion,
    });
  }
  const wasSpotlight =
    current.phase === 'combat' &&
    current.turn?.spotlightSlotIndex === human.slotIndex;
  const now = iso(nowMs);
  const state = cloneState(current);
  state.players[human.slotIndex] = createGrid9Sentinel(
    state.matchId,
    human.slotIndex,
    now,
  );
  if (options?.bumpAudience) {
    state.audienceCount = Math.max(0, state.audienceCount + 1);
  }
  return {
    state: mutationDone(state, current, now, 1),
    kickedSlotIndex: human.slotIndex,
    targetUserId: userId,
    wasSpotlight: Boolean(wasSpotlight),
  };
}

/**
 * Fail-closed: private lobby host leave cancels the room (no host transfer).
 */
export function cancelGrid9PrivateLobby(
  current: Grid9GameState,
  hostUserId: string,
  nowMs = Date.now(),
): Grid9GameState {
  if (current.phase !== 'private_lobby') {
    throw new Grid9Error('MATCH_NOT_ACTIVE', 'Not a private lobby');
  }
  if (!current.ownerUserId || current.ownerUserId !== hostUserId) {
    throw new Grid9Error('NOT_ELIGIBLE', 'Only the host can cancel the lobby');
  }
  const state = cloneState(current);
  const now = iso(nowMs);
  state.phase = 'cancelled';
  state.phaseStartedAt = now;
  state.phaseEndsAt = null;
  state.turn = null;
  state.roulette = null;
  state.outcome = {
    reason: 'system_cancelled',
    winnerSlotIndex: null,
    winnerKind: null,
    winnerUserId: null,
    winnerSentinelId: null,
    jackpotCoins: state.jackpot.currentCoins,
    sponsorPass: null,
    entropyReveal: state.authority.entropySeed,
    concludedAt: now,
  };
  state.authority.nextTurnAt = null;
  state.jackpot.status = 'rollover_pending';
  state.settlement.status = 'pending';
  state.settlement.settlementId = randomUUID();
  state.settlement.winnerPayoutCoins = 0;
  state.settlement.rolloverCoins = state.jackpot.currentCoins;
  return mutationDone(state, current, now, 1);
}
