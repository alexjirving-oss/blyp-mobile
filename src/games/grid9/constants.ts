export const GRID9_GAME_ID = 'grid9' as const;
export const GRID9_PROTOCOL = 'grid9.ws' as const;
export const GRID9_PROTOCOL_VERSION = 1 as const;
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

export type Grid9WeaponId = 'arrow' | 'fireball' | 'mega_bomb';
export type Grid9ShieldId = 'basic_shield';

export function isGrid9SlotIndex(value: number): value is Grid9SlotIndex {
  return Number.isInteger(value) && value >= 0 && value < GRID9_SLOT_COUNT;
}
