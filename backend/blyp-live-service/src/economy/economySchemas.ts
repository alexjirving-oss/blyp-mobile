import { z } from 'zod';

export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const iapVerifySchema = z.object({
  idempotencyKey: z.string().min(1),
  platform: z.enum(['IOS', 'ANDROID']),
  sku: z.string().min(1),
  storeTransactionId: z.string().min(1),
  purchaseToken: z.string().min(1).optional(),
  receipt: z.string().min(1).optional(),
});

export const giftSendSchema = z.object({
  idempotencyKey: z.string().min(1),
  streamId: z.string().min(1),
  receiverUserId: z.string().min(1),
  giftId: z.string().min(1),
  quantity: z.coerce.number().int().min(1).max(1000),
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

export type GiftSendInput = z.infer<typeof giftSendSchema>;
export type AdminCreditCoinsInput = z.infer<typeof adminCreditCoinsSchema>;
export type PromoteBattleInput = z.infer<typeof promoteBattleSchema>;
export type PromoteTimeSlotBookInput = z.infer<typeof promoteTimeSlotBookSchema>;
export type PromoteSpotlightBookInput = z.infer<typeof promoteSpotlightBookSchema>;
