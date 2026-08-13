import { z } from 'zod';

export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const iapVerifySchema = z
  .object({
    idempotencyKey: z.string().min(1),
    platform: z.enum(['IOS', 'ANDROID']),
    sku: z.string().min(1),
    storeTransactionId: z.string().min(1),
    purchaseToken: z.string().min(1).optional(),
    receipt: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.platform === 'ANDROID' && !value.purchaseToken) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'purchaseToken is required for Android purchases',
        path: ['purchaseToken'],
      });
    }

    if (value.platform === 'IOS' && !value.receipt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'receipt is required for iOS purchases',
        path: ['receipt'],
      });
    }
  });

export const giftSendSchema = z
  .object({
    idempotencyKey: z.string().min(1),
    streamId: z.string().min(1),
    receiverUserId: z.string().min(1),
    giftId: z.string().min(1),
    quantity: z.coerce.number().int().min(1).max(1000),
    battleId: z.string().min(1).max(120).optional(),
    battleSide: z.enum(['A', 'B']).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!!value.battleId === !!value.battleSide) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'battleId and battleSide must be supplied together',
      path: value.battleId ? ['battleSide'] : ['battleId'],
    });
  });

export const liveGameStartSchema = z
  .object({
    idempotencyKey: z.string().min(1),
    streamId: z.string().min(1),
    entryFeeCoins: z.coerce.number().int().min(1).max(1_000_000),
  })
  .strict();

export const liveGameJoinSchema = z
  .object({
    idempotencyKey: z.string().min(1),
    streamId: z.string().min(1),
  })
  .strict();

export const liveGameFinalizeSchema = z
  .object({
    idempotencyKey: z.string().min(1),
    streamId: z.string().min(1),
    winners: z.array(z.string().min(1)).max(100).optional(),
  })
  .strict();

export const adminCreditCoinsSchema = z
  .object({
    targetUserId: z.string().min(1),
    coins: z.coerce.number().int().min(1).max(1_000_000),
    idempotencyKey: z.string().min(1),
    reason: z.string().min(1).max(200).optional(),
  })
  .strict();

export const promoteBattleSchema = z
  .object({
    idempotencyKey: z.string().min(1),
    battleRef: z.string().max(200).optional(),
  })
  .strict();

export const promoteTimeSlotBookSchema = z
  .object({
    idempotencyKey: z.string().min(1),
    startsAt: z.string().min(1),
    durationMinutes: z.coerce.number().int().min(15).max(24 * 60),
    note: z.string().max(200).optional(),
  })
  .strict();

export const promoteSpotlightBookSchema = z
  .object({
    idempotencyKey: z.string().min(1),
    startsAt: z.string().min(1),
    durationKey: z.enum(['1h', '24h', '7d']),
    note: z.string().max(200).optional(),
  })
  .strict();

export const PROMOTE_METHOD_IDS = [
  'spotlight',
  'time_slot',
  'battle',
  'feed_boost',
  'profile',
  'live',
  'search',
  'followers',
  'team',
  'cross_sport',
  'rematch',
] as const;

export const promoteMethodBookSchema = z
  .object({
    idempotencyKey: z.string().min(1),
    methodId: z.enum(PROMOTE_METHOD_IDS),
    packageId: z.string().min(1).max(40).optional(),
    startsAt: z.string().min(1).optional(),
    durationKey: z.enum(['1h', '24h', '7d']).optional(),
    durationMinutes: z.coerce.number().int().min(15).max(24 * 60).optional(),
    battleRef: z.string().min(1).max(120).optional(),
    postRef: z.string().min(1).max(120).optional(),
    streamRef: z.string().min(1).max(120).optional(),
    note: z.string().max(200).optional(),
    targeting: z
      .object({
        sports: z.array(z.string().min(1).max(40)).max(8).optional(),
        geos: z.array(z.string().min(1).max(40)).max(8).optional(),
        interests: z.array(z.string().min(1).max(40)).max(8).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const matchdayPurchaseSchema = z
  .object({
    idempotencyKey: z.string().min(1),
    eventId: z.string().min(1).max(120),
    eventMeta: z
      .object({
        homeTeam: z.string().max(120).optional(),
        awayTeam: z.string().max(120).optional(),
        league: z.string().max(120).optional(),
        kickoff: z.string().max(40).optional(),
      })
      .partial()
      .optional(),
  })
  .strict();

export const matchdayPredictionPlaceSchema = z
  .object({
    idempotencyKey: z.string().min(1),
    eventId: z.string().min(1).max(120),
    market: z.enum(['SCORELINE', 'FIRST_SCORER', 'RESULT']),
    selection: z.string().min(1).max(80),
    stakeCoins: z.coerce.number().int().min(1).max(1_000_000),
  })
  .strict();

export const matchdayPredictionSettleSchema = z
  .object({
    idempotencyKey: z.string().min(1),
    eventId: z.string().min(1).max(120),
    result: z
      .object({
        status: z.enum(['COMPLETED', 'VOID']),
        homeScore: z.coerce.number().int().min(0).max(99).nullable().optional(),
        awayScore: z.coerce.number().int().min(0).max(99).nullable().optional(),
        winner: z.enum(['HOME', 'AWAY', 'DRAW']).nullable().optional(),
        firstScorer: z.string().max(120).nullable().optional(),
      })
      .strict(),
  })
  .strict();

export const matchdayReactSchema = z
  .object({
    eventId: z.string().min(1).max(120),
    emoji: z.string().min(1).max(16),
  })
  .strict();

export const battleDepositSchema = z
  .object({
    idempotencyKey: z.string().min(1),
    battleId: z.string().min(1).max(120),
    role: z.enum(['creator', 'opponent']),
    stakeCoins: z.coerce.number().int().min(1).max(1_000_000),
    creatorUid: z.string().min(1).max(128),
    opponentUid: z.string().min(1).max(128),
  })
  .strict();

export const battleCancelRefundSchema = z
  .object({
    idempotencyKey: z.string().min(1),
    battleId: z.string().min(1).max(120),
  })
  .strict();

export const battleSettleSchema = z
  .object({
    idempotencyKey: z.string().min(1),
    battleId: z.string().min(1).max(120),
  })
  .strict();

export const battleGiftPledgeCreateSchema = z
  .object({
    idempotencyKey: z.string().min(1).max(120),
    battleId: z.string().min(1).max(120),
    side: z.enum(['creator', 'opponent']),
    giftId: z.string().min(1).max(64),
    quantity: z.coerce.number().int().min(1).max(99).default(1),
    creatorUid: z.string().min(1).max(128),
    opponentUid: z.string().min(1).max(128),
  })
  .strict();

export const battleGiftPledgeCancelSchema = z
  .object({
    idempotencyKey: z.string().min(1).max(120),
    pledgeId: z.string().min(1).max(120),
  })
  .strict();

export const battleGiftPledgesApplySchema = z
  .object({
    idempotencyKey: z.string().min(1).max(120),
    battleId: z.string().min(1).max(120),
    streamId: z.string().min(1).max(160).optional(),
  })
  .strict();

export const battleGiftPledgesRefundSchema = z
  .object({
    idempotencyKey: z.string().min(1).max(120),
    battleId: z.string().min(1).max(120),
  })
  .strict();

export type GiftSendInput = z.infer<typeof giftSendSchema>;
export type IapVerifyInput = z.infer<typeof iapVerifySchema>;
export type AdminCreditCoinsInput = z.infer<typeof adminCreditCoinsSchema>;
export type PromoteBattleInput = z.infer<typeof promoteBattleSchema>;
export type PromoteTimeSlotBookInput = z.infer<typeof promoteTimeSlotBookSchema>;
export type PromoteSpotlightBookInput = z.infer<typeof promoteSpotlightBookSchema>;
export type PromoteMethodBookInput = z.infer<typeof promoteMethodBookSchema>;
export type MatchdayPurchaseInput = z.infer<typeof matchdayPurchaseSchema>;
export type MatchdayPredictionPlaceInput = z.infer<typeof matchdayPredictionPlaceSchema>;
export type MatchdayPredictionSettleInput = z.infer<typeof matchdayPredictionSettleSchema>;
export type MatchdayReactInput = z.infer<typeof matchdayReactSchema>;
export type BattleDepositInput = z.infer<typeof battleDepositSchema>;
export type BattleCancelRefundInput = z.infer<typeof battleCancelRefundSchema>;
export type BattleSettleInput = z.infer<typeof battleSettleSchema>;
export type BattleGiftPledgeCreateInput = z.infer<typeof battleGiftPledgeCreateSchema>;
export type BattleGiftPledgeCancelInput = z.infer<typeof battleGiftPledgeCancelSchema>;
export type BattleGiftPledgesApplyInput = z.infer<typeof battleGiftPledgesApplySchema>;
export type BattleGiftPledgesRefundInput = z.infer<typeof battleGiftPledgesRefundSchema>;

export const withdrawRequestSchema = z
  .object({
    amountGems: z.coerce.number().int().min(1),
    idempotencyKey: z.string().min(1).max(120),
    /** Destination rail. Default stripe for backward compatibility. */
    method: z.enum(['stripe', 'paypal']).optional().default('stripe'),
    /** Required when method=paypal — creator's PayPal login email. */
    paypalEmail: z.string().email().max(200).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.method === 'paypal' && !val.paypalEmail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'paypalEmail required for PayPal withdrawals',
        path: ['paypalEmail'],
      });
    }
  });

export const withdrawConnectOnboardSchema = z
  .object({
    returnUrl: z.string().url().optional(),
    refreshUrl: z.string().url().optional(),
  })
  .strict();

export type WithdrawRequestInput = z.infer<typeof withdrawRequestSchema>;
export type WithdrawConnectOnboardInput = z.infer<typeof withdrawConnectOnboardSchema>;

export const socialFollowSchema = z
  .object({
    targetUserId: z.string().min(1).max(128),
  })
  .strict();

export type SocialFollowInput = z.infer<typeof socialFollowSchema>;
