/**
 * Tokens → spendable COIN convert (Grid 9 victory currency).
 *
 * Mirrors gems→coins Instant boundary without touching gem paths:
 * Rate: 1 token → 1 coin + 15% bonus, rounded UP.
 *   coinsOut = Math.ceil(tokens * 1.15)
 *
 * Tokens are credited from jackpot settlement at 50% of final jackpot coins.
 * Conversion is the monetization boundary (not raw coin jackpot payout).
 */
export const TOKEN_TO_COIN_FACE_RATIO = 1 as const;
export const TOKEN_TO_COIN_CONVERT_BONUS_MULTIPLIER = 1.15 as const;

/** Integer form of ×1.15 with ceil: ceil(tokens * 115 / 100). */
export const TOKEN_TO_COIN_BONUS_NUM = 115;
export const TOKEN_TO_COIN_BONUS_DEN = 100;

export function coinsFromTokensConvert(tokens: number): number {
  const t = Math.floor(Number(tokens) || 0);
  if (!Number.isFinite(t) || t <= 0) return 0;
  return Math.ceil((t * TOKEN_TO_COIN_BONUS_NUM) / TOKEN_TO_COIN_BONUS_DEN);
}

export function describeTokenToCoinRate(): string {
  return '1 token = 1 coin + 15% bonus (rounded up)';
}
