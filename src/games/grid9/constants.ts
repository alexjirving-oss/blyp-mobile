export const GRID9_GAME_ID = 'grid9' as const;
export const GRID9_PROTOCOL = 'grid9.ws' as const;
export const GRID9_PROTOCOL_VERSION = 2 as const;
export const GRID9_SOCKET_CHANNEL = 'grid9' as const;
export const GRID9_SLOT_COUNT = 9 as const;
export const GRID9_SLOT_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;
export type Grid9SlotIndex = (typeof GRID9_SLOT_INDICES)[number];

export const GRID9_NONCE_BYTES = 16 as const;
export const GRID9_NONCE_MIN_BASE64URL_LENGTH = 22 as const;
export const GRID9_NONCE_MAX_BASE64URL_LENGTH = 128 as const;

export const GRID9_MIN_MERCENARY_FUND_COINS = 10 as const;
export const GRID9_MAX_MERCENARY_FUND_COINS = 5_000 as const;
export const GRID9_MIN_ESCROW_RESERVE_COINS = 10 as const;
export const GRID9_MAX_ESCROW_RESERVE_COINS = 20_000 as const;
/** Default stake pulled into match escrow when a seated player has none. */
export const GRID9_DEFAULT_ESCROW_RESERVE_COINS = 100 as const;
/** Optional entry fee → 100% jackpot. 0 = free. */
export const GRID9_MIN_ENTRY_FEE_COINS = 0 as const;
export const GRID9_MAX_ENTRY_FEE_COINS = 5_000 as const;

export const GRID9_INVENTORY_CAPACITY = 3 as const;
export const GRID9_ROULETTE_FLASH_MS = 12_000 as const;
/** Dramatic selection show length (must match server GRID9_ROULETTE_DURATION_MS). */
export const GRID9_ROULETTE_DURATION_MS = GRID9_ROULETTE_FLASH_MS;
/** Public Join coalesces into one open lobby for this window (ms). */
export const GRID9_PUBLIC_LOBBY_MS = 30_000 as const;
export const GRID9_TURN_DURATION_MS = 30_000 as const;
export const GRID9_HOUSE_SEED_COINS = 100 as const;

/** Audience gift: 100% seat bankroll; jackpot += 10% of face as platform match. */
export const GRID9_AUDIENCE_GIFT_SEAT_BPS = 10_000 as const;
export const GRID9_AUDIENCE_GIFT_JACKPOT_BPS = 1000 as const;
/** Victory Tokens = floor(jackpotCoins * 50%). */
export const GRID9_TOKEN_PAYOUT_BPS = 5000 as const;
/** Tokens→Coins Instant bonus (+15%), mirrors gems convert. */
export const GRID9_TOKEN_CONVERT_BONUS_BPS = 1500 as const;
/** @deprecated alias for GRID9_TOKEN_CONVERT_BONUS_BPS */
export const GRID9_INSTANT_CONVERT_FEE_BPS = GRID9_TOKEN_CONVERT_BONUS_BPS;

export function tokensFromJackpotCoins(jackpotCoins: number): number {
  const coins = Math.floor(Number(jackpotCoins) || 0);
  if (!Number.isSafeInteger(coins) || coins <= 0) return 0;
  return Math.floor((coins * GRID9_TOKEN_PAYOUT_BPS) / 10_000);
}

export function coinsFromTokensConvert(tokens: number): number {
  const t = Math.floor(Number(tokens) || 0);
  if (!Number.isFinite(t) || t <= 0) return 0;
  return Math.ceil((t * (10_000 + GRID9_TOKEN_CONVERT_BONUS_BPS)) / 10_000);
}

export type Grid9WeaponId = 'arrow' | 'fireball' | 'mega_bomb' | 'kiss';
export type Grid9ShieldId = 'basic_shield';
export type Grid9ArsenalItemId = Grid9WeaponId | Grid9ShieldId;

export function isGrid9SlotIndex(value: number): value is Grid9SlotIndex {
  return Number.isInteger(value) && value >= 0 && value < GRID9_SLOT_COUNT;
}
