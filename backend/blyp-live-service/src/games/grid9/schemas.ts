import { z } from 'zod';
import {
  GRID9_COUNTDOWN_MS,
  GRID9_INVENTORY_CAPACITY,
  GRID9_MAX_HEALTH,
  GRID9_MAX_ESCROW_RESERVE_COINS,
  GRID9_MAX_MATCH_DURATION_MS,
  GRID9_MAX_MERCENARY_FUND_COINS,
  GRID9_MAX_SHIELD_POINTS,
  GRID9_MICRO_DROP_COIN_REWARD,
  GRID9_MICRO_DROP_SHIELD_REWARD,
  GRID9_MIN_MERCENARY_FUND_COINS,
  GRID9_MIN_ESCROW_RESERVE_COINS,
  GRID9_PUBLIC_LOBBY_MS,
  GRID9_ROULETTE_DURATION_MS,
  GRID9_RULES_VERSION,
  GRID9_SENTINEL_FILL_DELAY_MS,
  GRID9_SLOT_COUNT,
  GRID9_SPOTLIGHT_DURATION_MS,
  GRID9_TURN_DURATION_MS,
  grid9EntropyCommitment,
  isGrid9SlotIndex,
  type Grid9SlotIndex,
} from './constants';
import type { Grid9GameState } from './state';
import { deriveGrid9MicroDrop } from './entropy';

const id = z.string().min(1).max(200);
const isoDate = z.string().datetime();
const nullableIsoDate = isoDate.nullable();
const nonNegativeInteger = z.number().int().nonnegative();
const slotIndex = z.custom<Grid9SlotIndex>(
  (value) => typeof value === 'number' && isGrid9SlotIndex(value),
  'slotIndex must be an integer from 0 through 8',
);

const supporterSchema = z.object({
  userId: id,
  publicProfileId: id,
  displayName: z.string().min(1).max(80),
  contributedCoins: nonNegativeInteger,
  firstFundedAt: isoDate,
  lastFundedAt: isoDate,
});

const statsSchema = z.object({
  attacksPurchased: nonNegativeInteger,
  shieldsPurchased: nonNegativeInteger,
  damageDealt: nonNegativeInteger,
  damageReceived: nonNegativeInteger,
  coinsSpent: nonNegativeInteger,
  mercenaryCoinsReceived: nonNegativeInteger,
  microDropsReceived: nonNegativeInteger,
});

const humanFeedSchema = z.object({
  kind: z.literal('human_live'),
  provider: z.enum(['ivs', 'livekit']),
  streamId: id,
  participantId: id,
});

const sentinelFeedSchema = z.object({
  kind: z.literal('sentinel_render'),
  characterId: id,
  animationSeed: z.number().int(),
});

const eliminatorSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('human'),
    userId: id,
    publicProfileId: id,
    displayName: z.string().min(1).max(80),
  }),
  z.object({
    kind: z.literal('sentinel'),
    sentinelId: id,
    displayName: z.string().min(1).max(80),
  }),
]);

const publicActionActorSchema = z.union([
  z.object({
    kind: z.enum(['human_player', 'audience']),
    publicProfileId: id,
    displayName: z.string().min(1).max(80),
  }),
  z.object({
    kind: z.literal('sentinel'),
    sentinelId: id,
    displayName: z.string().min(1).max(80),
  }),
  z.object({
    kind: z.literal('mercenary_proxy'),
    sourceSlotIndex: slotIndex,
    displayName: z.string().min(1).max(80),
  }),
]);

const actionActorSchema = z.union([
  z.object({
    kind: z.enum(['human_player', 'audience']),
    userId: id,
    publicProfileId: id,
    displayName: z.string().min(1).max(80),
  }),
  z.object({
    kind: z.literal('sentinel'),
    sentinelId: id,
    displayName: z.string().min(1).max(80),
  }),
  z.object({
    kind: z.literal('mercenary_proxy'),
    sourceSlotIndex: slotIndex,
    operationId: id,
    displayName: z.string().min(1).max(80),
  }),
]);

const commonPlayerShape = {
  slotId: id,
  slotIndex,
  displayName: z.string().min(1).max(80),
  avatarUrl: z.string().url().nullable(),
  status: z.enum(['alive', 'eliminated']),
  mode: z.enum(['combatant', 'sabotage', 'inactive']),
  health: z.number().int().min(0).max(GRID9_MAX_HEALTH),
  maxHealth: z.literal(GRID9_MAX_HEALTH),
  shieldPoints: z.number().int().min(0).max(GRID9_MAX_SHIELD_POINTS),
  maxShieldPoints: z.literal(GRID9_MAX_SHIELD_POINTS),
  inventory: z
    .array(z.enum(['arrow', 'fireball', 'mega_bomb', 'kiss', 'basic_shield']))
    .max(GRID9_INVENTORY_CAPACITY),
  mercenaryBankrollCoins: nonNegativeInteger,
  mercenarySponsorCoins: nonNegativeInteger,
  mercenaryMicroDropCoins: nonNegativeInteger,
  supporterTotalCoins: nonNegativeInteger,
  topSupporters: z.array(supporterSchema).max(10),
  stats: statsSchema,
  joinedAt: isoDate,
  eliminatedAt: nullableIsoDate,
  eliminatedBy: eliminatorSchema.nullable(),
  lastDamagedAt: nullableIsoDate,
};

const humanPlayerSchema = z
  .object({
    ...commonPlayerShape,
    kind: z.literal('human'),
    userId: id,
    publicProfileId: id,
    feed: humanFeedSchema,
    connectionState: z.enum(['connected', 'reconnecting', 'disconnected']),
    queueTicketId: id,
    sponsorPassId: id.nullable(),
  })
  .superRefine((player, context) => {
    if (
      player.mercenaryBankrollCoins !==
      player.mercenarySponsorCoins + player.mercenaryMicroDropCoins
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'mercenary bankroll must equal sponsor plus micro-drop coins',
      });
    }
    if (player.status === 'alive' && (player.health === 0 || player.mode !== 'combatant')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a living human must have health and combatant mode',
      });
    }
    if (
      player.status === 'eliminated' &&
      (player.health !== 0 || player.mode !== 'sabotage' || player.eliminatedAt === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'an eliminated human must have zero health and sabotage mode',
      });
    }
  });

const sentinelAiSchema = z
  .object({
    profileId: id,
    targetStrategy: z.enum([
      'lowest_health',
      'highest_health',
      'highest_support',
      'retaliatory',
      'random_survivor',
    ]),
    aggressionBps: z.number().int().min(0).max(10_000),
    shieldBelowHealth: z.number().int().min(0).max(GRID9_MAX_HEALTH),
    minimumReactionMs: nonNegativeInteger,
    maximumReactionMs: nonNegativeInteger,
  })
  .refine((profile) => profile.maximumReactionMs >= profile.minimumReactionMs, {
    message: 'maximumReactionMs must be at least minimumReactionMs',
  });

const sentinelPlayerSchema = z
  .object({
    ...commonPlayerShape,
    kind: z.literal('sentinel'),
    sentinelId: id,
    feed: sentinelFeedSchema,
    connectionState: z.literal('not_applicable'),
    ai: sentinelAiSchema,
  })
  .superRefine((player, context) => {
    if (
      player.mercenaryBankrollCoins !==
      player.mercenarySponsorCoins + player.mercenaryMicroDropCoins
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'mercenary bankroll must equal sponsor plus micro-drop coins',
      });
    }
    if (player.status === 'alive' && (player.health === 0 || player.mode !== 'combatant')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a living Sentinel must have health and combatant mode',
      });
    }
    if (
      player.status === 'eliminated' &&
      (player.health !== 0 || player.mode !== 'inactive' || player.eliminatedAt === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'an eliminated Sentinel must have zero health and inactive mode',
      });
    }
  });

const playerSchema = z.union([humanPlayerSchema, sentinelPlayerSchema]);
const playersSchema = z
  .tuple([
    playerSchema,
    playerSchema,
    playerSchema,
    playerSchema,
    playerSchema,
    playerSchema,
    playerSchema,
    playerSchema,
    playerSchema,
  ])
  .superRefine((players, context) => {
    const slotIds = new Set(players.map((player) => player.slotId));
    if (slotIds.size !== GRID9_SLOT_COUNT) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'slotId values must be unique',
      });
    }
    players.forEach((player, index) => {
      if (player.slotIndex !== index) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'slotIndex'],
          message: 'player array position must equal slotIndex',
        });
      }
    });
  });

const microDropRewardSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('coins'),
    amountCoins: nonNegativeInteger,
    ledgerEntryId: id,
  }),
  z.object({
    kind: z.literal('shield'),
    shieldPoints: nonNegativeInteger,
  }),
]);

const sponsorPassAwardSchema = z.object({
  passId: id,
  userId: id,
  publicProfileId: id,
  displayName: z.string().min(1).max(80),
  region: id,
  sourceMatchId: id,
  sponsoredSentinelId: id,
  contributedCoins: nonNegativeInteger,
  issuedAt: isoDate,
  expiresAt: isoDate,
});

const jackpotSchema = z
  .object({
    currency: z.literal('coins'),
    openingRolloverCoins: nonNegativeInteger,
    houseSeedCoins: nonNegativeInteger,
    openingRolloverClaimId: id.nullable(),
    openingRolloverFenceToken: nonNegativeInteger.nullable(),
    openingRolloverClaimStatus: z.enum(['none', 'reserved', 'consumed']),
    purchaseContributionCoins: nonNegativeInteger,
    currentCoins: nonNegativeInteger,
    status: z.enum([
      'growing',
      'payout_pending',
      'paid',
      'rollover_pending',
      'rolled_over',
    ]),
    rolloverSourceMatchId: id.nullable(),
    rolloverDestinationMatchId: id.nullable(),
    winnerSlotIndex: slotIndex.nullable(),
    winnerUserId: id.nullable(),
    winnerSentinelId: id.nullable(),
    sponsorPassRecipientUserId: id.nullable(),
  })
  .refine(
    (jackpot) =>
      jackpot.status !== 'growing' ||
      jackpot.currentCoins ===
        jackpot.openingRolloverCoins +
          jackpot.houseSeedCoins +
          jackpot.purchaseContributionCoins,
    {
      message:
        'a growing jackpot must equal rollover plus house seed plus purchase contributions',
    },
  );

const rulesSchema = z.object({
  rulesVersion: z.literal(GRID9_RULES_VERSION),
  slotCount: z.literal(GRID9_SLOT_COUNT),
  maxHealth: z.literal(GRID9_MAX_HEALTH),
  maxShieldPoints: z.literal(GRID9_MAX_SHIELD_POINTS),
  sentinelFillDelayMs: z.literal(GRID9_SENTINEL_FILL_DELAY_MS),
  countdownMs: z.literal(GRID9_COUNTDOWN_MS),
  publicLobbyMs: z.literal(GRID9_PUBLIC_LOBBY_MS),
  rouletteDurationMs: z.literal(GRID9_ROULETTE_DURATION_MS),
  turnDurationMs: z.literal(GRID9_TURN_DURATION_MS),
  spotlightDurationMs: z.literal(GRID9_SPOTLIGHT_DURATION_MS),
  maxMatchDurationMs: z.literal(GRID9_MAX_MATCH_DURATION_MS),
  houseSeedCoins: nonNegativeInteger,
  inventoryCapacity: z.literal(GRID9_INVENTORY_CAPACITY),
  microDropCoinReward: z.literal(GRID9_MICRO_DROP_COIN_REWARD),
  microDropShieldReward: z.literal(GRID9_MICRO_DROP_SHIELD_REWARD),
  minEscrowReserveCoins: z.literal(GRID9_MIN_ESCROW_RESERVE_COINS),
  maxEscrowReserveCoins: z.literal(GRID9_MAX_ESCROW_RESERVE_COINS),
  minMercenaryFundCoins: z.literal(GRID9_MIN_MERCENARY_FUND_COINS),
  maxMercenaryFundCoins: z.literal(GRID9_MAX_MERCENARY_FUND_COINS),
});

export const grid9GameStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    game: z.literal('grid9'),
    matchId: id,
    liveSessionId: id,
    region: id,
    roomMode: z.enum(['public', 'private']),
    ownerUserId: id.nullable(),
    roomCode: z.string().min(4).max(12).nullable(),
    entryFeeCoins: nonNegativeInteger.default(0),
    phase: z.enum([
      'initializing',
      'lobby',
      'lobby_waiting',
      'private_lobby',
      'roulette',
      'countdown',
      'combat',
      'settling',
      'completed',
      'cancelled',
    ]),
    phaseStartedAt: isoDate,
    phaseEndsAt: nullableIsoDate,
    players: playersSchema,
    audienceCount: nonNegativeInteger,
    turn: z
      .object({
        turnNumber: nonNegativeInteger,
        spotlightSlotIndex: slotIndex,
        startedAt: isoDate,
        spotlightEndsAt: isoDate,
        endsAt: isoDate,
        microDropAwarded: z.boolean(),
        attacksUsedThisTurn: nonNegativeInteger,
        defensesUsedThisTurn: nonNegativeInteger,
        freeDropItemId: z
          .enum(['arrow', 'fireball', 'mega_bomb', 'kiss', 'basic_shield'])
          .nullable(),
        freeDropEquipped: z.boolean(),
        autoResolved: z.boolean(),
      })
      .nullable(),
    roulette: z
      .object({
        turnNumber: nonNegativeInteger,
        candidateSlotIndices: z.array(slotIndex).min(1).max(GRID9_SLOT_COUNT),
        selectedSlotIndex: slotIndex,
        startedAt: isoDate,
        endsAt: isoDate,
        entropyDigest: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .nullable(),
    lastMicroDrop: z
      .object({
        dropId: id,
        turnNumber: nonNegativeInteger,
        recipientSlotIndex: slotIndex,
        reward: microDropRewardSchema,
        entropyDigest: z.string().regex(/^[a-f0-9]{64}$/),
        awardedAt: isoDate,
      })
      .nullable(),
    lastAction: z
      .object({
        intentId: id.nullable(),
        serverOperationId: id.nullable(),
        actor: publicActionActorSchema,
        kind: z.enum([
          'weapon',
          'shield',
          'mercenary_funding',
          'arsenal_gift',
          'inventory_buy',
        ]),
        weaponId: z.enum(['arrow', 'fireball', 'mega_bomb', 'kiss']).nullable(),
        shieldId: z.literal('basic_shield').nullable(),
        targetSlotIndex: slotIndex,
        affectedSlotIndices: z.array(slotIndex).min(1).max(GRID9_SLOT_COUNT),
        ledgerEntryId: id,
        committedAt: isoDate,
      })
      .refine(
        (action) =>
          (action.intentId === null) !== (action.serverOperationId === null),
        { message: 'lastAction requires exactly one intent or server operation id' },
      )
      .refine(
        (action) =>
          (action.kind === 'weapon' &&
            action.weaponId !== null &&
            action.shieldId === null) ||
          (action.kind === 'shield' &&
            action.weaponId === null &&
            action.shieldId !== null) ||
          (action.kind === 'mercenary_funding' &&
            action.weaponId === null &&
            action.shieldId === null) ||
          ((action.kind === 'arsenal_gift' || action.kind === 'inventory_buy') &&
            ((action.weaponId !== null && action.shieldId === null) ||
              (action.weaponId === null && action.shieldId !== null))),
        { message: 'lastAction item ids must match its action kind' },
      )
      .nullable(),
    jackpot: jackpotSchema,
    outcome: z
      .object({
        reason: z.enum([
          'last_box_standing',
          'max_duration_health_tiebreak',
          'operator_cancelled',
          'system_cancelled',
        ]),
        winnerSlotIndex: slotIndex.nullable(),
        winnerKind: z.enum(['human', 'sentinel']).nullable(),
        winnerUserId: id.nullable(),
        winnerSentinelId: id.nullable(),
        jackpotCoins: nonNegativeInteger,
        sponsorPass: sponsorPassAwardSchema.nullable(),
        entropyReveal: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        concludedAt: isoDate,
      })
      .nullable(),
    settlement: z.object({
      status: z.enum([
        'not_started',
        'pending',
        'completed',
        'failed_retryable',
        'failed_terminal',
      ]),
      settlementId: id.nullable(),
      winnerPayoutCoins: nonNegativeInteger,
      rolloverCoins: nonNegativeInteger,
      escrowReleaseCoins: nonNegativeInteger,
      attemptCount: nonNegativeInteger,
      lastAttemptAt: nullableIsoDate,
      completedAt: nullableIsoDate,
      errorCode: z.string().min(1).max(100).nullable(),
    }),
    rules: rulesSchema,
    authority: z.object({
      stateVersion: nonNegativeInteger,
      eventSequence: nonNegativeInteger,
      entropySeed: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      entropyCommitment: z.string().regex(/^[a-f0-9]{64}$/),
      nextTurnAt: nullableIsoDate,
      matchDeadlineAt: isoDate,
      cooldowns: z.record(
        z.object({
          actorKey: id,
          actor: actionActorSchema,
          itemId: z.enum(['arrow', 'fireball', 'mega_bomb', 'kiss', 'basic_shield']),
          readyAt: isoDate,
        }),
      ),
      proxyNextActionAt: z.record(isoDate),
      mutationCount: nonNegativeInteger,
      lastMutationAt: isoDate,
    }),
    createdAt: isoDate,
    updatedAt: isoDate,
    expiresAt: isoDate,
  })
  .superRefine((state, context) => {
    const terminal = state.phase === 'completed' || state.phase === 'cancelled';
    if (terminal !== (state.outcome !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['outcome'],
        message: 'outcome must exist exactly when the phase is terminal',
      });
    }
    if (state.phase === 'combat' && state.turn === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['turn'],
        message: 'combat requires an active server turn',
      });
    }
    const hasOpeningRollover = state.jackpot.openingRolloverCoins > 0;
    if (
      hasOpeningRollover !==
      (state.jackpot.openingRolloverClaimId !== null &&
        state.jackpot.openingRolloverFenceToken !== null &&
        state.jackpot.openingRolloverClaimStatus !== 'none')
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['jackpot'],
        message: 'opening rollover amount and claim metadata must exist together',
      });
    }
    if (
      state.phase !== 'initializing' &&
      hasOpeningRollover &&
      state.jackpot.openingRolloverClaimStatus !== 'consumed'
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['jackpot', 'openingRolloverClaimStatus'],
        message: 'a match cannot leave initializing before rollover is consumed',
      });
    }
    const expectedCommitment = grid9EntropyCommitment(
      state.matchId,
      state.authority.entropySeed,
    );
    if (state.authority.entropyCommitment !== expectedCommitment) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['authority', 'entropyCommitment'],
        message: 'entropyCommitment does not match the match-bound entropy seed',
      });
    }
    if (
      state.outcome !== null &&
      state.outcome.entropyReveal !== state.authority.entropySeed
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['outcome', 'entropyReveal'],
        message: 'terminal entropyReveal must equal the committed entropy seed',
      });
    }
    if (state.lastMicroDrop !== null) {
      const proof = deriveGrid9MicroDrop({
        entropySeed: state.authority.entropySeed,
        matchId: state.matchId,
        turnNumber: state.lastMicroDrop.turnNumber,
        slotIndex: state.lastMicroDrop.recipientSlotIndex,
      });
      if (
        state.lastMicroDrop.entropyDigest !== proof.digest ||
        state.lastMicroDrop.reward.kind !== proof.rewardKind
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['lastMicroDrop'],
          message: 'micro-drop reward does not match its entropy proof',
        });
      }
      if (
        (state.lastMicroDrop.reward.kind === 'coins' &&
          state.lastMicroDrop.reward.amountCoins !==
            GRID9_MICRO_DROP_COIN_REWARD) ||
        (state.lastMicroDrop.reward.kind === 'shield' &&
          state.lastMicroDrop.reward.shieldPoints !==
            GRID9_MICRO_DROP_SHIELD_REWARD)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['lastMicroDrop', 'reward'],
          message: 'micro-drop amount does not match the rules snapshot',
        });
      }
    }
  });

export function parseGrid9GameState(value: unknown): Grid9GameState {
  return grid9GameStateSchema.parse(value) as Grid9GameState;
}
