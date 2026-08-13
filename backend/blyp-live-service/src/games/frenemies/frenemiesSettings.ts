/** Session settings helpers (pure — safe for unit tests). */

export const SPIN_OPTIONS_MS = [10_000, 15_000, 20_000, 30_000] as const;
export const AUTO_DELAY_OPTIONS_MS = [5_000, 10_000, 15_000, 30_000, 45_000, 60_000] as const;
/** Prize chips for throw / solo — 10 default, 20 walk-away option. */
export const PRIZE_COIN_OPTIONS = [10, 20, 25, 50] as const;

export const DEFAULT_SPIN_MS = 15_000;
export const DEFAULT_CHOOSE_MS = 20_000;
export const DEFAULT_CHALLENGE_MS = 20_000;
export const DEFAULT_RESULT_MS = 6_000;
/** Pause after result before next auto-spin (owner walk-away cadence). */
export const DEFAULT_AUTO_DELAY_MS = 60_000;
export const DEFAULT_COINS = 10;
export const MAX_COINS = 500;
export const DEFAULT_LIKES = 50;

const ENV_SPIN_MS = process.env.FRENEMIES_SPIN_MS
  ? Math.max(5_000, Number(process.env.FRENEMIES_SPIN_MS) || DEFAULT_SPIN_MS)
  : null;
const ENV_CHOOSE_MS = process.env.FRENEMIES_CHOOSE_MS
  ? Math.max(5_000, Number(process.env.FRENEMIES_CHOOSE_MS) || DEFAULT_CHOOSE_MS)
  : null;
const ENV_CHALLENGE_MS = process.env.FRENEMIES_CHALLENGE_MS
  ? Math.max(5_000, Number(process.env.FRENEMIES_CHALLENGE_MS) || DEFAULT_CHALLENGE_MS)
  : null;
const ENV_LIKES = process.env.FRENEMIES_LIKES_TARGET
  ? Math.max(5, Number(process.env.FRENEMIES_LIKES_TARGET) || DEFAULT_LIKES)
  : null;

export interface FrenemiesSettings {
  spinMs: number;
  chooseMs: number;
  challengeMs: number;
  resultMs: number;
  autoContinue: boolean;
  autoContinueDelayMs: number;
  throwCoins: number;
  soloCoins: number;
  likesTarget: number;
  challengeQuiz: boolean;
  challengeChat: boolean;
  challengeLikes: boolean;
  housePays: boolean;
  showPayerBadge: boolean;
}

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, v));
}

export function nearestSpinMs(ms: number): number {
  let best: number = SPIN_OPTIONS_MS[0];
  let bestDiff = Math.abs(ms - best);
  for (const opt of SPIN_OPTIONS_MS) {
    const d = Math.abs(ms - opt);
    if (d < bestDiff) {
      best = opt;
      bestDiff = d;
    }
  }
  return best;
}

export function nearestAutoDelayMs(ms: number): number {
  let best: number = AUTO_DELAY_OPTIONS_MS[0];
  let bestDiff = Math.abs(ms - best);
  for (const opt of AUTO_DELAY_OPTIONS_MS) {
    const d = Math.abs(ms - opt);
    if (d < bestDiff) {
      best = opt;
      bestDiff = d;
    }
  }
  return best;
}

export function defaultSettings(partial?: Partial<FrenemiesSettings>): FrenemiesSettings {
  return {
    spinMs: nearestSpinMs(partial?.spinMs ?? ENV_SPIN_MS ?? DEFAULT_SPIN_MS),
    chooseMs: clampInt(partial?.chooseMs ?? ENV_CHOOSE_MS ?? DEFAULT_CHOOSE_MS, 8_000, 45_000, DEFAULT_CHOOSE_MS),
    challengeMs: clampInt(
      partial?.challengeMs ?? ENV_CHALLENGE_MS ?? DEFAULT_CHALLENGE_MS,
      8_000,
      45_000,
      DEFAULT_CHALLENGE_MS,
    ),
    resultMs: clampInt(partial?.resultMs ?? DEFAULT_RESULT_MS, 3_000, 12_000, DEFAULT_RESULT_MS),
    autoContinue: partial?.autoContinue === true,
    autoContinueDelayMs: nearestAutoDelayMs(
      clampInt(
        partial?.autoContinueDelayMs ?? DEFAULT_AUTO_DELAY_MS,
        5_000,
        60_000,
        DEFAULT_AUTO_DELAY_MS,
      ),
    ),
    throwCoins: clampInt(partial?.throwCoins ?? DEFAULT_COINS, 0, MAX_COINS, DEFAULT_COINS),
    soloCoins: clampInt(partial?.soloCoins ?? DEFAULT_COINS, 0, MAX_COINS, DEFAULT_COINS),
    likesTarget: clampInt(partial?.likesTarget ?? ENV_LIKES ?? DEFAULT_LIKES, 10, 500, DEFAULT_LIKES),
    challengeQuiz: partial?.challengeQuiz !== false,
    challengeChat: partial?.challengeChat !== false,
    challengeLikes: partial?.challengeLikes !== false,
    housePays: partial?.housePays === true,
    showPayerBadge: partial?.showPayerBadge !== false,
  };
}

export function maxPrizeForSettings(s: FrenemiesSettings): number {
  return Math.max(0, s.throwCoins, s.soloCoins);
}
