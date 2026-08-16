import { createHash, randomBytes } from 'crypto';

export const GRID9_GAME_ID = 'grid9' as const;
export const GRID9_SCHEMA_VERSION = 1 as const;
export const GRID9_PROTOCOL_VERSION = 2 as const;
export const GRID9_RULES_VERSION = '2026-08-16.5' as const;

export const GRID9_SLOT_COUNT = 9 as const;
export const GRID9_SLOT_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;
export type Grid9SlotIndex = (typeof GRID9_SLOT_INDICES)[number];

export const GRID9_MAX_HEALTH = 100 as const;
export const GRID9_MAX_SHIELD_POINTS = 100 as const;
export const GRID9_TOP_SUPPORTERS_PER_SLOT = 10 as const;
export const GRID9_INVENTORY_CAPACITY = 3 as const;

export const GRID9_SENTINEL_FILL_DELAY_MS = 0 as const;
/** @deprecated v1 name — public lobby uses GRID9_PUBLIC_LOBBY_MS */
export const GRID9_COUNTDOWN_MS = 30_000 as const;
/**
 * Public matchmaking lobby window. Humans who Join in this window coalesce into
 * the same open public match before sentinel fill + roulette. Private rooms are
 * unchanged (code join / host start).
 */
export const GRID9_PUBLIC_LOBBY_MS = 30_000 as const;
export const GRID9_ROULETTE_DURATION_MS = 3_500 as const;
export const GRID9_TURN_DURATION_MS = 30_000 as const;
/** Active seat highlight matches the 30s action window in v2. */
export const GRID9_SPOTLIGHT_DURATION_MS = 30_000 as const;
/** Sentinel spotlight auto-act ceiling — do not wait for client intents. */
export const GRID9_SENTINEL_MAX_REACTION_MS = 1_500 as const;
export const GRID9_MAX_MATCH_DURATION_MS = 15 * 60 * 1_000;

export const GRID9_HOUSE_SEED_COINS = 100 as const;

/**
 * Audience gift split (basis points of gift face coins).
 * Locked: 70% recipient seat bankroll / supporters, 30% match jackpot.
 */
export const GRID9_AUDIENCE_GIFT_SEAT_BPS = 7000 as const;
export const GRID9_AUDIENCE_GIFT_JACKPOT_BPS = 3000 as const;
/** Victory: Tokens credited = floor(jackpotCoins * 5000 / 10000). House keeps the rest. */
export const GRID9_TOKEN_PAYOUT_BPS = 5000 as const;
/**
 * Tokens → COIN Instant convert bonus (mirrors gems: ceil(tokens * 1.15)).
 * Not a fee — Alex locked Instant as +15% bonus at the conversion boundary.
 */
export const GRID9_TOKEN_CONVERT_BONUS_BPS = 1500 as const;
/** @deprecated Use GRID9_TOKEN_CONVERT_BONUS_BPS — Instant is a bonus, not a fee. */
export const GRID9_INSTANT_CONVERT_FEE_BPS = GRID9_TOKEN_CONVERT_BONUS_BPS;

/** Short reconnect grace before auto-resolve turn / mark disconnected. */
export const GRID9_DISCONNECT_GRACE_MS = 9_000 as const;

export function splitGrid9AudienceGiftCoins(amountCoins: number): {
  seatCoins: number;
  jackpotCoins: number;
} {
  const amount = Math.floor(Number(amountCoins) || 0);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return { seatCoins: 0, jackpotCoins: 0 };
  }
  const seatCoins = Math.floor((amount * GRID9_AUDIENCE_GIFT_SEAT_BPS) / 10_000);
  return { seatCoins, jackpotCoins: amount - seatCoins };
}

export function tokensFromJackpotCoins(jackpotCoins: number): number {
  const coins = Math.floor(Number(jackpotCoins) || 0);
  if (!Number.isSafeInteger(coins) || coins <= 0) return 0;
  return Math.floor((coins * GRID9_TOKEN_PAYOUT_BPS) / 10_000);
}

export const GRID9_MICRO_DROP_COIN_REWARD = 5 as const;
export const GRID9_MICRO_DROP_SHIELD_REWARD = 15 as const;

export const GRID9_FREE_DROP_WEIGHTS = {
  arrow: 65,
  basic_shield: 18,
  kiss: 7,
  fireball: 8,
  mega_bomb: 2,
} as const;

export const GRID9_MIN_MERCENARY_FUND_COINS = 10 as const;
export const GRID9_MAX_MERCENARY_FUND_COINS = 5_000 as const;
export const GRID9_MIN_ESCROW_RESERVE_COINS = 10 as const;
export const GRID9_MAX_ESCROW_RESERVE_COINS = 20_000 as const;
/** Optional match entry fee (0 = free). 100% credited to jackpot on seat claim. */
export const GRID9_MIN_ENTRY_FEE_COINS = 0 as const;
export const GRID9_MAX_ENTRY_FEE_COINS = 5_000 as const;

export const GRID9_NONCE_BYTES = 16 as const;
export const GRID9_NONCE_MIN_BASE64URL_LENGTH = 22 as const;
export const GRID9_NONCE_MAX_BASE64URL_LENGTH = 128 as const;
export const GRID9_NONCE_TTL_SECONDS = 10 * 60;
export const GRID9_INTENT_RECEIPT_TTL_SECONDS = 24 * 60 * 60;
export const GRID9_MATCH_TTL_SECONDS = 24 * 60 * 60;
export const GRID9_LEDGER_TTL_SECONDS = 30 * 24 * 60 * 60;
export const GRID9_LOCK_TTL_MS = 8_000 as const;
export const GRID9_SPONSOR_PASS_TTL_SECONDS = 24 * 60 * 60;
export const GRID9_PRIVATE_ROOM_CODE_LENGTH = 6 as const;

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
