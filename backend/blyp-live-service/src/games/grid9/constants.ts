import { createHash, randomBytes } from 'crypto';

export const GRID9_GAME_ID = 'grid9' as const;
export const GRID9_SCHEMA_VERSION = 1 as const;
export const GRID9_PROTOCOL_VERSION = 1 as const;
export const GRID9_RULES_VERSION = '2026-08-15.1' as const;

export const GRID9_SLOT_COUNT = 9 as const;
export const GRID9_SLOT_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;
export type Grid9SlotIndex = (typeof GRID9_SLOT_INDICES)[number];

export const GRID9_MAX_HEALTH = 100 as const;
export const GRID9_MAX_SHIELD_POINTS = 60 as const;
export const GRID9_TOP_SUPPORTERS_PER_SLOT = 10 as const;

export const GRID9_SENTINEL_FILL_DELAY_MS = 0 as const;
export const GRID9_COUNTDOWN_MS = 3_000 as const;
export const GRID9_TURN_DURATION_MS = 5_000 as const;
export const GRID9_SPOTLIGHT_DURATION_MS = 1_250 as const;
export const GRID9_MAX_MATCH_DURATION_MS = 15 * 60 * 1_000;

export const GRID9_MICRO_DROP_COIN_REWARD = 5 as const;
export const GRID9_MICRO_DROP_SHIELD_REWARD = 15 as const;

export const GRID9_MIN_MERCENARY_FUND_COINS = 10 as const;
export const GRID9_MAX_MERCENARY_FUND_COINS = 5_000 as const;
export const GRID9_MIN_ESCROW_RESERVE_COINS = 10 as const;
export const GRID9_MAX_ESCROW_RESERVE_COINS = 20_000 as const;

export const GRID9_NONCE_BYTES = 16 as const;
export const GRID9_NONCE_MIN_BASE64URL_LENGTH = 22 as const;
export const GRID9_NONCE_MAX_BASE64URL_LENGTH = 128 as const;
export const GRID9_NONCE_TTL_SECONDS = 10 * 60;
export const GRID9_INTENT_RECEIPT_TTL_SECONDS = 24 * 60 * 60;
export const GRID9_MATCH_TTL_SECONDS = 24 * 60 * 60;
export const GRID9_LEDGER_TTL_SECONDS = 30 * 24 * 60 * 60;
export const GRID9_LOCK_TTL_MS = 8_000 as const;
export const GRID9_SPONSOR_PASS_TTL_SECONDS = 24 * 60 * 60;

export const GRID9_SOCKET_CHANNEL = 'grid9' as const;
export const GRID9_SOCKET_ROOM_PREFIX = 'grid9:match:' as const;

export function isGrid9SlotIndex(value: number): value is Grid9SlotIndex {
  return Number.isInteger(value) && value >= 0 && value < GRID9_SLOT_COUNT;
}

export function createGrid9CryptographicNonce(): string {
  return randomBytes(GRID9_NONCE_BYTES).toString('base64url');
}

export function grid9EntropyCommitment(
  matchId: string,
  entropySeed: string,
): string {
  return createHash('sha256')
    .update(`grid9:${matchId}:${entropySeed}`, 'utf8')
    .digest('hex');
}

export function isGrid9NonceEncoding(value: string): boolean {
  if (
    value.length < GRID9_NONCE_MIN_BASE64URL_LENGTH ||
    value.length > GRID9_NONCE_MAX_BASE64URL_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    return false;
  }
  try {
    const decoded = Buffer.from(value, 'base64url');
    return (
      decoded.length >= GRID9_NONCE_BYTES &&
      decoded.toString('base64url') === value
    );
  } catch {
    return false;
  }
}
