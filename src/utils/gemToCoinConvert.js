/**
 * Client mirror of backend gem→coin convert.
 * Gift half already applied coins→gems; convert is 1:1 + 15% ceil.
 *   coinsOut = Math.ceil(gems * 1.15)
 */
export const GEM_TO_COIN_BONUS_MULTIPLIER = 1.15;

export function coinsFromGemsConvert(gems) {
  const g = Math.floor(Number(gems) || 0);
  if (!Number.isFinite(g) || g <= 0) return 0;
  return Math.ceil((g * 115) / 100);
}

export function describeGemToCoinRate() {
  return '1 gem = 1 coin + 15% bonus (rounded up)';
}
