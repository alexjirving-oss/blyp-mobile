/**
 * Gems → spendable COIN convert.
 *
 * Gift path already applied the half: 100 coins spent → 50 gems (1p each).
 * Converting gems back is NOT another half.
 *
 * Rate: 1 gem → 1 coin + 15% bonus, rounded UP.
 *   coinsOut = Math.ceil(gems * 1.15)
 * Example: 50 gems → ceil(57.5) → 58 coins.
 *
 * UI copy: "1 gem = 1 coin + 15% bonus (rounded up)."
 */
export const GEM_TO_COIN_FACE_RATIO = 1 as const;
export const GEM_TO_COIN_CONVERT_BONUS_MULTIPLIER = 1.15 as const;

/** Integer form of ×1.15 with ceil: ceil(gems * 115 / 100). */
export const GEM_TO_COIN_BONUS_NUM = 115;
export const GEM_TO_COIN_BONUS_DEN = 100;

export function coinsFromGemsConvert(gems: number): number {
  const g = Math.floor(Number(gems) || 0);
  if (!Number.isFinite(g) || g <= 0) return 0;
  // Equivalent to Math.ceil(g * 1.15) for positive integers.
  return Math.ceil((g * GEM_TO_COIN_BONUS_NUM) / GEM_TO_COIN_BONUS_DEN);
}

export function describeGemToCoinRate(): string {
  return '1 gem = 1 coin + 15% bonus (rounded up)';
}
