import { z } from 'zod';
import {
  GRID9_MAX_ESCROW_RESERVE_COINS,
  GRID9_MAX_MERCENARY_FUND_COINS,
  GRID9_MIN_ESCROW_RESERVE_COINS,
  GRID9_MIN_MERCENARY_FUND_COINS,
  isGrid9NonceEncoding,
} from './constants';
import type { Grid9ClientIntent } from './protocol';

const id = z.string().min(1).max(200);
const slotIndex = z.number().int().min(0).max(8);
const common = {
  protocol: z.literal('grid9.ws'),
  protocolVersion: z.literal(1),
  direction: z.literal('client_to_server'),
  messageId: id,
  connectionSessionId: id,
  intentId: id,
  nonce: z.string().refine(isGrid9NonceEncoding, 'invalid nonce encoding'),
  sentAt: z.string().datetime(),
};

const queueJoin = z
  .object({
    ...common,
    type: z.literal('QUEUE_JOIN'),
    matchId: z.null(),
    expectedStateVersion: z.null(),
    payload: z
      .object({
        region: id,
        sponsorPassId: id.nullable(),
      })
      .strict(),
  })
  .strict();

const queueLeave = z
  .object({
    ...common,
    type: z.literal('QUEUE_LEAVE'),
    matchId: z.null(),
    expectedStateVersion: z.null(),
    payload: z.object({ region: id, ticketId: id }).strict(),
  })
  .strict();

const matchJoin = z
  .object({
    ...common,
    type: z.literal('MATCH_JOIN'),
    matchId: id,
    expectedStateVersion: z.null(),
    payload: z
      .object({
        region: id,
        assignmentId: id,
        assignmentToken: z.string().min(32).max(512),
      })
      .strict(),
  })
  .strict();

const reserveCoins = z
  .object({
    ...common,
    type: z.literal('RESERVE_COINS'),
    matchId: id,
    expectedStateVersion: z.number().int().nonnegative(),
    payload: z
      .object({
        amountCoins: z
          .number()
          .int()
          .min(GRID9_MIN_ESCROW_RESERVE_COINS)
          .max(GRID9_MAX_ESCROW_RESERVE_COINS),
      })
      .strict(),
  })
  .strict();

const fireWeapon = z
  .object({
    ...common,
    type: z.literal('FIRE_WEAPON'),
    matchId: id,
    expectedStateVersion: z.number().int().nonnegative(),
    payload: z
      .object({
        weaponId: z.enum(['arrow', 'fireball', 'mega_bomb']),
        targetSlotIndex: slotIndex,
      })
      .strict(),
  })
  .strict();

const purchaseShield = z
  .object({
    ...common,
    type: z.literal('PURCHASE_SHIELD'),
    matchId: id,
    expectedStateVersion: z.number().int().nonnegative(),
    payload: z
      .object({
        shieldId: z.literal('basic_shield'),
        beneficiarySlotIndex: slotIndex,
      })
      .strict(),
  })
  .strict();

const fundMercenary = z
  .object({
    ...common,
    type: z.literal('FUND_MERCENARY'),
    matchId: id,
    expectedStateVersion: z.number().int().nonnegative(),
    payload: z
      .object({
        beneficiarySlotIndex: slotIndex,
        amountCoins: z
          .number()
          .int()
          .min(GRID9_MIN_MERCENARY_FUND_COINS)
          .max(GRID9_MAX_MERCENARY_FUND_COINS),
      })
      .strict(),
  })
  .strict();

const requestSnapshot = z
  .object({
    ...common,
    type: z.literal('REQUEST_SNAPSHOT'),
    matchId: id,
    expectedStateVersion: z.null(),
    payload: z
      .object({
        lastSeenStateVersion: z.number().int().nonnegative().nullable(),
        lastSeenSequence: z.number().int().nonnegative().nullable(),
      })
      .strict(),
  })
  .strict();

const ping = z
  .object({
    ...common,
    type: z.literal('PING'),
    matchId: z.null(),
    expectedStateVersion: z.null(),
    payload: z.object({ clientTime: z.string().datetime() }).strict(),
  })
  .strict();

export const grid9ClientIntentSchema = z.discriminatedUnion('type', [
  queueJoin,
  queueLeave,
  matchJoin,
  reserveCoins,
  fireWeapon,
  purchaseShield,
  fundMercenary,
  requestSnapshot,
  ping,
]);

export function parseGrid9ClientIntent(value: unknown): Grid9ClientIntent {
  return grid9ClientIntentSchema.parse(value) as Grid9ClientIntent;
}
