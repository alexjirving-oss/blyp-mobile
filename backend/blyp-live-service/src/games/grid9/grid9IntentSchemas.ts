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
  protocolVersion: z.literal(2),
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

const sendArsenalGift = z
  .object({
    ...common,
    type: z.literal('SEND_ARSENAL_GIFT'),
    matchId: id,
    expectedStateVersion: z.number().int().nonnegative(),
    payload: z
      .object({
        itemId: z.enum(['arrow', 'fireball', 'mega_bomb', 'basic_shield']),
        recipientSlotIndex: slotIndex,
      })
      .strict(),
  })
  .strict();

const buyInventoryItem = z
  .object({
    ...common,
    type: z.literal('BUY_INVENTORY_ITEM'),
    matchId: id,
    expectedStateVersion: z.number().int().nonnegative(),
    payload: z
      .object({
        itemId: z.enum(['arrow', 'fireball', 'mega_bomb', 'basic_shield']),
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

const privateRoomCreate = z
  .object({
    ...common,
    type: z.literal('PRIVATE_ROOM_CREATE'),
    matchId: z.null(),
    expectedStateVersion: z.null(),
    payload: z
      .object({
        region: id,
        displayName: z.string().min(1).max(80).optional(),
        entryFeeCoins: z.number().int().min(0).max(5_000).optional(),
      })
      .strict(),
  })
  .strict();

const privateRoomJoin = z
  .object({
    ...common,
    type: z.literal('PRIVATE_ROOM_JOIN'),
    matchId: z.null(),
    expectedStateVersion: z.null(),
    payload: z.object({ region: id, roomCode: z.string().min(4).max(12) }).strict(),
  })
  .strict();

const startPrivateMatch = z
  .object({
    ...common,
    type: z.literal('START_PRIVATE_MATCH'),
    matchId: id,
    expectedStateVersion: z.number().int().nonnegative(),
    payload: z.object({ confirm: z.literal(true) }).strict(),
  })
  .strict();

const kickPlayer = z
  .object({
    ...common,
    type: z.literal('KICK_PLAYER'),
    matchId: id,
    expectedStateVersion: z.number().int().nonnegative(),
    payload: z.object({ targetUserId: id }).strict(),
  })
  .strict();

const changeSettings = z
  .object({
    ...common,
    type: z.literal('CHANGE_SETTINGS'),
    matchId: id,
    expectedStateVersion: z.number().int().nonnegative(),
    payload: z.object({ settings: z.record(z.unknown()) }).strict(),
  })
  .strict();

const matchLeave = z
  .object({
    ...common,
    type: z.literal('MATCH_LEAVE'),
    matchId: id,
    expectedStateVersion: z.number().int().nonnegative().nullable(),
    payload: z
      .object({
        reason: z.enum(['user', 'navigation']).nullable().optional(),
      })
      .strict(),
  })
  .strict();

export const grid9ClientIntentSchema = z.discriminatedUnion('type', [
  queueJoin,
  queueLeave,
  matchJoin,
  matchLeave,
  privateRoomCreate,
  privateRoomJoin,
  startPrivateMatch,
  kickPlayer,
  changeSettings,
  reserveCoins,
  fireWeapon,
  purchaseShield,
  fundMercenary,
  sendArsenalGift,
  buyInventoryItem,
  requestSnapshot,
  ping,
]);

export function parseGrid9ClientIntent(value: unknown): Grid9ClientIntent {
  return grid9ClientIntentSchema.parse(value) as Grid9ClientIntent;
}
