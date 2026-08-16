import type {
  Grid9HumanPlayer,
  Grid9Player,
  Grid9PublicPlayer,
  Grid9SentinelPlayer,
} from './players';
import type {
  Grid9GameState,
  Grid9PublicGameState,
  Grid9PublicJackpotState,
  Grid9PublicMatchOutcome,
  Grid9PublicPlayerSlots,
} from './state';

function projectCommonPlayer(player: Grid9Player) {
  return {
    slotId: player.slotId,
    slotIndex: player.slotIndex,
    displayName: player.displayName,
    avatarUrl: player.avatarUrl,
    status: player.status,
    mode: player.mode,
    health: player.health,
    maxHealth: player.maxHealth,
    shieldPoints: player.shieldPoints,
    maxShieldPoints: player.maxShieldPoints,
    inventory: [...player.inventory],
    mercenaryBankrollCoins: player.mercenaryBankrollCoins,
    mercenarySponsorCoins: player.mercenarySponsorCoins,
    mercenaryMicroDropCoins: player.mercenaryMicroDropCoins,
    supporterTotalCoins: player.supporterTotalCoins,
    topSupporters: player.topSupporters.map(
      ({ userId: _userId, ...supporter }) => supporter,
    ),
    stats: { ...player.stats },
    eliminatedAt: player.eliminatedAt,
  };
}

function projectPlayer(player: Grid9Player): Grid9PublicPlayer {
  const common = projectCommonPlayer(player);
  if (player.kind === 'human') {
    const human = player as Grid9HumanPlayer;
    return {
      ...common,
      kind: 'human',
      publicProfileId: human.publicProfileId,
      feed: { ...human.feed },
      connectionState: human.connectionState,
    };
  }
  const sentinel = player as Grid9SentinelPlayer;
  return {
    ...common,
    kind: 'sentinel',
    sentinelId: sentinel.sentinelId,
    feed: { ...sentinel.feed },
    connectionState: 'not_applicable',
  };
}

function humanByUserId(
  state: Grid9GameState,
  userId: string | null,
): Grid9HumanPlayer | null {
  if (!userId) return null;
  const player = state.players.find(
    (candidate): candidate is Grid9HumanPlayer =>
      candidate.kind === 'human' && candidate.userId === userId,
  );
  return player ?? null;
}

function projectJackpot(state: Grid9GameState): Grid9PublicJackpotState {
  const winner = humanByUserId(state, state.jackpot.winnerUserId);
  const sponsor = humanByUserId(
    state,
    state.jackpot.sponsorPassRecipientUserId,
  );
  return {
    currency: 'coins',
    openingRolloverCoins: state.jackpot.openingRolloverCoins,
    houseSeedCoins: state.jackpot.houseSeedCoins,
    purchaseContributionCoins: state.jackpot.purchaseContributionCoins,
    currentCoins: state.jackpot.currentCoins,
    status: state.jackpot.status,
    rolloverSourceMatchId: state.jackpot.rolloverSourceMatchId,
    rolloverDestinationMatchId: state.jackpot.rolloverDestinationMatchId,
    winnerSlotIndex: state.jackpot.winnerSlotIndex,
    winnerPublicProfileId: winner?.publicProfileId ?? null,
    winnerSentinelId: state.jackpot.winnerSentinelId,
    sponsorPassRecipientPublicProfileId: sponsor?.publicProfileId ?? null,
  };
}

function projectOutcome(
  state: Grid9GameState,
): Grid9PublicMatchOutcome | null {
  if (!state.outcome) return null;
  const winner =
    state.outcome.winnerSlotIndex === null
      ? null
      : state.players[state.outcome.winnerSlotIndex];
  const sponsorPass = state.outcome.sponsorPass
    ? {
        publicProfileId: state.outcome.sponsorPass.publicProfileId,
        displayName: state.outcome.sponsorPass.displayName,
        region: state.outcome.sponsorPass.region,
        sourceMatchId: state.outcome.sponsorPass.sourceMatchId,
        sponsoredSentinelId:
          state.outcome.sponsorPass.sponsoredSentinelId,
        contributedCoins: state.outcome.sponsorPass.contributedCoins,
        issuedAt: state.outcome.sponsorPass.issuedAt,
        expiresAt: state.outcome.sponsorPass.expiresAt,
      }
    : null;
  return {
    reason: state.outcome.reason,
    winnerSlotIndex: state.outcome.winnerSlotIndex,
    winnerKind: state.outcome.winnerKind,
    winnerPublicProfileId:
      winner?.kind === 'human' ? winner.publicProfileId : null,
    winnerDisplayName: winner?.displayName ?? null,
    winnerSentinelId: state.outcome.winnerSentinelId,
    jackpotCoins: state.outcome.jackpotCoins,
    sponsorPass,
    entropyReveal: state.outcome.entropyReveal,
    concludedAt: state.outcome.concludedAt,
  };
}

export function toGrid9PublicGameState(
  state: Grid9GameState,
  serverTime = new Date().toISOString(),
): Grid9PublicGameState {
  const owner = humanByUserId(state, state.ownerUserId);
  return {
    schemaVersion: 1,
    game: 'grid9',
    matchId: state.matchId,
    liveSessionId: state.liveSessionId,
    roomMode: state.roomMode,
    ownerPublicProfileId: owner?.publicProfileId ?? null,
    roomCode: state.roomCode,
    phase: state.phase,
    phaseStartedAt: state.phaseStartedAt,
    phaseEndsAt: state.phaseEndsAt,
    stateVersion: state.authority.stateVersion,
    eventSequence: state.authority.eventSequence,
    entropyCommitment: state.authority.entropyCommitment,
    players: state.players.map(projectPlayer) as Grid9PublicPlayerSlots,
    audienceCount: state.audienceCount,
    turn: state.turn ? { ...state.turn } : null,
    roulette: state.roulette ? { ...state.roulette } : null,
    lastMicroDrop: state.lastMicroDrop
      ? JSON.parse(JSON.stringify(state.lastMicroDrop))
      : null,
    lastAction: state.lastAction
      ? JSON.parse(JSON.stringify(state.lastAction))
      : null,
    jackpot: projectJackpot(state),
    outcome: projectOutcome(state),
    rules: { ...state.rules },
    serverTime,
  };
}
