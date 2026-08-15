import type { Grid9SlotIndex } from './constants';

export type Grid9PlayerKind = 'human' | 'sentinel';
export type Grid9PlayerStatus = 'alive' | 'eliminated';
export type Grid9PlayerMode = 'combatant' | 'sabotage' | 'inactive';
export type Grid9HumanConnectionState = 'connected' | 'reconnecting' | 'disconnected';

export interface Grid9SupporterSummary {
  userId: string;
  publicProfileId: string;
  displayName: string;
  contributedCoins: number;
  firstFundedAt: string;
  lastFundedAt: string;
}

export type Grid9PublicSupporterSummary = Omit<Grid9SupporterSummary, 'userId'>;

export interface Grid9HumanFeedRef {
  kind: 'human_live';
  provider: 'ivs' | 'livekit';
  streamId: string;
  participantId: string;
}

export interface Grid9SentinelFeedRef {
  kind: 'sentinel_render';
  characterId: string;
  animationSeed: number;
}

export interface Grid9PlayerStats {
  attacksPurchased: number;
  shieldsPurchased: number;
  damageDealt: number;
  damageReceived: number;
  coinsSpent: number;
  mercenaryCoinsReceived: number;
  microDropsReceived: number;
}

export type Grid9Eliminator =
  | {
      kind: 'human';
      userId: string;
      publicProfileId: string;
      displayName: string;
    }
  | {
      kind: 'sentinel';
      sentinelId: string;
      displayName: string;
    };

export interface Grid9PlayerBase {
  slotId: string;
  slotIndex: Grid9SlotIndex;
  displayName: string;
  avatarUrl: string | null;
  status: Grid9PlayerStatus;
  mode: Grid9PlayerMode;
  health: number;
  maxHealth: number;
  shieldPoints: number;
  maxShieldPoints: number;
  mercenaryBankrollCoins: number;
  mercenarySponsorCoins: number;
  mercenaryMicroDropCoins: number;
  supporterTotalCoins: number;
  topSupporters: Grid9SupporterSummary[];
  stats: Grid9PlayerStats;
  joinedAt: string;
  eliminatedAt: string | null;
  eliminatedBy: Grid9Eliminator | null;
  lastDamagedAt: string | null;
}

export interface Grid9HumanPlayer extends Grid9PlayerBase {
  kind: 'human';
  userId: string;
  publicProfileId: string;
  feed: Grid9HumanFeedRef;
  connectionState: Grid9HumanConnectionState;
  queueTicketId: string;
  sponsorPassId: string | null;
}

export type Grid9SentinelTargetStrategy =
  | 'lowest_health'
  | 'highest_health'
  | 'highest_support'
  | 'retaliatory'
  | 'random_survivor';

export interface Grid9SentinelAiProfile {
  profileId: string;
  targetStrategy: Grid9SentinelTargetStrategy;
  aggressionBps: number;
  shieldBelowHealth: number;
  minimumReactionMs: number;
  maximumReactionMs: number;
}

export interface Grid9SentinelPlayer extends Grid9PlayerBase {
  kind: 'sentinel';
  sentinelId: string;
  feed: Grid9SentinelFeedRef;
  connectionState: 'not_applicable';
  ai: Grid9SentinelAiProfile;
}

export type Grid9Player = Grid9HumanPlayer | Grid9SentinelPlayer;

export interface Grid9PublicPlayerBase {
  slotId: string;
  slotIndex: Grid9SlotIndex;
  displayName: string;
  avatarUrl: string | null;
  status: Grid9PlayerStatus;
  mode: Grid9PlayerMode;
  health: number;
  maxHealth: number;
  shieldPoints: number;
  maxShieldPoints: number;
  mercenaryBankrollCoins: number;
  mercenarySponsorCoins: number;
  mercenaryMicroDropCoins: number;
  supporterTotalCoins: number;
  topSupporters: Grid9PublicSupporterSummary[];
  stats: Grid9PlayerStats;
  eliminatedAt: string | null;
}

export interface Grid9PublicHumanPlayer extends Grid9PublicPlayerBase {
  kind: 'human';
  publicProfileId: string;
  feed: Grid9HumanFeedRef;
  connectionState: Grid9HumanConnectionState;
}

export interface Grid9PublicSentinelPlayer extends Grid9PublicPlayerBase {
  kind: 'sentinel';
  sentinelId: string;
  feed: Grid9SentinelFeedRef;
  connectionState: 'not_applicable';
}

export type Grid9PublicPlayer =
  | Grid9PublicHumanPlayer
  | Grid9PublicSentinelPlayer;

export type Grid9ActionActor =
  | {
      kind: 'human_player';
      userId: string;
      publicProfileId: string;
      displayName: string;
    }
  | {
      kind: 'audience';
      userId: string;
      publicProfileId: string;
      displayName: string;
    }
  | {
      kind: 'sentinel';
      sentinelId: string;
      displayName: string;
    }
  | {
      kind: 'mercenary_proxy';
      sourceSlotIndex: Grid9SlotIndex;
      operationId: string;
      displayName: string;
    };

export type Grid9PublicActionActor =
  | {
      kind: 'human_player';
      publicProfileId: string;
      displayName: string;
    }
  | {
      kind: 'audience';
      publicProfileId: string;
      displayName: string;
    }
  | {
      kind: 'sentinel';
      sentinelId: string;
      displayName: string;
    }
  | {
      kind: 'mercenary_proxy';
      sourceSlotIndex: Grid9SlotIndex;
      displayName: string;
    };

export function grid9ActionActorKey(actor: Grid9ActionActor): string {
  if (actor.kind === 'sentinel') return `sentinel:${actor.sentinelId}`;
  if (actor.kind === 'mercenary_proxy') {
    return `proxy:${actor.sourceSlotIndex}`;
  }
  return `user:${actor.userId}`;
}
