/**
 * Daily treasure chest (verified accounts) — amounts + feature flag.
 *
 * Reset window: UTC midnight (same convention as /economy/daily-reward).
 *
 * Defaults (documented):
 *   TREASURE_CHEST_BASE_COINS  = 15  (within product band 5–25)
 *   TREASURE_CHEST_BONUS_COINS = 10  (post a new video same UTC day)
 *   TREASURE_CHEST_ENABLED     = 1
 *
 * Deploy: gcloud run services update blyp-live-service --update-env-vars \
 *   "TREASURE_CHEST_ENABLED=1,TREASURE_CHEST_BASE_COINS=15,TREASURE_CHEST_BONUS_COINS=10"
 * (do not use --set-env-vars; that wipes existing env).
 */

function parsePositiveInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function envTruthy(raw: string | undefined, defaultOn: boolean): boolean {
  if (raw === undefined || raw === null || String(raw).trim() === '') return defaultOn;
  const v = String(raw).trim().toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(v)) return false;
  if (['1', 'true', 'on', 'yes'].includes(v)) return true;
  return defaultOn;
}

export type TreasureChestAmounts = {
  enabled: boolean;
  baseCoins: number;
  bonusCoins: number;
  /** Inclusive product band for docs / admin UI. */
  baseMin: number;
  baseMax: number;
};

export function getTreasureChestAmounts(): TreasureChestAmounts {
  return {
    enabled: envTruthy(process.env.TREASURE_CHEST_ENABLED, true),
    baseCoins: parsePositiveInt(process.env.TREASURE_CHEST_BASE_COINS, 15, 5, 25),
    bonusCoins: parsePositiveInt(process.env.TREASURE_CHEST_BONUS_COINS, 10, 1, 50),
    baseMin: 5,
    baseMax: 25,
  };
}
